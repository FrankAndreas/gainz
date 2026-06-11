# Authentication Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

The fitness tracker API has no authentication. Any client that can reach the host can read or write any user's workout data. The goal is to add per-user password authentication so each family member logs in with their own credentials and can only access their own data.

## Constraints

- Home / trusted-network deployment; UX should be low-friction
- Existing flat-file JSON storage; no database
- Must support algorithm migration without re-enrollment (bcrypt today, argon2 later)

---

## Architecture

### What changes

| Endpoint | Before | After |
|---|---|---|
| `GET /users` | Public | **Stays public** (login page needs it) |
| `GET /exercises` | Public | Requires valid JWT |
| `POST /workouts` | Public | Requires JWT; `user_id` must match token |
| `GET /workouts` | Public | Requires JWT; `user_id` must match token |
| `GET /workouts/{date}` | Public | Requires JWT; `user_id` must match token |
| `GET /records` | Public | Requires JWT; `user_id` must match token |
| `POST /login` | — | **New** (public) |

### New files

- `data/credentials.json` — bcrypt password hashes, keyed by `user_id`
- `backend/set_password.py` — CLI script for changing passwords
- `frontend/src/LoginPage.tsx` — login screen component

---

## Backend

### Dependencies

```
passlib[bcrypt]
python-jose[cryptography]
```

### Credentials storage (`data/credentials.json`)

```json
{
  "user1": "$2b$12$...",
  "user2": "$2b$12$..."
}
```

The bcrypt hash string is self-describing — it encodes the algorithm identifier (`$2b$`) and cost factor (`$12$`). No separate metadata field is needed. To migrate to argon2 later, update the `CryptContext` schemes list; passlib re-hashes transparently on next login.

`credentials.json` is kept outside the normal data export path. It must never be included in any backup or API response.

### Password context

```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
```

To upgrade algorithm in future: `schemes=["argon2", "bcrypt"], deprecated=["bcrypt"]`.

### JWT

- Library: `python-jose`
- Algorithm: `HS256`
- Signing secret: `JWT_SECRET` env var (required; long random string)
- Expiry: 30 days (suitable for home use; configurable via `JWT_EXPIRE_DAYS` env var)
- Payload: `{"sub": "<user_id>", "exp": <timestamp>}`

### New endpoint: `POST /login`

Request:
```json
{ "user_id": "user1", "password": "…" }
```

Response (200):
```json
{ "access_token": "…", "token_type": "bearer" }
```

Errors:
- `401` — wrong user_id or wrong password (same message for both; no enumeration)

### FastAPI auth dependency

```python
async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    # decode JWT, validate exp, return user_id
    # raises 401 on any failure
```

All protected endpoints gain `current_user: str = Depends(get_current_user)` and assert `current_user == requested_user_id`.

### Password initialization (first boot)

On startup, if `data/credentials.json` does not exist, `initialize_data()` reads env vars of the form `INITIAL_PASSWORD_<user_id>` (e.g. `INITIAL_PASSWORD_user1`), hashes them with bcrypt, and writes `credentials.json`. The env vars are only consumed once; they can be removed from `docker-compose.yml` after first boot.

Example `docker-compose.yml` addition (first boot only):
```yaml
environment:
  - JWT_SECRET=<long-random-string>
  - INITIAL_PASSWORD_user1=changeme
  - INITIAL_PASSWORD_user2=changeme
```

### Password management script (`backend/set_password.py`)

```
docker compose exec backend python set_password.py <user_id> <new_password>
```

Reads `credentials.json`, updates the hash for the given user, writes it back. Used for changing passwords after initial setup.

---

## Frontend

### Login page (`frontend/src/LoginPage.tsx`)

Shown when localStorage contains no valid JWT. Contains:
- User picker dropdown (populated from `GET /users`)
- Password field
- Submit button → `POST /login` → store token → show main app

The existing user switcher dropdown in the main app is **removed**. Switching users requires logging out and logging in as the other user.

### JWT storage and transport

- Stored in `localStorage` under key `fitness_token`
- An axios request interceptor attaches `Authorization: Bearer <token>` to every API call
- An axios response interceptor catches `401` responses, clears the stored token, and redirects to the login screen

### Logout

A logout button in the app header clears `fitness_token` from localStorage and returns the user to the login screen. No server-side session to invalidate (JWT is stateless).

### Auth state

`App.tsx` checks for a stored, non-expired token on mount. If absent or expired, renders `<LoginPage />` instead of the main UI. Token expiry is checked client-side by decoding the JWT payload (no library needed; just parse the base64 `exp` claim).

---

## Security properties

- Passwords never stored in plaintext; bcrypt hashes only
- Algorithm agility: `CryptContext` + self-describing hash strings enable future migration without re-enrollment
- `JWT_SECRET` is required from the environment; the app refuses to start without it
- Login error messages are identical for unknown user and wrong password (no enumeration)
- Each protected endpoint independently verifies the JWT user matches the requested resource (no relying solely on the route guard)
- `credentials.json` is separate from workout data and must be excluded from any export/restore flows

---

## Out of scope

- Token refresh / sliding sessions (30-day expiry is acceptable for home use)
- Account lockout after failed attempts
- Password strength enforcement
- HTTPS (separate infrastructure concern; recommended but not part of this change)

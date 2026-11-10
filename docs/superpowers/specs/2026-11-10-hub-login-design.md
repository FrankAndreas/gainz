# Fitness tracker: log in through the family hub

Date: 2026-11-10. The fitness tracker (gainz) joins the family hub (FrankAndreas/family-hub), after the budget app,
the meal planner, the chores app, the job tracking app and the planner. It follows their switch (family-chore and
family-meal-planner `docs/superpowers/specs/2026-10-30-hub-login-design.md`) and the planner's code, which uses the
hub's client package. The user said "go" to the proposed plan, so points marked **(my call)** were settled by Claude.

## Why

- **One login for the family.** Today each person has a password here, set on the NAS with `set_password.py`.
- **One place for security.** The hub holds the login, the PINs, the lock after wrong PINs and "log out everywhere".
- **One start page.** The tracker gets a tile in the hub.

## How this app differs

- Data lives in JSON files (`users.json`, `workouts/<user id>/<date>.json`), not SQL: linking people is done in
  `users.json`, there is no migration.
- No roles: everyone sees only their own workouts. That stays.
- It runs at `http://<NAS_IP>:8083`. The hub's cookie is set for `local.<domain>`, so the tracker needs the address
  `https://fitness.local.<domain>`.

## Goals

1. **Login:** the hub's `hub_session` cookie (`Authorization: Bearer` for tests and scripts).
   - The hub's `/api/session?app=fitness` says whose it is and whether they may use the tracker **(my call:** key
     `fitness`).
   - A change made with the cookie needs `X-Requested-With: fitness`.
   - **Home only (my call):** a request carrying `Cf-Connecting-Ip` is no login (401).
   - In the hub login's last week the backend answers `X-Hub-Renew: 1`; the page goes through the hub once (at most
     once a day, never without storage), as in the planner.
   - Gone: passwords, `credentials.json`, `set_password.py`, `JWT_SECRET`, `JWT_EXPIRE_DAYS`,
     `INITIAL_PASSWORD_*`, the seeded `user1`/`user2`, `bcrypt`, `PyJWT`, the login page, the token in local storage.
2. **People come from the hub:** `/api/apps/fitness/people`, at most once a minute, one refresh at a time, 10 s
   backoff after the hub failed (the planner's `hub_people`). Each person in `users.json` gets `hub_id` and
   `is_active`; the name follows the hub.
3. **Existing workouts stay with their person.**
   - Local ids stay (`user1` keeps `workouts/user1/`); no folder moves **(my call)**. A new hub person gets the id
     `hub<hub id>`.
   - At the first sync only (no entry has a `hub_id` yet) an entry without `hub_id` is linked to the hub person with
     the same name (case and surrounding spaces ignored). After that nothing is linked by name: a new person with an
     old name must not take over someone's workouts.
   - For a name that doesn't match (the seeded "Family Member"): `python backend/link_user.py <user id> <hub id>` on
     the NAS. It refuses a hub id already linked to someone else.
4. **Removed in the hub:** the person is hidden (`is_active` false), their workouts stay **(my call:** deleting their
   data is done by hand on the NAS; the app has no admin page).
5. **The API uses the login's person (my call):** the `user_id` query parameter and body field go away; the backend
   uses the logged-in person's local id.
6. **"Log out"** goes to `<HUB_PUBLIC_URL>/logout?next=<the app>`. A 401 sends the browser to
   `<HUB_PUBLIC_URL>/?next=<current address>`. "No access" and "hub unavailable" each get their own page.

## Errors

Each error answers `{"detail": {"code": "<code>"}}`:

| Status | Code | When |
|---|---|---|
| 401 | `not_logged_in` | no token, invalid token, or a request from outside |
| 403 | `csrf` | cookie login, a change, no `X-Requested-With: fitness` |
| 403 | `no_access` | valid login, no access to `fitness` |
| 503 | `hub_unavailable` | the hub doesn't answer as expected |

Validation errors (400/404/422/500) keep their current form.

## Endpoints

- **New:** `GET /me` → `{"id", "name"}`; `GET /hub` → `{"login_url", "logout_url"}` (no login needed).
- **Changed:** `POST /workouts` (no `user_id` in the body), `GET /workouts`, `GET /workouts/{date}`, `GET /records`
  (no `user_id` parameter).
- **Removed:** `POST /login`, `GET /users`.
- `/`, `/health` and `/exercises` stay (`/exercises` with a login).

## Frontend

- Removed: `LoginPage.tsx`, the token helpers, the Authorization interceptor.
- `API_URL` is `/api` (nginx and the Vite dev proxy forward it to the backend); `VITE_API_URL` and `ALLOWED_ORIGIN`
  (CORS) go away.
- axios sends cookies (`withCredentials`) and `X-Requested-With: fitness`.
- `hubAddress.ts` from the planner (`loginAddress`, `renewNow`).
- The header shows the name from `/me`; "Sign out" goes to `logout_url`.
- The UI stays English; German is a later step.

## Non-goals

- Outside access through the Cloudflare tunnel.
- German UI (the hub's `language` is not used yet).
- Parents seeing their children's workouts (the hub's `role` is not used yet).
- e2e tests against a real hub (the tracker has no e2e suite today).

## Tests

- **Backend:** the client package's `FakeHub` (`family_hub_client.fake`). Covered: login (Bearer, cookie), CSRF,
  the tunnel header, hub down, no access, renew header; sync (new person, rename, removed person hidden and data
  kept); linking by name only at the first sync; `link_user.py`; every workout endpoint uses the login's person.
- **Frontend:** `/me` and `/hub` mocked instead of the login page; 401 redirect, no access page, hub unavailable page,
  renew, sign out; `hubAddress.test.ts`.

## Deploy

1. DSM reverse proxy: `fitness.local.<domain>` (HTTPS, 443, HSTS) → `localhost:8083`, with the `*.local.<domain>`
   certificate.
2. NAS `compose.yaml` / `.env`: the backend gets `HUB_URL=http://<NAS_IP>:8086`,
   `HUB_PUBLIC_URL=https://home.local.<domain>` and `HUB_APP_KEY=fitness`; `JWT_SECRET`, `JWT_EXPIRE_DAYS` and
   `INITIAL_PASSWORD_*` go away.
3. In the hub (Einstellungen → Apps): a tile with home address `https://fitness.local.<domain>`, no outside address,
   key `fitness`, the people who may use it.
4. Before the first login: hub names match `users.json`, or run `link_user.py`. Afterwards delete
   `data/credentials.json`.

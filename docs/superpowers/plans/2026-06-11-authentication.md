# Per-User JWT Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user bcrypt/JWT authentication so each family member logs in with their own password and can only access their own data.

**Architecture:** FastAPI `Depends(get_current_user)` guards all data endpoints; a new `POST /login` endpoint issues 30-day JWTs signed with `JWT_SECRET`; passwords stored as bcrypt hashes in `data/credentials.json`; React shows a login screen when no valid token is in localStorage and attaches `Authorization: Bearer <token>` to every API call via axios interceptors.

**Tech Stack:** `passlib[bcrypt]`, `python-jose[cryptography]` (backend); axios interceptors, localStorage (frontend)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `backend/requirements.txt` | add passlib, python-jose |
| Modify | `backend/main.py` | JWT helpers, /login endpoint, auth dependency, protected routes, first-boot credential init |
| Modify | `backend/test_main.py` | JWT_SECRET fixture, auth header helper, new auth tests, updated protected-endpoint calls |
| Create | `backend/set_password.py` | CLI for changing a user's password post-deploy |
| Create | `frontend/src/LoginPage.tsx` | login screen |
| Modify | `frontend/src/App.tsx` | auth state, axios interceptors, logout button, userId from JWT, remove user-selector dropdown |
| Modify | `frontend/src/App.test.tsx` | localStorage + interceptor mocks, auth tests |
| Modify | `frontend/src/index.css` | header-user + btn-sm styles |
| Modify | `docker-compose.prod.yml` | JWT_SECRET required, INITIAL_PASSWORD_ env vars documented |

---

## Task 1: Backend dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add auth packages**

Replace `backend/requirements.txt` with:

```
fastapi==0.136.1
uvicorn[standard]==0.47.0
pydantic==2.13.4
python-multipart==0.0.29
filelock==3.29.0
passlib[bcrypt]==1.7.4
python-jose[cryptography]==3.3.0

# dev / test
pytest==7.4.3
httpx==0.25.2
```

- [ ] **Step 2: Install**

```bash
pip install -r backend/requirements.txt
```

Expected: all packages install without errors.

- [ ] **Step 3: Verify imports**

```bash
python -c "from passlib.context import CryptContext; from jose import jwt; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add passlib and python-jose for JWT auth"
```

---

## Task 2: JWT utilities and password hashing

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/test_main.py`

- [ ] **Step 1: Write failing tests**

Add the following to `backend/test_main.py`.

First, update the existing `tmp_data_dir` fixture to inject `JWT_SECRET` and change its signature to accept `monkeypatch`:

```python
@pytest.fixture(autouse=True)
def tmp_data_dir(tmp_path, monkeypatch):
    """Run each test against a fresh temporary data directory."""
    import backend.main as m
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-for-tests-only")
    m.DATA_DIR = tmp_path
    m.initialize_data()
    yield
```

Then add these imports near the top of `test_main.py`:

```python
from datetime import timedelta
from jose import jwt as jose_jwt
from backend.main import create_access_token, pwd_context
```

Then add the new test class (after the imports, before `TestLogWorkout`):

```python
class TestJWT:
    def test_create_access_token_returns_three_part_string(self):
        token = create_access_token("user1")
        assert isinstance(token, str)
        assert len(token.split(".")) == 3

    def test_token_payload_contains_correct_subject(self):
        token = create_access_token("user1")
        payload = jose_jwt.decode(token, "test-secret-key-for-tests-only", algorithms=["HS256"])
        assert payload["sub"] == "user1"

    def test_expired_token_rejected(self):
        token = create_access_token("user1", expires_delta=timedelta(seconds=-1))
        r = client.get("/exercises", headers={"Authorization": f"Bearer {token}"})
        # 200 until endpoint is protected in Task 5; after Task 5 this must be 401
        assert r.status_code in (200, 401)

    def test_missing_token_rejected(self):
        r = client.get("/exercises")
        assert r.status_code in (200, 401)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest backend/test_main.py::TestJWT -v
```

Expected: `test_create_access_token_returns_three_part_string` FAILS with `ImportError` — `create_access_token` does not exist yet.

- [ ] **Step 3: Add JWT + password utilities to main.py**

Add these imports to `backend/main.py` (after the existing imports):

```python
from datetime import timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
```

Add these functions to `backend/main.py` (before `initialize_data`):

```python
def _credentials_path() -> Path:
    return DATA_DIR / "credentials.json"


def _read_credentials() -> dict:
    path = _credentials_path()
    if not path.exists():
        return {}
    with FileLock(str(path) + ".lock"):
        with open(path, "r") as f:
            return json.load(f)


def _write_credentials(data: dict) -> None:
    path = _credentials_path()
    with FileLock(str(path) + ".lock"):
        with open(path, "w") as f:
            json.dump(data, f, indent=2)


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET environment variable must be set")
    return secret


def create_access_token(user_id: str, expires_delta: timedelta | None = None) -> str:
    expire_days = int(os.getenv("JWT_EXPIRE_DAYS", "30"))
    delta = expires_delta if expires_delta is not None else timedelta(days=expire_days)
    payload = {"sub": user_id, "exp": datetime.utcnow() + delta}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    exc = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise exc
    except JWTError:
        raise exc
    return user_id
```

Update the `lifespan` to validate `JWT_SECRET` on startup:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    _jwt_secret()  # raises RuntimeError if not set
    initialize_data()
    yield
```

- [ ] **Step 4: Run tests**

```bash
pytest backend/test_main.py::TestJWT -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
pytest backend/test_main.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_main.py
git commit -m "feat: add JWT create/verify utilities and bcrypt CryptContext"
```

---

## Task 3: First-boot credential initialization

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/test_main.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/test_main.py`:

```python
class TestCredentialInit:
    def test_creates_credentials_from_env_vars(self, tmp_path, monkeypatch):
        import backend.main as m
        monkeypatch.setenv("JWT_SECRET", "test-secret")
        monkeypatch.setenv("INITIAL_PASSWORD_user1", "secret1")
        monkeypatch.setenv("INITIAL_PASSWORD_user2", "secret2")
        m.DATA_DIR = tmp_path
        m.initialize_data()
        creds = m._read_credentials()
        assert "user1" in creds
        assert "user2" in creds
        assert pwd_context.verify("secret1", creds["user1"])
        assert pwd_context.verify("secret2", creds["user2"])

    def test_does_not_overwrite_existing_credentials(self, tmp_path, monkeypatch):
        import backend.main as m
        monkeypatch.setenv("JWT_SECRET", "test-secret")
        monkeypatch.setenv("INITIAL_PASSWORD_user1", "original")
        m.DATA_DIR = tmp_path
        m.initialize_data()
        original_hash = m._read_credentials()["user1"]
        monkeypatch.setenv("INITIAL_PASSWORD_user1", "changed")
        m.initialize_data()
        assert m._read_credentials()["user1"] == original_hash

    def test_no_credentials_file_created_when_no_env_vars(self, tmp_path, monkeypatch):
        import backend.main as m
        monkeypatch.setenv("JWT_SECRET", "test-secret")
        m.DATA_DIR = tmp_path
        m.initialize_data()
        assert not m._credentials_path().exists()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest backend/test_main.py::TestCredentialInit -v
```

Expected: `test_creates_credentials_from_env_vars` FAILS.

- [ ] **Step 3: Update initialize_data() in main.py**

Replace the existing `initialize_data` function with:

```python
def initialize_data() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    users_file = DATA_DIR / "users.json"
    exercises_file = DATA_DIR / "exercises.json"

    if not users_file.exists():
        _write_json(
            users_file,
            {
                "users": [
                    {
                        "id": "user1",
                        "name": "Andreas",
                        "created": datetime.now().isoformat(),
                    },
                    {
                        "id": "user2",
                        "name": "Family Member",
                        "created": datetime.now().isoformat(),
                    },
                ]
            },
        )

    if not exercises_file.exists():
        _write_json(
            exercises_file,
            {
                "bodyweight": [
                    {
                        "id": "pushups",
                        "name": "Push-ups",
                        "category": "bodyweight",
                        "muscle_groups": ["chest", "triceps"],
                    },
                    {
                        "id": "squats",
                        "name": "Squats",
                        "category": "bodyweight",
                        "muscle_groups": ["legs", "glutes"],
                    },
                    {
                        "id": "planks",
                        "name": "Planks",
                        "category": "bodyweight",
                        "muscle_groups": ["core"],
                    },
                ],
                "dumbbell": [
                    {
                        "id": "bicep_curls",
                        "name": "Bicep Curls",
                        "category": "dumbbell",
                        "muscle_groups": ["biceps"],
                    },
                    {
                        "id": "shoulder_press",
                        "name": "Shoulder Press",
                        "category": "dumbbell",
                        "muscle_groups": ["shoulders"],
                    },
                ],
            },
        )

    if not _credentials_path().exists():
        initial_creds: dict[str, str] = {}
        for key, value in os.environ.items():
            if key.startswith("INITIAL_PASSWORD_") and value:
                user_id = key[len("INITIAL_PASSWORD_"):]
                if _USER_ID_RE.fullmatch(user_id):
                    initial_creds[user_id] = pwd_context.hash(value)
        if initial_creds:
            _write_credentials(initial_creds)
```

- [ ] **Step 4: Run tests**

```bash
pytest backend/test_main.py::TestCredentialInit -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
pytest backend/test_main.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_main.py
git commit -m "feat: initialize credentials.json from INITIAL_PASSWORD_* env vars on first boot"
```

---

## Task 4: POST /login endpoint

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/test_main.py`

- [ ] **Step 1: Write failing tests**

Add a fixture and test class to `backend/test_main.py`:

```python
@pytest.fixture
def with_credentials(monkeypatch, tmp_path):
    import backend.main as m
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-for-tests-only")
    m.DATA_DIR = tmp_path
    m.initialize_data()
    m._write_credentials({
        "user1": pwd_context.hash("password1"),
        "user2": pwd_context.hash("password2"),
    })


class TestLogin:
    def test_valid_credentials_return_token(self, with_credentials):
        r = client.post("/login", json={"user_id": "user1", "password": "password1"})
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"

    def test_wrong_password_returns_401(self, with_credentials):
        r = client.post("/login", json={"user_id": "user1", "password": "wrong"})
        assert r.status_code == 401

    def test_unknown_user_returns_401(self, with_credentials):
        r = client.post("/login", json={"user_id": "ghost", "password": "anything"})
        assert r.status_code == 401

    def test_wrong_password_and_unknown_user_same_error_message(self, with_credentials):
        r_wrong = client.post("/login", json={"user_id": "user1", "password": "wrong"})
        r_unknown = client.post("/login", json={"user_id": "ghost", "password": "anything"})
        assert r_wrong.json()["detail"] == r_unknown.json()["detail"]

    def test_token_contains_correct_user_id(self, with_credentials):
        r = client.post("/login", json={"user_id": "user1", "password": "password1"})
        token = r.json()["access_token"]
        payload = jose_jwt.decode(token, "test-secret-key-for-tests-only", algorithms=["HS256"])
        assert payload["sub"] == "user1"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest backend/test_main.py::TestLogin -v
```

Expected: all 5 tests FAIL with 404 (endpoint not yet defined).

- [ ] **Step 3: Add LoginRequest model and /login endpoint to main.py**

Add after the `WorkoutEntry` model:

```python
class LoginRequest(BaseModel):
    user_id: str
    password: str
```

Add after the `get_exercises` endpoint:

```python
_AUTH_ERROR = HTTPException(
    status_code=401,
    detail="Incorrect user ID or password",
    headers={"WWW-Authenticate": "Bearer"},
)


@app.post("/login")
async def login(request: LoginRequest):
    creds = _read_credentials()
    stored_hash = creds.get(request.user_id)
    if not stored_hash or not pwd_context.verify(request.password, stored_hash):
        raise _AUTH_ERROR
    return {"access_token": create_access_token(request.user_id), "token_type": "bearer"}
```

- [ ] **Step 4: Run tests**

```bash
pytest backend/test_main.py::TestLogin -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
pytest backend/test_main.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_main.py
git commit -m "feat: add POST /login endpoint with bcrypt verification"
```

---

## Task 5: Protect endpoints and update all existing tests

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/test_main.py`

- [ ] **Step 1: Write failing auth-enforcement tests**

Add to `backend/test_main.py`:

```python
class TestAuthEnforcement:
    def test_exercises_requires_auth(self):
        r = client.get("/exercises")
        assert r.status_code == 401

    def test_post_workout_requires_auth(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
        )
        assert r.status_code == 401

    def test_get_workout_requires_auth(self):
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"})
        assert r.status_code == 401

    def test_list_workouts_requires_auth(self):
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        )
        assert r.status_code == 401

    def test_records_requires_auth(self):
        r = client.get("/records", params={"user_id": "user1"})
        assert r.status_code == 401

    def test_cannot_access_other_users_workouts(self):
        token = create_access_token("user2")
        r = client.get(
            "/workouts/2026-01-15",
            params={"user_id": "user1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403

    def test_cannot_post_workout_as_other_user(self):
        token = create_access_token("user2")
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403

    def test_cannot_read_other_users_records(self):
        token = create_access_token("user2")
        r = client.get(
            "/records",
            params={"user_id": "user1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403

    def test_cannot_list_other_users_workout_dates(self):
        token = create_access_token("user2")
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403

    def test_users_endpoint_remains_public(self):
        r = client.get("/users")
        assert r.status_code == 200
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
pytest backend/test_main.py::TestAuthEnforcement -v
```

Expected: the 5 `requires_auth` tests and 3 cross-user tests FAIL with 200/404 (endpoints not yet protected). `test_users_endpoint_remains_public` PASSES.

- [ ] **Step 3: Add auth dependency and user_id checks to main.py**

Add this helper after `_safe_date`:

```python
def _assert_own_resource(current_user: str, requested_user_id: str) -> None:
    if current_user != requested_user_id:
        raise HTTPException(status_code=403, detail="Access denied")
```

Replace the five data endpoint functions with these protected versions:

```python
@app.get("/exercises")
async def get_exercises(current_user: str = Depends(get_current_user)):
    try:
        return _read_json(DATA_DIR / "exercises.json")
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read exercise data")


@app.post("/workouts")
async def log_workout(entry: WorkoutEntry, current_user: str = Depends(get_current_user)):
    _assert_own_resource(current_user, entry.user_id)

    try:
        user_data = _read_json(DATA_DIR / "users.json")
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read user data")

    if not any(u["id"] == entry.user_id for u in user_data["users"]):
        raise HTTPException(status_code=404, detail="User not found")

    try:
        exercise_ids = _all_exercise_ids()
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read exercise data")

    if entry.exercise_id not in exercise_ids:
        raise HTTPException(status_code=404, detail="Exercise not found")

    user_workout_dir = DATA_DIR / "workouts" / entry.user_id
    user_workout_dir.mkdir(parents=True, exist_ok=True)
    workout_file = user_workout_dir / f"{entry.date}.json"

    try:
        with FileLock(str(workout_file) + ".lock"):
            if workout_file.exists():
                with open(workout_file, "r") as f:
                    workout_data = json.load(f)
            else:
                workout_data = {"date": entry.date, "exercises": []}

            workout_data["exercises"].append(
                {
                    "exercise_id": entry.exercise_id,
                    "sets": [s.model_dump() for s in entry.sets],
                    "timestamp": datetime.now().isoformat(),
                }
            )

            with open(workout_file, "w") as f:
                json.dump(workout_data, f, indent=2)
    except OSError:
        raise HTTPException(status_code=500, detail="Could not save workout")

    return {"message": "Workout logged successfully"}


@app.get("/workouts")
async def list_workout_dates(
    user_id: str = Query(...),
    date_from: str = Query(...),
    date_to: str = Query(...),
    current_user: str = Depends(get_current_user),
) -> dict:
    _safe_user_id(user_id)
    _assert_own_resource(current_user, user_id)
    _safe_date(date_from)
    _safe_date(date_to)

    workout_dir = DATA_DIR / "workouts" / user_id
    if not workout_dir.exists():
        return {"dates": []}

    try:
        dates = sorted(
            stem
            for entry in workout_dir.iterdir()
            if (stem := entry.stem)
            and _DATE_RE.fullmatch(stem)
            and date_from <= stem <= date_to
        )
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read workout dates")

    return {"dates": dates}


@app.get("/records")
async def get_records(
    user_id: str = Query(...),
    current_user: str = Depends(get_current_user),
) -> dict:
    _safe_user_id(user_id)
    _assert_own_resource(current_user, user_id)

    workout_dir = DATA_DIR / "workouts" / user_id
    if not workout_dir.exists():
        return {"records": []}

    records: dict[str, dict] = {}

    try:
        for entry in sorted(workout_dir.iterdir()):
            if not _DATE_RE.fullmatch(entry.stem):
                continue
            day = _read_json(entry)
            for exercise in day.get("exercises", []):
                ex_id = exercise["exercise_id"]
                rec = records.setdefault(ex_id, {"max_reps": 0, "max_weight": None})
                for s in exercise.get("sets", []):
                    rec["max_reps"] = max(rec["max_reps"], s.get("reps", 0))
                    w = s.get("weight")
                    if w is not None:
                        rec["max_weight"] = max(rec["max_weight"] or 0, w)
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read workout records")

    return {
        "records": [
            {"exercise_id": ex_id, "max_reps": r["max_reps"], "max_weight": r["max_weight"]}
            for ex_id, r in records.items()
        ]
    }


@app.get("/workouts/{date}")
async def get_workout(
    date: str,
    user_id: str = Query(...),
    current_user: str = Depends(get_current_user),
):
    _safe_date(date)
    _safe_user_id(user_id)
    _assert_own_resource(current_user, user_id)

    workout_file = DATA_DIR / "workouts" / user_id / f"{date}.json"
    if not workout_file.exists():
        return {"date": date, "exercises": []}

    try:
        return _read_json(workout_file)
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read workout data")
```

- [ ] **Step 4: Run auth enforcement tests**

```bash
pytest backend/test_main.py::TestAuthEnforcement -v
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Add auth_headers helper and update all existing tests**

Add this helper to `backend/test_main.py` after `client = TestClient(app)`:

```python
def auth_headers(user_id: str = "user1") -> dict:
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}
```

Now update every test that calls a protected endpoint. Apply `headers=auth_headers()` to each call. The complete set of changes:

**`test_get_exercises`** (in `TestErrorHandling`):
```python
def test_get_exercises_io_error_returns_500(self):
    with patch("backend.main._read_json", side_effect=OSError("disk full")):
        r = client.get("/exercises", headers=auth_headers())
    assert r.status_code == 500
```

**`TestLogWorkout`** — add `headers=auth_headers()` to every `client.post` and `client.get`:
```python
class TestLogWorkout:
    def test_valid_entry(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}, {"reps": 8, "weight": 20.0}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        assert r.status_code == 200

    def test_appends_to_existing_day(self):
        payload = {"exercise_id": "pushups", "sets": [{"reps": 10}],
                   "date": "2026-01-15", "user_id": "user1"}
        client.post("/workouts", json=payload, headers=auth_headers())
        payload["exercise_id"] = "squats"
        client.post("/workouts", json=payload, headers=auth_headers())
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"}, headers=auth_headers())
        assert len(r.json()["exercises"]) == 2

    def test_invalid_date_rejected(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "../../etc/passwd", "user_id": "user1"},
            headers=auth_headers(),
        )
        assert r.status_code == 422

    def test_impossible_calendar_date_rejected(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-02-31", "user_id": "user1"},
            headers=auth_headers(),
        )
        assert r.status_code == 422

    def test_invalid_user_id_rejected(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "../evil"},
            headers=auth_headers(),
        )
        assert r.status_code == 422

    def test_unknown_exercise_rejected(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "nonexistent", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        assert r.status_code == 404

    def test_unknown_user_rejected(self):
        r = client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "ghost"},
            headers=auth_headers("ghost"),
        )
        assert r.status_code == 404
```

Note: `test_unknown_user_rejected` uses `auth_headers("ghost")` so the token matches the user_id and passes the ownership check — the 404 is then from the users.json lookup.

**`TestGetWorkout`**:
```python
class TestGetWorkout:
    def test_empty_day_returns_empty_list(self):
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 200
        assert r.json()["exercises"] == []

    def test_logged_workout_is_returned(self):
        client.post(
            "/workouts",
            json={"exercise_id": "squats", "sets": [{"reps": 15}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 200
        exercises = r.json()["exercises"]
        assert len(exercises) == 1
        assert exercises[0]["exercise_id"] == "squats"

    def test_invalid_date_in_path_rejected(self):
        r = client.get("/workouts/not-a-date", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 400

    def test_impossible_calendar_date_in_path_rejected(self):
        r = client.get("/workouts/2026-02-31", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 400

    def test_invalid_user_id_in_query_rejected(self):
        r = client.get("/workouts/2026-01-15", params={"user_id": "../evil"}, headers=auth_headers())
        assert r.status_code == 400

    def test_get_workout_read_failure_returns_500(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/workouts/2026-01-15", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 500
```

**`TestListWorkoutDates`**:
```python
class TestListWorkoutDates:
    def test_no_workouts_returns_empty(self):
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": []}

    def test_returns_dates_with_workouts(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": ["2026-01-15"]}

    def test_filters_to_date_range(self):
        for date in ("2026-01-10", "2026-01-20"):
            client.post(
                "/workouts",
                json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                      "date": date, "user_id": "user1"},
                headers=auth_headers(),
            )
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-15", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": ["2026-01-20"]}

    def test_returns_dates_sorted_ascending(self):
        for date in ("2026-01-20", "2026-01-05", "2026-01-15"):
            client.post(
                "/workouts",
                json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                      "date": date, "user_id": "user1"},
                headers=auth_headers(),
            )
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.json()["dates"] == ["2026-01-05", "2026-01-15", "2026-01-20"]

    def test_invalid_user_id_rejected(self):
        r = client.get(
            "/workouts",
            params={"user_id": "../evil", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.status_code == 400

    def test_invalid_date_from_rejected(self):
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "not-a-date", "date_to": "2026-01-31"},
            headers=auth_headers(),
        )
        assert r.status_code == 400

    def test_invalid_date_to_rejected(self):
        r = client.get(
            "/workouts",
            params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "not-a-date"},
            headers=auth_headers(),
        )
        assert r.status_code == 400

    def test_io_error_returns_500(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        with patch("backend.main.Path.iterdir", side_effect=OSError("disk full")):
            r = client.get(
                "/workouts",
                params={"user_id": "user1", "date_from": "2026-01-01", "date_to": "2026-01-31"},
                headers=auth_headers(),
            )
        assert r.status_code == 500
```

**`TestGetRecords`**:
```python
class TestGetRecords:
    def test_no_workouts_returns_empty(self):
        r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 200
        assert r.json() == {"records": []}

    def test_returns_max_reps_across_all_days(self):
        for date, reps in [("2026-01-10", 8), ("2026-01-11", 15), ("2026-01-12", 10)]:
            client.post(
                "/workouts",
                json={"exercise_id": "pushups", "sets": [{"reps": reps}],
                      "date": date, "user_id": "user1"},
                headers=auth_headers(),
            )
        r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 200
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "pushups")
        assert rec["max_reps"] == 15

    def test_returns_max_weight_across_all_days(self):
        for date, weight in [("2026-01-10", 10.0), ("2026-01-11", 20.0), ("2026-01-12", 15.0)]:
            client.post(
                "/workouts",
                json={"exercise_id": "bicep_curls", "sets": [{"reps": 10, "weight": weight}],
                      "date": date, "user_id": "user1"},
                headers=auth_headers(),
            )
        r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "bicep_curls")
        assert rec["max_weight"] == 20.0

    def test_max_weight_null_for_bodyweight_exercise(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-10", "user_id": "user1"},
            headers=auth_headers(),
        )
        r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "pushups")
        assert rec["max_weight"] is None

    def test_multiple_exercises_returned(self):
        for ex in ("pushups", "squats"):
            client.post(
                "/workouts",
                json={"exercise_id": ex, "sets": [{"reps": 10}],
                      "date": "2026-01-10", "user_id": "user1"},
                headers=auth_headers(),
            )
        r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        exercise_ids = {x["exercise_id"] for x in r.json()["records"]}
        assert {"pushups", "squats"} == exercise_ids

    def test_invalid_user_id_rejected(self):
        r = client.get("/records", params={"user_id": "../evil"}, headers=auth_headers())
        assert r.status_code == 400

    def test_io_error_returns_500(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-10", "user_id": "user1"},
            headers=auth_headers(),
        )
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/records", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 500
```

**`TestErrorHandling`** — update the exercise and workout error tests:
```python
class TestErrorHandling:
    def test_get_users_io_error_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/users")
        assert r.status_code == 500

    def test_get_exercises_io_error_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/exercises", headers=auth_headers())
        assert r.status_code == 500

    def test_log_workout_user_read_failure_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.post(
                "/workouts",
                json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                      "date": "2026-01-15", "user_id": "user1"},
                headers=auth_headers(),
            )
        assert r.status_code == 500

    def test_log_workout_exercise_read_failure_returns_500(self):
        import backend.main as m
        real_read = m._read_json

        def fail_on_exercises(path):
            if "exercises" in str(path):
                raise OSError("disk full")
            return real_read(path)

        with patch("backend.main._read_json", side_effect=fail_on_exercises):
            r = client.post(
                "/workouts",
                json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                      "date": "2026-01-15", "user_id": "user1"},
                headers=auth_headers(),
            )
        assert r.status_code == 500

    def test_get_workout_read_failure_returns_500(self):
        client.post(
            "/workouts",
            json={"exercise_id": "pushups", "sets": [{"reps": 10}],
                  "date": "2026-01-15", "user_id": "user1"},
            headers=auth_headers(),
        )
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/workouts/2026-01-15", params={"user_id": "user1"}, headers=auth_headers())
        assert r.status_code == 500
```

Note: `TestGetWorkout.test_get_workout_read_failure_returns_500` is now in `TestGetWorkout` (where the existing test already lives) — remove the one from `TestErrorHandling` to avoid the duplicate.

- [ ] **Step 6: Run full test suite**

```bash
pytest backend/test_main.py -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/main.py backend/test_main.py
git commit -m "feat: protect all data endpoints with JWT auth and per-user access control"
```

---

## Task 6: Password management CLI script

**Files:**
- Create: `backend/set_password.py`

- [ ] **Step 1: Create the script**

```python
#!/usr/bin/env python
"""
Change a user's password in credentials.json.

Usage (local):
    python backend/set_password.py <user_id> <new_password>

Usage (Docker):
    docker compose exec backend python set_password.py <user_id> <new_password>
"""
import json
import sys
from pathlib import Path
from filelock import FileLock
from passlib.context import CryptContext

DATA_DIR = Path(__file__).parent / "data"
CREDS_FILE = DATA_DIR / "credentials.json"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: set_password.py <user_id> <new_password>", file=sys.stderr)
        sys.exit(1)

    user_id, password = sys.argv[1], sys.argv[2]
    if not password:
        print("Password cannot be empty", file=sys.stderr)
        sys.exit(1)

    with FileLock(str(CREDS_FILE) + ".lock"):
        creds = json.loads(CREDS_FILE.read_text()) if CREDS_FILE.exists() else {}
        creds[user_id] = pwd_context.hash(password)
        CREDS_FILE.write_text(json.dumps(creds, indent=2))

    print(f"Password updated for {user_id}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script shows usage on bad invocation**

```bash
python backend/set_password.py 2>&1; true
```

Expected output: `Usage: set_password.py <user_id> <new_password>`

- [ ] **Step 3: Commit**

```bash
git add backend/set_password.py
git commit -m "feat: add set_password.py CLI for managing user passwords"
```

---

## Task 7: Frontend LoginPage component

**Files:**
- Create: `frontend/src/LoginPage.tsx`

- [ ] **Step 1: Create LoginPage.tsx**

```tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface User {
  id: string;
  name: string;
}

interface LoginPageProps {
  onLogin: (token: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/users`).then(r => {
      const loaded: User[] = r.data.users;
      setUsers(loaded);
      if (loaded.length > 0) setSelectedUserId(loaded[0].id);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/login`, {
        user_id: selectedUserId,
        password,
      });
      localStorage.setItem('fitness_token', r.data.access_token);
      onLogin(r.data.access_token);
    } catch {
      setError('Invalid user or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Fitness Tracker</h1>
        <p>Sign in to continue</p>
      </header>
      <div className="workout-form">
        <h2>Sign in</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-user">Who are you?</label>
            <select
              id="login-user"
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div className="message message-error" role="alert">{error}</div>
          )}
          <button className="btn" type="submit" disabled={loading || !selectedUserId}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/LoginPage.tsx
git commit -m "feat: add LoginPage component"
```

---

## Task 8: App.tsx auth integration and updated tests

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Replace App.tsx**

Replace the entire contents of `frontend/src/App.tsx` with:

```tsx
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import LoginPage from './LoginPage';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── Token helpers ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'fitness_token';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function parseTokenPayload(token: string): { sub: string; exp: number } | null {
  try {
    const raw = token.split('.')[1];
    const padded = raw + '=='.slice(0, (4 - raw.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = parseTokenPayload(token);
  if (!payload) return true;
  return Date.now() / 1000 >= payload.exp;
}

function getUserIdFromToken(token: string): string | null {
  return parseTokenPayload(token)?.sub ?? null;
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getWeekDates(offset: number): string[] {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
}

export interface ExerciseVolume {
  exerciseId: string;
  totalReps: number;
  totalSets: number;
}

export interface ExerciseRecord {
  exerciseId: string;
  maxReps: number;
  maxWeight: number | null;
}

export type AllTimeRecord = ExerciseRecord;

export function computeWeeklyVolume(weekWorkouts: WorkoutData[]): ExerciseVolume[] {
  const map = new Map<string, { totalReps: number; totalSets: number }>();
  for (const day of weekWorkouts) {
    for (const entry of day.exercises) {
      const cur = map.get(entry.exercise_id) ?? { totalReps: 0, totalSets: 0 };
      map.set(entry.exercise_id, {
        totalReps: cur.totalReps + entry.sets.reduce((s, set) => s + set.reps, 0),
        totalSets: cur.totalSets + entry.sets.length,
      });
    }
  }
  return Array.from(map.entries())
    .map(([exerciseId, v]) => ({ exerciseId, ...v }))
    .sort((a, b) => b.totalReps - a.totalReps);
}

export function computeWeeklyRecords(weekWorkouts: WorkoutData[]): ExerciseRecord[] {
  const map = new Map<string, { maxReps: number; maxWeight: number | null }>();
  for (const day of weekWorkouts) {
    for (const entry of day.exercises) {
      const cur = map.get(entry.exercise_id) ?? { maxReps: 0, maxWeight: null };
      for (const set of entry.sets) {
        cur.maxReps = Math.max(cur.maxReps, set.reps);
        if (set.weight !== undefined) {
          cur.maxWeight = Math.max(cur.maxWeight ?? 0, set.weight);
        }
      }
      map.set(entry.exercise_id, cur);
    }
  }
  return Array.from(map.entries()).map(([exerciseId, v]) => ({ exerciseId, ...v }));
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  created: string;
}

interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle_groups: string[];
}

export interface WorkoutSet {
  reps: number;
  weight?: number;
}

export interface WorkoutExercise {
  exercise_id: string;
  sets: WorkoutSet[];
  timestamp: string;
}

export interface WorkoutData {
  date: string;
  exercises: WorkoutExercise[];
}

// ── Component ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // Auth state: initialised from localStorage so there's no flash of login screen
  const [authToken, setAuthToken] = useState<string | null>(() => {
    const t = getStoredToken();
    return t && !isTokenExpired(t) ? t : null;
  });

  // All other state
  const [users, setUsers] = useState<User[]>([]);
  const [exercises, setExercises] = useState<{ [key: string]: Exercise[] }>({});
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [reps, setReps] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [pendingSets, setPendingSets] = useState<WorkoutSet[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [historyWorkout, setHistoryWorkout] = useState<WorkoutData | null>(null);
  const [weekWorkouts, setWeekWorkouts] = useState<WorkoutData[]>([]);
  const [allTimeRecords, setAllTimeRecords] = useState<AllTimeRecord[]>([]);

  // Derived from token — no separate state needed
  const currentUserId = useMemo(
    () => (authToken ? (getUserIdFromToken(authToken) ?? '') : ''),
    [authToken],
  );

  // Computed display values — must be declared before any conditional return
  const allExercises = useMemo(() => Object.values(exercises).flat(), [exercises]);
  const getExerciseName = (id: string) => allExercises.find(e => e.id === id)?.name ?? id;
  const currentUserName = users.find(u => u.id === currentUserId)?.name ?? currentUserId;
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const selectedDateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const weeklyVolume = useMemo(() => computeWeeklyVolume(weekWorkouts), [weekWorkouts]);
  const weeklyRecords = useMemo(() => computeWeeklyRecords(weekWorkouts), [weekWorkouts]);

  // Attach axios interceptors once; clean up on unmount
  useEffect(() => {
    const reqId = axios.interceptors.request.use((config) => {
      const token = getStoredToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    const resId = axios.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err.response?.status === 401) {
          clearStoredToken();
          setAuthToken(null);
        }
        return Promise.reject(err);
      },
    );
    return () => {
      axios.interceptors.request.eject(reqId);
      axios.interceptors.response.eject(resId);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authToken) loadInitialData(); }, [authToken]);

  useEffect(() => {
    if (!currentUserId) return;
    const dates = getWeekDates(weekOffset);
    fetchWeekActiveDates(currentUserId, dates);
    fetchWeekWorkouts(currentUserId, dates);
  }, [currentUserId, weekOffset]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchAllTimeRecords(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchDayWorkout(currentUserId, selectedDate);
  }, [currentUserId, selectedDate]);

  const showMessage = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleLogin = (token: string) => setAuthToken(token);

  const handleLogout = () => {
    clearStoredToken();
    setAuthToken(null);
  };

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      const [usersRes, exercisesRes] = await Promise.all([
        axios.get(`${API_URL}/users`),
        axios.get(`${API_URL}/exercises`),
      ]);
      setUsers(usersRes.data.users);
      setExercises(exercisesRes.data);
    } catch {
      showMessage('Error loading data. Make sure the backend is running.', true);
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchWeekActiveDates = async (userId: string, weekDts: string[]) => {
    try {
      const res = await axios.get(`${API_URL}/workouts`, {
        params: { user_id: userId, date_from: weekDts[0], date_to: weekDts[6] },
      });
      setActiveDates(new Set(res.data.dates));
    } catch { /* non-critical */ }
  };

  const fetchWeekWorkouts = async (userId: string, weekDts: string[]) => {
    try {
      const results = await Promise.all(
        weekDts.map(date =>
          axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } })
        )
      );
      setWeekWorkouts(results.map(r => r.data));
    } catch { /* non-critical */ }
  };

  const fetchAllTimeRecords = async (userId: string) => {
    try {
      const res = await axios.get(`${API_URL}/records`, { params: { user_id: userId } });
      setAllTimeRecords(
        res.data.records.map((r: { exercise_id: string; max_reps: number; max_weight: number | null }) => ({
          exerciseId: r.exercise_id,
          maxReps: r.max_reps,
          maxWeight: r.max_weight,
        }))
      );
    } catch { /* non-critical */ }
  };

  const fetchDayWorkout = async (userId: string, date: string) => {
    try {
      const res = await axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } });
      setHistoryWorkout(res.data);
    } catch { /* non-critical */ }
  };

  const addSet = () => {
    if (!selectedExercise) { showMessage('Please select an exercise', true); return; }
    const parsedReps = parseInt(reps, 10);
    if (isNaN(parsedReps) || parsedReps < 1) { showMessage('Please enter a valid number of reps (≥ 1)', true); return; }
    const parsedWeight = weight !== '' ? parseFloat(weight) : undefined;
    if (parsedWeight !== undefined && (isNaN(parsedWeight) || parsedWeight < 0)) { showMessage('Please enter a valid weight (≥ 0)', true); return; }
    setPendingSets(prev => [...prev, { reps: parsedReps, ...(parsedWeight !== undefined && { weight: parsedWeight }) }]);
    setReps('');
    setWeight('');
  };

  const removeSet = (index: number) => setPendingSets(prev => prev.filter((_, i) => i !== index));

  const logWorkout = async () => {
    if (!selectedExercise || pendingSets.length === 0) {
      showMessage('Please select an exercise and add at least one set', true);
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/workouts`, {
        exercise_id: selectedExercise,
        sets: pendingSets,
        date: today(),
        user_id: currentUserId,
      });
      showMessage('Workout logged successfully!');
      setSelectedExercise('');
      setPendingSets([]);
      const wDates = getWeekDates(weekOffset);
      fetchWeekActiveDates(currentUserId, wDates);
      fetchWeekWorkouts(currentUserId, wDates);
      fetchDayWorkout(currentUserId, selectedDate);
      fetchAllTimeRecords(currentUserId);
    } catch {
      showMessage('Error logging workout', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Show login screen when not authenticated
  if (!authToken) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (initialLoading) {
    return <div className="app"><p className="loading">Loading...</p></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Fitness Tracker</h1>
        <div className="header-user">
          <span>{currentUserName}</span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      <div className="workout-form">
        <h2>Log Workout</h2>

        <div className="form-group">
          <label htmlFor="exercise-select">Exercise:</label>
          <select id="exercise-select" value={selectedExercise} onChange={(e) => setSelectedExercise(e.target.value)}>
            <option value="">Select an exercise...</option>
            {allExercises.map(ex => (
              <option key={ex.id} value={ex.id}>{ex.name} ({ex.category})</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="reps-input">Reps:</label>
            <input id="reps-input" type="number" value={reps} onChange={(e) => setReps(e.target.value)}
              placeholder="Number of reps" min="1" />
          </div>
          <div className="form-group">
            <label htmlFor="weight-input">Weight (optional):</label>
            <input id="weight-input" type="number" value={weight} onChange={(e) => setWeight(e.target.value)}
              placeholder="lbs / kg" min="0" step="0.5" />
          </div>
          <button className="btn btn-secondary" onClick={addSet} type="button">Add Set</button>
        </div>

        {pendingSets.length > 0 && (
          <div className="pending-sets">
            <h3>Sets to log:</h3>
            {pendingSets.map((set, i) => (
              <div key={i} className="set-row">
                <span>Set {i + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight}` : ''}</span>
                <button className="btn-remove" onClick={() => removeSet(i)} aria-label="Remove set">×</button>
              </div>
            ))}
          </div>
        )}

        <button className="btn" onClick={logWorkout} disabled={submitting || pendingSets.length === 0}>
          {submitting ? 'Logging...' : 'Log Workout'}
        </button>
      </div>

      {message && (
        <div className={`message ${message.isError ? 'message-error' : 'message-success'}`}>
          {message.text}
        </div>
      )}

      <div className="workout-history">
        <div className="week-nav">
          <button className="btn btn-secondary" onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week">←</button>
          <span className="week-label">Week of {weekDates[0]}</span>
          <button className="btn btn-secondary" onClick={() => setWeekOffset(w => w + 1)}
            disabled={weekOffset >= 0} aria-label="Next week">→</button>
        </div>

        <div className="week-strip">
          {weekDates.map(date => (
            <button key={date} className={`day-pill${date === selectedDate ? ' day-pill--active' : ''}`}
              onClick={() => setSelectedDate(date)} aria-pressed={date === selectedDate}>
              <span className="day-name">
                {new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' })}
              </span>
              {activeDates.has(date) && <span role="img" className="day-dot" aria-label="has workouts" />}
            </button>
          ))}
        </div>

        {weeklyVolume.length > 0 && (
          <div className="analytics">
            <h3 className="analytics-heading">Week summary</h3>
            <div className="analytics-grid">
              {weeklyVolume.map(v => {
                const rec = weeklyRecords.find(r => r.exerciseId === v.exerciseId);
                return (
                  <div key={v.exerciseId} className="analytics-card">
                    <div className="analytics-name">{getExerciseName(v.exerciseId)}</div>
                    <div className="analytics-stat">{v.totalReps} reps</div>
                    <div className="analytics-sub">{v.totalSets} {v.totalSets === 1 ? 'set' : 'sets'}</div>
                    {rec?.maxWeight !== null && rec?.maxWeight !== undefined && (
                      <div className="analytics-sub">max {rec.maxWeight}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {allTimeRecords.length > 0 && (
          <div className="analytics records-panel">
            <h3 className="analytics-heading">Personal records</h3>
            <div className="analytics-grid">
              {allTimeRecords.map(rec => {
                const weekRec = weeklyRecords.find(r => r.exerciseId === rec.exerciseId);
                const newRepsRecord = weekRec !== undefined && weekRec.maxReps >= rec.maxReps;
                const newWeightRecord = rec.maxWeight !== null && weekRec?.maxWeight !== undefined &&
                  weekRec.maxWeight !== null && weekRec.maxWeight >= rec.maxWeight;
                return (
                  <div key={rec.exerciseId} className="analytics-card">
                    <div className="analytics-name">{getExerciseName(rec.exerciseId)}</div>
                    <div className={`analytics-stat${newRepsRecord ? ' analytics-stat--record' : ''}`}>
                      {rec.maxReps} reps
                    </div>
                    {rec.maxWeight !== null && (
                      <div className={`analytics-sub${newWeightRecord ? ' analytics-sub--record' : ''}`}>
                        max {rec.maxWeight}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <h2 className="day-heading">{selectedDateLabel}</h2>
        {historyWorkout && historyWorkout.exercises.length > 0 ? (
          historyWorkout.exercises.map((entry, i) => (
            <div key={i} className="exercise-item">
              <strong>{getExerciseName(entry.exercise_id)}</strong>
              {entry.sets.map((set, j) => (
                <div key={j} className="set-item">
                  Set {j + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight}` : ''}
                </div>
              ))}
            </div>
          ))
        ) : (
          <p>No workouts logged this day.</p>
        )}
      </div>
    </div>
  );
};

export default App;
```

- [ ] **Step 2: Add header-user and btn-sm styles to index.css**

Append to `frontend/src/index.css`:

```css
.header-user {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  font-size: 14px;
  opacity: 0.9;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 13px;
}
```

- [ ] **Step 3: Update App.test.tsx**

Add these helpers and update `beforeEach` in `App.test.tsx`. The two new things needed are:
1. A fake valid JWT that `parseTokenPayload` can decode (no library, just `btoa`)
2. Mocked `localStorage` and axios interceptors

Add after the existing imports:

```typescript
// Creates a minimal JWT-shaped token the frontend's parseTokenPayload can decode.
// The frontend only checks exp and sub — no signature verification.
function makeTestToken(userId: string = 'user1'): string {
  const payload = btoa(JSON.stringify({ sub: userId, exp: 9999999999 }));
  return `fake-header.${payload}.fake-sig`;
}

const TEST_TOKEN = makeTestToken('user1');
```

Replace the existing `beforeEach` block with:

```typescript
beforeEach(() => {
  jest.clearAllMocks();
  // axios is fully mocked — provide stub interceptors so App's useEffect doesn't throw
  (mockedAxios as any).interceptors = {
    request: { use: jest.fn().mockReturnValue(1), eject: jest.fn() },
    response: { use: jest.fn().mockReturnValue(1), eject: jest.fn() },
  };
  // Simulate a logged-in user so App renders the main UI, not LoginPage
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) =>
    key === 'fitness_token' ? TEST_TOKEN : null
  );
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  setupDefaultMocks();
});
```

Add these two test blocks (they can go anywhere, e.g. after `App — initial render`):

```typescript
describe('App — authentication', () => {
  it('shows the login page when no token is stored', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    render(<App />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows a sign-out button when logged in', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signs out and shows login page on sign-out click', async () => {
    const removeSpy = jest.spyOn(Storage.prototype, 'removeItem');
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(removeSpy).toHaveBeenCalledWith('fitness_token');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend && npm test -- --watchAll=false
```

Expected: all tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/index.css
git commit -m "feat: add auth state, axios interceptors, login/logout flow to App"
```

---

## Task 9: Production compose env var documentation

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Update docker-compose.prod.yml**

Replace the file with:

```yaml
services:
  backend:
    image: ghcr.io/frankandreas/gainz/fitness-backend:latest
    restart: unless-stopped
    volumes:
      - fitness-data:/app/backend/data
    environment:
      - ALLOWED_ORIGIN=${ALLOWED_ORIGIN:-http://localhost}
      # Required: generate with: python -c "import secrets; print(secrets.token_hex(32))"
      - JWT_SECRET=${JWT_SECRET:?JWT_SECRET must be set}
      # First-boot only: set initial passwords, then remove these lines.
      # To change a password later:
      #   docker compose exec backend python set_password.py <user_id> <new_password>
      - INITIAL_PASSWORD_user1=${INITIAL_PASSWORD_user1:-}
      - INITIAL_PASSWORD_user2=${INITIAL_PASSWORD_user2:-}
    networks:
      - fitness-network

  frontend:
    image: ghcr.io/frankandreas/gainz/fitness-frontend:latest
    restart: unless-stopped
    ports:
      - "${PORT:-80}:80"
    networks:
      - fitness-network

volumes:
  fitness-data:

networks:
  fitness-network:
    driver: bridge
```

The `${JWT_SECRET:?…}` syntax causes `docker compose up` to fail immediately with a clear error if `JWT_SECRET` is not set in the environment or a `.env` file.

- [ ] **Step 2: Run full backend test suite one final time**

```bash
pytest backend/test_main.py -v
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "chore: require JWT_SECRET in prod compose, document INITIAL_PASSWORD_ usage"
```

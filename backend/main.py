from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, field_validator
from typing import List, Optional
import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from contextlib import asynccontextmanager
from filelock import FileLock
from jose import JWTError, jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

DATA_DIR = Path(__file__).parent / "data"
_USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _read_json(path: Path) -> dict:
    with FileLock(str(path) + ".lock"):
        with open(path, "r") as f:
            return json.load(f)


def _write_json(path: Path, data: dict) -> None:
    with FileLock(str(path) + ".lock"):
        with open(path, "w") as f:
            json.dump(data, f, indent=2)


def _safe_user_id(user_id: str) -> str:
    if not _USER_ID_RE.fullmatch(user_id):
        raise HTTPException(status_code=400, detail="Invalid user_id")
    return user_id


def _safe_date(date: str) -> str:
    if not _DATE_RE.fullmatch(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="date must be a valid calendar date"
        )
    return date


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    _jwt_secret()  # raises RuntimeError if not set
    initialize_data()
    yield


app = FastAPI(title="Fitness Tracker API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Data models
class User(BaseModel):
    id: str
    name: str
    created: str


class Exercise(BaseModel):
    id: str
    name: str
    category: str
    muscle_groups: List[str]


class WorkoutSet(BaseModel):
    reps: int
    weight: Optional[float] = None


class WorkoutEntry(BaseModel):
    exercise_id: str
    sets: List[WorkoutSet]
    date: str
    user_id: str

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        if not _DATE_RE.fullmatch(v):
            raise ValueError("date must be YYYY-MM-DD")
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("date must be a valid calendar date")
        return v

    @field_validator("user_id")
    @classmethod
    def validate_user_id(cls, v: str) -> str:
        if not _USER_ID_RE.fullmatch(v):
            raise ValueError("user_id contains invalid characters")
        return v


def _all_exercise_ids() -> set:
    data = _read_json(DATA_DIR / "exercises.json")
    return {ex["id"] for exercises in data.values() for ex in exercises}


@app.get("/")
async def root():
    return {"message": "Fitness Tracker API", "version": "0.1.0"}


@app.get("/users")
async def get_users():
    try:
        return _read_json(DATA_DIR / "users.json")
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read user data")


@app.get("/exercises")
async def get_exercises():
    try:
        return _read_json(DATA_DIR / "exercises.json")
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read exercise data")


@app.post("/workouts")
async def log_workout(entry: WorkoutEntry):
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
) -> dict:
    _safe_user_id(user_id)
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
async def get_records(user_id: str = Query(...)) -> dict:
    _safe_user_id(user_id)

    workout_dir = DATA_DIR / "workouts" / user_id
    if not workout_dir.exists():
        return {"records": []}

    records: dict[str, dict] = {}  # exercise_id -> {max_reps, max_weight}

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
            {
                "exercise_id": ex_id,
                "max_reps": r["max_reps"],
                "max_weight": r["max_weight"],
            }
            for ex_id, r in records.items()
        ]
    }


@app.get("/workouts/{date}")
async def get_workout(date: str, user_id: str = Query(...)):
    _safe_date(date)
    _safe_user_id(user_id)

    workout_file = DATA_DIR / "workouts" / user_id / f"{date}.json"
    if not workout_file.exists():
        return {"date": date, "exercises": []}

    try:
        return _read_json(workout_file)
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read workout data")

import json
import re
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from filelock import FileLock
from pydantic import BaseModel, field_validator

from backend import hub, storage
from backend.auth import CurrentPerson

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def initialize_data() -> None:
    storage.DATA_DIR.mkdir(exist_ok=True)
    users_file = storage.DATA_DIR / "users.json"
    exercises_file = storage.DATA_DIR / "exercises.json"

    if not users_file.exists():
        storage.write_json(users_file, {"users": []})

    if not exercises_file.exists():
        storage.write_json(
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
                        "unit": "seconds",
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
    initialize_data()
    yield


app = FastAPI(title="Fitness Tracker API", version="0.1.0", lifespan=lifespan)

# Data models
class User(BaseModel):
    id: str
    name: str
    created: str


class Exercise(BaseModel):
    id: str
    name: str
    category: str
    muscle_groups: list[str]


class WorkoutSet(BaseModel):
    reps: int
    weight: float | None = None


class WorkoutEntry(BaseModel):
    exercise_id: str
    sets: list[WorkoutSet]
    date: str

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

def _all_exercise_ids() -> set:
    data = storage.read_json(storage.DATA_DIR / "exercises.json")
    return {ex["id"] for exercises in data.values() for ex in exercises}


@app.get("/")
async def root():
    return {"message": "Fitness Tracker API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/hub")
async def hub_links():
    """Where the family hub is, for the page: its login, and its logout (which ends the login for every app)."""
    login_url = hub.client.public_url()
    return {"login_url": login_url, "logout_url": f"{login_url}/logout"}


@app.get("/me")
def me(person: CurrentPerson):
    return {"id": person.id, "name": person.name}


@app.get("/exercises")
def get_exercises(person: CurrentPerson):
    try:
        return storage.read_json(storage.DATA_DIR / "exercises.json")
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read exercise data")


@app.post("/workouts")
# Plain def: FastAPI runs it in a worker thread, so the file lock and file I/O don't block the event loop
def log_workout(
    entry: WorkoutEntry, person: CurrentPerson
):
    try:
        exercise_ids = _all_exercise_ids()
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read exercise data")

    if entry.exercise_id not in exercise_ids:
        raise HTTPException(status_code=404, detail="Exercise not found")

    user_workout_dir = storage.DATA_DIR / "workouts" / person.id
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
    person: CurrentPerson,
    date_from: str = Query(...),
    date_to: str = Query(...),
) -> dict:
    _safe_date(date_from)
    _safe_date(date_to)

    workout_dir = storage.DATA_DIR / "workouts" / person.id
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
    person: CurrentPerson,
) -> dict:

    workout_dir = storage.DATA_DIR / "workouts" / person.id
    if not workout_dir.exists():
        return {"records": []}

    records: dict[str, dict] = {}  # exercise_id -> {max_reps, max_weight}

    try:
        for entry in sorted(workout_dir.iterdir()):
            if not _DATE_RE.fullmatch(entry.stem):
                continue
            day = storage.read_json(entry)
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
async def get_workout(
    date: str,
    person: CurrentPerson,
):
    _safe_date(date)

    workout_file = storage.DATA_DIR / "workouts" / person.id / f"{date}.json"
    if not workout_file.exists():
        return {"date": date, "exercises": []}

    try:
        return storage.read_json(workout_file)
    except OSError:
        raise HTTPException(status_code=500, detail="Could not read workout data")

"""Basic smoke tests for the Fitness Tracker API. Everyone logs in as the fake hub's "Andreas" (backend/conftest.py),
whose workouts are in workouts/hub1."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app

client = TestClient(app)

_real_read_json = storage.read_json


def fail_except_users(path):
    """A disk error for every file but users.json, which the login reads on every request."""
    if path == storage.users_path():
        return _real_read_json(path)
    raise OSError("disk full")

_login = None


@pytest.fixture(autouse=True)
def hub_login(login):
    global _login
    _login = login
    yield


def auth_headers(name: str = "Andreas") -> dict:
    return _login(name)


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["message"] == "Fitness Tracker API"


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_exercises():
    r = client.get("/exercises", headers=auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert "bodyweight" in data
    assert "dumbbell" in data


class TestLogWorkout:
    def test_valid_entry(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}, {"reps": 8, "weight": 20.0}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 200

    def test_appends_to_existing_day(self):
        payload = {
            "exercise_id": "pushups",
            "sets": [{"reps": 10}],
            "date": "2026-01-15",
        }
        client.post("/workouts", json=payload, headers=auth_headers())
        payload["exercise_id"] = "squats"
        client.post("/workouts", json=payload, headers=auth_headers())
        r = client.get(
            "/workouts/2026-01-15", headers=auth_headers()
        )
        assert len(r.json()["exercises"]) == 2

    def test_invalid_date_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "../../etc/passwd",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 422

    def test_impossible_calendar_date_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-02-31",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 422

    def test_unknown_exercise_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "nonexistent",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 404

class TestGetWorkout:
    def test_empty_day_returns_empty_list(self):
        r = client.get(
            "/workouts/2026-01-15", headers=auth_headers()
        )
        assert r.status_code == 200
        assert r.json()["exercises"] == []

    def test_logged_workout_is_returned(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "squats",
                "sets": [{"reps": 15}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        r = client.get(
            "/workouts/2026-01-15", headers=auth_headers()
        )
        assert r.status_code == 200
        exercises = r.json()["exercises"]
        assert len(exercises) == 1
        assert exercises[0]["exercise_id"] == "squats"

    def test_invalid_date_in_path_rejected(self):
        r = client.get(
            "/workouts/not-a-date", headers=auth_headers()
        )
        assert r.status_code == 400

    def test_impossible_calendar_date_in_path_rejected(self):
        r = client.get(
            "/workouts/2026-02-31", headers=auth_headers()
        )
        assert r.status_code == 400

    def test_get_workout_read_failure_returns_500(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        with patch("backend.storage.read_json", side_effect=fail_except_users):
            r = client.get(
                "/workouts/2026-01-15",
                headers=auth_headers(),
            )
        assert r.status_code == 500


class TestListWorkoutDates:
    def test_no_workouts_returns_empty(self):
        r = client.get(
            "/workouts",
            params={
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": []}

    def test_returns_dates_with_workouts(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        r = client.get(
            "/workouts",
            params={
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": ["2026-01-15"]}

    def test_filters_to_date_range(self):
        for date in ("2026-01-10", "2026-01-20"):
            client.post(
                "/workouts",
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": 10}],
                    "date": date,
                },
                headers=auth_headers(),
            )
        r = client.get(
            "/workouts",
            params={
                "date_from": "2026-01-15",
                "date_to": "2026-01-31",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 200
        assert r.json() == {"dates": ["2026-01-20"]}

    def test_returns_dates_sorted_ascending(self):
        for date in ("2026-01-20", "2026-01-05", "2026-01-15"):
            client.post(
                "/workouts",
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": 10}],
                    "date": date,
                },
                headers=auth_headers(),
            )
        r = client.get(
            "/workouts",
            params={
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
            headers=auth_headers(),
        )
        assert r.json()["dates"] == ["2026-01-05", "2026-01-15", "2026-01-20"]

    def test_invalid_date_from_rejected(self):
        r = client.get(
            "/workouts",
            params={
                "date_from": "not-a-date",
                "date_to": "2026-01-31",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 400

    def test_invalid_date_to_rejected(self):
        r = client.get(
            "/workouts",
            params={
                "date_from": "2026-01-01",
                "date_to": "not-a-date",
            },
            headers=auth_headers(),
        )
        assert r.status_code == 400

    def test_io_error_returns_500(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
            },
            headers=auth_headers(),
        )
        with patch("pathlib.Path.iterdir", side_effect=OSError("disk full")):
            r = client.get(
                "/workouts",
                params={
                    "date_from": "2026-01-01",
                    "date_to": "2026-01-31",
                },
                headers=auth_headers(),
            )
        assert r.status_code == 500


class TestGetRecords:
    def test_no_workouts_returns_empty(self):
        r = client.get("/records", headers=auth_headers())
        assert r.status_code == 200
        assert r.json() == {"records": []}

    def test_returns_max_reps_across_all_days(self):
        for date, reps in [("2026-01-10", 8), ("2026-01-11", 15), ("2026-01-12", 10)]:
            client.post(
                "/workouts",
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": reps}],
                    "date": date,
                },
                headers=auth_headers(),
            )
        r = client.get("/records", headers=auth_headers())
        assert r.status_code == 200
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "pushups")
        assert rec["max_reps"] == 15

    def test_returns_max_weight_across_all_days(self):
        for date, weight in [
            ("2026-01-10", 10.0),
            ("2026-01-11", 20.0),
            ("2026-01-12", 15.0),
        ]:
            client.post(
                "/workouts",
                json={
                    "exercise_id": "bicep_curls",
                    "sets": [{"reps": 10, "weight": weight}],
                    "date": date,
                },
                headers=auth_headers(),
            )
        r = client.get("/records", headers=auth_headers())
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "bicep_curls")
        assert rec["max_weight"] == 20.0

    def test_max_weight_null_for_bodyweight_exercise(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-10",
            },
            headers=auth_headers(),
        )
        r = client.get("/records", headers=auth_headers())
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "pushups")
        assert rec["max_weight"] is None

    def test_multiple_exercises_returned(self):
        for ex in ("pushups", "squats"):
            client.post(
                "/workouts",
                json={
                    "exercise_id": ex,
                    "sets": [{"reps": 10}],
                    "date": "2026-01-10",
                },
                headers=auth_headers(),
            )
        r = client.get("/records", headers=auth_headers())
        exercise_ids = {x["exercise_id"] for x in r.json()["records"]}
        assert {"pushups", "squats"} == exercise_ids

    def test_io_error_returns_500(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-10",
            },
            headers=auth_headers(),
        )
        with patch("backend.storage.read_json", side_effect=fail_except_users):
            r = client.get(
                "/records", headers=auth_headers()
            )
        assert r.status_code == 500


class TestErrorHandling:
    """OSError paths — simulated disk failures."""

    def test_get_exercises_io_error_returns_500(self):
        with patch("backend.storage.read_json", side_effect=fail_except_users):
            r = client.get("/exercises", headers=auth_headers())
        assert r.status_code == 500

    def test_log_workout_exercise_read_failure_returns_500(self):
        real_read = storage.read_json

        def fail_on_exercises(path):
            if "exercises" in str(path):
                raise OSError("disk full")
            return real_read(path)

        with patch("backend.storage.read_json", side_effect=fail_on_exercises):
            r = client.post(
                "/workouts",
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": 10}],
                    "date": "2026-01-15",
                },
                headers=auth_headers(),
            )
        assert r.status_code == 500

"""Basic smoke tests for the Fitness Tracker API."""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture(autouse=True)
def tmp_data_dir(tmp_path):
    """Run each test against a fresh temporary data directory."""
    import backend.main as m

    m.DATA_DIR = tmp_path
    m.initialize_data()
    yield


client = TestClient(app)


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["message"] == "Fitness Tracker API"


def test_get_users():
    r = client.get("/users")
    assert r.status_code == 200
    assert "users" in r.json()


def test_get_exercises():
    r = client.get("/exercises")
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
                "user_id": "user1",
            },
        )
        assert r.status_code == 200

    def test_appends_to_existing_day(self):
        """Second log on the same date appends rather than overwrites."""
        payload = {
            "exercise_id": "pushups",
            "sets": [{"reps": 10}],
            "date": "2026-01-15",
            "user_id": "user1",
        }
        client.post("/workouts", json=payload)
        payload["exercise_id"] = "squats"
        client.post("/workouts", json=payload)
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"})
        assert len(r.json()["exercises"]) == 2

    def test_invalid_date_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "../../etc/passwd",
                "user_id": "user1",
            },
        )
        assert r.status_code == 422

    def test_impossible_calendar_date_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-02-31",
                "user_id": "user1",
            },
        )
        assert r.status_code == 422

    def test_invalid_user_id_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
                "user_id": "../evil",
            },
        )
        assert r.status_code == 422

    def test_unknown_exercise_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "nonexistent",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
                "user_id": "user1",
            },
        )
        assert r.status_code == 404

    def test_unknown_user_rejected(self):
        r = client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
                "user_id": "ghost",
            },
        )
        assert r.status_code == 404


class TestGetWorkout:
    def test_empty_day_returns_empty_list(self):
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"})
        assert r.status_code == 200
        assert r.json()["exercises"] == []

    def test_logged_workout_is_returned(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "squats",
                "sets": [{"reps": 15}],
                "date": "2026-01-15",
                "user_id": "user1",
            },
        )
        r = client.get("/workouts/2026-01-15", params={"user_id": "user1"})
        assert r.status_code == 200
        exercises = r.json()["exercises"]
        assert len(exercises) == 1
        assert exercises[0]["exercise_id"] == "squats"

    def test_invalid_date_in_path_rejected(self):
        # Use a clearly invalid date string that still matches the {date} route param
        r = client.get("/workouts/not-a-date", params={"user_id": "user1"})
        assert r.status_code == 400

    def test_impossible_calendar_date_in_path_rejected(self):
        r = client.get("/workouts/2026-02-31", params={"user_id": "user1"})
        assert r.status_code == 400

    def test_invalid_user_id_in_query_rejected(self):
        r = client.get("/workouts/2026-01-15", params={"user_id": "../evil"})
        assert r.status_code == 400


class TestListWorkoutDates:
    def test_no_workouts_returns_empty(self):
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
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
                "user_id": "user1",
            },
        )
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
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
                    "user_id": "user1",
                },
            )
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "2026-01-15",
                "date_to": "2026-01-31",
            },
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
                    "user_id": "user1",
                },
            )
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
        )
        assert r.json()["dates"] == ["2026-01-05", "2026-01-15", "2026-01-20"]

    def test_invalid_user_id_rejected(self):
        r = client.get(
            "/workouts",
            params={
                "user_id": "../evil",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
        )
        assert r.status_code == 400

    def test_invalid_date_from_rejected(self):
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "not-a-date",
                "date_to": "2026-01-31",
            },
        )
        assert r.status_code == 400

    def test_invalid_date_to_rejected(self):
        r = client.get(
            "/workouts",
            params={
                "user_id": "user1",
                "date_from": "2026-01-01",
                "date_to": "not-a-date",
            },
        )
        assert r.status_code == 400

    def test_io_error_returns_500(self):
        # Create the directory so the OSError branch is reached
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
                "user_id": "user1",
            },
        )
        with patch("backend.main.Path.iterdir", side_effect=OSError("disk full")):
            r = client.get(
                "/workouts",
                params={
                    "user_id": "user1",
                    "date_from": "2026-01-01",
                    "date_to": "2026-01-31",
                },
            )
        assert r.status_code == 500


class TestGetRecords:
    def test_no_workouts_returns_empty(self):
        r = client.get("/records", params={"user_id": "user1"})
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
                    "user_id": "user1",
                },
            )
        r = client.get("/records", params={"user_id": "user1"})
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
                    "user_id": "user1",
                },
            )
        r = client.get("/records", params={"user_id": "user1"})
        rec = next(x for x in r.json()["records"] if x["exercise_id"] == "bicep_curls")
        assert rec["max_weight"] == 20.0

    def test_max_weight_null_for_bodyweight_exercise(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-10",
                "user_id": "user1",
            },
        )
        r = client.get("/records", params={"user_id": "user1"})
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
                    "user_id": "user1",
                },
            )
        r = client.get("/records", params={"user_id": "user1"})
        exercise_ids = {x["exercise_id"] for x in r.json()["records"]}
        assert {"pushups", "squats"} == exercise_ids

    def test_invalid_user_id_rejected(self):
        r = client.get("/records", params={"user_id": "../evil"})
        assert r.status_code == 400

    def test_io_error_returns_500(self):
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-10",
                "user_id": "user1",
            },
        )
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/records", params={"user_id": "user1"})
        assert r.status_code == 500


class TestErrorHandling:
    """OSError paths — simulated disk failures."""

    def test_get_users_io_error_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/users")
        assert r.status_code == 500

    def test_get_exercises_io_error_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/exercises")
        assert r.status_code == 500

    def test_log_workout_user_read_failure_returns_500(self):
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.post(
                "/workouts",
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": 10}],
                    "date": "2026-01-15",
                    "user_id": "user1",
                },
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
                json={
                    "exercise_id": "pushups",
                    "sets": [{"reps": 10}],
                    "date": "2026-01-15",
                    "user_id": "user1",
                },
            )
        assert r.status_code == 500

    def test_get_workout_read_failure_returns_500(self):
        # First create the workout file so the handler tries to read it
        client.post(
            "/workouts",
            json={
                "exercise_id": "pushups",
                "sets": [{"reps": 10}],
                "date": "2026-01-15",
                "user_id": "user1",
            },
        )
        with patch("backend.main._read_json", side_effect=OSError("disk full")):
            r = client.get("/workouts/2026-01-15", params={"user_id": "user1"})
        assert r.status_code == 500

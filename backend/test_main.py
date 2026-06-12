"""Basic smoke tests for the Fitness Tracker API."""

import pytest
from datetime import timedelta
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.main import app
from jose import jwt as jose_jwt
from backend.main import create_access_token, pwd_context


@pytest.fixture(autouse=True)
def tmp_data_dir(tmp_path, monkeypatch):
    """Run each test against a fresh temporary data directory."""
    import backend.main as m

    monkeypatch.setenv("JWT_SECRET", "test-secret-key-for-tests-only")
    m.DATA_DIR = tmp_path
    m.initialize_data()
    yield


client = TestClient(app)


def auth_headers(user_id: str = "user1") -> dict:
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


class TestJWT:
    def test_create_access_token_returns_three_part_string(self):
        token = create_access_token("user1")
        assert isinstance(token, str)
        assert len(token.split(".")) == 3

    def test_token_payload_contains_correct_subject(self):
        token = create_access_token("user1")
        payload = jose_jwt.decode(token, "test-secret-key-for-tests-only", algorithms=["HS256"])
        assert payload["sub"] == "user1"


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["message"] == "Fitness Tracker API"


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_users():
    r = client.get("/users")
    assert r.status_code == 200
    assert "users" in r.json()


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


class TestErrorHandling:
    """OSError paths — simulated disk failures."""

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

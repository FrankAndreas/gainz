"""The family hub: the tracker's people, the login and link_user.py. Invented people only: the repository is public."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import hub, hub_people, link_user, storage
from backend.main import app


def users() -> list[dict]:
    return json.loads(storage.users_path().read_text())["users"]


def by_id(user_id: str) -> dict:
    return next(u for u in users() if u["id"] == user_id)


def write_users(entries: list[dict]) -> None:
    storage.write_json(storage.users_path(), {"users": entries})


def old_user(user_id: str, name: str) -> dict:
    return {"id": user_id, "name": name, "created": "2026-01-01T00:00:00"}


def refresh(token: str, force: bool = False) -> None:
    hub_people.refresh(hub.Login(token), force=force)


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(hub_people, "time", SimpleNamespace(monotonic=lambda: now[0]))
    return now


@pytest.fixture
def calls(fake_hub, monkeypatch):
    """The paths the client asked the hub for."""
    seen: list[str] = []

    def counting(path, headers):
        seen.append(path)
        return fake_hub(path, headers)

    monkeypatch.setattr(hub.client, "transport", counting)
    return seen


class TestPeopleSync:
    def test_new_install_has_no_people(self):
        assert users() == []

    def test_new_hub_person_gets_hub_id_entry(self, fake_hub):
        token = fake_hub.add("Lena", id=7)
        refresh(token)
        entry = by_id("hub7")
        assert entry["name"] == "Lena"
        assert entry["hub_id"] == 7
        assert entry["is_active"] is True
        assert hub_people.local_id(7) == "hub7"

    def test_first_sync_links_by_name(self, fake_hub):
        write_users([old_user("user1", "Andreas"), old_user("user2", "Family Member")])
        token = fake_hub.add(" andreas ", id=3)
        refresh(token)
        assert by_id("user1")["hub_id"] == 3
        assert by_id("user2").get("hub_id") is None
        assert [u["id"] for u in users()] == ["user1", "user2"]
        assert hub_people.local_id(3) == "user1"

    def test_later_sync_never_links_by_name(self, fake_hub):
        write_users([old_user("user1", "Andreas"), old_user("user2", "Family Member")])
        token = fake_hub.add("Andreas", id=1)
        refresh(token)
        fake_hub.add("Family Member", id=2)
        refresh(token)
        assert by_id("user2").get("hub_id") is None
        assert by_id("hub2")["name"] == "Family Member"
        assert hub_people.local_id(2) == "hub2"

    def test_same_name_twice_in_hub_not_linked(self, fake_hub):
        write_users([old_user("user1", "Kim")])
        token = fake_hub.add("Kim", id=4)
        # The fake hub keys people by name: the second Kim differs in spaces only, as the linking ignores them
        fake_hub.add("Kim ", id=5)
        refresh(token)
        assert by_id("user1").get("hub_id") is None
        assert by_id("hub4")["hub_id"] == 4
        assert by_id("hub5")["hub_id"] == 5

    def test_same_name_twice_here_not_linked(self, fake_hub):
        write_users([old_user("user1", "Kim"), old_user("user2", "kim")])
        token = fake_hub.add("Kim", id=4)
        refresh(token)
        assert by_id("user1").get("hub_id") is None
        assert by_id("user2").get("hub_id") is None
        assert hub_people.local_id(4) == "hub4"

    def test_new_person_never_takes_an_existing_id(self, fake_hub):
        """An entry already called hub5 (linked to someone else, or not at all) keeps its folder to itself."""
        write_users([{**old_user("hub5", "Lena"), "hub_id": 7, "is_active": True}])
        token = fake_hub.add("Lena", id=7)
        fake_hub.add("Kim", id=5)
        refresh(token)
        assert [u["id"] for u in users()].count("hub5") == 1
        assert hub_people.local_id(7) == "hub5"
        assert hub_people.local_id(5) not in (None, "hub5")

    def test_rename_follows_hub(self, fake_hub):
        fake_hub.add("Andreas", id=1)
        refresh("tok-Andreas")
        fake_hub.rename("Andreas", "Andi")
        refresh("tok-Andi", force=True)
        assert by_id("hub1")["name"] == "Andi"
        assert hub_people.local_id(1) == "hub1"

    def test_removed_person_hidden_and_back(self, fake_hub, data_dir):
        token = fake_hub.add("Andreas", id=1)
        fake_hub.add("Lena", id=2)
        refresh(token)
        workout = data_dir / "workouts" / "hub2" / "2026-01-05.json"
        workout.parent.mkdir(parents=True)
        workout.write_text('{"date": "2026-01-05", "exercises": []}')

        fake_hub.remove_access("Lena")
        refresh(token)
        assert by_id("hub2")["is_active"] is False
        assert hub_people.local_id(2) is None
        assert workout.exists()

        fake_hub.give_access("Lena")
        refresh(token)
        assert by_id("hub2")["is_active"] is True
        assert hub_people.local_id(2) == "hub2"
        assert len(users()) == 2

    def test_empty_answer_changes_nothing(self, fake_hub):
        fake_hub.add("Andreas", id=1)
        refresh("tok-Andreas")
        before = storage.users_path().read_bytes()
        fake_hub.add("Kim", access=False)
        refresh("tok-Kim", force=True)
        assert storage.users_path().read_bytes() == before

    def test_refresh_at_most_every_minute(self, fake_hub, calls, clock):
        fake_hub.add("Andreas")
        refresh("tok-Andreas")
        clock[0] += 59
        refresh("tok-Andreas")
        assert len(calls) == 1
        clock[0] += 2
        refresh("tok-Andreas")
        assert len(calls) == 2
        refresh("tok-Andreas", force=True)
        assert len(calls) == 3

    def test_backoff_after_hub_down(self, fake_hub, calls, clock):
        fake_hub.add("Andreas")
        fake_hub.down = True
        with pytest.raises(hub.HubUnavailable):
            refresh("tok-Andreas")
        fake_hub.down = False
        clock[0] += 9
        refresh("tok-Andreas")
        assert len(calls) == 1
        assert users() == []
        clock[0] += 2
        refresh("tok-Andreas")
        assert len(calls) == 2
        assert hub_people.local_id(1) == "hub1"




client = TestClient(app)

WORKOUT = {"exercise_id": "pushups", "sets": [{"reps": 10}], "date": "2026-01-05"}


def code(response) -> str:
    return response.json()["detail"]["code"]


@pytest.fixture
def cookie_client():
    with TestClient(app) as fresh:
        yield fresh


class TestLogin:
    def test_bearer_login_me(self, login):
        r = client.get("/me", headers=login("Andreas"))
        assert r.status_code == 200
        assert r.json() == {"id": "hub1", "name": "Andreas"}

    def test_cookie_login_get(self, login, cookie_client):
        login("Andreas")
        cookie_client.cookies.set("hub_session", "tok-Andreas")
        assert cookie_client.get("/exercises").status_code == 200

    def test_cookie_change_needs_csrf_header(self, login, cookie_client):
        login("Andreas")
        cookie_client.cookies.set("hub_session", "tok-Andreas")
        r = cookie_client.post("/workouts", json=WORKOUT)
        assert r.status_code == 403
        assert code(r) == "csrf"
        r = cookie_client.post("/workouts", json=WORKOUT, headers={"X-Requested-With": "fitness"})
        assert r.status_code == 200

    def test_bearer_change_needs_no_csrf_header(self, login):
        assert client.post("/workouts", json=WORKOUT, headers=login()).status_code == 200

    def test_no_token_401(self):
        r = client.get("/me")
        assert r.status_code == 401
        assert code(r) == "not_logged_in"
        assert r.headers["WWW-Authenticate"] == "Bearer"

    def test_unknown_token_401(self):
        r = client.get("/me", headers={"Authorization": "Bearer tok-Nobody"})
        assert r.status_code == 401
        assert code(r) == "not_logged_in"

    def test_tunnel_header_401(self, login):
        r = client.get("/me", headers={**login(), "Cf-Connecting-Ip": "203.0.113.9"})
        assert r.status_code == 401
        assert code(r) == "not_logged_in"

    def test_no_access_403(self, login):
        r = client.get("/me", headers=login("Kim", access=False))
        assert r.status_code == 403
        assert code(r) == "no_access"

    def test_hub_down_503(self, login, fake_hub):
        headers = login()
        fake_hub.down = True
        r = client.get("/me", headers=headers)
        assert r.status_code == 503
        assert code(r) == "hub_unavailable"
        assert users() == []

    def test_renew_header(self, login, fake_hub):
        headers = login()
        assert "X-Hub-Renew" not in client.get("/me", headers=headers).headers
        fake_hub.renewing.add("Andreas")
        hub.client.forget()
        assert client.get("/me", headers=headers).headers["X-Hub-Renew"] == "1"

    def test_given_access_a_moment_ago(self, login, fake_hub):
        headers = login("Kim", access=False)
        assert client.get("/me", headers=headers).status_code == 403
        fake_hub.give_access("Kim")
        assert client.get("/me", headers=headers).status_code == 200

    def test_rename_shows_at_once(self, login, fake_hub):
        client.get("/me", headers=login("Andreas"))
        fake_hub.rename("Andreas", "Andi")
        assert client.get("/me", headers={"Authorization": "Bearer tok-Andi"}).json()["name"] == "Andi"

    def test_rename_while_session_kept(self, login, fake_hub, monkeypatch):
        """The client keeps Bob's session (old name) for a minute; someone else's request already synced the new name."""
        bob = login("Bob")
        assert client.get("/me", headers=bob).status_code == 200
        monkeypatch.setattr(hub.client, "forget", lambda login=None: None)
        fake_hub.rename("Bob", "Bobby")
        assert client.get("/me", headers=login("Carol")).status_code == 200
        r = client.get("/me", headers=bob)
        assert r.status_code == 200
        assert r.json() == {"id": "hub1", "name": "Bobby"}

    def test_hub_links(self, monkeypatch):
        monkeypatch.setenv("HUB_PUBLIC_URL", "https://home.local.example")
        assert client.get("/hub").json() == {
            "login_url": "https://home.local.example",
            "logout_url": "https://home.local.example/logout",
        }

    def test_login_endpoint_gone(self):
        assert client.post("/login", json={"user_id": "user1", "password": "x"}).status_code in (404, 405)


class TestOwnWorkouts:
    def test_workouts_are_the_logins_own(self, login):
        andreas, lena = login("Andreas"), login("Lena")
        assert client.post("/workouts", json=WORKOUT, headers=andreas).status_code == 200
        other = {**WORKOUT, "exercise_id": "squats", "sets": [{"reps": 20}]}
        assert client.post("/workouts", json=other, headers=lena).status_code == 200

        dates = {"date_from": "2026-01-01", "date_to": "2026-01-31"}
        assert client.get("/workouts", params=dates, headers=andreas).json() == {"dates": ["2026-01-05"]}
        day = client.get("/workouts/2026-01-05", params={"user_id": "hub2"}, headers=andreas).json()
        assert [e["exercise_id"] for e in day["exercises"]] == ["pushups"]
        records = client.get("/records", params={"user_id": "hub2"}, headers=andreas).json()["records"]
        assert [r["exercise_id"] for r in records] == ["pushups"]
        day = client.get("/workouts/2026-01-05", headers=lena).json()
        assert [e["exercise_id"] for e in day["exercises"]] == ["squats"]

    def test_user_id_in_body_ignored(self, login, data_dir):
        r = client.post("/workouts", json={**WORKOUT, "user_id": "hub2"}, headers=login())
        assert r.status_code == 200
        assert (data_dir / "workouts" / "hub1" / "2026-01-05.json").exists()
        assert not (data_dir / "workouts" / "hub2").exists()

    def test_linked_person_sees_old_workouts(self, login, data_dir):
        write_users([old_user("user1", "Andreas")])
        old = data_dir / "workouts" / "user1" / "2026-01-05.json"
        old.parent.mkdir(parents=True)
        old.write_text(json.dumps({"date": "2026-01-05", "exercises": [{"exercise_id": "planks", "sets": []}]}))
        day = client.get("/workouts/2026-01-05", headers=login("Andreas")).json()
        assert [e["exercise_id"] for e in day["exercises"]] == ["planks"]



def synced(entry: dict, hub_id: int) -> dict:
    return {**entry, "hub_id": hub_id, "is_active": True}


class TestLinkUser:
    def test_refuses_before_first_sync(self):
        """Linking by hand before the first login would stop the first sync from linking the others by name."""
        write_users([old_user("user1", "Andreas"), old_user("user2", "Family Member")])
        before = storage.users_path().read_bytes()
        assert link_user.main(["user2", "4"]) == 1
        assert storage.users_path().read_bytes() == before

    def test_refuses_target_linked_to_someone_else(self):
        write_users([synced(old_user("user1", "Andreas"), 3), old_user("user2", "Family Member")])
        before = storage.users_path().read_bytes()
        assert link_user.main(["user1", "4"]) == 1
        assert storage.users_path().read_bytes() == before

    def test_refuses_another_hub_entry_as_target(self):
        write_users([synced(old_user("hub5", "Lena"), 5), synced(old_user("hub7", "Kim"), 7)])
        before = storage.users_path().read_bytes()
        assert link_user.main(["hub5", "7"]) == 1
        assert storage.users_path().read_bytes() == before

    def test_links_entry(self, capsys):
        write_users([synced(old_user("user1", "Andreas"), 1), old_user("user2", "Family Member")])
        assert link_user.main(["user2", "5"]) == 0
        assert by_id("user2")["hub_id"] == 5
        assert by_id("user2")["is_active"] is True
        assert "Linked user2 to hub person 5" in capsys.readouterr().out

    def test_linked_entry_is_used_at_login(self, login):
        write_users([synced(old_user("user1", "Andreas"), 1), old_user("user2", "Family Member")])
        assert link_user.main(["user2", "2"]) == 0
        login("Andreas")
        assert client.get("/me", headers=login("Lena")).json() == {"id": "user2", "name": "Lena"}

    def test_unknown_user_id(self):
        write_users([synced(old_user("user1", "Andreas"), 1)])
        before = storage.users_path().read_bytes()
        assert link_user.main(["ghost", "5"]) == 1
        assert storage.users_path().read_bytes() == before

    def test_hub_id_taken(self):
        write_users([{**old_user("user1", "Andreas"), "hub_id": 5}, old_user("user2", "Family Member")])
        before = storage.users_path().read_bytes()
        assert link_user.main(["user2", "5"]) == 1
        assert storage.users_path().read_bytes() == before

    def test_unused_hub_entry_makes_way(self, data_dir):
        write_users([old_user("user2", "Family Member"), {**old_user("hub5", "Lena"), "hub_id": 5, "is_active": True}])
        assert link_user.main(["user2", "5"]) == 0
        assert [u["id"] for u in users()] == ["user2"]
        assert by_id("user2")["hub_id"] == 5

    def test_hub_entry_with_workouts_stays(self, data_dir):
        write_users([old_user("user2", "Family Member"), {**old_user("hub5", "Lena"), "hub_id": 5, "is_active": True}])
        (data_dir / "workouts" / "hub5").mkdir(parents=True)
        before = storage.users_path().read_bytes()
        assert link_user.main(["user2", "5"]) == 1
        assert storage.users_path().read_bytes() == before

    @pytest.mark.parametrize("argv", [[], ["user2"], ["user2", "x"], ["user2", "5", "extra"]])
    def test_bad_arguments(self, argv):
        assert link_user.main(argv) == 2

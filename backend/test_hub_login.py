"""The family hub: the tracker's people, the login and link_user.py. Invented people only: the repository is public."""

import json
from types import SimpleNamespace

import pytest

from backend import hub, hub_people, storage


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

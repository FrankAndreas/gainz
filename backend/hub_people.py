"""The tracker's people come from the family hub, as in the sibling apps (family-planner's hub_people).

Everyone the hub lets use the tracker has an entry in users.json, linked by `hub_id`; the name follows the hub. An entry
the hub no longer lists is hidden (`is_active` False) and its workouts stay. Local ids never change, so the workouts
folder of an account from before the hub (`user1`) stays where it is; a new person gets `hub<hub id>`.

Linking by name happens once, at the first sync (no entry has a `hub_id` yet), and only where the name (case and
surrounding spaces ignored) belongs to exactly one hub person and exactly one entry here. Later nothing is linked by
name: a new person with an old name must not take over someone's workouts. backend/link_user.py links the rest."""

import threading
import time
from datetime import datetime

from backend import hub, storage

REFRESH_SECONDS = 60
# After the hub failed to answer, the next try waits this long (requests go on with the people kept here)
BACKOFF_SECONDS = 10

# A condition, so a request can wait for a refresh that another one is running (wait_for_running)
_lock = threading.Condition()
# When the last refresh finished (time.monotonic()); None: not yet. Not 0.0: monotonic counts from the machine's start,
# so on a machine up for less than a minute 0.0 would look like a refresh a moment ago
_last: float | None = None
_running = False


def forget() -> None:
    """Refresh at the next chance (tests)."""
    global _last
    _last = None


def refresh(login: hub.Login, force: bool = False) -> None:
    """Take the tracker's people from the hub, at most every REFRESH_SECONDS unless forced. When the hub answers no one
    (the asking person has no access), nothing changes. One refresh at a time: other requests meanwhile go on with the
    people kept here instead of waiting for a slow hub. Raises hub.HubUnavailable."""
    global _last, _running
    with _lock:
        if _running or (not force and _last is not None and time.monotonic() - _last < REFRESH_SECONDS):
            return
        _running = True
    try:
        try:
            people = hub.client.fetch_people(login)
        except hub.HubUnavailable:
            with _lock:
                _last = time.monotonic() - REFRESH_SECONDS + BACKOFF_SECONDS
            raise
        if people:
            storage.update_json(storage.users_path(), lambda data: _apply(data, people), {"users": []})
        with _lock:
            _last = time.monotonic()
    finally:
        with _lock:
            _running = False
            _lock.notify_all()


def wait_for_running(timeout: float) -> None:
    """Until a refresh another request is running has finished, at most `timeout` seconds. Only for a person the app
    doesn't know yet: their first requests often come together, and the one that didn't refresh would answer "no
    access" a moment before the other one adds them. Everyone else goes on without waiting."""
    with _lock:
        _lock.wait_for(lambda: not _running, timeout)


def entry(hub_id: int) -> dict | None:
    """The active entry linked to this hub person, or None."""
    path = storage.users_path()
    if not path.exists():
        return None
    for found in storage.read_json(path)["users"]:
        if found.get("hub_id") == hub_id and found.get("is_active", True):
            return found
    return None


def local_id(hub_id: int) -> str | None:
    found = entry(hub_id)
    return found["id"] if found else None


def _key(name: str) -> str:
    return name.strip().casefold()


def _link_by_name(entries: list[dict], people: list[hub.HubPerson]) -> dict[int, dict]:
    """The first sync's links: hub id -> entry, for names that only one hub person and one entry here have."""
    here: dict[str, list[dict]] = {}
    for found in entries:
        here.setdefault(_key(found["name"]), []).append(found)
    there: dict[str, list[hub.HubPerson]] = {}
    for person in people:
        there.setdefault(_key(person.name), []).append(person)
    return {
        there[name][0].id: here[name][0]
        for name in here.keys() & there.keys()
        if len(here[name]) == 1 and len(there[name]) == 1
    }


def _free_id(entries: list[dict], wanted: str) -> str:
    """`wanted`, or wanted-2, -3, ... if an entry already has it: two people must never share a workouts folder."""
    taken = {found["id"] for found in entries}
    candidate, n = wanted, 1
    while candidate in taken:
        n += 1
        candidate = f"{wanted}-{n}"
    return candidate


def _apply(data: dict, people: list[hub.HubPerson]) -> None:
    entries: list[dict] = data.setdefault("users", [])
    linked = {found["hub_id"]: found for found in entries if found.get("hub_id") is not None}
    if not linked:
        linked = _link_by_name(entries, people)
    listed = set()
    for person in people:
        found = linked.get(person.id)
        if found is None:
            found = {"id": _free_id(entries, f"hub{person.id}"), "created": datetime.now().isoformat()}
            entries.append(found)
        found["name"] = person.name
        found["hub_id"] = person.id
        found["is_active"] = True
        listed.add(person.id)
    for found in entries:
        if found.get("hub_id") is not None and found["hub_id"] not in listed:
            found["is_active"] = False

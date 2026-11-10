"""Link an account from before the family hub to a hub person, when the first sync couldn't do it by name.

    sudo docker exec fitness-backend python backend/link_user.py <user id> <hub id>

The user id is the entry in data/users.json (its workouts are in data/workouts/<user id>); the hub id is the person's id
in the hub. Run it after the first login through the hub (which links the matching names). An entry the hub already gave
that person (hub<id>) makes way, as long as it has no workouts yet."""

import sys

from backend import storage

USAGE = "usage: python backend/link_user.py <user id> <hub id>"


class Refused(Exception):
    pass


def _link(data: dict, user_id: str, hub_id: int) -> None:
    entries: list[dict] = data["users"]
    if not any(e.get("hub_id") is not None for e in entries):
        # Linking by hand first would stop the first sync from linking everyone else by name
        raise Refused("Nobody has logged in through the family hub yet: log in once first, then link")
    target = next((e for e in entries if e["id"] == user_id), None)
    if target is None:
        raise Refused(f"No user {user_id} in users.json")
    if target.get("hub_id") is not None and target["hub_id"] != hub_id:
        raise Refused(f"{user_id} is already linked to hub person {target['hub_id']}")
    if target["id"].startswith("hub") and target["id"] != f"hub{hub_id}":
        # The sync would give that hub person their hub<id> entry again: two people in one workouts folder
        raise Refused(f"{user_id} is another hub person's entry")
    for other in entries:
        if other is target or other.get("hub_id") != hub_id:
            continue
        if other["id"] != f"hub{hub_id}" or (storage.DATA_DIR / "workouts" / other["id"]).exists():
            raise Refused(f"Hub person {hub_id} is already linked to {other['id']}")
        entries.remove(other)
        break
    target["hub_id"] = hub_id
    target["is_active"] = True


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[1].isdigit():
        print(USAGE, file=sys.stderr)
        return 2
    user_id, hub_id = argv[0], int(argv[1])
    try:
        # A refusal raises before anything is written
        storage.update_json(storage.users_path(), lambda data: _link(data, user_id, hub_id), {"users": []})
    except Refused as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Linked {user_id} to hub person {hub_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

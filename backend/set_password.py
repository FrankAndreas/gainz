"""CLI utility to set or change a user's password in credentials.json."""

import sys
from pathlib import Path

# Ensure project root is on sys.path so `backend.main` can be imported
# regardless of the working directory the script is invoked from.
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.main import _USER_ID_RE, _read_credentials, _write_credentials, pwd_context  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print(f"Usage: python {Path(sys.argv[0]).name} <user_id> <new_password>")
        sys.exit(1)

    user_id = sys.argv[1]
    new_password = sys.argv[2]

    if not _USER_ID_RE.match(user_id):
        print("Error: invalid user_id format (only alphanumeric, _, - allowed)")
        sys.exit(1)

    try:
        credentials = _read_credentials()
        credentials[user_id] = pwd_context.hash(new_password)
        _write_credentials(credentials)
        print(f"Password for '{user_id}' updated successfully.")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

"""The data folder: JSON files, each written atomically under its own file lock."""

import json
import os
from collections.abc import Callable
from pathlib import Path

from filelock import FileLock

# Read where used (storage.DATA_DIR), so tests can point it at a folder of their own
DATA_DIR = Path(__file__).parent / "data"


def users_path() -> Path:
    return DATA_DIR / "users.json"


def _lock(path: Path) -> FileLock:
    return FileLock(str(path) + ".lock")


def _load(path: Path) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def _store(path: Path, data: dict) -> None:
    tmp = Path(str(path) + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def read_json(path: Path) -> dict:
    with _lock(path):
        return _load(path)


def write_json(path: Path, data: dict) -> None:
    with _lock(path):
        _store(path, data)


def update_json(path: Path, change: Callable[[dict], None], default: dict) -> None:
    """Read, change and write back under one lock (a second FileLock on the same file would wait for the first).
    `default` stands in for a file that doesn't exist yet."""
    with _lock(path):
        data = _load(path) if path.exists() else default
        change(data)
        _store(path, data)

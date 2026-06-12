#!/bin/sh
set -e

# Fix ownership of the data volume on first boot (volume is created as root).
chown -R appuser:appuser /app/backend/data 2>/dev/null || true

exec gosu appuser "$@"

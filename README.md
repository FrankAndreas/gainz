# gainz

Personal home workout tracker — log sets & reps, browse week history, and track personal records. FastAPI backend · React/TypeScript frontend · Docker-ready for self-hosting on a NAS.

## Features

- **Multi-user support** without authentication (family-friendly)
- **Multi-set logging** — add as many sets as you need before submitting
- **Week history browser** — navigate by week, see which days have workouts
- **File-based storage** using JSON files (no database required)
- **Dev container setup** to avoid touching your host system

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/get-started)
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Running the Application

1. **Clone or download this repository**

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Reopen in Dev Container**
   - When prompted click "Reopen in Container", or
   - Command Palette → `Dev Containers: Reopen in Container`

4. **Start the servers** (inside the container terminal)
   ```bash
   # Backend
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

   # Frontend (separate terminal)
   cd frontend && npm start
   ```
   - Backend API: http://localhost:8000
   - Frontend:    http://localhost:3000

## Usage

### Logging a workout

1. Select a user from the dropdown
2. Choose an exercise
3. Enter reps (and optional weight), click **Add Set** — repeat for each set
4. Click **Log Workout** to save

### Browsing history

- The week strip below the form shows Mon–Sun of the current week
- A blue dot marks days that have logged workouts
- Click any day pill to see its exercises and sets
- Use **←** / **→** to step between weeks

### Available exercises

**Bodyweight:** Push-ups · Squats · Planks

**Dumbbell:** Bicep Curls · Shoulder Press

To add more exercises edit `data/exercises.json` (created on first run):

```json
{
  "bodyweight": [
    {
      "id": "pullups",
      "name": "Pull-ups",
      "category": "bodyweight",
      "muscle_groups": ["back", "biceps"]
    }
  ]
}
```

## Project Structure

```
gainz/
├── .devcontainer/          # Dev container configuration
├── .github/workflows/      # CI pipeline (test + build + push to ghcr.io)
├── backend/
│   ├── main.py             # FastAPI application
│   ├── requirements.txt    # Python dependencies
│   └── test_main.py        # pytest test suite (97 % coverage)
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main React component
│   │   ├── App.test.tsx    # React Testing Library tests
│   │   └── index.css       # Styles
│   └── package.json
├── scripts/
│   ├── nas-update.sh       # Nightly auto-update on the NAS
│   └── deploy-nas.sh       # Deploy from this machine over SSH
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.prod.yml # NAS deployment (compose.yaml on the NAS)
├── .env.example            # Settings for the NAS deployment
├── nginx.conf
└── README.md
```

## Data Storage

All data lives in `data/` (created automatically, excluded from git):

| File | Contents |
|---|---|
| `users.json` | User list |
| `exercises.json` | Exercise catalogue |
| `workouts/{user_id}/{date}.json` | One file per user per day |

## API Reference

All endpoints return JSON. Validation errors return HTTP 400 or 422; server errors return 500.

### `GET /users`
Returns the user list.
```json
{ "users": [{ "id": "user1", "name": "Andreas", "created": "…" }] }
```

### `GET /exercises`
Returns exercises grouped by category.
```json
{ "bodyweight": [{ "id": "pushups", "name": "Push-ups", … }], "dumbbell": […] }
```

### `POST /workouts`
Log a workout. All fields are required.
```json
{
  "user_id": "user1",
  "date": "2026-05-16",
  "exercise_id": "pushups",
  "sets": [{ "reps": 10 }, { "reps": 8, "weight": 5.0 }]
}
```
`date` must be `YYYY-MM-DD`. `user_id` must be alphanumeric (plus `_` and `-`).

### `GET /workouts/{date}?user_id=`
Returns all logged exercises for a user on a given date.
```json
{
  "date": "2026-05-16",
  "exercises": [
    { "exercise_id": "pushups", "sets": [{ "reps": 10 }], "timestamp": "…" }
  ]
}
```

### `GET /workouts?user_id=&date_from=&date_to=`
Returns dates within the range that have at least one logged workout.
```json
{ "dates": ["2026-05-13", "2026-05-16"] }
```

## Deployment (Synology NAS)

The app runs as two containers from images on GitHub Container Registry, built by GitHub Actions on
every push to `main`:

- **backend** (`ghcr.io/frankandreas/gainz/fitness-backend`): the API; all data lives in `./data`
- **frontend** (`ghcr.io/frankandreas/gainz/fitness-frontend`): nginx serving the app on port 8080
  inside the container, forwarding `/api` to the backend

It is set up like the other family apps (family-chore on 8080, family-budget on 8081, family-jobs on
8082, spielzeugkiste on 8084), so this one uses **8083**.

### Installation

1. **Choose the user the app runs as.** Reuse the DSM user of the other family apps (e.g.
   `familyapps`), or create one in **Control Panel → User & Group** with no application permissions.
   Look up its IDs over SSH:
   ```bash
   id familyapps    # e.g. uid=1031(familyapps) gid=100(users)
   ```
2. **Prepare the folder.** Create `/volume1/docker/fitness-tracker` and upload `docker-compose.prod.yml`
   into it **renamed to `compose.yaml`**. Then create the data folder, owned by the app's user:
   ```bash
   cd /volume1/docker/fitness-tracker
   sudo mkdir -p data
   sudo chown -R 1031:100 data    # the IDs from step 1
   ```
3. **Create `.env`** (all settings are explained in `.env.example`), with the first passwords of
   `user1` and `user2`:
   ```bash
   printf 'PUID=1031\nPGID=100\nPORT=8083\nTZ=Europe/Zurich\nJWT_SECRET=%s\nINITIAL_PASSWORD_user1=...\nINITIAL_PASSWORD_user2=...\n' \
     "$(openssl rand -hex 32)" | sudo tee .env
   sudo chmod 600 .env
   ```
4. **Start** it:
   ```bash
   sudo docker-compose pull
   sudo docker-compose up -d
   ```
5. **Open** `http://<NAS_IP>:8083` and log in as `user1` or `user2`.
6. **Remove the two `INITIAL_PASSWORD_*` lines from `.env`.** They are only read on the first start.
   To change a password later:
   ```bash
   sudo docker exec -it fitness-backend python backend/set_password.py user1 'new password'
   ```

### Where the data is

Everything is in `data/` as JSON files (see [Data Storage](#data-storage)), plus `credentials.json`
with the password hashes. Include `data/` in your Hyper Backup task.

### Automatic updates

`scripts/nas-update.sh` checks for new images and installs them, the same way as in the other family
apps:
- it pulls the images
- if there is a new one, it archives `data/` to `data-backups/`, keeps the old images as `:previous`
  and restarts the app
- it waits until the backend is healthy, logging to `logs/update.log`

1. Copy `scripts/nas-update.sh` into `/volume1/docker/fitness-tracker` and make it executable (or let
   `scripts/deploy-nas.sh` upload it):
   ```bash
   sudo chmod +x /volume1/docker/fitness-tracker/nas-update.sh
   sudo /volume1/docker/fitness-tracker/nas-update.sh     # should end with "Up to date" or "Update complete"
   ```
2. In **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**:
   - user **root**
   - daily, a few minutes apart from the other apps' updates (e.g. 04:15)
   - command `bash /volume1/docker/fitness-tracker/nas-update.sh`

If the images are private, log in to the registry once as root:
`sudo docker login ghcr.io -u <github-user>` with a token that has `read:packages`.

To deploy right away from your computer:
```bash
cp .deploy.env.example .deploy.env   # once; then set NAS_HOST and NAS_DIR
scripts/deploy-nas.sh
```

### Rolling back

Before each update the running images are tagged `:previous`. To go back:
```bash
cd /volume1/docker/fitness-tracker
sudo docker tag ghcr.io/frankandreas/gainz/fitness-backend:previous ghcr.io/frankandreas/gainz/fitness-backend:latest
sudo docker tag ghcr.io/frankandreas/gainz/fitness-frontend:previous ghcr.io/frankandreas/gainz/fitness-frontend:latest
sudo docker-compose up -d
```
If the new version changed the data, restore the matching archive from `data-backups/` first
(`sudo tar -xzf data-backups/data-<date>.tar.gz`, with the app stopped). Pause the scheduled task
until a fixed version is published, or it installs the new one again the next night.

## Development

### Pre-commit hooks

Hooks run automatically before every commit: file hygiene, Python linting (ruff), backend tests, TypeScript type-check, ESLint, and frontend tests.

```bash
pip install pre-commit
pre-commit install
```

After that, every `git commit` triggers the checks. To run them manually on all files:

```bash
pre-commit run --all-files
```

### Running tests

```bash
# Backend (from repo root)
python -m pytest backend/test_main.py --cov=backend.main -v

# Frontend
cd frontend && npm test
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend URL used by the frontend (read at build time) |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS origin allowed by the backend |

## Troubleshooting

**Backend not starting** — check port 8000 is free; run `pip install -r backend/requirements.txt` inside the container.

**Frontend not loading** — check port 3000 is free; run `npm install` inside `frontend/`.

**Data not saving** — check write permissions on the `data/` directory.

**Backend not starting on the NAS** — `sudo docker logs fitness-backend`. `PermissionError` on `data`: the folder
must belong to `PUID:PGID` from `.env` (`sudo chown -R <PUID>:<PGID> data`). `JWT_SECRET must be set`: add it to `.env`.

**Everyone is logged out after an update** — `JWT_SECRET` changed in `.env`.

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
│   ├── public/
│   ├── src/
│   │   ├── App.tsx         # Main React component
│   │   ├── App.test.tsx    # React Testing Library tests
│   │   └── index.css       # Styles
│   └── package.json
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.prod.yml # Production deployment
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

## Deployment (Synology NAS or any Docker host)

Images are built automatically by GitHub Actions on every push to `master` and pushed to the GitHub Container Registry.

**First-time setup on the NAS:**

```bash
export ALLOWED_ORIGIN=http://your-nas-ip   # or your domain

docker compose -f docker-compose.prod.yml up -d
```

**Updating to the latest image:**

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Workout data is stored in the `fitness-data` named volume and survives container updates.

## Development

### Running tests

```bash
# Backend (from repo root)
python -m pytest backend/test_main.py --cov=backend.main -v

# Frontend
cd frontend && npm test -- --watchAll=false
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REACT_APP_API_URL` | `http://localhost:8000` | Backend URL used by the frontend |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS origin allowed by the backend |

## Troubleshooting

**Backend not starting** — check port 8000 is free; run `pip install -r backend/requirements.txt` inside the container.

**Frontend not loading** — check port 3000 is free; run `npm install` inside `frontend/`.

**Data not saving** — check write permissions on the `data/` directory.

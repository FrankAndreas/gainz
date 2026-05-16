# Fitness Tracker

A simple home fitness tracking application with Python backend and React frontend, designed to run in a dev container.

## Features

- **Multi-user support** without authentication (perfect for family use)
- **Exercise logging** for bodyweight and dumbbell exercises
- **File-based storage** using JSON files (no database required)
- **Dev container setup** to avoid messing with your host system
- **Real-time workout logging** with sets, reps, and weights

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/get-started)
- [VS Code](https://code.visualstudio.com/) with [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Running the Application

1. **Clone or download this repository**

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Reopen in Dev Container**
   - When prompted, click "Reopen in Container"
   - Or use Command Palette: `Dev Containers: Reopen in Container`

4. **The application will start automatically**
   - Backend: http://localhost:8000
   - Frontend: http://localhost:3000

## Usage

### Basic Workflow

1. **Select User**: Choose a family member from the dropdown
2. **Log Exercise**:
   - Select an exercise (push-ups, squats, bicep curls, etc.)
   - Enter number of reps
   - Add weight if using dumbbells (optional)
   - Click "Log Workout"

### Available Exercises

**Bodyweight Exercises:**
- Push-ups
- Squats
- Planks

**Dumbbell Exercises:**
- Bicep Curls
- Shoulder Press

## Project Structure

```
fitness-tracker/
├── .devcontainer/          # Dev container configuration
├── backend/               # Python FastAPI backend
│   ├── main.py           # Main API application
│   └── requirements.txt  # Python dependencies
├── frontend/             # React TypeScript frontend
│   ├── public/
│   ├── src/
│   └── package.json
├── data/                 # JSON data files (created automatically)
├── docker-compose.yml    # Multi-service setup
└── README.md
```

## Data Storage

All data is stored as JSON files in the `data/` directory:

- `users.json` - User information and current user selection
- `exercises.json` - Available exercises and categories
- `workouts/{user_id}/` - Individual workout logs per user

## Development

### Backend (Python/FastAPI)

The backend provides REST API endpoints:
- `GET /users` - Get all users
- `POST /users/switch/{user_id}` - Switch current user
- `GET /exercises` - Get available exercises
- `POST /workouts` - Log a workout
- `GET /workouts/{date}` - Get workouts for a specific date

### Frontend (React/TypeScript)

Built with React and TypeScript, featuring:
- User selection dropdown
- Exercise logging form
- Real-time feedback
- Responsive design

## Adding New Exercises

To add new exercises, edit the `data/exercises.json` file:

```json
{
  "bodyweight": [
    {
      "id": "new_exercise",
      "name": "New Exercise",
      "category": "bodyweight",
      "muscle_groups": ["target_muscle"]
    }
  ]
}
```

## Troubleshooting

### Backend Not Starting
- Check if port 8000 is available
- Ensure Python dependencies are installed

### Frontend Not Loading
- Check if port 3000 is available
- Verify backend is running on port 8000

### Data Not Saving
- Check file permissions in the `data/` directory
- Ensure the dev container has write access

## Future Enhancements

- Progress charts and analytics
- Workout templates and routines
- Exercise instructions and videos
- Data export/import functionality
- Mobile-responsive improvements

## Contributing

This is a home project, but feel free to suggest improvements or add features based on your fitness tracking needs!

import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Pure helpers — exported for unit tests
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getWeekDates(offset: number): string[] {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // rewind to Monday
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
}

interface User {
  id: string;
  name: string;
  created: string;
}

interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle_groups: string[];
}

interface WorkoutSet {
  reps: number;
  weight?: number;
}

interface WorkoutExercise {
  exercise_id: string;
  sets: WorkoutSet[];
  timestamp: string;
}

interface WorkoutData {
  date: string;
  exercises: WorkoutExercise[];
}

const App: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [exercises, setExercises] = useState<{ [key: string]: Exercise[] }>({});
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [reps, setReps] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [pendingSets, setPendingSets] = useState<WorkoutSet[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // History browser state
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [historyWorkout, setHistoryWorkout] = useState<WorkoutData | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const dates = getWeekDates(weekOffset);
    fetchWeekActiveDates(currentUserId, dates);
  }, [currentUserId, weekOffset]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchDayWorkout(currentUserId, selectedDate);
  }, [currentUserId, selectedDate]);

  const showMessage = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadInitialData = async () => {
    try {
      const [usersRes, exercisesRes] = await Promise.all([
        axios.get(`${API_URL}/users`),
        axios.get(`${API_URL}/exercises`),
      ]);
      const loadedUsers: User[] = usersRes.data.users;
      setUsers(loadedUsers);
      setCurrentUserId(loadedUsers[0]?.id ?? '');
      setExercises(exercisesRes.data);
    } catch {
      showMessage('Error loading data. Make sure the backend is running.', true);
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchWeekActiveDates = async (userId: string, weekDates: string[]) => {
    try {
      const res = await axios.get(`${API_URL}/workouts`, {
        params: { user_id: userId, date_from: weekDates[0], date_to: weekDates[6] },
      });
      setActiveDates(new Set(res.data.dates));
    } catch {
      // non-critical — strip just won't show dots
    }
  };

  const fetchDayWorkout = async (userId: string, date: string) => {
    try {
      const res = await axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } });
      setHistoryWorkout(res.data);
    } catch {
      // non-critical — detail panel stays empty
    }
  };

  const addSet = () => {
    if (!selectedExercise) {
      showMessage('Please select an exercise', true);
      return;
    }
    const parsedReps = parseInt(reps, 10);
    if (isNaN(parsedReps) || parsedReps < 1) {
      showMessage('Please enter a valid number of reps (≥ 1)', true);
      return;
    }
    const parsedWeight = weight !== '' ? parseFloat(weight) : undefined;
    if (parsedWeight !== undefined && (isNaN(parsedWeight) || parsedWeight < 0)) {
      showMessage('Please enter a valid weight (≥ 0)', true);
      return;
    }
    setPendingSets(prev => [...prev, { reps: parsedReps, ...(parsedWeight !== undefined && { weight: parsedWeight }) }]);
    setReps('');
    setWeight('');
  };

  const removeSet = (index: number) => {
    setPendingSets(prev => prev.filter((_, i) => i !== index));
  };

  const logWorkout = async () => {
    if (!selectedExercise || pendingSets.length === 0) {
      showMessage('Please select an exercise and add at least one set', true);
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/workouts`, {
        exercise_id: selectedExercise,
        sets: pendingSets,
        date: today(),
        user_id: currentUserId,
      });
      showMessage('Workout logged successfully!');
      setSelectedExercise('');
      setPendingSets([]);
      const weekDates = getWeekDates(weekOffset);
      fetchWeekActiveDates(currentUserId, weekDates);
      fetchDayWorkout(currentUserId, selectedDate);
    } catch {
      showMessage('Error logging workout', true);
    } finally {
      setSubmitting(false);
    }
  };

  const allExercises = useMemo(() => Object.values(exercises).flat(), [exercises]);
  const getExerciseName = (id: string) => allExercises.find(e => e.id === id)?.name ?? id;
  const currentUserName = users.find(u => u.id === currentUserId)?.name ?? '';

  const weekDates = getWeekDates(weekOffset);
  const selectedDateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  if (initialLoading) {
    return <div className="app"><p className="loading">Loading...</p></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Fitness Tracker</h1>
        <p>Track your workouts at home</p>
      </header>

      <div className="user-selector">
        <label htmlFor="user-select">Current User: {currentUserName}</label>
        <select
          id="user-select"
          value={currentUserId}
          onChange={(e) => setCurrentUserId(e.target.value)}
        >
          {users.map(user => (
            <option key={user.id} value={user.id}>{user.name}</option>
          ))}
        </select>
      </div>

      <div className="workout-form">
        <h2>Log Workout</h2>

        <div className="form-group">
          <label htmlFor="exercise-select">Exercise:</label>
          <select
            id="exercise-select"
            value={selectedExercise}
            onChange={(e) => setSelectedExercise(e.target.value)}
          >
            <option value="">Select an exercise...</option>
            {allExercises.map(exercise => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name} ({exercise.category})
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="reps-input">Reps:</label>
            <input
              id="reps-input"
              type="number"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              placeholder="Number of reps"
              min="1"
            />
          </div>

          <div className="form-group">
            <label htmlFor="weight-input">Weight (optional):</label>
            <input
              id="weight-input"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="lbs / kg"
              min="0"
              step="0.5"
            />
          </div>

          <button className="btn btn-secondary" onClick={addSet} type="button">
            Add Set
          </button>
        </div>

        {pendingSets.length > 0 && (
          <div className="pending-sets">
            <h3>Sets to log:</h3>
            {pendingSets.map((set, i) => (
              <div key={i} className="set-row">
                <span>Set {i + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight}` : ''}</span>
                <button className="btn-remove" onClick={() => removeSet(i)} aria-label="Remove set">×</button>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn"
          onClick={logWorkout}
          disabled={submitting || pendingSets.length === 0}
        >
          {submitting ? 'Logging...' : 'Log Workout'}
        </button>
      </div>

      {message && (
        <div className={`message ${message.isError ? 'message-error' : 'message-success'}`}>
          {message.text}
        </div>
      )}

      <div className="workout-history">
        <div className="week-nav">
          <button
            className="btn btn-secondary"
            onClick={() => setWeekOffset(w => w - 1)}
            aria-label="Previous week"
          >
            ←
          </button>
          <span className="week-label">Week of {weekDates[0]}</span>
          <button
            className="btn btn-secondary"
            onClick={() => setWeekOffset(w => w + 1)}
            disabled={weekOffset >= 0}
            aria-label="Next week"
          >
            →
          </button>
        </div>

        <div className="week-strip">
          {weekDates.map(date => (
            <button
              key={date}
              className={`day-pill${date === selectedDate ? ' day-pill--active' : ''}`}
              onClick={() => setSelectedDate(date)}
              aria-pressed={date === selectedDate}
            >
              <span className="day-name">
                {new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' })}
              </span>
              {activeDates.has(date) && <span className="day-dot" aria-label="has workouts" />}
            </button>
          ))}
        </div>

        <h2>{selectedDateLabel}</h2>
        {historyWorkout && historyWorkout.exercises.length > 0 ? (
          historyWorkout.exercises.map((entry, i) => (
            <div key={i} className="exercise-item">
              <strong>{getExerciseName(entry.exercise_id)}</strong>
              {entry.sets.map((set, j) => (
                <div key={j} className="set-item">
                  Set {j + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight}` : ''}
                </div>
              ))}
            </div>
          ))
        ) : (
          <p>No workouts logged this day.</p>
        )}
      </div>
    </div>
  );
};

export default App;

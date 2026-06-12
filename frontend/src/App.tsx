import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import LoginPage from './LoginPage';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── Token helpers ─────────────────────────────────────────────────────────────

export const TOKEN_KEY = 'fitness_token';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function parseTokenPayload(token: string): { sub: string; exp: number } | null {
  try {
    const raw = token.split('.')[1];
    const padded = raw + '=='.slice(0, (4 - raw.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = parseTokenPayload(token);
  if (!payload) return true;
  return Date.now() / 1000 >= payload.exp;
}

function getUserIdFromToken(token: string): string | null {
  return parseTokenPayload(token)?.sub ?? null;
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getWeekDates(offset: number): string[] {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
}

export interface ExerciseVolume {
  exerciseId: string;
  totalReps: number;
  totalSets: number;
}

export interface ExerciseRecord {
  exerciseId: string;
  maxReps: number;
  maxWeight: number | null;
}

export type AllTimeRecord = ExerciseRecord;

export function computeWeeklyVolume(weekWorkouts: WorkoutData[]): ExerciseVolume[] {
  const map = new Map<string, { totalReps: number; totalSets: number }>();
  for (const day of weekWorkouts) {
    for (const entry of day.exercises) {
      const cur = map.get(entry.exercise_id) ?? { totalReps: 0, totalSets: 0 };
      map.set(entry.exercise_id, {
        totalReps: cur.totalReps + entry.sets.reduce((s, set) => s + set.reps, 0),
        totalSets: cur.totalSets + entry.sets.length,
      });
    }
  }
  return Array.from(map.entries())
    .map(([exerciseId, v]) => ({ exerciseId, ...v }))
    .sort((a, b) => b.totalReps - a.totalReps);
}

export function computeWeeklyRecords(weekWorkouts: WorkoutData[]): ExerciseRecord[] {
  const map = new Map<string, { maxReps: number; maxWeight: number | null }>();
  for (const day of weekWorkouts) {
    for (const entry of day.exercises) {
      const cur = map.get(entry.exercise_id) ?? { maxReps: 0, maxWeight: null };
      for (const set of entry.sets) {
        cur.maxReps = Math.max(cur.maxReps, set.reps);
        if (set.weight !== undefined) {
          cur.maxWeight = Math.max(cur.maxWeight ?? 0, set.weight);
        }
      }
      map.set(entry.exercise_id, cur);
    }
  }
  return Array.from(map.entries()).map(([exerciseId, v]) => ({ exerciseId, ...v }));
}

// ── Interfaces ────────────────────────────────────────────────────────────────

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

export interface WorkoutSet {
  reps: number;
  weight?: number;
}

export interface WorkoutExercise {
  exercise_id: string;
  sets: WorkoutSet[];
  timestamp: string;
}

export interface WorkoutData {
  date: string;
  exercises: WorkoutExercise[];
}

// ── Component ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // Auth state: initialised from localStorage so there's no flash of login screen
  const [authToken, setAuthToken] = useState<string | null>(() => {
    const t = getStoredToken();
    return t && !isTokenExpired(t) ? t : null;
  });

  // All other state
  const [users, setUsers] = useState<User[]>([]);
  const [exercises, setExercises] = useState<{ [key: string]: Exercise[] }>({});
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [reps, setReps] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>(() =>
    (localStorage.getItem('fitness_weight_unit') as 'kg' | 'lbs') || 'kg'
  );
  const [pendingSets, setPendingSets] = useState<WorkoutSet[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [historyWorkout, setHistoryWorkout] = useState<WorkoutData | null>(null);
  const [weekWorkouts, setWeekWorkouts] = useState<WorkoutData[]>([]);
  const [allTimeRecords, setAllTimeRecords] = useState<AllTimeRecord[]>([]);
  const [lastRemovedSet, setLastRemovedSet] = useState<{ set: WorkoutSet; index: number } | null>(null);

  // Derived from token — no separate state needed
  const currentUserId = useMemo(
    () => (authToken ? (getUserIdFromToken(authToken) ?? '') : ''),
    [authToken],
  );

  // Computed display values — must be declared before any conditional return
  const allExercises = useMemo(() => Object.values(exercises).flat(), [exercises]);
  const getExerciseName = (id: string) => allExercises.find(e => e.id === id)?.name ?? id;
  const currentUserName = users.find(u => u.id === currentUserId)?.name ?? currentUserId;
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const selectedDateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const weeklyVolume = useMemo(() => computeWeeklyVolume(weekWorkouts), [weekWorkouts]);
  const weeklyRecords = useMemo(() => computeWeeklyRecords(weekWorkouts), [weekWorkouts]);

  // Attach axios interceptors once; clean up on unmount
  useEffect(() => {
    const reqId = axios.interceptors.request.use((config) => {
      const token = getStoredToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    const resId = axios.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err.response?.status === 401) {
          clearStoredToken();
          setAuthToken(null);
        }
        return Promise.reject(err);
      },
    );
    return () => {
      axios.interceptors.request.eject(reqId);
      axios.interceptors.response.eject(resId);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authToken) loadInitialData(); }, [authToken]);

  useEffect(() => {
    if (!currentUserId) return;
    const dates = getWeekDates(weekOffset);
    fetchWeekActiveDates(currentUserId, dates);
    fetchWeekWorkouts(currentUserId, dates);
  }, [currentUserId, weekOffset]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchAllTimeRecords(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchDayWorkout(currentUserId, selectedDate);
  }, [currentUserId, selectedDate]);

  const showMessage = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleLogin = (token: string) => setAuthToken(token);

  const handleLogout = () => {
    clearStoredToken();
    setAuthToken(null);
  };

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      const [usersRes, exercisesRes] = await Promise.all([
        axios.get(`${API_URL}/users`),
        axios.get(`${API_URL}/exercises`),
      ]);
      setUsers(usersRes.data.users);
      setExercises(exercisesRes.data);
    } catch {
      showMessage('Error loading data. Make sure the backend is running.', true);
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchWeekActiveDates = async (userId: string, weekDts: string[]) => {
    try {
      const res = await axios.get(`${API_URL}/workouts`, {
        params: { user_id: userId, date_from: weekDts[0], date_to: weekDts[6] },
      });
      setActiveDates(new Set(res.data.dates));
    } catch { /* non-critical */ }
  };

  const fetchWeekWorkouts = async (userId: string, weekDts: string[]) => {
    try {
      const results = await Promise.all(
        weekDts.map(date =>
          axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } })
        )
      );
      setWeekWorkouts(results.map(r => r.data));
    } catch { /* non-critical */ }
  };

  const fetchAllTimeRecords = async (userId: string) => {
    try {
      const res = await axios.get(`${API_URL}/records`, { params: { user_id: userId } });
      setAllTimeRecords(
        res.data.records.map((r: { exercise_id: string; max_reps: number; max_weight: number | null }) => ({
          exerciseId: r.exercise_id,
          maxReps: r.max_reps,
          maxWeight: r.max_weight,
        }))
      );
    } catch { /* non-critical */ }
  };

  const fetchDayWorkout = async (userId: string, date: string) => {
    try {
      const res = await axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } });
      setHistoryWorkout(res.data);
    } catch { /* non-critical */ }
  };

  const addSet = () => {
    if (!selectedExercise) { showMessage('Please select an exercise', true); return; }
    const parsedReps = parseInt(reps, 10);
    if (isNaN(parsedReps) || parsedReps < 1) { showMessage('Please enter a valid number of reps (≥ 1)', true); return; }
    const parsedWeight = weight !== '' ? parseFloat(weight) : undefined;
    if (parsedWeight !== undefined && (isNaN(parsedWeight) || parsedWeight < 0)) { showMessage('Please enter a valid weight (≥ 0)', true); return; }
    setPendingSets(prev => [...prev, { reps: parsedReps, ...(parsedWeight !== undefined && { weight: parsedWeight }) }]);
    setReps('');
    setWeight('');
  };

  const removeSet = (index: number) => {
    setPendingSets(prev => {
      setLastRemovedSet({ set: prev[index], index });
      return prev.filter((_, i) => i !== index);
    });
    setTimeout(() => setLastRemovedSet(null), 3000);
  };

  const undoRemoveSet = () => {
    if (!lastRemovedSet) return;
    setPendingSets(prev => {
      const next = [...prev];
      next.splice(lastRemovedSet.index, 0, lastRemovedSet.set);
      return next;
    });
    setLastRemovedSet(null);
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
        date: selectedDate,
        user_id: currentUserId,
      });
      showMessage('Workout logged successfully!');
      setSelectedExercise('');
      setPendingSets([]);
      const wDates = getWeekDates(weekOffset);
      fetchWeekActiveDates(currentUserId, wDates);
      fetchWeekWorkouts(currentUserId, wDates);
      fetchDayWorkout(currentUserId, selectedDate);
      fetchAllTimeRecords(currentUserId);
    } catch {
      showMessage('Error logging workout', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Show login screen when not authenticated
  if (!authToken) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (initialLoading) {
    return <div className="app"><p className="loading">Loading...</p></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Fitness Tracker</h1>
        <div className="header-user">
          <span>{currentUserName}</span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      <div className="workout-form">
        <h2>Log Workout <span className="log-date-label">— {selectedDateLabel}</span></h2>

        {message && (
          <div className={`message ${message.isError ? 'message-error' : 'message-success'}`}>
            {message.text}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="exercise-select">Exercise:</label>
          <select id="exercise-select" value={selectedExercise} onChange={(e) => setSelectedExercise(e.target.value)}>
            <option value="">Select an exercise...</option>
            {Object.entries(exercises).map(([category, exs]) => (
              <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
                {exs.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="reps-input">Reps:</label>
            <input id="reps-input" type="number" value={reps} onChange={(e) => setReps(e.target.value)}
              placeholder="Number of reps" min="1" />
          </div>
          <div className="form-group">
            <label htmlFor="weight-input">Weight (optional):</label>
            <div className="weight-input-row">
              <input id="weight-input" type="number" value={weight} onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 20" min="0" step="0.5" />
              <select
                className="unit-select"
                value={weightUnit}
                onChange={(e) => {
                  const u = e.target.value as 'kg' | 'lbs';
                  setWeightUnit(u);
                  localStorage.setItem('fitness_weight_unit', u);
                }}
                aria-label="Weight unit"
              >
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
              </select>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={addSet} type="button">Add Set</button>
        </div>

        {(pendingSets.length > 0 || lastRemovedSet) && (
          <div className="pending-sets">
            <h3>Sets to log:</h3>
            {pendingSets.map((set, i) => (
              <div key={i} className="set-row">
                <span>Set {i + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight} ${weightUnit}` : ''}</span>
                <button className="btn-remove" onClick={() => removeSet(i)} aria-label="Remove set">×</button>
              </div>
            ))}
            {lastRemovedSet && (
              <div className="undo-row">
                <span>Set removed.</span>
                <button className="btn-undo" onClick={undoRemoveSet}>Undo</button>
              </div>
            )}
          </div>
        )}

        <button className="btn" onClick={logWorkout} disabled={submitting || pendingSets.length === 0}>
          {submitting ? 'Logging...' : 'Log Workout'}
        </button>
      </div>

      <div className="workout-history">
        <div className="week-nav">
          <button className="btn btn-secondary" onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week">←</button>
          <span className="week-label">Week of {new Date(weekDates[0] + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
          <button className="btn btn-secondary" onClick={() => setWeekOffset(w => w + 1)}
            disabled={weekOffset >= 0} aria-label="Next week">→</button>
        </div>

        <div className="week-strip">
          {weekDates.map(date => (
            <button key={date} className={`day-pill${date === selectedDate ? ' day-pill--active' : ''}`}
              onClick={() => setSelectedDate(date)} aria-pressed={date === selectedDate}>
              <span className="day-name">
                {new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' })}
              </span>
              <span className="day-num">
                {new Date(date + 'T00:00:00').getDate()}
              </span>
              {activeDates.has(date) && <span role="img" className="day-dot" aria-label="has workouts" />}
            </button>
          ))}
        </div>

        {weeklyVolume.length > 0 && (
          <div className="analytics">
            <h3 className="analytics-heading">Week summary</h3>
            <div className="analytics-grid">
              {weeklyVolume.map(v => {
                const rec = weeklyRecords.find(r => r.exerciseId === v.exerciseId);
                return (
                  <div key={v.exerciseId} className="analytics-card">
                    <div className="analytics-name">{getExerciseName(v.exerciseId)}</div>
                    <div className="analytics-stat">{v.totalReps} reps</div>
                    <div className="analytics-sub">{v.totalSets} {v.totalSets === 1 ? 'set' : 'sets'}</div>
                    {rec?.maxWeight !== null && rec?.maxWeight !== undefined && (
                      <div className="analytics-sub">max {rec.maxWeight} {weightUnit}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {allTimeRecords.length > 0 && (
          <div className="analytics records-panel">
            <h3 className="analytics-heading">Personal records</h3>
            <div className="analytics-grid">
              {allTimeRecords.map(rec => {
                const weekRec = weeklyRecords.find(r => r.exerciseId === rec.exerciseId);
                const newRepsRecord = weekRec !== undefined && weekRec.maxReps >= rec.maxReps;
                const newWeightRecord = rec.maxWeight !== null && weekRec?.maxWeight !== undefined &&
                  weekRec.maxWeight !== null && weekRec.maxWeight >= rec.maxWeight;
                return (
                  <div key={rec.exerciseId} className="analytics-card">
                    <div className="analytics-name">{getExerciseName(rec.exerciseId)}</div>
                    <div className={`analytics-stat${newRepsRecord ? ' analytics-stat--record' : ''}`}>
                      {rec.maxReps} reps
                    </div>
                    {rec.maxWeight !== null && (
                      <div className={`analytics-sub${newWeightRecord ? ' analytics-sub--record' : ''}`}>
                        max {rec.maxWeight} {weightUnit}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <h2 className="day-heading">{selectedDateLabel}</h2>
        {historyWorkout && historyWorkout.exercises.length > 0 ? (
          historyWorkout.exercises.map((entry, i) => (
            <div key={i} className="exercise-item">
              <strong>{getExerciseName(entry.exercise_id)}</strong>
              {entry.sets.map((set, j) => (
                <div key={j} className="set-item">
                  Set {j + 1}: {set.reps} reps{set.weight !== undefined ? ` @ ${set.weight} ${weightUnit}` : ''}
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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  API_URL,
  errorCode,
  fetchActiveDates,
  fetchAllTimeRecords,
  fetchDayWorkout,
  fetchExercises,
  fetchHubLinks,
  fetchMe,
  fetchWeekWorkouts,
} from './api';
import type { Exercise, Me } from './api';
import { loginAddress } from './hubAddress';
import type { HubLinks } from './hubAddress';
import { goTo } from './navigation';
import { today, getWeekDates, computeWeeklyVolume, computeWeeklyRecords } from './workoutStats';
import type { AllTimeRecord, WorkoutData, WorkoutSet } from './workoutStats';

// The login is the family hub's (its cookie). Before the hub, the tracker kept its own token here: drop it
const OLD_TOKEN_KEY = 'fitness_token';

function dropOldToken(): void {
  try {
    localStorage.removeItem(OLD_TOKEN_KEY);
  } catch {
    // No storage (private window): nothing to drop
  }
}

type Status = 'loading' | 'ready' | 'no_access' | 'hub_unavailable' | 'error';

// ── Component ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // Who is logged in (from the hub), and where the hub is
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [links, setLinks] = useState<HubLinks | null>(null);
  // Bumped by "Try again", so the effect below loads everything again
  const [attempt, setAttempt] = useState<number>(0);

  // All other state
  const [exercises, setExercises] = useState<{ [key: string]: Exercise[] }>({});
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [reps, setReps] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>(() =>
    (localStorage.getItem('fitness_weight_unit') as 'kg' | 'lbs') || 'kg'
  );
  const [pendingSets, setPendingSets] = useState<WorkoutSet[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [historyWorkout, setHistoryWorkout] = useState<WorkoutData | null>(null);
  const [weekWorkouts, setWeekWorkouts] = useState<WorkoutData[]>([]);
  const [allTimeRecords, setAllTimeRecords] = useState<AllTimeRecord[]>([]);
  const [lastRemovedSet, setLastRemovedSet] = useState<{ set: WorkoutSet; index: number } | null>(null);
  // Bumped after logging a workout, so the effects below reload the workout data
  const [dataVersion, setDataVersion] = useState<number>(0);

  const currentUserId = me?.id ?? '';

  // Computed display values — must be declared before any conditional return
  const allExercises = useMemo(() => Object.values(exercises).flat(), [exercises]);
  const getExerciseName = (id: string) => allExercises.find(e => e.id === id)?.name ?? id;
  const getExerciseUnit = (id: string) => allExercises.find(e => e.id === id)?.unit ?? 'reps';
  const selectedExerciseUnit = getExerciseUnit(selectedExercise);
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const selectedDateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const weeklyVolume = useMemo(() => computeWeeklyVolume(weekWorkouts), [weekWorkouts]);
  const weeklyRecords = useMemo(() => computeWeeklyRecords(weekWorkouts), [weekWorkouts]);

  const showMessage = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  // Not logged in: to the hub's login, which sends the browser back here
  const toHubLogin = useCallback((hub: HubLinks) => {
    const address = loginAddress(hub, window.location.href);
    if (address) goTo(address);
  }, []);

  const handleLogout = () => {
    if (links) goTo(`${links.logout_url}?next=${encodeURIComponent(window.location.origin)}`);
  };

  const logInAsSomeoneElse = () => {
    if (links) goTo(`${links.logout_url}?next=${encodeURIComponent(window.location.href)}`);
  };

  // A login problem from any request: the hub's login, or the page that says what is wrong
  const handleLoginError = useCallback((err: unknown, hub: HubLinks | null): boolean => {
    const code = errorCode(err);
    if (code === 'not_logged_in') {
      if (hub) toHubLogin(hub);
      return true;
    }
    if (code === 'no_access' || code === 'hub_unavailable') {
      setStatus(code);
      return true;
    }
    return false;
  }, [toHubLogin]);

  // Each effect drops responses that arrive after its inputs changed (or the component
  // unmounted), so a slow answer for a previous week or day can't overwrite the current one.
  useEffect(() => {
    let current = true;
    dropOldToken();
    (async () => {
      let hub: HubLinks | null = null;
      try {
        hub = await fetchHubLinks();
        if (!current) return;
        setLinks(hub);
        const [{ me: person, renew }, exerciseList] = await Promise.all([fetchMe(), fetchExercises()]);
        if (!current) return;
        setMe(person);
        setExercises(exerciseList);
        setStatus('ready');
        // The hub login is in its last week: once through the hub, which renews it and sends the browser back
        if (renew) toHubLogin(hub);
      } catch (err) {
        if (!current || handleLoginError(err, hub)) return;
        setStatus('error');
        showMessage('Error loading data. Make sure the backend is running.', true);
      }
    })();
    return () => { current = false; };
  }, [attempt, handleLoginError, showMessage, toHubLogin]);

  // The remaining data is non-critical: on failure the previous values stay
  useEffect(() => {
    if (!currentUserId) return;
    let current = true;
    const dates = getWeekDates(weekOffset);
    fetchActiveDates(dates).then(
      (active) => { if (current) setActiveDates(active); },
      () => {},
    );
    fetchWeekWorkouts(dates).then(
      (workouts) => { if (current) setWeekWorkouts(workouts); },
      () => {},
    );
    return () => { current = false; };
  }, [currentUserId, weekOffset, dataVersion]);

  useEffect(() => {
    if (!currentUserId) return;
    let current = true;
    fetchAllTimeRecords().then(
      (records) => { if (current) setAllTimeRecords(records); },
      () => {},
    );
    return () => { current = false; };
  }, [currentUserId, dataVersion]);

  useEffect(() => {
    if (!currentUserId) return;
    let current = true;
    fetchDayWorkout(selectedDate).then(
      (workout) => { if (current) setHistoryWorkout(workout); },
      () => {},
    );
    return () => { current = false; };
  }, [currentUserId, selectedDate, dataVersion]);

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
      });
      showMessage('Workout logged successfully!');
      setSelectedExercise('');
      setPendingSets([]);
      setDataVersion(v => v + 1);
    } catch (err) {
      if (!handleLoginError(err, links)) showMessage('Error logging workout', true);
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'no_access') {
    return (
      <main className="hub-page">
        <h1>No access</h1>
        <p>You don't have access to the fitness tracker.</p>
        <button className="btn btn-primary" onClick={logInAsSomeoneElse} type="button">
          Log in as someone else
        </button>
      </main>
    );
  }

  if (status === 'hub_unavailable') {
    return (
      <main className="hub-page">
        <h1>The family hub can't be reached</h1>
        <p>Logging in goes through the family hub. Try again in a moment.</p>
        <button
          className="btn btn-primary"
          onClick={() => { setStatus('loading'); setAttempt(a => a + 1); }}
          type="button"
        >
          Try again
        </button>
      </main>
    );
  }

  if (status === 'loading') {
    return <div className="loading-screen"><div className="spinner" aria-label="Loading" /></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Fitness Tracker</h1>
        <div className="header-user">
          <span>{me?.name}</span>
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
            <label htmlFor="reps-input">{selectedExerciseUnit === 'seconds' ? 'Duration (seconds):' : 'Reps:'}</label>
            <input id="reps-input" type="number" value={reps} onChange={(e) => setReps(e.target.value)}
              placeholder={selectedExerciseUnit === 'seconds' ? 'e.g. 30' : 'Number of reps'} min="1" />
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
                <span>Set {i + 1}: {set.reps} {selectedExerciseUnit}{set.weight != null ? ` @ ${set.weight} ${weightUnit}` : ''}</span>
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

        {weeklyVolume.length === 0 && (
          <p className="analytics-empty">Log a workout to see your week summary and personal records here.</p>
        )}

        {weeklyVolume.length > 0 && (
          <div className="analytics">
            <h3 className="analytics-heading">Week summary</h3>
            <div className="analytics-grid">
              {weeklyVolume.map(v => {
                const rec = weeklyRecords.find(r => r.exerciseId === v.exerciseId);
                return (
                  <div key={v.exerciseId} className="analytics-card">
                    <div className="analytics-name">{getExerciseName(v.exerciseId)}</div>
                    <div className="analytics-stat">{v.totalReps} {getExerciseUnit(v.exerciseId)}</div>
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
                      {rec.maxReps} {getExerciseUnit(rec.exerciseId)}
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
                  Set {j + 1}: {set.reps} {getExerciseUnit(entry.exercise_id)}{set.weight != null ? ` @ ${set.weight} ${weightUnit}` : ''}
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

// ── Workout types ─────────────────────────────────────────────────────────────

export interface WorkoutSet {
  reps: number;
  // The API sends null for sets without weight
  weight?: number | null;
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
        if (set.weight != null) {
          cur.maxWeight = Math.max(cur.maxWeight ?? 0, set.weight);
        }
      }
      map.set(entry.exercise_id, cur);
    }
  }
  return Array.from(map.entries()).map(([exerciseId, v]) => ({ exerciseId, ...v }));
}

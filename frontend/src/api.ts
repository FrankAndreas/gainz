import axios from 'axios';
import type { AllTimeRecord, WorkoutData } from './workoutStats';

// The fetchers only load and return data; the components decide what to do with it

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface User {
  id: string;
  name: string;
  created: string;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle_groups: string[];
  unit?: string;
}

export async function fetchUsersAndExercises(): Promise<{
  users: User[];
  exercises: { [key: string]: Exercise[] };
}> {
  const [usersRes, exercisesRes] = await Promise.all([
    axios.get(`${API_URL}/users`),
    axios.get(`${API_URL}/exercises`),
  ]);
  return { users: usersRes.data.users, exercises: exercisesRes.data };
}

export async function fetchActiveDates(userId: string, weekDates: string[]): Promise<Set<string>> {
  const res = await axios.get(`${API_URL}/workouts`, {
    params: { user_id: userId, date_from: weekDates[0], date_to: weekDates[6] },
  });
  return new Set(res.data.dates);
}

export async function fetchWeekWorkouts(userId: string, weekDates: string[]): Promise<WorkoutData[]> {
  const results = await Promise.all(
    weekDates.map(date =>
      axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } })
    )
  );
  return results.map(r => r.data);
}

export async function fetchAllTimeRecords(userId: string): Promise<AllTimeRecord[]> {
  const res = await axios.get(`${API_URL}/records`, { params: { user_id: userId } });
  return res.data.records.map((r: { exercise_id: string; max_reps: number; max_weight: number | null }) => ({
    exerciseId: r.exercise_id,
    maxReps: r.max_reps,
    maxWeight: r.max_weight,
  }));
}

export async function fetchDayWorkout(userId: string, date: string): Promise<WorkoutData> {
  const res = await axios.get(`${API_URL}/workouts/${date}`, { params: { user_id: userId } });
  return res.data;
}

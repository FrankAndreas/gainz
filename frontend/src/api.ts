import axios from 'axios';
import type { AllTimeRecord, WorkoutData } from './workoutStats';
import { renewNow } from './hubAddress';
import type { HubLinks } from './hubAddress';

// The fetchers only load and return data; the components decide what to do with it

// nginx (and the Vite dev server) pass /api on to the backend, so the hub's cookie is this page's own
export const API_URL = '/api';

// The family hub's login is the cookie hub_session; a change made with it needs this header, which another page on
// the family's domain can't add
axios.defaults.withCredentials = true;
axios.defaults.headers.common['X-Requested-With'] = 'fitness';

export type ErrorCode = 'not_logged_in' | 'no_access' | 'hub_unavailable' | 'csrf';
const CODES: readonly string[] = ['not_logged_in', 'no_access', 'hub_unavailable', 'csrf'];

// The backend's code for a login problem ({"detail": {"code": ...}}), or null for anything else
export function errorCode(err: unknown): ErrorCode | null {
  const code = (err as { response?: { data?: { detail?: { code?: unknown } } } })?.response?.data?.detail?.code;
  return typeof code === 'string' && CODES.includes(code) ? (code as ErrorCode) : null;
}

export interface Me {
  id: string;
  name: string;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle_groups: string[];
  unit?: string;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Who is logged in, and whether the hub login is in its last week (then go through the hub once to renew it)
export async function fetchMe(): Promise<{ me: Me; renew: boolean }> {
  const res = await axios.get(`${API_URL}/me`);
  return { me: res.data, renew: renewNow(res.headers ?? {}, safeLocalStorage()) };
}

export async function fetchHubLinks(): Promise<HubLinks> {
  const res = await axios.get(`${API_URL}/hub`);
  return res.data;
}

export async function fetchExercises(): Promise<{ [key: string]: Exercise[] }> {
  const res = await axios.get(`${API_URL}/exercises`);
  return res.data;
}

export async function fetchActiveDates(weekDates: string[]): Promise<Set<string>> {
  const res = await axios.get(`${API_URL}/workouts`, {
    params: { date_from: weekDates[0], date_to: weekDates[6] },
  });
  return new Set(res.data.dates);
}

export async function fetchWeekWorkouts(weekDates: string[]): Promise<WorkoutData[]> {
  return Promise.all(weekDates.map(date => fetchDayWorkout(date)));
}

export async function fetchAllTimeRecords(): Promise<AllTimeRecord[]> {
  const res = await axios.get(`${API_URL}/records`);
  return res.data.records.map((r: { exercise_id: string; max_reps: number; max_weight: number | null }) => ({
    exerciseId: r.exercise_id,
    maxReps: r.max_reps,
    maxWeight: r.max_weight,
  }));
}

export async function fetchDayWorkout(date: string): Promise<WorkoutData> {
  const res = await axios.get(`${API_URL}/workouts/${date}`);
  return res.data;
}

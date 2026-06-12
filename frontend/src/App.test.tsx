import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import axios from 'axios';

import App, { today, getWeekDates, computeWeeklyVolume, computeWeeklyRecords } from './App';
import type { WorkoutData } from './App';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Creates a minimal JWT-shaped token the frontend's parseTokenPayload can decode.
// The frontend only checks exp and sub — no signature verification.
function makeTestToken(userId: string = 'user1'): string {
  const payload = btoa(JSON.stringify({ sub: userId, exp: 9999999999 }));
  return `fake-header.${payload}.fake-sig`;
}

const TEST_TOKEN = makeTestToken('user1');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const USERS_RESPONSE = {
  users: [
    { id: 'user1', name: 'Andreas', created: '2026-01-01' },
    { id: 'user2', name: 'Family Member', created: '2026-01-01' },
  ],
};

const EXERCISES_RESPONSE = {
  bodyweight: [{ id: 'pushups', name: 'Push-ups', category: 'bodyweight', muscle_groups: ['chest'] }],
  dumbbell: [{ id: 'bicep_curls', name: 'Bicep Curls', category: 'dumbbell', muscle_groups: ['biceps'] }],
};

const EMPTY_WORKOUT = { date: today(), exercises: [] };

const WORKOUT_WITH_EXERCISES = {
  date: today(),
  exercises: [
    { exercise_id: 'pushups', sets: [{ reps: 10 }, { reps: 8, weight: 5 }], timestamp: '2026-05-16T10:00:00' },
  ],
};

function setupDefaultMocks() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/users')) return Promise.resolve({ data: USERS_RESPONSE });
    if (url.includes('/exercises')) return Promise.resolve({ data: EXERCISES_RESPONSE });
    if (/\/workouts\/\d{4}-\d{2}-\d{2}/.test(url)) return Promise.resolve({ data: EMPTY_WORKOUT });
    if (url.includes('/workouts')) return Promise.resolve({ data: { dates: [] } });
    if (url.includes('/records')) return Promise.resolve({ data: { records: [] } });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  mockedAxios.post.mockResolvedValue({ data: { message: 'Workout logged successfully' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  // axios is fully mocked — provide stub interceptors so App's useEffect doesn't throw
  (mockedAxios as any).interceptors = {
    request: { use: jest.fn().mockReturnValue(1), eject: jest.fn() },
    response: { use: jest.fn().mockReturnValue(1), eject: jest.fn() },
  };
  // Simulate a logged-in user so App renders the main UI, not LoginPage
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) =>
    key === 'fitness_token' ? TEST_TOKEN : null
  );
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  setupDefaultMocks();
});

// ── Helper: wait for initial load ─────────────────────────────────────────────

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
}

// ── Pure helper unit tests ────────────────────────────────────────────────────

describe('today()', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getWeekDates()', () => {
  it('returns exactly 7 dates', () => {
    expect(getWeekDates(0)).toHaveLength(7);
  });

  it('first date is always a Monday', () => {
    const [mon] = getWeekDates(0);
    expect(new Date(mon + 'T00:00:00').getDay()).toBe(1);
  });

  it('all 7 dates are valid YYYY-MM-DD strings', () => {
    getWeekDates(0).forEach(d => expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('offset -1 returns the previous week (7 days earlier)', () => {
    const [mon0] = getWeekDates(0);
    const [mon1] = getWeekDates(-1);
    const diff = (new Date(mon0 + 'T00:00:00').getTime() - new Date(mon1 + 'T00:00:00').getTime()) / 86_400_000;
    expect(diff).toBe(7);
  });

  it('offset +1 returns the next week (7 days later)', () => {
    const [mon0] = getWeekDates(0);
    const [mon1] = getWeekDates(1);
    const diff = (new Date(mon1 + 'T00:00:00').getTime() - new Date(mon0 + 'T00:00:00').getTime()) / 86_400_000;
    expect(diff).toBe(7);
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe('App — initial render', () => {
  it('shows a loading state before data arrives', () => {
    // Delay both responses so loading state is visible
    mockedAxios.get.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders the week strip with 7 day pills after loading', async () => {
    await renderApp();
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    dayNames.forEach(name => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  });

  it("marks today's pill as active by default", async () => {
    await renderApp();
    const activeButton = screen.getByRole('button', { pressed: true });
    const todayWeekday = new Date(today() + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' });
    expect(activeButton).toHaveTextContent(todayWeekday);
  });

  it('shows empty-state text when no workouts are logged', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByText('No workouts logged this day.')).toBeInTheDocument();
    });
  });
});

describe('App — week strip activity dots', () => {
  it('shows a dot on days returned by the dates endpoint', async () => {
    const todayStr = today();
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/users')) return Promise.resolve({ data: USERS_RESPONSE });
      if (url.includes('/exercises')) return Promise.resolve({ data: EXERCISES_RESPONSE });
      if (/\/workouts\/\d{4}-\d{2}-\d{2}/.test(url)) return Promise.resolve({ data: EMPTY_WORKOUT });
      if (url.includes('/workouts')) return Promise.resolve({ data: { dates: [todayStr] } });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    await renderApp();
    expect(await screen.findByRole('img', { name: 'has workouts' })).toBeInTheDocument();
  });

  it('shows no dots when no dates are active', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'has workouts' })).not.toBeInTheDocument();
    });
  });
});

describe('App — day detail panel', () => {
  it('shows exercises when the selected day has workouts', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/users')) return Promise.resolve({ data: USERS_RESPONSE });
      if (url.includes('/exercises')) return Promise.resolve({ data: EXERCISES_RESPONSE });
      if (/\/workouts\/\d{4}-\d{2}-\d{2}/.test(url)) return Promise.resolve({ data: WORKOUT_WITH_EXERCISES });
      if (url.includes('/workouts')) return Promise.resolve({ data: { dates: [] } });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    await renderApp();
    // Push-ups appears in both the analytics card and the day detail — use set items to verify the detail panel
    expect(await screen.findByText('Set 1: 10 reps')).toBeInTheDocument();
    expect(await screen.findByText('Set 2: 8 reps @ 5')).toBeInTheDocument();
  });

  it('fetches a new day when a different pill is clicked', async () => {
    await renderApp();

    // Find a pill that is NOT today's and click it (day pills have aria-pressed; nav buttons do not)
    const otherPill = screen.getAllByRole('button')
      .find(btn => btn.getAttribute('aria-pressed') === 'false');
    if (otherPill) {
      await userEvent.click(otherPill);
    }

    // The day detail GET should have been called at least twice (once for today, once for the new day)
    await waitFor(() => {
      const dayCalls = mockedAxios.get.mock.calls.filter(([url]) => /\/workouts\/\d{4}-\d{2}-\d{2}/.test(url));
      expect(dayCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('App — week navigation', () => {
  it('prev-week button is always enabled', async () => {
    await renderApp();
    const prevBtn = screen.getByRole('button', { name: /previous week/i });
    expect(prevBtn).not.toBeDisabled();
  });

  it('next-week button is disabled on the current week', async () => {
    await renderApp();
    const nextBtn = screen.getByRole('button', { name: /next week/i });
    expect(nextBtn).toBeDisabled();
  });

  it('navigating to prev week re-fetches active dates', async () => {
    await renderApp();
    const prevBtn = screen.getByRole('button', { name: /previous week/i });
    await userEvent.click(prevBtn);

    await waitFor(() => {
      const listCalls = mockedAxios.get.mock.calls.filter(([url]) => url.includes('/workouts') && !/\/workouts\/\d{4}/.test(url));
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('App — logging a workout', () => {
  it('refreshes strip and detail after a successful log', async () => {
    await renderApp();

    await userEvent.selectOptions(screen.getByLabelText('Exercise:'), 'pushups');
    await userEvent.type(screen.getByLabelText('Reps:'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add Set' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log Workout' }));

    await waitFor(() => {
      const listCalls = mockedAxios.get.mock.calls.filter(([url]) => url.includes('/workouts') && !/\/workouts\/\d{4}/.test(url));
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      const dayCalls = mockedAxios.get.mock.calls.filter(([url]) => /\/workouts\/\d{4}-\d{2}-\d{2}/.test(url));
      expect(dayCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ── Analytics pure function tests ─────────────────────────────────────────────

const WEEK_WITH_DATA: WorkoutData[] = [
  {
    date: '2026-05-12',
    exercises: [
      { exercise_id: 'pushups', sets: [{ reps: 10 }, { reps: 8, weight: 5 }], timestamp: '' },
    ],
  },
  {
    date: '2026-05-13',
    exercises: [
      { exercise_id: 'pushups', sets: [{ reps: 12 }], timestamp: '' },
      { exercise_id: 'squats', sets: [{ reps: 15 }, { reps: 15 }], timestamp: '' },
    ],
  },
  { date: '2026-05-14', exercises: [] },
];

describe('computeWeeklyVolume()', () => {
  it('returns an entry per unique exercise', () => {
    const result = computeWeeklyVolume(WEEK_WITH_DATA);
    expect(result.map(v => v.exerciseId)).toEqual(
      expect.arrayContaining(['pushups', 'squats'])
    );
    expect(result).toHaveLength(2);
  });

  it('sums reps across all days and sets', () => {
    const result = computeWeeklyVolume(WEEK_WITH_DATA);
    const pushups = result.find(v => v.exerciseId === 'pushups')!;
    expect(pushups.totalReps).toBe(10 + 8 + 12); // 30
    const squats = result.find(v => v.exerciseId === 'squats')!;
    expect(squats.totalReps).toBe(15 + 15); // 30
  });

  it('counts total sets correctly', () => {
    const result = computeWeeklyVolume(WEEK_WITH_DATA);
    const pushups = result.find(v => v.exerciseId === 'pushups')!;
    expect(pushups.totalSets).toBe(3); // 2 sets day 1 + 1 set day 2
  });

  it('sorts by totalReps descending', () => {
    // pushups: 30 reps, squats: 30 reps — tie goes to insertion order;
    // let's use a case where one clearly exceeds the other
    const data: WorkoutData[] = [{
      date: '2026-05-12',
      exercises: [
        { exercise_id: 'pushups', sets: [{ reps: 5 }], timestamp: '' },
        { exercise_id: 'squats', sets: [{ reps: 20 }], timestamp: '' },
      ],
    }];
    const result = computeWeeklyVolume(data);
    expect(result[0].exerciseId).toBe('squats');
  });

  it('returns empty array for a week with no exercises', () => {
    const empty: WorkoutData[] = [{ date: '2026-05-12', exercises: [] }];
    expect(computeWeeklyVolume(empty)).toEqual([]);
  });
});

describe('computeWeeklyRecords()', () => {
  it('tracks max reps across all days', () => {
    const result = computeWeeklyRecords(WEEK_WITH_DATA);
    const pushups = result.find(r => r.exerciseId === 'pushups')!;
    expect(pushups.maxReps).toBe(12);
  });

  it('tracks max weight across all days', () => {
    const result = computeWeeklyRecords(WEEK_WITH_DATA);
    const pushups = result.find(r => r.exerciseId === 'pushups')!;
    expect(pushups.maxWeight).toBe(5);
  });

  it('sets maxWeight to null when no sets have weight', () => {
    const result = computeWeeklyRecords(WEEK_WITH_DATA);
    const squats = result.find(r => r.exerciseId === 'squats')!;
    expect(squats.maxWeight).toBeNull();
  });

  it('returns empty array for an empty week', () => {
    expect(computeWeeklyRecords([])).toEqual([]);
  });
});

describe('App — analytics panel', () => {
  it('renders week summary when workouts exist', async () => {
    const todayStr = today();
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/users')) return Promise.resolve({ data: USERS_RESPONSE });
      if (url.includes('/exercises')) return Promise.resolve({ data: EXERCISES_RESPONSE });
      if (/\/workouts\/\d{4}-\d{2}-\d{2}/.test(url)) {
        // Only today has data — other days return empty so weekly total = 10 reps
        const dateInUrl = url.match(/\/workouts\/(\d{4}-\d{2}-\d{2})/)?.[1];
        return Promise.resolve({
          data: dateInUrl === todayStr
            ? { date: todayStr, exercises: [{ exercise_id: 'pushups', sets: [{ reps: 10 }], timestamp: '' }] }
            : { date: dateInUrl, exercises: [] },
        });
      }
      if (url.includes('/workouts')) return Promise.resolve({ data: { dates: [todayStr] } });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    await renderApp();
    expect(await screen.findByText('Week summary')).toBeInTheDocument();
    expect(await screen.findByText('10 reps')).toBeInTheDocument();
  });

  it('hides week summary when the week has no workouts', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByText('Week summary')).not.toBeInTheDocument();
    });
  });
});

// ── Personal records panel tests ──────────────────────────────────────────────

const RECORDS_RESPONSE: { records: { exercise_id: string; max_reps: number; max_weight: number | null }[] } = {
  records: [
    { exercise_id: 'pushups', max_reps: 20, max_weight: null },
    { exercise_id: 'bicep_curls', max_reps: 12, max_weight: 15.0 },
  ],
};

function setupRecordsMocks() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/users')) return Promise.resolve({ data: USERS_RESPONSE });
    if (url.includes('/exercises')) return Promise.resolve({ data: EXERCISES_RESPONSE });
    if (/\/workouts\/\d{4}-\d{2}-\d{2}/.test(url)) return Promise.resolve({ data: EMPTY_WORKOUT });
    if (url.includes('/workouts')) return Promise.resolve({ data: { dates: [] } });
    if (url.includes('/records')) return Promise.resolve({ data: RECORDS_RESPONSE });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
}

describe('App — personal records panel', () => {
  it('renders the records panel when records exist', async () => {
    setupRecordsMocks();
    await renderApp();
    await waitFor(() => {
      expect(screen.getByText('Personal records')).toBeInTheDocument();
    });
  });

  it('hides the records panel when no records exist', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByText('Personal records')).not.toBeInTheDocument();
    });
  });

  it('displays max reps for each exercise', async () => {
    setupRecordsMocks();
    await renderApp();
    expect(await screen.findByText('20 reps')).toBeInTheDocument();
    expect(await screen.findByText('12 reps')).toBeInTheDocument();
  });

  it('displays max weight when present', async () => {
    setupRecordsMocks();
    await renderApp();
    await waitFor(() => {
      expect(screen.getByText('max 15')).toBeInTheDocument();
    });
  });

  it('fetches records again after logging a workout', async () => {
    setupRecordsMocks();
    mockedAxios.post.mockResolvedValue({ data: { message: 'Workout logged successfully' } });
    await renderApp();

    await userEvent.selectOptions(screen.getByLabelText('Exercise:'), 'pushups');
    await userEvent.type(screen.getByLabelText('Reps:'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add Set' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log Workout' }));

    await waitFor(() => {
      const recordsCalls = mockedAxios.get.mock.calls.filter(([url]) => url.includes('/records'));
      expect(recordsCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('App — authentication', () => {
  it('shows the login page when no token is stored', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    render(<App />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows a sign-out button when logged in', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signs out and shows login page on sign-out click', async () => {
    const removeSpy = jest.spyOn(Storage.prototype, 'removeItem');
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(removeSpy).toHaveBeenCalledWith('fitness_token');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

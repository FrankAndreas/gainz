import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import axios from 'axios';

import App, { today, getWeekDates } from './App';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  mockedAxios.post.mockResolvedValue({ data: { message: 'Workout logged successfully' } });
}

beforeEach(() => {
  jest.clearAllMocks();
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
    const activeButton = document.querySelector('.day-pill--active');
    expect(activeButton).toBeInTheDocument();
    // The active pill should correspond to today's weekday abbreviation
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
    await waitFor(() => {
      expect(document.querySelector('.day-dot')).toBeInTheDocument();
    });
  });

  it('shows no dots when no dates are active', async () => {
    await renderApp();
    await waitFor(() => {
      expect(document.querySelector('.day-dot')).not.toBeInTheDocument();
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
    await waitFor(() => {
      expect(screen.getByText('Push-ups')).toBeInTheDocument();
      expect(screen.getByText('Set 1: 10 reps')).toBeInTheDocument();
      expect(screen.getByText('Set 2: 8 reps @ 5')).toBeInTheDocument();
    });
  });

  it('fetches a new day when a different pill is clicked', async () => {
    await renderApp();

    // Find a pill that is NOT today's and click it
    const pills = document.querySelectorAll('.day-pill');
    const otherPill = Array.from(pills).find(p => !p.classList.contains('day-pill--active'));
    if (otherPill) {
      await userEvent.click(otherPill as HTMLElement);
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

    // Select exercise, add a set, submit
    await userEvent.selectOptions(screen.getByLabelText('Exercise:'), 'pushups');
    await userEvent.type(screen.getByLabelText('Reps:'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add Set' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log Workout' }));

    await waitFor(() => {
      // Both the list and the day detail should have been re-fetched
      const listCalls = mockedAxios.get.mock.calls.filter(([url]) => url.includes('/workouts') && !/\/workouts\/\d{4}/.test(url));
      const dayCalls = mockedAxios.get.mock.calls.filter(([url]) => /\/workouts\/\d{4}-\d{2}-\d{2}/.test(url));
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
      expect(dayCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

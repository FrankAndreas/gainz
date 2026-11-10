import axios from 'axios';
import type { Mocked } from 'vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), defaults: { withCredentials: false, headers: { common: {} } } },
}));
const mockedAxios = axios as Mocked<typeof axios>;

import { API_URL, errorCode, fetchActiveDates, fetchDayWorkout, fetchMe } from './api';

function httpError(status: number, code?: string) {
  return { response: { status, data: code ? { detail: { code } } : { detail: 'x' } } };
}

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('talks to /api with the hub cookie and the CSRF header', () => {
    expect(API_URL).toBe('/api');
    expect(axios.defaults.withCredentials).toBe(true);
    expect(axios.defaults.headers.common['X-Requested-With']).toBe('fitness');
  });

  it('asks for a day without a user id', async () => {
    mockedAxios.get.mockResolvedValue({ data: { date: '2026-01-05', exercises: [] } });
    await fetchDayWorkout('2026-01-05');
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/workouts/2026-01-05');
  });

  it('asks for the week without a user id', async () => {
    mockedAxios.get.mockResolvedValue({ data: { dates: ['2026-01-05'] } });
    const dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11'];
    expect(await fetchActiveDates(dates)).toEqual(new Set(['2026-01-05']));
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/workouts', {
      params: { date_from: '2026-01-05', date_to: '2026-01-11' },
    });
  });

  it('fetchMe passes on the renew header once a day', async () => {
    mockedAxios.get.mockResolvedValue({ data: { id: 'hub1', name: 'Andreas' }, headers: { 'x-hub-renew': '1' } });
    expect(await fetchMe()).toEqual({ me: { id: 'hub1', name: 'Andreas' }, renew: true });
    expect((await fetchMe()).renew).toBe(false);
  });

  it('errorCode reads the backend codes', () => {
    expect(errorCode(httpError(401, 'not_logged_in'))).toBe('not_logged_in');
    expect(errorCode(httpError(403, 'no_access'))).toBe('no_access');
    expect(errorCode(httpError(503, 'hub_unavailable'))).toBe('hub_unavailable');
    expect(errorCode(httpError(403, 'csrf'))).toBe('csrf');
    expect(errorCode(httpError(400))).toBeNull();
    expect(errorCode(new Error('Network Error'))).toBeNull();
  });
});

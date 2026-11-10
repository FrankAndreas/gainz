import { describe, expect, it } from 'vitest';
import { loginAddress, renewNow } from './hubAddress';

const home = { login_url: 'https://home.local.example.ch', logout_url: 'https://home.local.example.ch/logout' };
const outside = { login_url: 'https://home.local.example.ch', logout_url: '/cdn-cgi/access/logout' };

describe('loginAddress', () => {
    it('at home the hub\'s login, back here afterwards', () => {
        expect(loginAddress(home, 'https://kalender.local.example.ch/plan'))
            .toBe('https://home.local.example.ch/?next=https%3A%2F%2Fkalender.local.example.ch%2Fplan');
        expect(loginAddress(home, null)).toBe('https://home.local.example.ch');
    });
    it('outside none: the hub\'s home address is out of reach, Cloudflare Access is the login there', () => {
        expect(loginAddress(outside, 'https://kalender.example.ch/')).toBeNull();
    });
});

describe('renewNow', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const memory = () => {
        const kept = new Map<string, string>();
        return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
    };

    it('only when the backend asks', () => {
        expect(renewNow({}, memory())).toBe(false);
        expect(renewNow({ 'x-hub-renew': '1' }, memory())).toBe(true);
    });

    it('at most once a day', () => {
        const storage = memory();
        expect(renewNow({ 'x-hub-renew': '1' }, storage, 1000)).toBe(true);
        expect(renewNow({ 'x-hub-renew': '1' }, storage, 1000 + DAY - 1)).toBe(false);
        expect(renewNow({ 'x-hub-renew': '1' }, storage, 1000 + DAY)).toBe(true);
    });

    it('never without storage, so it can never loop', () => {
        const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
        expect(renewNow({ 'x-hub-renew': '1' }, broken)).toBe(false);
        expect(renewNow({ 'x-hub-renew': '1' }, null)).toBe(false);
    });
});

import path from 'node:path';
import { expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

// The Python with the backend's packages; a path is made absolute (Python warns about relative ones with "..")
const configured = process.env.E2E_PYTHON ?? 'python3';
export const PYTHON = configured.includes('/') ? path.resolve(configured) : configured;

export const HUB = 'http://localhost:8130';
export const FRONTEND = 'http://localhost:3100';
export const ADMIN_PIN = '1111';
// The hub takes changes only with its own header, and the manage cookie of the login
const HUB_HEADERS = { 'X-Requested-With': 'hub' };

// A login at the hub, in a throwaway API context: logging out would end the login, so the cookies are only read
async function hubCookies(name: string, pin: string): Promise<{ token: string; cookies: string }> {
    const context = await playwrightRequest.newContext();
    try {
        const response = await context.post(`${HUB}/api/login`, { data: { name, pin }, headers: HUB_HEADERS });
        expect(response.ok(), await response.text()).toBeTruthy();
        const found = response.headersArray()
            .filter(h => h.name.toLowerCase() === 'set-cookie' && /^hub_(session|manage)=/.test(h.value))
            .map(h => h.value.split(';')[0]);
        const session = found.find(c => c.startsWith('hub_session='));
        expect(session, 'the hub sets hub_session').toBeTruthy();
        return { token: session!.slice('hub_session='.length), cookies: found.join('; ') };
    } finally {
        await context.dispose();
    }
}

async function asHubAdmin<T = any>(request: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
    const { cookies } = await hubCookies('Admin', ADMIN_PIN);
    const response = await request.fetch(`${HUB}${url}`, { method, data, headers: { ...HUB_HEADERS, Cookie: cookies } });
    expect(response.ok(), `${method} ${url}: ${await response.text()}`).toBeTruthy();
    return response.json();
}

// The tracker's tile in the hub, with the key "fitness" and Admin ticked (made on first use)
async function fitnessTile(request: APIRequestContext): Promise<void> {
    const tiles = await asHubAdmin<{ app_key: string | null }[]>(request, 'GET', '/api/tiles/manage');
    if (tiles.some(t => t.app_key === 'fitness')) return;
    const admin = (await asHubAdmin<{ id: number; name: string }[]>(request, 'GET', '/api/people')).find(p => p.name === 'Admin')!;
    await asHubAdmin(request, 'POST', '/api/tiles', { name: 'Fitness', local_url: FRONTEND, app_key: 'fitness', people: [admin.id] });
}

// The page with Admin's hub cookie, as at home after logging in at the hub; errors in the browser are collected
export async function login(page: Page, request: APIRequestContext): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await fitnessTile(request);
    const { token } = await hubCookies('Admin', ADMIN_PIN);
    await page.context().addCookies([{ name: 'hub_session', value: token, url: FRONTEND }]);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Fitness Tracker' })).toBeVisible();
    return errors;
}

// Where the family hub is (HUB_PUBLIC_URL) and where "Log out" goes: at home the hub, outside Cloudflare Access, whose
// logout is an address on this site
export interface HubLinks {
    login_url: string;
    logout_url: string;
}

// Where a login that ended goes: at home the hub's login, which sends the browser back to `next` afterwards. Outside
// nowhere: the hub's home address is out of reach there, and Cloudflare Access asks for its e-mail code by itself
// (security review 2026-10-31)
export function loginAddress(links: HubLinks, next: string | null): string | null {
    if (links.logout_url.startsWith('/')) return null;
    return next ? `${links.login_url}/?next=${encodeURIComponent(next)}` : links.login_url;
}

// The hub login is in its last week (the backend's X-Hub-Renew, on loading the page): once through the hub, which
// renews it and sends the browser straight back. At most once a day, in case the renewal doesn't take; without storage
// not at all, so it can never loop (app integration review 2026-11-07)
export const RENEWED_AT = 'hubRenewedAt';
const DAY_MS = 24 * 60 * 60 * 1000;

export function renewNow(
    headers: Record<string, unknown>,
    storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    now: number = Date.now(),
): boolean {
    if (headers['x-hub-renew'] !== '1' || !storage) return false;
    try {
        const last = Number(storage.getItem(RENEWED_AT));
        if (last && now - last < DAY_MS) return false;
        storage.setItem(RENEWED_AT, String(now));
        return true;
    } catch {
        return false;
    }
}

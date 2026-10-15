// FE-07: the trainer keeps unsaved code in localStorage (practice/draft-recovery.service.ts) only as a short
// safety net between the editor and the server draft. These helpers live in core so the shell can clean it up
// without loading the trainer: on an explicit sign-out the account's copies go, and any copy expires after
// LOCAL_DRAFT_TTL_MS. The key is the JSON tuple from DraftRecovery.key, an attempt intent adds «:intent».
export const LOCAL_DRAFT_PREFIX = '["mentor.practice.source.v1",';
export const LOCAL_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// A copy without a timestamp predates FE-07 (expireLocalDrafts dates it on the next start); a stamp from the
// far future (a wrong computer clock) does not make a copy immortal.
export function localDraftExpired(value: unknown, now = Date.now()): boolean {
    const saved = value !== null && typeof value === 'object' ? (value as { savedAt?: unknown }).savedAt : undefined;
    return typeof saved === 'number' && Number.isFinite(saved) && Math.abs(now - saved) > LOCAL_DRAFT_TTL_MS;
}

function draftKeys(): string[] {
    const keys: string[] = [];
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key?.startsWith(LOCAL_DRAFT_PREFIX)) keys.push(key);
        }
    } catch {
        // Storage is unavailable: there is nothing this tab could have written either.
    }
    return keys;
}

function owner(key: string): string | null {
    try {
        const parts: unknown = JSON.parse(key.endsWith(':intent') ? key.slice(0, -':intent'.length) : key);
        return Array.isArray(parts) && typeof parts[1] === 'string' ? parts[1] : null;
    } catch {
        return null;
    }
}

function remove(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // Nothing more to do: the next start or sign-out tries again.
    }
}

// The signed-out account's unsaved copies; other accounts' copies are left alone.
export function forgetLocalDrafts(account: string): void {
    for (const key of draftKeys()) if (owner(key) === account) remove(key);
}

// Copies older than the TTL and unreadable entries, for every account on this browser; an undated copy from
// before FE-07 gets today's date, so its two weeks start now. Runs once per start over a handful of small keys.
export function expireLocalDrafts(now = Date.now()): void {
    for (const key of draftKeys()) {
        let value: unknown;
        try {
            value = JSON.parse(localStorage.getItem(key) ?? 'null');
        } catch {
            remove(key);
            continue;
        }
        if (owner(key) === null || localDraftExpired(value, now)) remove(key);
        else if (value !== null && typeof value === 'object' && !('savedAt' in value)) {
            try {
                localStorage.setItem(key, JSON.stringify({ ...value, savedAt: now }));
            } catch {
                // A full or denied storage keeps the copy undated; the account's sign-out still removes it.
            }
        }
    }
}

import { expireLocalDrafts, forgetLocalDrafts, LOCAL_DRAFT_TTL_MS, localDraftExpired } from './local-drafts';

const key = (account: string, exercise = 'e1') => JSON.stringify(['mentor.practice.source.v1', account, 'w1', 's1', 'l1', exercise, ['number', 1]]);
const now = Date.parse('2026-10-16T09:00:00Z');

describe('Local trainer drafts', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('forgets only the signed-out account, with its attempt intents', () => {
        localStorage.setItem(key('u1'), JSON.stringify({ files: { 'A.java': 'a' }, savedAt: now }));
        localStorage.setItem(key('u1') + ':intent', JSON.stringify({ key: 'k', savedAt: now }));
        localStorage.setItem(key('u2'), JSON.stringify({ files: { 'B.java': 'b' }, savedAt: now }));
        localStorage.setItem('mentor.practice.theme', 'dark');
        forgetLocalDrafts('u1');
        expect(localStorage.getItem(key('u1'))).toBeNull();
        expect(localStorage.getItem(key('u1') + ':intent')).toBeNull();
        expect(localStorage.getItem(key('u2'))).not.toBeNull();
        expect(localStorage.getItem('mentor.practice.theme')).toBe('dark');
    });

    it('expires copies older than two weeks for every account and keeps fresh and undated ones', () => {
        const old = now - LOCAL_DRAFT_TTL_MS - 1;
        localStorage.setItem(key('u1', 'old'), JSON.stringify({ files: {}, savedAt: old }));
        localStorage.setItem(key('u2', 'old') + ':intent', JSON.stringify({ key: 'k', savedAt: old }));
        localStorage.setItem(key('u1', 'fresh'), JSON.stringify({ files: {}, savedAt: now - 1000 }));
        localStorage.setItem(key('u1', 'undated'), JSON.stringify({ files: {} }));
        localStorage.setItem(key('u1', 'broken'), '{');
        expireLocalDrafts(now);
        expect(localStorage.getItem(key('u1', 'old'))).toBeNull();
        expect(localStorage.getItem(key('u2', 'old') + ':intent')).toBeNull();
        expect(localStorage.getItem(key('u1', 'broken'))).toBeNull();
        expect(localStorage.getItem(key('u1', 'fresh'))).not.toBeNull();
        expect(localStorage.getItem(key('u1', 'undated'))).not.toBeNull();
    });

    it('dates an undated copy from before FE-07 so its two weeks start now', () => {
        localStorage.setItem(key('u1', 'undated'), JSON.stringify({ files: { 'A.java': 'a' } }));
        expireLocalDrafts(now);
        expect(JSON.parse(localStorage.getItem(key('u1', 'undated'))!)).toEqual({ files: { 'A.java': 'a' }, savedAt: now });
    });

    it('treats only a dated copy past the limit, either way in time, as expired', () => {
        expect(localDraftExpired({ savedAt: now - LOCAL_DRAFT_TTL_MS }, now)).toBe(false);
        expect(localDraftExpired({ savedAt: now - LOCAL_DRAFT_TTL_MS - 1 }, now)).toBe(true);
        expect(localDraftExpired({ savedAt: now + LOCAL_DRAFT_TTL_MS + 1 }, now)).toBe(true);
        expect(localDraftExpired({ files: {} }, now)).toBe(false);
        expect(localDraftExpired(null, now)).toBe(false);
    });

    it('survives storage that refuses access', () => {
        vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(() => forgetLocalDrafts('u1')).not.toThrow();
        expect(() => expireLocalDrafts(now)).not.toThrow();
        vi.restoreAllMocks();
    });
});

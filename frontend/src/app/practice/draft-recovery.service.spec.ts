import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { DraftRecovery } from './draft-recovery.service';
import { LOCAL_DRAFT_TTL_MS } from '../core/local-drafts';
describe('Owned exact practice recovery', () => {
    beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }); const session = TestBed.inject(SessionStore); session.load().subscribe(); TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/session').flush({ account: { userId: 'u1', workspaceId: 'w1', role: 'STUDENT', authVersion: 1 }, csrfToken: 'synthetic' }); });
    afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); TestBed.resetTestingModule(); });
    it('distinguishes typed revision and every scope component with exact whitespace source', () => { const r = TestBed.inject(DraftRecovery), key = r.key('u1', 'w1', 's1', 'l1', 'e1', 1); expect(key).not.toBe(r.key('u1', 'w1', 's1', 'l1', 'e1', '1')); for (const position of [0, 1, 2, 3, 4]) {
        const tuple = ['u1', 'w1', 's1', 'l1', 'e1'];
        tuple[position] += 'different';
        expect(key).not.toBe(r.key(tuple[0], tuple[1], tuple[2], tuple[3], tuple[4], 1));
    } const files = { 'demo/Task.java': '  class Task {}\r\n' }; r.save(key, files); expect(r.read(key)?.files).toEqual(files); r.remove(key); expect(r.read(key)).toBeNull(); });
    it('never writes or exposes an old account recovery after invalidation', () => { const r = TestBed.inject(DraftRecovery), key = r.key('u1', 'w1', 's1', 'l1', 'e1', 1), files = { 'Task.java': 'unsaved' }; r.save(key, files); const set = vi.spyOn(Storage.prototype, 'setItem'); TestBed.inject(SessionStore).invalidate(); r.save(key, { 'Task.java': 'late old source' }); expect(set).not.toHaveBeenCalled(); expect(r.read(key)).toBeNull(); });
    it('stamps a saved copy and drops one older than two weeks instead of restoring it', () => { const r = TestBed.inject(DraftRecovery), key = r.key('u1', 'w1', 's1', 'l1', 'e1', 1); r.save(key, { 'Task.java': 'fresh' }); const stored = JSON.parse(localStorage.getItem(key)!); expect(typeof stored.savedAt).toBe('number'); localStorage.setItem(key, JSON.stringify({ files: { 'Task.java': 'old' }, savedAt: Date.now() - LOCAL_DRAFT_TTL_MS - 1 })); expect(r.read(key)).toBeNull(); expect(localStorage.getItem(key)).toBeNull(); });
    it('storage denial leaves the caller source intact and surfaces save failure', () => { const r = TestBed.inject(DraftRecovery), key = r.key('u1', 'w1', 's1', 'l1', 'e1', 1), files = { 'Task.java': 'not lost' }; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); }); expect(() => r.save(key, files)).toThrow(); expect(files).toEqual({ 'Task.java': 'not lost' }); });
});

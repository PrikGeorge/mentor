import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { AttemptPoller } from './attempt-poller.service';
@Component({ template: '' })
class LoginStub {
}
const lesson = { workspaceId: 'w1', studentId: 's1', id: 'l1' }, url = '/api/v1/workspaces/w1/students/s1/lessons/l1/practice/exercises/e1/attempts/a1';
const pending = { id: 'a1', exerciseId: 'e1', exerciseRevision: 1, environmentRevision: 'synthetic', mode: 'run', jobState: 'queued', files: { 'Task.java': 'source' }, result: null, createdAt: '2030-01-01T00:00:00Z' };
describe('Durable attempt polling', () => {
    beforeEach(() => { vi.useFakeTimers(); TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'login', component: LoginStub }]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }); const session = TestBed.inject(SessionStore); session.load().subscribe(); TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/session').flush({ account: { userId: 'u1', workspaceId: 'w1', role: 'STUDENT', authVersion: 1 }, csrfToken: 'synthetic' }); });
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); vi.useRealTimers(); TestBed.resetTestingModule(); });
    it('polls immediately then every2s and stops after a terminal response', () => { const http = TestBed.inject(HttpTestingController), seen: unknown[] = []; TestBed.inject(AttemptPoller).watch(lesson, 'e1', 'a1').subscribe(a => seen.push(a)); http.expectOne(url).flush(pending); vi.advanceTimersByTime(1999); http.expectNone(url); vi.advanceTimersByTime(1); http.expectOne(url).flush({ ...pending, jobState: 'completed', result: { status: 'wrong_answer', passed: 0, total: 1, elapsedMs: 1, tests: [] } }); vi.advanceTimersByTime(30000); http.expectNone(url); expect(seen).toHaveLength(2); });
    it('backs network failure off4/8/16/30s without overlapping requests', () => { const http = TestBed.inject(HttpTestingController), sub = TestBed.inject(AttemptPoller).watch(lesson, 'e1', 'a1').subscribe(); for (const delay of [4000, 8000, 16000, 30000, 30000]) {
        http.expectOne(url).error(new ProgressEvent('error'));
        vi.advanceTimersByTime(delay - 1);
        http.expectNone(url);
        vi.advanceTimersByTime(1);
    } const request = http.expectOne(url); vi.advanceTimersByTime(60000); http.expectNone(url); sub.unsubscribe(); expect(request.cancelled).toBe(true); });
    it('stops old generation and401 rather than polling from the new account', () => { const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore); TestBed.inject(AttemptPoller).watch(lesson, 'e1', 'a1').subscribe({ error: () => { } }); http.expectOne(url).flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' }); vi.advanceTimersByTime(30000); http.expectNone(url); expect(session.actor()).toBeNull(); });
});

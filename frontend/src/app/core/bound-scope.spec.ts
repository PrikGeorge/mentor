import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { defer, finalize, of, Subject, throwError } from 'rxjs';
import { createBoundScope } from './bound-scope';
import { SessionStore } from './session.store';

@Component({ template: '' })
class ScopeHost {
    readonly key = signal<readonly (string | number)[]>(['workspace', 'student', 'lesson', 1]);
    readonly scope = createBoundScope(() => this.key());
    readonly sessionScope = createBoundScope();
    readonly active = computed(() => this.scope.active());
}

describe('Bound component scope', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
    afterEach(() => TestBed.inject(HttpTestingController).verify());

    function setup() {
        const session = TestBed.inject(SessionStore);
        const http = TestBed.inject(HttpTestingController);
        const account = { userId: 'teacher', workspaceId: 'workspace', role: 'TEACHER', authVersion: 1 };
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account, csrfToken: 'synthetic' });
        const fixture = TestBed.createComponent(ScopeHost);
        return { fixture, host: fixture.componentInstance, session, http, account };
    }

    it('requires an explicit binding and rejects changed inputs before rendering', () => {
        const { host } = setup();
        expect(host.scope.current()).toBe(true);
        expect(host.active()).toBe(false);
        expect(host.sessionScope.active()).toBe(true);
        host.scope.bind();
        expect(host.active()).toBe(true);
        host.key.set(['workspace', 'student', 'another-lesson', 1]);
        expect(host.active()).toBe(false);
        expect(host.scope.current()).toBe(true);
        host.scope.bind();
        expect(host.active()).toBe(true);
    });

    it('compares primitive values exactly and snapshots the key array', () => {
        const { host } = setup();
        const parts = ['workspace', 'student', 'lesson', 1];
        host.key.set(parts);
        host.scope.bind();
        parts[3] = '1';
        expect(host.scope.active()).toBe(false);
        host.key.set(['workspace', 'student', 'lesson', 1]);
        expect(host.scope.active()).toBe(true);
    });

    it('never revives an old callback when a component returns from B to A', () => {
        const { host } = setup();
        const unbound = host.scope.capture();
        host.scope.bind();
        const first = host.scope.capture();
        host.key.set(['workspace', 'student', 'B', 1]);
        host.scope.bind();
        host.key.set(['workspace', 'student', 'lesson', 1]);
        host.scope.bind();
        expect(host.scope.active()).toBe(true);
        expect(first()).toBe(false);
        expect(unbound()).toBe(false);
    });

    it('cancels old requests on bind and invalidates their cleanup callbacks first', () => {
        const { host } = setup();
        host.scope.bind();
        const source = new Subject<string>();
        const received: string[] = [];
        const accepted = host.scope.capture();
        const cleanup = vi.fn(() => expect(accepted()).toBe(false));
        host.scope.track(source.pipe(finalize(cleanup))).subscribe((value) => received.push(value));
        source.next('first');
        host.key.set(['workspace', 'student', 'B', 1]);
        source.next('late-before-render');
        expect(received).toEqual(['first']);
        host.scope.bind();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(source.observed).toBe(false);
    });

    it('does not start an observable created by an earlier binding after rebind', () => {
        const { host } = setup();
        host.scope.bind();
        const start = vi.fn(() => of('old'));
        const request = host.scope.track(defer(start));
        host.scope.bind();
        request.subscribe();
        expect(start).not.toHaveBeenCalled();
    });

    it('forwards current errors and discards errors from changed inputs before bind', () => {
        const { host } = setup();
        host.scope.bind();
        const failure = new Error('current');
        const error = vi.fn();
        host.scope.track(throwError(() => failure)).subscribe({ error });
        expect(error).toHaveBeenCalledWith(failure);
        const pending = new Subject<void>();
        host.scope.track(pending).subscribe({ error });
        host.key.set(['workspace', 'student', 'B', 1]);
        pending.error(new Error('stale'));
        expect(error).toHaveBeenCalledOnce();
    });

    it('cancels on session change and never adopts a new login of the same account', () => {
        const { host, session, http, account } = setup();
        host.scope.bind();
        const pending = new Subject<void>();
        const complete = vi.fn();
        host.scope.track(pending).subscribe({ complete });
        session.invalidate();
        expect(complete).toHaveBeenCalledOnce();
        expect(pending.observed).toBe(false);
        expect(host.scope.current()).toBe(false);
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account, csrfToken: 'new-synthetic' });
        host.scope.bind();
        expect(host.scope.current()).toBe(false);
        expect(host.scope.active()).toBe(false);
        const start = vi.fn(() => of('forbidden'));
        host.scope.track(defer(start)).subscribe();
        expect(start).not.toHaveBeenCalled();
    });

    it('invalidates computed state, callbacks and streams when destroyed', () => {
        const { fixture, host } = setup();
        host.scope.bind();
        const accepted = host.scope.capture();
        const pending = new Subject<void>();
        const complete = vi.fn();
        host.sessionScope.track(pending).subscribe({ complete });
        expect(host.active()).toBe(true);
        fixture.destroy();
        expect(host.active()).toBe(false);
        expect(accepted()).toBe(false);
        expect(host.sessionScope.current()).toBe(false);
        expect(complete).toHaveBeenCalledOnce();
        expect(pending.observed).toBe(false);
    });
});

import { Component, inject, InjectionToken, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, Observable, of, throwError } from 'rxjs';
import { createBoundScope } from './bound-scope';
import { readResource } from './read-resource';
import { SessionStore } from './session.store';

type Params = { id: string };
type Value = { text: string };
const source = new InjectionToken<(params: Params) => Observable<Value>>('read resource test source', {
    factory: () => {
        const http = inject(HttpClient);
        return (params) => http.get<Value>('/read/' + params.id);
    },
});

@Component({ template: '' })
class ReadHost {
    readonly params = signal<Params | undefined>({ id: 'A' });
    private readonly load = inject(source);
    readonly read = readResource({ params: () => this.params(), load: this.load });
}

@Component({ template: '' })
class BoundReadHost {
    readonly id = input.required<string>();
    readonly scope = createBoundScope(() => [this.id()]);
    private readonly load = inject(source);
    readonly read = readResource({ scope: this.scope, params: () => ({ id: this.id() }), load: this.load });
}

describe('Session-bound read resource', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
    afterEach(() => TestBed.inject(HttpTestingController).verify());

    function session() {
        const http = TestBed.inject(HttpTestingController),
            store = TestBed.inject(SessionStore);
        const account = { userId: 'teacher', workspaceId: 'workspace', role: 'TEACHER', authVersion: 1 };
        store.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account, csrfToken: 'synthetic' });
        return { http, store, account };
    }

    function setup(load?: (params: Params) => Observable<Value>) {
        if (load) TestBed.overrideProvider(source, { useValue: load });
        const identity = session(),
            fixture = TestBed.createComponent(ReadHost);
        return { ...identity, fixture, host: fixture.componentInstance };
    }

    it('loads an HTTP snapshot and exposes its pending and resolved state', async () => {
        const { fixture, host, http } = setup();
        expect(host.read.state()).toEqual({ status: 'loading', params: { id: 'A' } });
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'first' });
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'first' } });
    });

    for (const response of ['value', 'error'] as const) {
        it(`discards a late ${response} after params change before the resource effect runs`, async () => {
            const { fixture, host, http } = setup();
            expect(host.read.state().status).toBe('loading');
            fixture.detectChanges();
            const old = http.expectOne('/read/A');
            host.params.set({ id: 'B' });
            expect(host.read.state()).toEqual({ status: 'loading', params: { id: 'B' } });
            if (response === 'value') old.flush({ text: 'obsolete' });
            else old.flush({ message: 'obsolete failure' }, { status: 503, statusText: 'Unavailable' });
            await Promise.resolve();
            expect(host.read.state()).toEqual({ status: 'loading', params: { id: 'B' } });
            fixture.detectChanges();
            http.expectOne('/read/B').flush({ text: 'current' });
            await fixture.whenStable();
            expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'B' }, value: { text: 'current' } });
        });
    }

    it('clears resolved data immediately when the params change', async () => {
        const { fixture, host, http } = setup();
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'private A' });
        await fixture.whenStable();
        expect(host.read.state().status).toBe('resolved');
        host.params.set({ id: 'B' });
        expect(host.read.state()).toEqual({ status: 'loading', params: { id: 'B' } });
        fixture.detectChanges();
        http.expectOne('/read/B').flush({ text: 'B' });
        await fixture.whenStable();
    });

    it('cancels pending HTTP when params become unavailable instead of leaving an idle request alive', async () => {
        const { fixture, host, http } = setup();
        expect(host.read.state().status).toBe('loading');
        fixture.detectChanges();
        const pending = http.expectOne('/read/A');
        host.params.set(undefined);
        expect(host.read.state()).toEqual({ status: 'idle' });
        fixture.detectChanges();
        expect(pending.cancelled).toBe(true);
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'idle' });
    });

    it('does not start HTTP while the initial params are unavailable', async () => {
        const { fixture, host, http } = setup();
        host.params.set(undefined);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'idle' });
        http.expectNone('/read/A');
    });

    it('cancels immediately on logout and never adopts a new login of the same account', async () => {
        const { fixture, host, http, store, account } = setup();
        expect(host.read.state().status).toBe('loading');
        fixture.detectChanges();
        const pending = http.expectOne('/read/A');
        store.invalidate();
        expect(pending.cancelled).toBe(true);
        expect(host.read.state()).toEqual({ status: 'idle' });
        store.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account, csrfToken: 'new-synthetic' });
        host.read.reload();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'idle' });
        http.expectNone('/read/A');
    });

    it('cancels its request on destruction and makes the retained state idle', async () => {
        const { fixture, host, http } = setup();
        expect(host.read.state().status).toBe('loading');
        fixture.detectChanges();
        const pending = http.expectOne('/read/A');
        fixture.destroy();
        expect(pending.cancelled).toBe(true);
        expect(host.read.state()).toEqual({ status: 'idle' });
        await Promise.resolve();
        expect(host.read.state()).toEqual({ status: 'idle' });
    });

    it('reloads the same params while clearing the previous value immediately', async () => {
        const { fixture, host, http } = setup();
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'before' });
        await fixture.whenStable();
        expect(host.read.state().status).toBe('resolved');
        host.read.reload();
        expect(host.read.state()).toEqual({ status: 'loading', params: { id: 'A' } });
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'after' });
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'after' } });
    });

    it('supports synchronous sources without writes inside the params computation', async () => {
        const { fixture, host } = setup((params) => of({ text: params.id }));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'A' } });
        host.params.set({ id: 'B' });
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'B' }, value: { text: 'B' } });
    });

    it('preserves a plain error and permits retry without throwing from state', async () => {
        const failure = { status: 503, error: { message: 'Synthetic failure' } };
        let fail = true;
        const { fixture, host } = setup(() => (fail ? throwError(() => failure) : of({ text: 'recovered' })));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'error', params: { id: 'A' }, error: failure });
        const failed = host.read.state();
        if (failed.status === 'error') expect(failed.error).toBe(failure);
        fail = false;
        host.read.reload();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'recovered' } });
    });

    it('turns a throwing loader into an error state preserving the thrown value', async () => {
        const failure = { reason: 'loader failed before returning an observable' };
        const { fixture, host } = setup(() => {
            throw failure;
        });
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'error', params: { id: 'A' }, error: failure });
    });

    it('handles completion without a value as idle without NG0991', async () => {
        const { fixture, host } = setup(() => EMPTY);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'idle' });
    });

    it('waits for an explicit binding without reading required inputs during construction', async () => {
        const { http } = session(),
            fixture = TestBed.createComponent(BoundReadHost),
            host = fixture.componentInstance;
        expect(host.read.state()).toEqual({ status: 'idle' });
        fixture.componentRef.setInput('id', 'A');
        host.scope.bind();
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'bound' });
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'bound' } });
    });

    it('cancels on rebind without surfacing an empty-completion error or reviving an old A request', async () => {
        const { http } = session(),
            fixture = TestBed.createComponent(BoundReadHost),
            host = fixture.componentInstance;
        fixture.componentRef.setInput('id', 'A');
        host.scope.bind();
        expect(host.read.state().status).toBe('loading');
        fixture.detectChanges();
        const first = http.expectOne('/read/A');
        fixture.componentRef.setInput('id', 'B');
        expect(host.read.state()).toEqual({ status: 'idle' });
        host.scope.bind();
        expect(first.cancelled).toBe(true);
        fixture.detectChanges();
        const middle = http.expectOne('/read/B');
        fixture.componentRef.setInput('id', 'A');
        host.scope.bind();
        expect(middle.cancelled).toBe(true);
        fixture.detectChanges();
        http.expectOne('/read/A').flush({ text: 'new A' });
        await fixture.whenStable();
        expect(host.read.state()).toEqual({ status: 'resolved', params: { id: 'A' }, value: { text: 'new A' } });
    });
});

import { DestroyRef, inject, signal, untracked } from '@angular/core';
import { catchError, defer, EMPTY, filter, Observable, Subject, takeUntil, throwError } from 'rxjs';
import { SessionStore } from './session.store';

type ScopeKey = readonly (string | number | boolean | null | undefined)[];

/** Component ownership only; role, workspace and write permissions stay with the caller. */
export function createBoundScope(readKey?: () => ScopeKey) {
    const session = inject(SessionStore);
    const owner = session.generation();
    const alive = signal(true);
    const binding = signal<ScopeKey | null>(readKey ? null : []);
    const changes = new Subject<void>();
    const current = () => alive() && owner === session.generation();
    const active = () => {
        const expected = binding();
        if (!current() || expected === null) return false;
        const actual = readKey?.() ?? [];
        return expected.length === actual.length && expected.every((part, index) => Object.is(part, actual[index]));
    };
    const capture = () => {
        const expected = untracked(binding);
        return () => expected !== null && expected === binding() && active();
    };
    inject(DestroyRef).onDestroy(() => {
        alive.set(false);
        changes.next();
        changes.complete();
    });

    return {
        current,
        active,
        capture,
        bind() {
            // Invalidate old callbacks before cancellation can run their finalizers.
            binding.set(null);
            changes.next();
            binding.set([...(readKey?.() ?? [])]);
        },
        track<T>(source: Observable<T>): Observable<T> {
            // A deferred subscription must keep the binding that created the request.
            const accepted = capture();
            return defer(() =>
                accepted()
                    ? session.scope(source, owner).pipe(
                          takeUntil(changes),
                          filter(() => accepted()),
                          catchError((error) => (accepted() ? throwError(() => error) : EMPTY))
                      )
                    : EMPTY
            );
        },
    };
}

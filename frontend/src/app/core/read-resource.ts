import { computed, Signal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, defaultIfEmpty, defer, map, Observable, of } from 'rxjs';
import { createBoundScope } from './bound-scope';

export type ReadState<P, T> =
    | { status: 'idle' }
    | { status: 'loading'; params: P }
    | { status: 'resolved'; params: P; value: T }
    | { status: 'error'; params: P; error: unknown };

type Request<P> = { request: P | undefined; refresh: number };
type Outcome<T> = { status: 'cancelled' } | { status: 'resolved'; value: T } | { status: 'error'; error: unknown };
type Result<P, T> = { request: Request<P>; outcome: Outcome<T> };

/** Read-only loading. Params and loaders must not mutate component state. */
export function readResource<P, T>(options: {
    scope?: ReturnType<typeof createBoundScope>;
    params: () => P | undefined;
    load: (snapshot: P) => Observable<T>;
}): { state: Signal<ReadState<P, T>>; reload: () => void } {
    const scope = options.scope ?? createBoundScope();
    const refresh = signal(0);
    // A defined envelope also makes Angular abort the old load when the public params become idle.
    const request = computed<Request<P>>(() => ({ request: scope.active() ? options.params() : undefined, refresh: refresh() }));
    const resource = rxResource<Result<P, T>, Request<P>>({
        params: request,
        stream: ({ params }) => {
            const snapshot = params.request;
            if (snapshot === undefined) return of({ request: params, outcome: { status: 'cancelled' } as const });
            return scope.track(defer(() => options.load(snapshot))).pipe(
                map((value): Outcome<T> => ({ status: 'resolved', value })),
                // Keep the original HTTP or fixture error, rather than Angular's Error.cause wrapper.
                catchError((error: unknown) => of<Outcome<T>>({ status: 'error', error })),
                // Session/binding cancellation may complete before the first response (NG0991).
                defaultIfEmpty<Outcome<T>, Outcome<T>>({ status: 'cancelled' }),
                map((outcome) => ({ request: params, outcome }))
            );
        },
    });
    const state = computed<ReadState<P, T>>(() => {
        const current = request(),
            params = current.request;
        if (params === undefined) return { status: 'idle' };
        if (resource.hasValue()) {
            const result = resource.value();
            // A changed input invalidates the old result even before resource effects run.
            if (result.request === current) {
                const outcome = result.outcome;
                if (outcome.status === 'resolved') return { status: 'resolved', params, value: outcome.value };
                if (outcome.status === 'error') return { status: 'error', params, error: outcome.error };
                return { status: 'idle' };
            }
        }
        const error = resource.error();
        return error === undefined ? { status: 'loading', params } : { status: 'error', params, error };
    });
    return { state, reload: () => refresh.update((value) => value + 1) };
}

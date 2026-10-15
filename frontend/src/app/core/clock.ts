import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

// FE-17: one wall clock for every countdown and «идёт сейчас» on screen. A list of 25 turn clocks shares a
// single timer instead of starting 25; the timer runs only while at least one view watches the clock.
export const CLOCK_TICK_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class Clock {
    private readonly current = signal(Date.now());
    private watchers = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    // Call in an injection context (a field initializer or constructor); the watch ends with the view.
    watch(destroyRef: DestroyRef = inject(DestroyRef)): Signal<number> {
        // Registered first: a view that is already destroyed throws here and never counts as a watcher.
        destroyRef.onDestroy(() => {
            if (--this.watchers === 0 && this.timer !== null) {
                clearInterval(this.timer);
                this.timer = null;
            }
        });
        if (this.watchers++ === 0) {
            this.current.set(Date.now());
            this.timer = setInterval(() => this.current.set(Date.now()), CLOCK_TICK_MS);
        }
        return this.current.asReadonly();
    }
}

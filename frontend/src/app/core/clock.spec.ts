import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock, CLOCK_TICK_MS } from './clock';

class View implements DestroyRef {
    private readonly callbacks: (() => void)[] = [];
    destroyed = false;
    onDestroy(callback: () => void) {
        this.callbacks.push(callback);
        return () => undefined;
    }
    destroy() {
        this.destroyed = true;
        this.callbacks.forEach((callback) => callback());
    }
}

describe('Shared clock', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        TestBed.resetTestingModule();
    });

    it('ticks every watcher from one timer and stops when the last view goes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
        const clock = TestBed.inject(Clock);
        const intervals = vi.spyOn(globalThis, 'setInterval');
        const first = new View(),
            second = new View();
        const a = clock.watch(first),
            b = clock.watch(second);
        expect(intervals).toHaveBeenCalledTimes(1);
        expect(a()).toBe(Date.parse('2026-10-16T09:00:00Z'));
        vi.advanceTimersByTime(CLOCK_TICK_MS);
        expect(a()).toBe(Date.parse('2026-10-16T09:00:30Z'));
        expect(b()).toBe(a());
        first.destroy();
        expect(vi.getTimerCount()).toBe(1);
        second.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts from the current time when a view watches again after a pause', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
        const clock = TestBed.inject(Clock);
        const view = new View();
        clock.watch(view);
        view.destroy();
        vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
        const again = new View();
        const now = clock.watch(again);
        expect(now()).toBe(Date.parse('2026-10-16T12:00:00Z'));
        again.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });
});

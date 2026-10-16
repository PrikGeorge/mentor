import { DestroyRef, Injectable, Signal, afterRenderEffect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from './session.store';

// UX-28: one switch for motion. Durations and curves live in styles.scss (--motion-*, --ease-*); scripts read them from
// there so CSS stays the only source, and fall back to the same numbers where styles are absent (unit tests).
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export type MotionDuration = 'instant' | 'quick' | 'move' | 'stage' | 'stagger';
export type MotionEase = 'move' | 'enter' | 'exit' | 'step';
const DURATIONS: Record<MotionDuration, number> = { instant: 80, quick: 140, move: 200, stage: 360, stagger: 30 };
const EASINGS: Record<MotionEase, string> = {
    move: 'cubic-bezier(.25, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, .2, 1)',
    exit: 'cubic-bezier(.4, 0, 1, 1)',
    step: 'steps(1, end)',
};

const token = (name: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim());

export function motionMs(name: MotionDuration): number {
    const raw = token('--motion-' + name);
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return DURATIONS[name];
    return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : DURATIONS[name];
}

export function motionEase(name: MotionEase): string {
    return token('--ease-' + name) || EASINGS[name];
}

// Read once at start-up by app.config: with reduced motion route transitions are not even provided.
export function prefersReducedMotion(): boolean {
    return typeof matchMedia !== 'function' || matchMedia(REDUCED_MOTION_QUERY).matches;
}

@Injectable({ providedIn: 'root' })
export class Motion {
    private readonly prefers = signal(true);
    // Without matchMedia (tests, old engines) motion counts as reduced: every animation is skipped.
    readonly reduced: Signal<boolean> = this.prefers.asReadonly();

    constructor() {
        if (typeof matchMedia !== 'function') return;
        const media = matchMedia(REDUCED_MOTION_QUERY);
        this.prefers.set(media.matches);
        media.addEventListener?.('change', (event) => this.prefers.set(event.matches));
    }

    // Never keeps a filled end state: when the animation ends, the element shows exactly what its classes say.
    animate(element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
        if (untracked(this.reduced) || !element || typeof element.animate !== 'function') return null;
        const fill = options.fill === 'backwards' ? 'backwards' : 'none';
        return element.animate(frames, { ...options, fill });
    }
}

export type MotionPlay<T> = (previous: T, value: T) => Animation | (Animation | null)[] | null | void;

/**
 * Plays a state change that happened in front of the user: the first render only remembers the value, and a change of
 * the binding key (another student, lesson, attempt) or of the session generation re-baselines without playing.
 * A newer change or destroy cancels what is still running. Call in an injection context.
 */
export function animateOnChange<T>(options: { value: () => T; key: () => unknown; play: MotionPlay<T>; equal?: (a: T, b: T) => boolean }): void {
    const session = inject(SessionStore);
    const equal = options.equal ?? Object.is;
    let last: { generation: number; key: unknown; value: T } | null = null;
    let running: Animation[] = [];
    const cancel = () => {
        for (const animation of running) animation.cancel();
        running = [];
    };
    inject(DestroyRef).onDestroy(cancel);
    afterRenderEffect(() => {
        const next = { generation: session.generation(), key: options.key(), value: options.value() };
        const previous = last;
        last = next;
        if (!previous || previous.generation !== next.generation || !Object.is(previous.key, next.key) || equal(previous.value, next.value)) return;
        cancel();
        const played = untracked(() => options.play(previous.value, next.value));
        running = (Array.isArray(played) ? played : [played]).filter((animation): animation is Animation => !!animation);
    });
}

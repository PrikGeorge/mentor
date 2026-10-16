import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Motion, animateOnChange, motionEase, motionMs, prefersReducedMotion } from './motion';
import { SessionStore } from './session.store';

type Listener = (event: { matches: boolean }) => void;
function stubMedia(matches: boolean) {
    const listeners: Listener[] = [];
    vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: (_: string, listener: Listener) => listeners.push(listener) }));
    return (next: boolean) => listeners.forEach((listener) => listener({ matches: next }));
}
const fakeAnimation = () => ({ cancel: vi.fn() }) as unknown as Animation & { cancel: ReturnType<typeof vi.fn> };

@Component({ template: '' })
class Host {
    readonly value = signal(0);
    readonly key = signal('lesson-a');
    readonly plays: [number, number][] = [];
    readonly animations: ReturnType<typeof fakeAnimation>[] = [];
    constructor() {
        animateOnChange({
            value: () => this.value(),
            key: () => this.key(),
            play: (previous, value) => {
                this.plays.push([previous, value]);
                const animation = fakeAnimation();
                this.animations.push(animation);
                return animation;
            },
        });
    }
}

describe('Motion', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        TestBed.resetTestingModule();
    });

    it('counts as reduced without matchMedia and then never animates', () => {
        vi.stubGlobal('matchMedia', undefined);
        const motion = TestBed.inject(Motion);
        const element = { animate: vi.fn() } as unknown as Element;
        expect(motion.reduced()).toBe(true);
        expect(prefersReducedMotion()).toBe(true);
        expect(motion.animate(element, [], { duration: 200 })).toBeNull();
        expect(element.animate).not.toHaveBeenCalled();
    });

    it('animates without a filled end state and follows the system switch', () => {
        const change = stubMedia(false);
        const motion = TestBed.inject(Motion);
        const animate = vi.fn(() => fakeAnimation());
        const element = { animate } as unknown as Element;
        expect(motion.reduced()).toBe(false);
        expect(motion.animate(element, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'forwards' })).not.toBeNull();
        expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'none' });
        motion.animate(element, [], { duration: 80, delay: 40, fill: 'backwards' });
        expect(animate).toHaveBeenLastCalledWith([], { duration: 80, delay: 40, fill: 'backwards' });
        change(true);
        expect(motion.reduced()).toBe(true);
        expect(motion.animate(element, [], { duration: 80 })).toBeNull();
        expect(animate).toHaveBeenCalledTimes(2);
    });

    it('skips elements that cannot animate (jsdom)', () => {
        stubMedia(false);
        expect(TestBed.inject(Motion).animate({} as Element, [], { duration: 80 })).toBeNull();
    });

    it('reads the token values with the CSS numbers as fallback', () => {
        expect([motionMs('instant'), motionMs('quick'), motionMs('move'), motionMs('stage'), motionMs('stagger')]).toEqual([80, 140, 200, 360, 30]);
        expect(motionEase('move')).toBe('cubic-bezier(.25, 0, 0, 1)');
        expect(motionEase('step')).toBe('steps(1, end)');
    });
});

describe('animateOnChange', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
    afterEach(() => TestBed.resetTestingModule());
    const render = () => {
        const fixture = TestBed.createComponent(Host);
        TestBed.tick();
        return { fixture, host: fixture.componentInstance };
    };

    it('only remembers the first value and plays a later change once', () => {
        const { host } = render();
        expect(host.plays).toEqual([]);
        host.value.set(1);
        TestBed.tick();
        TestBed.tick();
        expect(host.plays).toEqual([[0, 1]]);
    });

    it('does not play for an equal value (a clock tick, a reload of the same turn)', () => {
        const { host } = render();
        host.value.set(0);
        TestBed.tick();
        expect(host.plays).toEqual([]);
    });

    it('re-baselines without playing when the binding changes, then plays the next change', () => {
        const { host } = render();
        host.key.set('lesson-b');
        host.value.set(1);
        TestBed.tick();
        expect(host.plays).toEqual([]);
        host.value.set(2);
        TestBed.tick();
        expect(host.plays).toEqual([[1, 2]]);
    });

    it('does not play across an account change', () => {
        const { host } = render();
        TestBed.inject(SessionStore).invalidate();
        host.value.set(1);
        TestBed.tick();
        expect(host.plays).toEqual([]);
    });

    it('cancels the running animation on the next change and on destroy', () => {
        const { fixture, host } = render();
        host.value.set(1);
        TestBed.tick();
        host.value.set(2);
        TestBed.tick();
        expect(host.animations[0].cancel).toHaveBeenCalled();
        fixture.destroy();
        expect(host.animations[1].cancel).toHaveBeenCalled();
    });
});

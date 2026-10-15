import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { focusAfterRender } from './focus';

describe('Focus after render', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('moves focus after the next render unless the view moved on', async () => {
        @Component({ selector: 'mentor-focus-host', template: '<button class="one">Один</button><button class="two">Два</button>' })
        class FocusHost {
            readonly focus = focusAfterRender();
        }
        const fixture = TestBed.createComponent(FocusHost);
        document.body.appendChild(fixture.nativeElement);
        try {
            fixture.detectChanges();
            fixture.componentInstance.focus('.two');
            fixture.componentInstance.focus('.one', () => false);
            await fixture.whenStable();
            TestBed.tick();
            expect(document.activeElement?.className).toBe('two');
        } finally {
            fixture.nativeElement.remove();
        }
    });
});

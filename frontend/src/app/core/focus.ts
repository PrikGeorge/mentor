import { afterNextRender, ElementRef, inject, Injector } from '@angular/core';

// FE-14: keyboard focus follows a block that appears after the next render — a confirmation, a form error.
// Create in an injection context; `still` lets a bound scope drop the focus if the view moved on meanwhile.
export function focusAfterRender(): (selector: string, still?: () => boolean) => void {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const injector = inject(Injector);
    return (selector, still = () => true) =>
        afterNextRender(
            () => {
                if (still()) host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
            },
            { injector }
        );
}

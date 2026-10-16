import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { PracticeExit } from './practice-exit.service';
import { IconComponent } from './icon.component';
@Component({ selector: 'mentor-practice-exit', template: `@if(exit.open()){<div class="dialog-backdrop"><section #panel tabindex="-1" (keydown)="key($event)" class="dialog exit-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-exit-title"><h2 id="practice-exit-title">Есть несохранённый код</h2><div class="body"><p>Сохрани его на сервере или скачай копию перед выходом.</p>@if(exit.error()){<p role="alert" class="auth-error">{{exit.error()}}</p>}</div><div class="form-actions"><button class="btn primary" [disabled]="exit.busy()" (click)="exit.choose('save')"><mentor-icon name="save"/>Сохранить и выйти</button><button class="btn" [disabled]="exit.busy()" (click)="exit.choose('export')"><mentor-icon name="download"/>Скачать и выйти</button><button class="btn" [disabled]="exit.busy()" (click)="exit.choose('cancel')">Отмена</button><button class="btn text danger" [disabled]="exit.busy()" (click)="exit.choose('discard')">Выйти без сохранения</button></div></section></div>}`, imports: [IconComponent] })
export class PracticeExitDialog {
    readonly exit = inject(PracticeExit);
    private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
    constructor() { effect(onCleanup => { const panel = this.panel()?.nativeElement; if (!this.exit.open() || !panel)
        return; const previous = document.activeElement as HTMLElement | null; panel.querySelector<HTMLButtonElement>('button')?.focus(); onCleanup(() => { if (previous?.isConnected)
        previous.focus(); }); }); }
    key(event: KeyboardEvent) { if (event.key === 'Escape') {
        event.preventDefault();
        void this.exit.choose('cancel');
    } if (event.key !== 'Tab')
        return; const panel = this.panel()?.nativeElement; if (!panel)
        return; const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); if (!buttons.length) {
        event.preventDefault();
        panel.focus();
        return;
    } const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    }
    else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    } }
}

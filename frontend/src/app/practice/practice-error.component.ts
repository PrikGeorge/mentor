import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../core/icon.component';
// One error block for the trainer: the message plus a single retry action that repeats whatever failed (UX-22).
@Component({
    selector: 'mentor-practice-error',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        :host { display: block; }
        .practice-error { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
        .practice-error .auth-error { flex: 1 1 240px; margin: 0; }
    `],
    template: `
        <div class="practice-error" role="alert">
            <p class="auth-error">{{ message() }}</p>
            @if (canRetry()) {
                <button type="button" class="btn sm" (click)="retry.emit()"><mentor-icon name="refresh"/>{{ retryLabel() }}</button>
            }
        </div>
    `,
})
export class PracticeErrorComponent {
    readonly message = input.required<string>();
    readonly retryLabel = input('Повторить');
    readonly canRetry = input(true);
    readonly retry = output<void>();
}

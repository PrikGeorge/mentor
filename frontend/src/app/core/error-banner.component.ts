import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';
// The one error pattern: a red banner (role=alert) and, when the caller can recover, a «Повторить…» button right under it.
// Without retryLabel it renders the plain banner, so a form error and a failed load look the same.
@Component({
    selector: 'mentor-error-banner', changeDetection: ChangeDetectionStrategy.OnPush, imports: [IconComponent],
    host: { class: 'shell-error' },
    template: `<p class="auth-error" role="alert">{{ message() }}</p>@if (retryLabel()) {<button class="btn sm" type="button" (click)="retry.emit()" [disabled]="busy()"><mentor-icon [name]="icon()"/>{{ retryLabel() }}</button>}`,
})
export class ErrorBannerComponent {
    readonly message = input.required<string>();
    readonly retryLabel = input('');
    readonly icon = input('refresh');
    readonly busy = input(false);
    readonly retry = output<void>();
}

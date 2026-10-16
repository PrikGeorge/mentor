import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { IconComponent } from '../core/icon.component';
import { CodeReviewComponent } from '../comments/code-review.component';
import type { Attempt } from './practice-api.service';
import type { WorkerAvailability } from './practice-session.store';
import { isFailure, modeLabel, scalar, stateIcon, stateLabel, testLabel } from './attempt-labels';
import { Motion, animateOnChange, motionEase, motionMs } from '../core/motion';
// One attempt as the student sees it: state, executor availability, per-test outcome and the exact code with mentor comments.
@Component({
    selector: 'mentor-attempt-result',
    imports: [DatePipe, IconComponent, CodeReviewComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <section class="attempt-result" aria-live="polite">
          <p class="small-muted">Попытка · {{ mode() }} · {{ attempt().createdAt | date:'dd.MM.yyyy, HH:mm':'+0300' }}</p>
          <h3 class="attempt-state" [class.ok]="accepted()" [class.bad]="failed()"><mentor-icon [class.spin]="attempt().jobState === 'running'" [name]="icon()"/>{{ label() }}</h3>
          @if (workerSilent()) {
            <p class="warning-banner" role="status">Сервер проверки сейчас не отвечает@if (worker()?.lastSeenAt; as seen) { · был на связи {{ seen | date:'dd.MM, HH:mm':'+0300' }}}. Попытка сохранена и проверится, когда он вернётся.</p>
          }
          @if (attempt().environmentRevision === null) {
            <p class="small-muted">Версия окружения не сохранена</p>
          }
          @if (attempt().result; as check) {
            <p class="check-summary">Тесты: {{ check.passed }} из {{ check.total }} пройдены · {{ check.elapsedMs }} мс</p>
            @if (check.tests.length) {
              <div class="test-cells" role="img" [attr.aria-label]="'Пройдено ' + check.passed + ' из ' + check.total">
                @for (test of check.tests; track $index) {
                  <span [class.pass]="test.status === 'accepted'" [class.fail]="test.status !== 'accepted'"><mentor-icon [name]="test.status === 'accepted' ? 'check' : 'x'"/></span>
                }
              </div>
            }
            @if (check.diagnostics) {
              <pre class="diagnostics">{{ check.diagnostics }}</pre>
            }
            <ul class="test-list">
              @for (test of check.tests; track $index) {
                <li [class.fail]="test.status !== 'accepted'">
                  <h4><mentor-icon [name]="test.status === 'accepted' ? 'check' : 'x'"/><span>{{ $index + 1 }}. {{ test.name }} · <span class="status-word">{{ testLabel(test.status) }}</span></span></h4>
                  @if (test.expected !== undefined || test.actual !== undefined) {
                    <div class="io">
                      @if (test.expected !== undefined) {<p>Ожидалось: <code>{{ scalar(test.expected) }}</code></p>}
                      @if (test.actual !== undefined) {<p>Получено: <code>{{ scalar(test.actual) }}</code></p>}
                    </div>
                  }
                  @if (test.message) {<pre class="code-view">{{ test.message }}</pre>}
                  @if (test.stdout) {<pre class="code-view">{{ test.stdout }}</pre>}
                </li>
              }
            </ul>
          }
          <details class="attempt-code" [open]="teacher() || noted() > 0">
            <summary>{{ codeSummary() }}</summary>
            <mentor-code-review [lesson]="lesson()" targetKind="attempt" [targetId]="attempt().id" [files]="files()" [editable]="teacher()" [preview]="preview()" (noted)="notedChanged.emit($event)"/>
          </details>
        </section>
    `,
})
export class AttemptResultComponent {
    readonly attempt = input.required<Attempt>();
    readonly lesson = input.required<LessonRef>();
    readonly worker = input<WorkerAvailability | null>(null);
    readonly teacher = input(false);
    readonly preview = input(false);
    readonly noted = input(0);
    readonly notedChanged = output<number>();
    readonly label = computed(() => stateLabel(this.attempt()));
    readonly icon = computed(() => stateIcon(this.attempt()));
    readonly failed = computed(() => isFailure(this.attempt()));
    readonly accepted = computed(() => this.attempt().result?.status === 'accepted');
    readonly mode = computed(() => modeLabel(this.attempt().mode));
    readonly files = computed<Record<string, string>>(() => this.attempt().files ?? {});
    readonly workerSilent = computed(() => { const worker = this.worker(); return !!worker && !worker.available && this.attempt().jobState === 'queued'; });
    readonly codeSummary = computed(() => this.teacher() ? 'Код этой попытки · комментарии по строкам' : this.noted() ? 'Точный код этой попытки · комментарии наставника: ' + this.noted() : 'Точный код этой попытки · только чтение');
    readonly testLabel = testLabel;
    readonly scalar = scalar;
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly motion = inject(Motion);

    // UX-28 M9: only an attempt that finishes in front of the user deals its test cells one by one; an attempt opened
    // from the history (or another attempt) shows them at once.
    constructor() {
        animateOnChange({ value: () => !!this.attempt().result, key: () => this.attempt().id, play: (had, has) => (!had && has ? this.dealCells() : null) });
    }

    private dealCells(): Animation[] {
        const root = this.host.nativeElement;
        const cells = Array.from(root.querySelectorAll<HTMLElement>('.attempt-result .test-cells > span'));
        const summary = root.querySelector<HTMLElement>('.attempt-result .check-summary');
        const count = cells.length;
        const step = count > 24 ? 0 : Math.min(40, motionMs('stage') / Math.max(count, 1));
        const land = motionMs('instant');
        const blank = count ? getComputedStyle(cells[0].parentElement!).getPropertyValue('--muted').trim() || getComputedStyle(cells[0].parentElement!).color : '';
        const animations = cells.flatMap((cell, index) => [
            // The fill appears with a click at the cell's turn, then the cell settles.
            index && step ? this.motion.animate(cell, [{ backgroundColor: 'transparent', color: blank }, { backgroundColor: 'transparent', color: blank }], { duration: index * step }) : null,
            this.motion.animate(cell, [{ transform: 'scale(.85)' }, { transform: 'none' }], { duration: land, delay: index * step, easing: motionEase('move'), fill: 'backwards' }),
        ]);
        animations.push(this.motion.animate(summary, [{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('quick'), delay: count * step, easing: motionEase('enter'), fill: 'backwards' }));
        return animations.filter((animation): animation is Animation => !!animation);
    }
}

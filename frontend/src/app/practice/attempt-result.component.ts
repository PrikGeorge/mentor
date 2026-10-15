import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { IconComponent } from '../core/icon.component';
import { CodeReviewComponent } from '../comments/code-review.component';
import type { Attempt } from './practice-api.service';
import type { WorkerAvailability } from './practice-session.store';
import { isFailure, modeLabel, scalar, stateIcon, stateLabel, testLabel } from './attempt-labels';
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
            <p class="warning-banner" role="status">Исполнитель заданий сейчас не отвечает@if (worker()?.lastSeenAt; as seen) { · последний отклик {{ seen | date:'dd.MM, HH:mm':'+0300' }}}. Попытка сохранена и выполнится, когда он вернётся.</p>
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
}

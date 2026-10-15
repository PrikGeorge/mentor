import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../core/icon.component';
import { historyLabel, modeLabel, type AttemptSummary } from './attempt-labels';
import { PAGE_SIZE, type DraftArchive, type DraftArchiveSummary } from './practice-session.store';
// Paged attempt history and the archive of earlier drafts; rows open the attempt or archive in the result pane.
@Component({
    selector: 'mentor-attempt-history',
    imports: [DatePipe, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <section class="practice-history">
          <h3>История попыток</h3>
          @for (row of attempts(); track row.id) {
            <button class="history-row" (click)="attemptChosen.emit(row.id)">
              <span>{{ modeLabel(row.mode) }} · {{ row.createdAt | date:'dd.MM.yyyy, HH:mm':'+0300' }}</span>
              <span>{{ historyLabel(row) }}</span>
            </button>
          }
          @if (!attempts().length) {
            <p class="small-muted">Попыток пока нет.</p>
          }
          @if (attemptTotal() > pageSize) {
            <nav class="pagination" aria-label="Страницы попыток">
              <button class="btn" [disabled]="attemptPage() === 0" (click)="attemptPageChanged.emit(attemptPage() - 1)"><mentor-icon name="chevron-left"/>Назад</button>
              <span>Страница {{ attemptPage() + 1 }}</span>
              <button class="btn" [disabled]="(attemptPage() + 1) * pageSize >= attemptTotal()" (click)="attemptPageChanged.emit(attemptPage() + 1)">Далее<mentor-icon name="chevron-right"/></button>
            </nav>
          }
          <h3>Архив черновиков</h3>
          @for (row of archives(); track row.id) {
            <button class="history-row" (click)="archiveChosen.emit(row.id)">
              <span>{{ row.updatedAt | date:'dd.MM.yyyy, HH:mm':'+0300' }}</span>
              <span>Ревизия {{ row.exerciseRevision }}</span>
            </button>
          }
          @if (!archives().length) {
            <p class="small-muted">Архивных черновиков нет.</p>
          }
          @if (archive(); as item) {
            <details open>
              <summary>Архив {{ item.id }} · только чтение</summary>
              @for (name of names(item.files); track name) {
                <h4>{{ name }}</h4>
                <pre class="code-view"><code>{{ item.files[name] }}</code></pre>
              }
            </details>
          }
          @if (archiveTotal() > pageSize) {
            <nav class="pagination" aria-label="Страницы архива">
              <button class="btn" [disabled]="archivePage() === 0" (click)="archivePageChanged.emit(archivePage() - 1)"><mentor-icon name="chevron-left"/>Назад</button>
              <span>Страница {{ archivePage() + 1 }}</span>
              <button class="btn" [disabled]="(archivePage() + 1) * pageSize >= archiveTotal()" (click)="archivePageChanged.emit(archivePage() + 1)">Далее<mentor-icon name="chevron-right"/></button>
            </nav>
          }
        </section>
    `,
})
export class AttemptHistoryComponent {
    readonly attempts = input<AttemptSummary[]>([]);
    readonly attemptPage = input(0);
    readonly attemptTotal = input(0);
    readonly archives = input<DraftArchiveSummary[]>([]);
    readonly archivePage = input(0);
    readonly archiveTotal = input(0);
    readonly archive = input<DraftArchive | null>(null);
    readonly attemptChosen = output<string>();
    readonly archiveChosen = output<string>();
    readonly attemptPageChanged = output<number>();
    readonly archivePageChanged = output<number>();
    readonly pageSize = PAGE_SIZE;
    readonly historyLabel = historyLabel;
    readonly modeLabel = modeLabel;
    names(files: Record<string, string>) { return Object.keys(files); }
}

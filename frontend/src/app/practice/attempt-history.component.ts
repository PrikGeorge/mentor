import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../core/icon.component';
import { historyLabel, modeLabel, type AttemptSummary } from './attempt-labels';
import { PAGE_SIZE } from './practice-session.store';
// Paged attempt history of the open exercise (the «Попытки» tab); a row opens the attempt in the «Результат» tab.
@Component({
    selector: 'mentor-attempt-history',
    imports: [DatePipe, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <section class="practice-history" aria-label="История попыток">
            @for (row of attempts(); track row.id) {
                <button class="history-row" (click)="attemptChosen.emit(row.id)">
                    <span>{{ modeLabel(row.mode) }} · {{ row.createdAt | date: 'dd.MM.yyyy, HH:mm' : '+0300' }}</span>
                    <span>{{ historyLabel(row) }}</span>
                </button>
            }
            @if (!attempts().length) {
                <p class="small-muted">Попыток пока нет.</p>
            }
            @if (attemptTotal() > pageSize) {
                <nav class="pagination" aria-label="Страницы попыток">
                    <button class="btn" [disabled]="attemptPage() === 0" (click)="attemptPageChanged.emit(attemptPage() - 1)">
                        <mentor-icon name="chevron-left" />Назад
                    </button>
                    <span>Страница {{ attemptPage() + 1 }}</span>
                    <button class="btn" [disabled]="(attemptPage() + 1) * pageSize >= attemptTotal()" (click)="attemptPageChanged.emit(attemptPage() + 1)">
                        Далее<mentor-icon name="chevron-right" />
                    </button>
                </nav>
            }
        </section>
    `,
})
export class AttemptHistoryComponent {
    readonly attempts = input<AttemptSummary[]>([]);
    readonly attemptPage = input(0);
    readonly attemptTotal = input(0);
    readonly attemptChosen = output<string>();
    readonly attemptPageChanged = output<number>();
    readonly pageSize = PAGE_SIZE;
    readonly historyLabel = historyLabel;
    readonly modeLabel = modeLabel;
}

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../core/icon.component';
import { PaginationComponent } from '../core/pagination.component';
import { PAGE_SIZE, type DraftArchive, type DraftArchiveSummary } from './practice-session.store';
// Earlier drafts of the open exercise, kept in the project tree under its files like an IDE's local history.
// Hidden while there is nothing archived; a row opens the archived files read-only in the bottom panel.
@Component({
    selector: 'mentor-draft-archive',
    imports: [DatePipe, IconComponent, PaginationComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        @if (archiveTotal() || archives().length) {
            <details class="tree-archive">
                <summary><mentor-icon name="history" />Архив черновиков · {{ archiveTotal() || archives().length }}</summary>
                @for (row of archives(); track row.id) {
                    <button class="history-row" [attr.aria-pressed]="opened()?.id === row.id" (click)="archiveChosen.emit(row.id)">
                        <span>{{ row.updatedAt | date: 'dd.MM.yyyy, HH:mm' : '+0300' }}</span>
                        <span>Ревизия {{ row.exerciseRevision }}</span>
                    </button>
                }
                <mentor-pagination
                    [page]="archivePage()"
                    [total]="archiveTotal()"
                    [size]="pageSize"
                    [compact]="true"
                    label="Страницы архива"
                    (pageChange)="archivePageChanged.emit($event)"
                />
            </details>
        }
    `,
})
export class DraftArchiveComponent {
    readonly archives = input<DraftArchiveSummary[]>([]);
    readonly archivePage = input(0);
    readonly archiveTotal = input(0);
    readonly opened = input<DraftArchive | null>(null);
    readonly archiveChosen = output<string>();
    readonly archivePageChanged = output<number>();
    readonly pageSize = PAGE_SIZE;
}

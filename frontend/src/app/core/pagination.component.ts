import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from './icon.component';
// One pager for every list: hidden while a single page holds everything, «Страница N из M» between the arrows.
@Component({
    selector: 'mentor-pagination', changeDetection: ChangeDetectionStrategy.OnPush, imports: [IconComponent],
    template: `@if (pages() > 1) {<nav class="pagination" [attr.aria-label]="label()"><button class="btn" type="button" (click)="go(page() - 1)" [disabled]="page() === 0 || disabled()"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{ page() + 1 }} из {{ pages() }}</span><button class="btn" type="button" (click)="go(page() + 1)" [disabled]="page() + 1 >= pages() || disabled()">Далее<mentor-icon name="chevron-right"/></button></nav>}`,
})
export class PaginationComponent {
    // Zero-based page index, as the API counts it.
    readonly page = input.required<number>();
    readonly total = input.required<number>();
    readonly size = input(25);
    readonly disabled = input(false);
    readonly label = input('Страницы');
    readonly pageChange = output<number>();
    readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / Math.max(1, this.size()))));
    go(page: number): void { if (!this.disabled() && page >= 0 && page < this.pages() && page !== this.page()) this.pageChange.emit(page); }
}

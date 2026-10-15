import { TestBed } from '@angular/core/testing';
import { PaginationComponent } from './pagination.component';

describe('Shared pagination', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(inputs: Record<string, unknown>) {
        TestBed.configureTestingModule({ imports: [PaginationComponent] });
        const fixture = TestBed.createComponent(PaginationComponent);
        for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        const pages: number[] = [];
        fixture.componentInstance.pageChange.subscribe((page) => pages.push(page));
        return { element: fixture.nativeElement as HTMLElement, pages };
    }

    it('stays hidden while one page holds everything', () => {
        const { element } = setup({ page: 0, total: 25 });
        expect(element.querySelector('.pagination')).toBeNull();
    });

    it('labels the page as «Страница N из M» and moves within the bounds', () => {
        const { element, pages } = setup({ page: 1, total: 60, size: 25, label: 'Страницы занятий' });
        const pager = element.querySelector('.pagination')!;
        expect(pager.getAttribute('aria-label')).toBe('Страницы занятий');
        expect(pager.querySelector('span')?.textContent).toBe('Страница 2 из 3');
        const [back, forward] = Array.from(pager.querySelectorAll<HTMLButtonElement>('button'));
        expect(back.classList.contains('icon-only')).toBe(false);
        expect(back.getAttribute('aria-label')).toBeNull();
        expect(back.textContent?.trim()).toBe('Назад');
        back.click();
        forward.click();
        expect(pages).toEqual([0, 2]);
    });

    it('uses arrow-only named buttons and «N из M» in compact panels and stops while disabled', () => {
        const { element, pages } = setup({ page: 2, total: 60, size: 25, compact: true, disabled: true });
        const pager = element.querySelector('.pagination')!;
        expect(pager.querySelector('span')?.textContent).toBe('3 из 3');
        const [back, forward] = Array.from(pager.querySelectorAll<HTMLButtonElement>('button'));
        expect(back.classList.contains('icon-only')).toBe(true);
        expect(back.getAttribute('aria-label')).toBe('Назад');
        expect(forward.getAttribute('aria-label')).toBe('Далее');
        expect(back.textContent?.trim()).toBe('');
        expect(back.disabled).toBe(true);
        expect(forward.disabled).toBe(true);
        expect(pages).toEqual([]);
    });
});

import { TestBed } from '@angular/core/testing';
import { AttemptHistoryComponent } from './attempt-history.component';
import { DraftArchiveComponent } from './draft-archive.component';
import type { AttemptSummary } from './attempt-labels';
import type { DraftArchive, DraftArchiveSummary } from './practice-session.store';
const attempts: AttemptSummary[] = [
    {
        id: 'a1',
        exerciseId: 'e1',
        exerciseRevision: 1,
        environmentRevision: 'synthetic',
        mode: 'run',
        jobState: 'queued',
        result: null,
        createdAt: '2030-01-01T09:00:00Z',
    },
    {
        id: 'a2',
        exerciseId: 'e1',
        exerciseRevision: 1,
        environmentRevision: 'synthetic',
        mode: 'submit',
        jobState: 'completed',
        result: { status: 'accepted', passed: 2, total: 2, elapsedMs: 5, tests: [] },
        createdAt: '2030-01-01T08:00:00Z',
    },
    {
        id: 'a3',
        exerciseId: 'e1',
        exerciseRevision: 1,
        environmentRevision: null,
        mode: 'submit',
        jobState: 'failed',
        result: { status: 'unavailable', passed: 0, total: 0, elapsedMs: 0, tests: [] },
        createdAt: '2030-01-01T07:00:00Z',
    },
];
const archives: DraftArchiveSummary[] = [
    {
        id: 'ar1',
        assignmentId: 'as1',
        exerciseId: 'e1',
        exerciseRevision: 1,
        revision: 3,
        updatedAt: '2030-01-01T06:00:00Z',
        archivedAt: null,
        reason: 'exercise_revision_changed',
    },
];
const archive: DraftArchive = { ...archives[0], files: { 'Task.java': 'archived source' } };
describe('Attempt history', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({ imports: [AttemptHistoryComponent] });
        const fixture = TestBed.createComponent(AttemptHistoryComponent);
        for (const [name, value] of Object.entries({ attempts, ...inputs })) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
    }
    it('lists attempts with human labels and reports which row was opened', () => {
        const { element, component } = setup();
        const rows = Array.from(element.querySelectorAll<HTMLButtonElement>('.history-row'));
        expect(
            rows.map((row) =>
                Array.from(row.querySelectorAll('span'))
                    .map((span) => span.textContent)
                    .join(' | ')
            )
        ).toEqual([
            'Примеры · 01.01.2030, 12:00 | В очереди',
            'Все проверки · 01.01.2030, 11:00 | Все проверки пройдены',
            'Все проверки · 01.01.2030, 10:00 | Проверка временно недоступна',
        ]);
        const opened: string[] = [];
        component.attemptChosen.subscribe((id) => opened.push(id));
        rows[1].click();
        expect(opened).toEqual(['a2']);
        expect(element.textContent).not.toContain('Архив');
        expect(element.querySelectorAll('.pagination')).toHaveLength(0);
    });
    it('shows the empty state and pages only when the list is longer than one page', () => {
        const { fixture, element, component } = setup({ attempts: [], attemptTotal: 60, attemptPage: 1 });
        expect(element.textContent).toContain('Попыток пока нет.');
        const pagers = element.querySelectorAll('.pagination');
        expect(pagers).toHaveLength(1);
        expect(pagers[0].getAttribute('aria-label')).toBe('Страницы попыток');
        expect(pagers[0].textContent).toContain('Страница 2 из 3');
        const pages: number[] = [];
        component.attemptPageChanged.subscribe((page) => pages.push(page));
        const [back, forward] = Array.from(pagers[0].querySelectorAll<HTMLButtonElement>('button'));
        expect(back.disabled).toBe(false);
        expect(forward.disabled).toBe(false);
        back.click();
        forward.click();
        expect(pages).toEqual([0, 2]);
        fixture.componentRef.setInput('attemptPage', 2);
        fixture.detectChanges();
        expect(forward.disabled).toBe(true);
    });
});
describe('Draft archive in the project tree', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({ imports: [DraftArchiveComponent] });
        const fixture = TestBed.createComponent(DraftArchiveComponent);
        for (const [name, value] of Object.entries({ archives, ...inputs })) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
    }
    it('stays out of the tree while nothing is archived', () => {
        const { element } = setup({ archives: [], archiveTotal: 0 });
        expect(element.querySelector('.tree-archive')).toBeNull();
    });
    it('counts the archived drafts, reports the opened one and marks it', () => {
        const { fixture, element, component } = setup({ archiveTotal: 1 });
        expect(element.querySelector('summary')?.textContent).toContain('Архив черновиков · 1');
        const row = element.querySelector<HTMLButtonElement>('.history-row')!;
        expect(
            Array.from(row.querySelectorAll('span'))
                .map((span) => span.textContent)
                .join(' | ')
        ).toBe('01.01.2030, 09:00 | Ревизия 1');
        const opened: string[] = [];
        component.archiveChosen.subscribe((id) => opened.push(id));
        row.click();
        expect(opened).toEqual(['ar1']);
        fixture.componentRef.setInput('opened', archive);
        fixture.detectChanges();
        expect(row.getAttribute('aria-pressed')).toBe('true');
    });
    it('pages a long archive', () => {
        const { element, component } = setup({ archiveTotal: 60, archivePage: 0 });
        const pager = element.querySelector('.pagination')!;
        expect(pager.getAttribute('aria-label')).toBe('Страницы архива');
        expect(pager.querySelector('span')?.textContent).toBe('1 из 3');
        const pages: number[] = [];
        component.archivePageChanged.subscribe((page) => pages.push(page));
        const [back, forward] = Array.from(pager.querySelectorAll<HTMLButtonElement>('button'));
        expect(back.disabled).toBe(true);
        forward.click();
        expect(pages).toEqual([1]);
    });
});

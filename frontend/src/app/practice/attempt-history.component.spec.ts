import { TestBed } from '@angular/core/testing';
import { AttemptHistoryComponent } from './attempt-history.component';
import type { AttemptSummary } from './attempt-labels';
import type { DraftArchive, DraftArchiveSummary } from './practice-session.store';
const attempts: AttemptSummary[] = [
    { id: 'a1', exerciseId: 'e1', exerciseRevision: 1, environmentRevision: 'synthetic', mode: 'run', jobState: 'queued', result: null, createdAt: '2030-01-01T09:00:00Z' },
    { id: 'a2', exerciseId: 'e1', exerciseRevision: 1, environmentRevision: 'synthetic', mode: 'submit', jobState: 'completed', result: { status: 'accepted', passed: 2, total: 2, elapsedMs: 5, tests: [] }, createdAt: '2030-01-01T08:00:00Z' },
    { id: 'a3', exerciseId: 'e1', exerciseRevision: 1, environmentRevision: null, mode: 'submit', jobState: 'failed', result: { status: 'unavailable', passed: 0, total: 0, elapsedMs: 0, tests: [] }, createdAt: '2030-01-01T07:00:00Z' },
];
const archives: DraftArchiveSummary[] = [{ id: 'ar1', assignmentId: 'as1', exerciseId: 'e1', exerciseRevision: 1, revision: 3, updatedAt: '2030-01-01T06:00:00Z', archivedAt: null, reason: 'exercise_revision_changed' }];
const archive: DraftArchive = { ...archives[0], files: { 'Task.java': 'archived source' } };
describe('Attempt history and draft archive', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({ imports: [AttemptHistoryComponent] });
        const fixture = TestBed.createComponent(AttemptHistoryComponent);
        for (const [name, value] of Object.entries({ attempts, archives, ...inputs })) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
    }
    it('lists attempts and archives with human labels and reports which row was opened', () => {
        const { element, component } = setup({ archive });
        const rows = Array.from(element.querySelectorAll<HTMLButtonElement>('.history-row'));
        expect(rows.map(row => Array.from(row.querySelectorAll('span')).map(span => span.textContent).join(' | '))).toEqual([
            'Примеры · 01.01.2030, 12:00 | В очереди',
            'Все проверки · 01.01.2030, 11:00 | Все проверки пройдены',
            'Все проверки · 01.01.2030, 10:00 | Проверка временно недоступна',
            '01.01.2030, 09:00 | Ревизия 1',
        ]);
        const opened: string[] = [];
        component.attemptChosen.subscribe(id => opened.push('attempt:' + id));
        component.archiveChosen.subscribe(id => opened.push('archive:' + id));
        rows[1].click();
        rows[3].click();
        expect(opened).toEqual(['attempt:a2', 'archive:ar1']);
        expect(element.querySelector('details')?.textContent).toContain('Архив ar1 · только чтение');
        expect(element.querySelector('details')?.textContent).toContain('archived source');
        expect(element.querySelectorAll('.pagination')).toHaveLength(0);
    });
    it('shows empty states and pages only when a list is longer than one page', () => {
        const { fixture, element, component } = setup({ attempts: [], archives: [], attemptTotal: 60, attemptPage: 1, archiveTotal: 25 });
        expect(element.textContent).toContain('Попыток пока нет.');
        expect(element.textContent).toContain('Архивных черновиков нет.');
        const pagers = element.querySelectorAll('.pagination');
        expect(pagers).toHaveLength(1);
        expect(pagers[0].getAttribute('aria-label')).toBe('Страницы попыток');
        expect(pagers[0].textContent).toContain('Страница 2');
        const pages: number[] = [];
        component.attemptPageChanged.subscribe(page => pages.push(page));
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

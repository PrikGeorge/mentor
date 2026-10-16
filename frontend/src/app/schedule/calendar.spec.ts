import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { lessonSummary } from '../students/domain-test-support';
import { CalendarEntry, lessonsCount, upcomingOf, upcomingWindow } from './calendar';
import { MonthCalendarComponent } from './month-calendar.component';
import { addMonths, isMonth, monthLabel, monthRange, monthWeeks, shortDayLabel } from './schedule-dates';

const entry = (id: string, date: string, time: string, extra: Partial<CalendarEntry> = {}, lesson: Partial<CalendarEntry['lesson']> = {}): CalendarEntry => ({
    lesson: { ...lessonSummary, id, date, time, duration: 60, number: Number(id.replace(/\D/g, '')) || 1, title: 'Тема ' + id, ...lesson },
    studentName: 'Анна Петрова',
    link: ['/teacher/students', 's1', 'lessons', id],
    query: {},
    ...extra,
});
// Thursday 15 October 2026, 15:30 in Moscow.
const NOW = Date.parse('2026-10-15T12:30:00Z');

describe('Month arithmetic (T23)', () => {
    it('validates, pages and names months across years', () => {
        expect(isMonth('2026-10')).toBe(true);
        expect(isMonth('2026-13')).toBe(false);
        expect(isMonth('2026-1')).toBe(false);
        expect(addMonths('2026-12', 1)).toBe('2027-01');
        expect(addMonths('2026-01', -1)).toBe('2025-12');
        expect(monthLabel('2026-10')).toBe('Октябрь 2026');
        expect(shortDayLabel('2026-10-16')).toBe('Пт, 16 октября');
    });

    it('covers the month with whole Monday-first weeks and an at most 31-day window', () => {
        expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
        const october = monthWeeks('2026-10');
        expect(october).toHaveLength(5);
        expect(october[0][0]).toBe('2026-09-28');
        expect(october[4][6]).toBe('2026-11-01');
        // March 2026 starts on a Sunday and needs six rows.
        expect(monthWeeks('2026-03')).toHaveLength(6);
        expect(monthWeeks('2027-02')[0][0]).toBe('2027-02-01');
    });

    it('keeps lessons that have not ended, ten at most, and counts the rest', () => {
        const entries = [
            entry('l0', '2026-10-15', '11:00'),
            ...Array.from({ length: 12 }, (_, i) => entry('l' + (i + 1), '2026-10-16', '1' + (i % 10) + ':00')),
        ];
        const { shown, more } = upcomingOf(entries, NOW);
        expect(shown).toHaveLength(10);
        expect(shown[0].lesson.id).toBe('l1');
        expect(more).toBe(2);
        expect(upcomingWindow('2026-10-15')).toEqual({ from: '2026-10-15', to: '2026-10-28' });
        expect([1, 3, 5, 11, 21].map(lessonsCount)).toEqual(['1 занятие', '3 занятия', '5 занятий', '11 занятий', '21 занятие']);
    });
});

describe('Month calendar (T23)', () => {
    afterEach(() => TestBed.resetTestingModule());
    function render(entries: CalendarEntry[], viewer: 'teacher' | 'student' = 'teacher', month = '2026-10') {
        TestBed.configureTestingModule({ imports: [MonthCalendarComponent], providers: [provideRouter([])] });
        const fixture = TestBed.createComponent(MonthCalendarComponent);
        for (const [name, value] of Object.entries({ month, today: '2026-10-15', now: NOW, entries, viewer })) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement };
    }
    const cell = (element: HTMLElement, day: number) =>
        [...element.querySelectorAll<HTMLTableCellElement>('td:not(.out)')].find((td) => td.querySelector('.day-num')?.textContent?.trim() === String(day))!;

    it('lays the month out in a captioned table with days of other months empty and today marked', () => {
        const { element } = render([entry('l1', '2026-09-30', '10:00'), entry('l2', '2026-10-15', '18:00')]);
        expect(element.querySelector('caption')?.textContent?.trim()).toBe('Октябрь 2026');
        expect([...element.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
        expect(element.querySelectorAll('tbody tr')).toHaveLength(5);
        const out = element.querySelectorAll('td.out');
        expect(out).toHaveLength(4);
        expect(out[0].querySelector('a')).toBeNull();
        const today = cell(element, 15);
        expect(today.classList).toContain('today');
        expect(today.querySelector('.tag.on')?.textContent).toBe('сегодня');
        expect(element.querySelector('.hatch, .private')).toBeNull();
    });

    it('lists three lessons a day with the student, links them and counts the rest', () => {
        const day = ['09:00', '11:00', '13:00', '15:00', '17:00'].map((time, i) => entry('l' + (i + 1), '2026-10-20', time));
        const { element } = render(day);
        const links = cell(element, 20).querySelectorAll<HTMLAnchorElement>('.day-lessons a');
        expect(links).toHaveLength(3);
        expect(links[0].textContent?.trim()).toBe('09:00 · Анна');
        expect(links[0].getAttribute('href')).toBe('/teacher/students/s1/lessons/l1');
        expect(links[0].getAttribute('aria-label')).toBe('09:00, Анна Петрова, занятие № 1, Тема l1, Запланировано');
        expect(cell(element, 20).querySelector('.more')?.textContent?.trim()).toBe('ещё 2');
    });

    it('shows the student the number instead of a name and «Прошло» for an unmarked past lesson', () => {
        const { element } = render([entry('l3', '2026-10-05', '10:00', { studentName: undefined, query: { preview: 'student' } })], 'student');
        const link = cell(element, 5).querySelector<HTMLAnchorElement>('.day-lessons a')!;
        expect(link.textContent?.trim()).toBe('10:00 · № 3');
        expect(link.getAttribute('href')).toBe('/teacher/students/s1/lessons/l3?preview=student');
        expect(cell(element, 5).querySelector('.tag.quiet')?.textContent).toBe('Прошло');
    });

    it('lets a phone pick a day and lists its lessons, starting on today', () => {
        const { fixture, element } = render([entry('l1', '2026-10-20', '18:00')]);
        expect(element.querySelector('.day-agenda h3')?.textContent).toBe('Четверг, 15 октября');
        expect(element.querySelector('.day-agenda')?.textContent).toContain('Свободно');
        const pick = cell(element, 20).querySelector<HTMLButtonElement>('.day-pick')!;
        expect(pick.getAttribute('aria-label')).toBe('20 октября, 1 занятие');
        expect(cell(element, 15).querySelector('.day-pick')?.getAttribute('aria-label')).toBe('15 октября, сегодня, занятий нет');
        pick.click();
        fixture.detectChanges();
        expect(pick.getAttribute('aria-pressed')).toBe('true');
        expect(element.querySelector('.day-agenda h3')?.textContent).toBe('Вторник, 20 октября');
        expect(element.querySelector('.day-agenda a')?.textContent).toContain('№ 1 · Тема l1');
    });

    it('starts another month on its first day with lessons, or on the 1st', () => {
        expect(render([entry('l1', '2026-11-12', '18:00')], 'teacher', '2026-11').element.querySelector('.day-agenda h3')?.textContent).toBe(
            'Четверг, 12 ноября'
        );
        TestBed.resetTestingModule();
        expect(render([], 'teacher', '2026-12').element.querySelector('.day-agenda h3')?.textContent).toBe('Вторник, 1 декабря');
    });
});

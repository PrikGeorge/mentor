import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { lessonSummary, renderResources } from '../students/domain-test-support';
import { SchedulePageComponent } from './schedule-page.component';
import type { ScheduleItem } from './schedule-api.service';

const root = '/api/v1/workspaces/w1/schedule';
// The T16 reminder reads the last 14 days next to «Сегодня».
const reminder = root + '?from=2026-10-02&to=2026-10-15';
const item = (id: string, studentName: string, date: string, time: string, extra: Partial<ScheduleItem['lesson']> = {}): ScheduleItem => ({
    studentName,
    lesson: {
        ...lessonSummary,
        id,
        studentId: 's-' + id,
        date,
        time,
        duration: 60,
        status: 'planned',
        bundleId: null,
        number: 7,
        title: 'Тема ' + id,
        ...extra,
    },
});

describe('Teacher schedule', () => {
    let http: HttpTestingController;
    beforeEach(() => {
        // Thursday 15 October 2026, 15:30 in Moscow.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-15T12:30:00Z'));
        TestBed.configureTestingModule({
            providers: [
                provideRouter([{ path: 'teacher/schedule', component: SchedulePageComponent }]),
                provideHttpClient(withInterceptors([sessionInterceptor])),
                provideHttpClientTesting(),
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => {
        for (const request of http.match(reminder)) if (!request.cancelled) request.flush({ from: '2026-10-02', to: '2026-10-15', items: [] });
        try {
            http.verify();
        } finally {
            TestBed.resetTestingModule();
            vi.useRealTimers();
        }
    });
    function signIn(role: 'TEACHER' | 'STUDENT' = 'TEACHER') {
        TestBed.inject(SessionStore).load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'u1', workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
    }
    async function open(url: string) {
        const harness = await RouterTestingHarness.create();
        await harness.navigateByUrl(url);
        return { harness, element: harness.routeNativeElement as HTMLElement };
    }
    async function flush(from: string, to: string, items: ScheduleItem[], harness: RouterTestingHarness) {
        http.expectOne(`${root}?from=${from}&to=${to}`).flush({ from, to, items });
        await renderResources();
        harness.detectChanges();
    }
    // Router navigation resolves on macrotasks; the open schedule request keeps the app unstable, so whenStable would hang.
    async function settle(harness: RouterTestingHarness) {
        await new Promise((resolve) => setTimeout(resolve));
        harness.detectChanges();
    }
    function button(element: HTMLElement, text: string) {
        return [...element.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text)!;
    }

    it('shows today with the running lesson, its end time and a link to the lesson', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        await flush(
            '2026-10-15',
            '2026-10-15',
            [item('a', 'Анна', '2026-10-15', '15:00'), item('b', 'Борис', '2026-10-15', '18:00', { status: 'prepared', bundleId: 'b1' })],
            harness
        );
        expect(element.querySelector('h2')?.textContent).toContain('Четверг, 15 октября');
        expect(element.textContent).toContain('2 занятия');
        const rows = element.querySelectorAll('.schedule-list > li');
        expect(rows).toHaveLength(2);
        expect(rows[0].classList).toContain('now');
        expect(rows[0].textContent).toContain('15:00–16:00');
        expect(rows[0].textContent).toContain('Идёт сейчас');
        expect(rows[0].textContent).toContain('Анна');
        expect(rows[0].querySelector('a.text-link')?.getAttribute('href')).toBe('/teacher/students/s-a/lessons/a');
        expect(rows[1].classList).not.toContain('now');
        expect(rows[1].textContent).toContain('Подготовлено');
        expect(rows[1].textContent).not.toContain('Идёт сейчас');
    });

    it('offers the week from an empty day and lays the week out by days', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        await flush('2026-10-15', '2026-10-15', [], harness);
        expect(element.textContent).toContain('Сегодня занятий нет.');
        button(element, 'Посмотреть неделю →').click();
        await settle(harness);
        await flush('2026-10-12', '2026-10-18', [item('a', 'Анна', '2026-10-13', '10:00')], harness);
        expect(TestBed.inject(SessionStore).actor()?.role).toBe('TEACHER');
        expect(element.querySelectorAll('.schedule-day')).toHaveLength(7);
        expect(element.querySelectorAll('.schedule-free')).toHaveLength(6);
        expect(element.textContent).toContain('12–18 октября 2026');
        expect(element.querySelector('#schedule-2026-10-15 .tag')?.textContent).toBe('сегодня');
        expect(element.querySelector('#schedule-2026-10-13')?.closest('section')?.textContent).toContain('Тема a');
        expect(button(element, 'Эта неделя')).toBeUndefined();
    });

    it('normalises a linked date to its Monday, pages weeks and falls back to this week', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule?view=week&from=2026-10-29');
        await flush('2026-10-26', '2026-11-01', [], harness);
        expect(element.textContent).toContain('26 октября – 1 ноября 2026');
        expect(element.textContent).toContain('На этой неделе занятий нет.');
        [...element.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Следующая'))!.click();
        await settle(harness);
        await flush('2026-11-02', '2026-11-08', [], harness);
        button(element, 'Эта неделя').click();
        await settle(harness);
        await flush('2026-10-12', '2026-10-18', [], harness);
        await harness.navigateByUrl('/teacher/schedule?view=week&from=2026-02-30');
        // The same window is already loaded, so no new request goes out.
        expect(element.textContent).toContain('12–18 октября 2026');
    });

    it('explains a failed read in Russian and retries it', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        http.expectOne(`${root}?from=2026-10-15&to=2026-10-15`).flush({ message: 'Resource unavailable.' }, { status: 404, statusText: 'Not Found' });
        await renderResources();
        harness.detectChanges();
        expect(element.textContent).toContain('Не удалось загрузить расписание.');
        expect(element.textContent).not.toContain('Resource unavailable.');
        button(element, 'Повторить загрузку').click();
        harness.detectChanges();
        await flush('2026-10-15', '2026-10-15', [], harness);
        expect(element.textContent).not.toContain('Не удалось загрузить расписание.');
    });

    it('never asks for a schedule outside a teacher session and drops it when the account changes', async () => {
        signIn('STUDENT');
        const student = await open('/teacher/schedule');
        student.harness.detectChanges();
        await renderResources();
        http.expectNone((request) => request.url.startsWith(root));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideRouter([{ path: 'teacher/schedule', component: SchedulePageComponent }]),
                provideHttpClient(withInterceptors([sessionInterceptor])),
                provideHttpClientTesting(),
            ],
        });
        http = TestBed.inject(HttpTestingController);
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        const pending = http.expectOne(`${root}?from=2026-10-15&to=2026-10-15`);
        TestBed.inject(SessionStore).invalidate();
        harness.detectChanges();
        expect(pending.cancelled).toBe(true);
        expect(element.querySelector('.schedule-list')).toBeNull();
    });

    it('reminds of the newest unmarked lessons of two weeks and marks one with its revision', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        await flush('2026-10-15', '2026-10-15', [], harness);
        const past = ['2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08', '2026-10-03'].map((date, index) =>
            item('p' + index, 'Ученик ' + index, date, '12:00', { revision: 3, number: index + 1 })
        );
        http.expectOne(reminder).flush({
            from: '2026-10-02',
            to: '2026-10-15',
            items: [...past, item('held', 'Готово', '2026-10-10', '12:00', { conductedAt: '2026-10-10T10:00:00Z' })],
        });
        await renderResources();
        harness.detectChanges();
        const block = element.querySelector('.conducted-reminder')!;
        expect(block.querySelector('h2')?.textContent).toBe('Отметьте проведённые занятия');
        const rows = block.querySelectorAll('.reminder-list li');
        expect(rows).toHaveLength(5);
        expect(rows[0].textContent).toContain('Ученик 0 · № 1 · 14.10, 12:00');
        expect(block.textContent).toContain('Ещё 1 за две недели.');
        expect(block.textContent).not.toContain('Готово');

        (rows[0].querySelector('button') as HTMLButtonElement).click();
        harness.detectChanges();
        const patch = http.expectOne('/api/v1/workspaces/w1/students/s-p0/lessons/p0');
        expect(patch.request.method).toBe('PATCH');
        expect(patch.request.body).toEqual({ revision: 3, conducted: true });
        expect((rows[1].querySelector('button') as HTMLButtonElement).disabled).toBe(true);
        patch.flush({ ...past[0].lesson, revision: 4, conductedAt: '2026-10-15T12:30:00Z' });
        await renderResources();
        harness.detectChanges();
        expect(element.querySelector('.success-banner')?.textContent).toBe('Занятие № 1 · Ученик 0 отмечено проведённым.');
        await flush('2026-10-15', '2026-10-15', [], harness);
        http.expectOne(reminder).flush({ from: '2026-10-02', to: '2026-10-15', items: past.slice(1) });
        await renderResources();
        harness.detectChanges();
        expect(element.querySelectorAll('.conducted-reminder .reminder-list li')).toHaveLength(5);
        expect(element.querySelector('.conducted-reminder')?.textContent).not.toContain('Ещё');
    });

    it('asks for a fresh schedule after a revision conflict and hides the reminder in the week view', async () => {
        signIn();
        const { harness, element } = await open('/teacher/schedule');
        await flush('2026-10-15', '2026-10-15', [], harness);
        http.expectOne(reminder).flush({ from: '2026-10-02', to: '2026-10-15', items: [item('p', 'Анна', '2026-10-14', '12:00')] });
        await renderResources();
        harness.detectChanges();
        (element.querySelector('.reminder-list button') as HTMLButtonElement).click();
        http.expectOne('/api/v1/workspaces/w1/students/s-p/lessons/p').flush({ message: 'Lesson changed.' }, { status: 409, statusText: 'Conflict' });
        harness.detectChanges();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('Занятие изменилось. Обновите расписание.');
        expect((element.querySelector('.reminder-list button') as HTMLButtonElement).disabled).toBe(false);
        button(element, 'Неделя').click();
        await settle(harness);
        await flush('2026-10-12', '2026-10-18', [], harness);
        expect(element.querySelector('.conducted-reminder')).toBeNull();
        expect(element.querySelector('[role="alert"]')).toBeNull();
    });
});

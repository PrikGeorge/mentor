import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { base, configure, lessonSummary, open, publicStudent, renderResources } from '../students/domain-test-support';

// T23: the student's calendar under /learn and the teacher's read-only preview of it.
const month = base + '/schedule?from=2026-10-01&to=2026-10-31';
const upcoming = base + '/schedule?from=2026-10-15&to=2026-10-28';
const lesson = (id: string, date: string, time: string, number: number) => ({ ...lessonSummary, id, date, time, duration: 60, number, title: 'Тема ' + id });

describe('Student calendar', () => {
    beforeEach(() => {
        // Thursday 15 October 2026, 15:30 in Moscow.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-15T12:30:00Z'));
        configure();
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        vi.useRealTimers();
    });
    async function answer(http: HttpTestingController, items: object[], audience: string | null = null) {
        const card = http.expectOne((request) => request.url === base && request.method === 'GET');
        expect(card.request.params.get('audience')).toBe(audience);
        card.flush(publicStudent);
        http.expectOne(month).flush({ from: '2026-10-01', to: '2026-10-31', items });
        http.expectOne(upcoming).flush({
            from: '2026-10-15',
            to: '2026-10-28',
            items: items.filter((item) => (item as { date: string }).date >= '2026-10-15'),
        });
        await renderResources();
    }

    it('shows the student only their own month and the next lessons, with «Календарь» in the header', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/calendar', 'STUDENT');
        try {
            await answer(http, [lesson('l1', '2026-10-05', '10:00', 1), lesson('l2', '2026-10-22', '18:00', 2)]);
            fixture.detectChanges();
            expect(element.querySelector('h1')?.textContent).toBe('Календарь');
            const links = [...element.querySelectorAll<HTMLAnchorElement>('.month-grid .day-lessons a')];
            expect(links.map((link) => link.textContent?.trim())).toEqual(['10:00 · № 1', '18:00 · № 2']);
            expect(links[1].getAttribute('href')).toBe('/learn/students/s1/lessons/l2');
            expect(element.querySelector('.month-grid .tag.quiet')?.textContent).toBe('Прошло');
            expect(element.querySelector('.upcoming time')?.textContent?.trim()).toBe('Чт, 22 октября · 18:00–19:00');
            expect(element.querySelector('.upcoming b')).toBeNull();
            const nav = [...element.querySelectorAll<HTMLAnchorElement>('header a')].find((link) => link.textContent?.trim() === 'Календарь');
            expect(nav?.getAttribute('href')).toBe('/learn/students/s1/calendar');
        } finally {
            fixture.destroy();
        }
    });

    it('tells the student when nothing is planned yet', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/calendar', 'STUDENT');
        try {
            await answer(http, []);
            fixture.detectChanges();
            expect(element.querySelector('.calendar-empty')?.textContent).toContain('В этом месяце занятий нет.');
            expect(element.querySelector('.upcoming')?.textContent).toContain('Ближайших занятий пока нет. Наставник назначит дату.');
        } finally {
            fixture.destroy();
        }
    });

    it('says when the next lessons could not be read and reads them again', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/calendar', 'STUDENT');
        try {
            http.expectOne((request) => request.url === base && request.method === 'GET').flush(publicStudent);
            http.expectOne(month).flush({ from: '2026-10-01', to: '2026-10-31', items: [] });
            http.expectOne(upcoming).flush({ status: 503, code: 'AUTH_UNAVAILABLE' }, { status: 503, statusText: 'Unavailable' });
            await renderResources();
            fixture.detectChanges();
            const upcomingSection = element.querySelector('.upcoming')!;
            expect(upcomingSection.textContent).toContain('Не удалось загрузить ближайшие занятия.');
            expect(upcomingSection.textContent).not.toContain('Ближайших занятий пока нет');
            [...upcomingSection.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Повторить загрузку')!.click();
            fixture.detectChanges();
            http.match(month).forEach((request) => request.flush({ from: '2026-10-01', to: '2026-10-31', items: [] }));
            http.expectOne(upcoming).flush({ from: '2026-10-15', to: '2026-10-28', items: [lesson('l2', '2026-10-22', '18:00', 2)] });
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('.upcoming')!.textContent).toContain('№ 2 · Тема l2');
        } finally {
            fixture.destroy();
        }
    });

    it('explains a failed month in Russian and reads it again', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/calendar', 'STUDENT');
        try {
            http.expectOne((request) => request.url === base && request.method === 'GET').flush(publicStudent);
            http.expectOne(month).flush({ status: 503, code: 'AUTH_UNAVAILABLE' }, { status: 503, statusText: 'Unavailable' });
            http.expectOne(upcoming).flush({ from: '2026-10-15', to: '2026-10-28', items: [] });
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('mentor-error-banner')?.textContent).toContain('Сервис временно недоступен');
            expect(element.querySelector('.month-grid')).toBeNull();
            [...element.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Повторить загрузку')!.click();
            fixture.detectChanges();
            http.expectOne(month).flush({ from: '2026-10-01', to: '2026-10-31', items: [lesson('l1', '2026-10-05', '10:00', 1)] });
            http.match(upcoming).forEach((request) => request.flush({ from: '2026-10-15', to: '2026-10-28', items: [] }));
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('mentor-error-banner')).toBeNull();
            expect(element.querySelector('.month-grid .day-lessons a')?.textContent?.trim()).toBe('10:00 · № 1');
        } finally {
            fixture.destroy();
        }
    });

    it('keeps the teacher preview read-only and inside the preview', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/calendar?preview=student');
        try {
            await answer(http, [lesson('l2', '2026-10-22', '18:00', 2)], 'student');
            fixture.detectChanges();
            expect(element.querySelector('.month-grid .day-lessons a')?.getAttribute('href')).toBe('/teacher/students/s1/lessons/l2?preview=student');
            expect(element.querySelector('.upcoming a')?.getAttribute('href')).toBe('/teacher/students/s1/lessons/l2?preview=student');
            expect(element.querySelector('.calendar-filter')).toBeNull();
        } finally {
            fixture.destroy();
        }
    });

    it('drops the calendar requests when the account changes', async () => {
        const { fixture, http, session } = await open('/learn/students/s1/calendar', 'STUDENT');
        try {
            const pending = http.expectOne(month);
            session.invalidate();
            fixture.detectChanges();
            expect(pending.cancelled).toBe(true);
            http.match(() => true);
        } finally {
            fixture.destroy();
        }
    });
});

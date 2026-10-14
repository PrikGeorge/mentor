import { TestBed } from '@angular/core/testing';
import { configure, open, page, base, publicStudent, publicLesson, flushTurns } from '../students/domain-test-support';
describe('Learner dashboard and navigation', () => {
    beforeEach(configure);
    afterEach(() => TestBed.resetTestingModule());
    for (const focus of [{ lesson: publicLesson, upcoming: true }, { lesson: publicLesson, upcoming: false }, null]) {
        it(`renders server-selected ${focus === null ? 'empty' : focus.upcoming ? 'next/current' : 'latest past'} lesson and resolves own membership`, async () => {
            const { fixture, http, element } = await open('/learn', 'STUDENT');
            http.expectOne('/api/v1/workspaces/w1/students?page=0&size=25').flush(page([publicStudent]));
            fixture.detectChanges();
            http.expectOne(base + '/dashboard').flush({ student: publicStudent, lessonCount: focus ? 1 : 0, focus });
            fixture.detectChanges();
            expect(element.querySelector('h1')?.textContent).toContain(focus ? publicLesson.title : 'Тестовая Анна');
            expect(element.querySelector('.profile-name')?.textContent).toContain('Тестовая Анна');
            expect(element.textContent).toContain(publicStudent.direction);
            expect(element.querySelectorAll('.selected-student')).toHaveLength(0);
            expect(element.querySelector('footer')?.textContent).toContain('Кабинет ученика');
            expect(element.querySelector('footer')?.textContent).not.toContain('Кабинет наставника');
            expect(element.textContent).toContain(focus === null ? 'Занятий пока нет' : focus.upcoming ? 'Ближайшее занятие' : 'Последнее занятие');
            expect(element.textContent).not.toContain('Заметки наставника');
            expect(element.querySelector('a[href*="/learn/students/s1/goal"]')).toBeTruthy();
            if (focus)
                expect(element.querySelector('a[href*="/learn/students/s1/lessons/l1/student/tasks"]')).toBeTruthy();
            flushTurns(http); http.verify();
        });
    }
    it('shows lesson sections in the learner menu without a second lesson header', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/lessons/l1/student/tasks', 'STUDENT');
        http.expectOne(base).flush(publicStudent);
        http.expectOne(base + '/lessons/l1').flush(publicLesson);
        fixture.detectChanges();
        expect(element.querySelectorAll('h1')).toHaveLength(1);
        expect(element.querySelector('nav[aria-label="Разделы занятия"]')?.textContent).toContain('Домашняя работа');
        expect(element.textContent).not.toContain('Заметки наставника');
        flushTurns(http); http.verify();
    });
    it('teacher home preview uses the public dashboard without account-access reads', async () => {
        const { fixture, http, element, session } = await open('/teacher/students/s1?preview=student');
        http.expectOne(base + '/dashboard?audience=student').flush({ student: publicStudent, lessonCount: 1, focus: { lesson: publicLesson, upcoming: true } });
        fixture.detectChanges();
        expect(session.actor()?.role).toBe('TEACHER');
        expect(element.querySelectorAll('.selected-student')).toHaveLength(0);
        expect(element.querySelector('.profile-name')?.textContent).toContain(publicStudent.name);
        expect(element.querySelector('footer')?.textContent).toContain('Кабинет ученика');
        expect(element.textContent).toContain('Ближайшее занятие');
        expect(element.textContent).not.toContain('Доступ к кабинету');
        expect(element.querySelector('a[href="/teacher/students/s1/lessons/l1/student/tasks?preview=student"]')).toBeTruthy();
        flushTurns(http); http.verify();
    });
    it('legacy learner list root resolves to its own dashboard instead of a missing page', async () => {
        const { fixture, http, router, element } = await open('/learn/students', 'STUDENT');
        http.expectOne('/api/v1/workspaces/w1/students?page=0&size=25').flush(page([publicStudent]));
        http.expectOne(base + '/dashboard').flush({ student: publicStudent, lessonCount: 0, focus: null });
        fixture.detectChanges();
        expect(router.url).toBe('/learn');
        expect(element.textContent).toContain('Тестовая Анна');
        flushTurns(http); http.verify();
    });
});

import { TestBed } from '@angular/core/testing';
import { TurnClockComponent, turnHeadline, turnOf } from './turn-clock.component';
import { renderResources, configure, open, page, base, student, lessonSummary, flushTurns, flushJournal } from '../students/domain-test-support';

describe('Whose turn it is', () => {
    afterEach(() => {
        vi.useRealTimers();
        TestBed.resetTestingModule();
    });
    it('gives the move to the mentor only while the latest work awaits review', () => {
        expect(turnOf(null).state).toBe('none');
        expect(turnHeadline(turnOf(null), 'student').title).toBe('Твой ход');
        expect(turnHeadline(turnOf({ status: 'submitted', createdAt: '2026-10-13T18:40:00Z' }), 'student').title).toBe('Ход у наставника');
        expect(turnHeadline(turnOf({ status: 'submitted', createdAt: '2026-10-13T18:40:00Z' }), 'teacher')).toEqual({
            title: 'Ход за вами',
            text: 'Работа отправлена 13.10, 21:40 и ждёт ревью.',
        });
        expect(
            turnHeadline(turnOf({ status: 'needs_revision', createdAt: '2026-10-13T18:40:00Z', reviewedAt: '2026-10-14T09:00:00Z' }), 'student').text
        ).toContain('доработать');
        expect(turnHeadline(turnOf({ status: 'reviewed', createdAt: '2026-10-13T18:40:00Z', reviewedAt: '2026-10-14T09:00:00Z' }), 'teacher').text).toBe(
            'Вы ответили 14.10.'
        );
        // A submitted trainer exercise placed as homework is the student's move too; the mentor answers it in the trainer.
        const attempt = turnOf({ status: 'submitted', createdAt: '2026-10-13T18:40:00Z', kind: 'attempt' });
        expect(turnHeadline(attempt, 'teacher')).toEqual({
            title: 'Ход за вами',
            text: 'Решение упражнения отправлено 13.10, 21:40 и ждёт вашего комментария.',
        });
        expect(turnHeadline(attempt, 'student').text).toContain('Решение упражнения отправлено');
        expect(turnOf({ status: 'submitted', createdAt: '2026-10-13T18:40:00Z' }).kind).toBe('homework');
    });
    it('lights the side whose move it is and counts down only to the lesson, never the mentor answer', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-11T19:35:00Z'));
        TestBed.configureTestingModule({ imports: [TurnClockComponent] });
        const fixture = TestBed.createComponent(TurnClockComponent),
            element: HTMLElement = fixture.nativeElement;
        fixture.componentRef.setInput('turn', turnOf({ status: 'reviewed', createdAt: '2026-10-10T10:00:00Z', reviewedAt: '2026-10-11T08:00:00Z' }));
        fixture.componentRef.setInput('name', 'Анна Соколова');
        fixture.componentRef.setInput('start', '2026-10-12T19:00:00+03:00');
        fixture.detectChanges();
        const faces = element.querySelectorAll('.face');
        expect(faces[0].classList.contains('on')).toBe(true);
        expect(faces[0].textContent).toContain('Анна');
        expect(faces[0].textContent).toContain('твой ход');
        expect(faces[0].textContent).toContain('20:25');
        expect(faces[0].textContent).toContain('до занятия');
        expect(faces[1].textContent).toContain('Наставник');
        expect(faces[1].textContent).toContain('ответил 11.10');
        expect(element.querySelector('[role=group]')?.getAttribute('aria-label')).toContain('Чей ход: Анна — твой ход');
        fixture.componentRef.setInput('turn', turnOf({ status: 'submitted', createdAt: '2026-10-11T18:40:00Z' }));
        fixture.componentRef.setInput('viewer', 'teacher');
        fixture.detectChanges();
        expect(faces[0].classList.contains('on')).toBe(false);
        expect(element.querySelectorAll('.face')[1].textContent).toContain('ход за вами');
        expect(element.textContent).not.toContain('до занятия');
        expect(element.textContent).toContain('работа отправлена 11.10, 21:40');
    });
});

describe('Turns on the teacher pages', () => {
    beforeEach(configure);
    afterEach(() => TestBed.resetTestingModule());
    it('queues works awaiting review before the cards and links straight to the lesson review', async () => {
        const { fixture, http, element } = await open('/teacher/students');
        // The list screen loads its cards and their summaries in one request.
        http.expectOne('/api/v1/workspaces/w1/students/dashboards?page=0&size=25').flush(
            page([{ student, lessonCount: 1, focus: { lesson: lessonSummary, upcoming: true } }])
        );
        await renderResources(); fixture.detectChanges();
        http.expectOne('/api/v1/workspaces/w1/homework/turns?page=0&size=100').flush(
            page([
                {
                    studentId: 's1',
                    studentName: student.name,
                    lessonId: 'l1',
                    lessonTitle: 'Коллекции',
                    lessonDate: '2026-10-02',
                    submissionId: 'h1',
                    filename: 'work.zip',
                    comment: 'Проверьте порядок',
                    status: 'submitted',
                    createdAt: '2026-10-13T18:40:00Z',
                    awaitingReview: 2,
                },
            ])
        );
        await renderResources(); fixture.detectChanges();
        expect(element.querySelector('#queue-title')?.textContent).toBe('Ход за вами');
        expect(element.querySelector('.queue')?.textContent).toContain('ещё работ на ревью: 1');
        expect(element.querySelector('.queue a')?.getAttribute('href')).toBe('/teacher/students/s1/lessons/l1/teacher/review');
        expect(element.querySelector('.student-card .clock .face.on')?.textContent).toContain('ход за вами');
        // The T16 reminder reads the schedule beside the queue; this test does not look at it.
        http.expectOne(request => request.url.startsWith('/api/v1/workspaces/w1/schedule')).flush({ from: '', to: '', items: [] });
        http.verify();
    });
    it('marks the lesson whose work waits for the teacher and offers its review first', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1');
        http.expectOne(base).flush(student);
        http.expectOne(base + '/lessons?page=0&size=25').flush(page([lessonSummary]));
        await renderResources(); fixture.detectChanges();
        http.expectOne(base + '/access').flush({ account: null, invitation: null });
        flushTurns(http, [{ lessonId: 'l1', submissionId: 'h1', filename: 'work.zip', status: 'submitted', createdAt: '2026-10-13T18:40:00Z' }]);
        await renderResources(); fixture.detectChanges();
        expect(element.querySelector('.turn-cell')?.textContent).toContain('Ход за вами');
        expect(element.querySelector('.lesson-table .num')?.classList.contains('mine')).toBe(true);
        const review = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).filter(
            (link) => link.getAttribute('href') === '/teacher/students/s1/lessons/l1/teacher/review'
        );
        expect(review.map((link) => link.textContent?.trim())).toEqual(['Открыть ревью', 'Ревью']);
        expect(element.querySelector('.card-turn .face.on')?.textContent).toContain('ход за вами');
        http.verify();
    });
    it('shows the learner that the move belongs to the mentor after sending work', async () => {
        const { fixture, http, element } = await open('/learn', 'STUDENT');
        http.expectOne('/api/v1/workspaces/w1/students?page=0&size=25').flush(page([student]));
        await renderResources(); fixture.detectChanges();
        http.expectOne(base + '/dashboard').flush({ student, lessonCount: 1, focus: { lesson: lessonSummary, upcoming: true } });
        await renderResources(); fixture.detectChanges();
        http.expectOne(base + '/homework/turns?page=0&size=1').flush(
            page([{ lessonId: 'l1', submissionId: 'h1', filename: 'work.zip', status: 'submitted', createdAt: '2026-10-13T18:40:00Z' }])
        );
        await renderResources(); fixture.detectChanges();
        expect(element.querySelector('.turn')?.textContent).toContain('Ход у наставника');
        expect(element.querySelector('.home-clock .face.on')?.textContent).toContain('Наставник');
        flushJournal(http);
        http.verify();
    });
});

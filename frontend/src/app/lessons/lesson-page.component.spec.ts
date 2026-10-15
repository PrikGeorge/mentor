import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { MarkdownRenderer } from '../editor/markdown-renderer.service';
import { LessonPageComponent } from './lesson-page.component';
import { base, click, configure, lesson, open, publicLesson, publicStudent, renderResources, student } from '../students/domain-test-support';

// Q-07: the lesson page itself — preparation steps, the teacher's actions and the read-only views.
function answerLesson(http: HttpTestingController, value: object = lesson, card: object = student, audience: string | null = null, id = 'l1') {
    http.expectOne((request) => request.url === base).flush(card);
    const read = http.expectOne((request) => request.url === base + '/lessons/' + id && request.method === 'GET');
    expect(read.request.params.get('audience')).toBe(audience);
    read.flush(value);
}
function buttons(element: HTMLElement) {
    return Array.from(element.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');
}
async function teacherPage(path = '/teacher/students/s1/lessons/l1', value: object = lesson) {
    const opened = await open(path);
    answerLesson(opened.http, value);
    await renderResources();
    opened.fixture.detectChanges();
    return opened;
}

describe('Lesson page', () => {
    beforeEach(configure);
    afterEach(() => {
        vi.useRealTimers();
        TestBed.resetTestingModule();
    });

    it('shows the teacher the preparation steps with the private scenario marked «Только вам»', async () => {
        const { fixture, http, element } = await teacherPage();
        try {
            expect(element.querySelector('#prep-title')?.textContent).toBe('Подготовка занятия');
            const steps = Array.from(element.querySelectorAll('.prep > li'));
            expect(steps).toHaveLength(4);
            expect(steps[0].textContent).toContain('Только вам');
            expect(steps[0].textContent).toContain('Сценарий добавлен');
            expect(steps[1].textContent).toContain('Видно ученику');
            expect(steps[3].textContent).toContain('Запланировано: материалы скрыты от ученика');
            expect(buttons(element)).toEqual(expect.arrayContaining(['Изменить занятие', 'Создать на основе', 'Отметить проведённым', 'Опубликовать ученику']));
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('marks the lesson as held with its revision and offers to undo the mark', async () => {
        const { fixture, http, element } = await teacherPage();
        try {
            click(element, 'Отметить проведённым');
            const patch = http.expectOne((request) => request.url === base + '/lessons/l1' && request.method === 'PATCH');
            expect(patch.request.body).toEqual({ revision: 1, conducted: true });
            patch.flush({ ...lesson, revision: 2, conductedAt: '2026-10-02T13:00:00Z' });
            fixture.detectChanges();
            expect(buttons(element)).toContain('Снять отметку «Проведено»');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('keeps the mark unset and reports a revision conflict', async () => {
        const { fixture, http, element } = await teacherPage();
        try {
            click(element, 'Отметить проведённым');
            http.expectOne((request) => request.method === 'PATCH').flush(
                { status: 409, code: 'REVISION_CONFLICT', message: 'Lesson changed. Refresh before saving.' },
                { status: 409, statusText: 'Conflict' }
            );
            fixture.detectChanges();
            expect(element.querySelector('mentor-error-banner')).toBeTruthy();
            expect(buttons(element)).toContain('Отметить проведённым');
            expect(buttons(element)).not.toContain('Снять отметку «Проведено»');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('reminds to mark the lesson only after it has ended without the mark', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const hint = 'Занятие прошло — отметьте, если оно состоялось.';
        // The lesson runs 2 October, 12:00–13:00 Moscow time (09:00–10:00 UTC).
        for (const [now, value, shown] of [
            ['2026-10-02T09:30:00Z', lesson, false],
            ['2026-10-02T10:01:00Z', lesson, true],
            ['2026-10-02T10:01:00Z', { ...lesson, conductedAt: '2026-10-02T10:00:00Z' }, false],
        ] as const) {
            vi.setSystemTime(new Date(now));
            const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1', value);
            try {
                expect(element.textContent?.includes(hint)).toBe(shown);
                http.verify();
            } finally {
                fixture.destroy();
                TestBed.resetTestingModule();
                configure();
            }
        }
    });

    it('publishes the materials to the student by switching the status to prepared', async () => {
        const { fixture, http, element } = await teacherPage();
        try {
            click(element, 'Опубликовать ученику');
            const patch = http.expectOne((request) => request.url === base + '/lessons/l1' && request.method === 'PATCH');
            expect(patch.request.body).toEqual({ revision: 1, status: 'prepared' });
            patch.flush({ ...lesson, revision: 2, status: 'prepared' });
            fixture.detectChanges();
            expect(element.querySelectorAll('.prep > li')[3].textContent).toContain('Подготовлено: ученик видит материалы');
            expect(buttons(element)).toContain('Скрыть от ученика');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('asks before deleting and explains a refusal for a lesson with works', async () => {
        const { fixture, http, element } = await teacherPage();
        try {
            click(element, 'Удалить занятие');
            fixture.detectChanges();
            expect(element.querySelector('.inline-confirm')?.textContent).toContain('Удалить занятие «Коллекции»?');
            http.expectNone((request) => request.method === 'DELETE');
            click(element, 'Удалить');
            http.expectOne((request) => request.url === base + '/lessons/l1' && request.method === 'DELETE').flush(
                { status: 409, code: 'CONFLICT', message: 'The change conflicts with existing data.' },
                { status: 409, statusText: 'Conflict' }
            );
            fixture.detectChanges();
            expect(element.querySelector('.inline-confirm')).toBeNull();
            expect(element.textContent).toContain('Занятие нельзя удалить');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('renders the private scenario as Markdown in the plan section', async () => {
        const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1/teacher/plan', {
            ...lesson,
            teacherNotes: 'Разобрать **List** и `Map`',
        });
        try {
            const source = element.querySelector('.lesson-source')!;
            expect(source.querySelector('strong')?.textContent).toBe('List');
            expect(source.querySelector('code')?.textContent).toBe('Map');
            expect(element.querySelector('.text-section .vis.private')?.textContent).toContain('Только вам');
            expect(buttons(element)).toContain('Изменить сценарий');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('renders the Markdown once per text and shows a saved text at once', async () => {
        const render = vi.spyOn(MarkdownRenderer.prototype, 'render');
        const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1/teacher/plan', { ...lesson, teacherNotes: 'Первый **план**' });
        try {
            fixture.detectChanges();
            fixture.detectChanges();
            expect(render.mock.calls.filter(([text]) => text === 'Первый **план**')).toHaveLength(1);
            const page = fixture.debugElement.query(By.directive(LessonPageComponent)).componentInstance as LessonPageComponent;
            page.savedText({ kind: 'teacherNotes', revision: 2, markdown: 'Новый *план*' });
            fixture.detectChanges();
            expect(element.querySelector('.lesson-source em')?.textContent).toBe('план');
            expect(render.mock.calls.filter(([text]) => text === 'Новый *план*')).toHaveLength(1);
            http.verify();
        } finally {
            render.mockRestore();
            fixture.destroy();
        }
    });

    it('shows an empty private scenario with the way to add it', async () => {
        const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1/teacher/plan', { ...lesson, teacherNotes: '' });
        try {
            const empty = element.querySelector('.empty-state')!;
            expect(empty.classList.contains('private')).toBe(true);
            expect(empty.textContent).toContain('Сценария пока нет');
            expect(empty.textContent).toContain('ученик этот текст не увидит');
            expect(buttons(element)).toContain('Добавить сценарий');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('keeps the editor closed and shows a banner when the text cannot be read', async () => {
        const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1/teacher/plan');
        try {
            click(element, 'Изменить сценарий');
            http.expectOne(base + '/lessons/l1/texts/teacherNotes').flush(
                { status: 503, code: 'AUTH_UNAVAILABLE', message: 'Authentication storage unavailable.' },
                { status: 503, statusText: 'Service Unavailable' }
            );
            fixture.detectChanges();
            expect(element.querySelector('mentor-markdown-editor')).toBeNull();
            expect(element.querySelector('mentor-error-banner')).toBeTruthy();
            expect(buttons(element)).toContain('Изменить сценарий');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('closes the editor and cancels its text request when another lesson opens', async () => {
        const { fixture, http, element } = await teacherPage('/teacher/students/s1/lessons/l1/teacher/plan');
        try {
            click(element, 'Изменить сценарий');
            http.expectOne(base + '/lessons/l1/texts/teacherNotes').flush({ kind: 'teacherNotes', revision: 1, markdown: 'Частный сценарий' });
            fixture.detectChanges();
            expect(element.querySelector('mentor-markdown-editor')).toBeTruthy();
            await TestBed.inject(Router).navigateByUrl('/teacher/students/s1/lessons/l2/teacher/plan');
            fixture.detectChanges();
            http.match((request) => request.url === base).forEach((request) => request.flush(student));
            http.expectOne(base + '/lessons/l2').flush({ ...lesson, id: 'l2', number: 2, teacherNotes: 'Второй сценарий' });
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('mentor-markdown-editor')).toBeNull();
            expect(element.querySelector('.lesson-source')?.textContent).toContain('Второй сценарий');
            click(element, 'Изменить сценарий');
            const pending = http.expectOne(base + '/lessons/l2/texts/teacherNotes');
            await TestBed.inject(Router).navigateByUrl('/teacher/students/s1/lessons/l1/teacher/plan');
            fixture.detectChanges();
            expect(pending.cancelled).toBe(true);
            http.match(() => true);
        } finally {
            fixture.destroy();
        }
    });

    it('gives the student the tasks to read without any teacher actions', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/lessons/l1/student/tasks', 'STUDENT');
        try {
            answerLesson(http, { ...publicLesson, studentNotes: 'Реши *три* задачи' }, publicStudent);
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('.text-section h2')?.textContent).toBe('Задания на занятие');
            expect(element.querySelector('.lesson-source em')?.textContent).toBe('три');
            expect(element.querySelector('.text-section .vis.public')?.textContent).toContain('Видно ученику');
            expect(element.querySelector('.vis.private')).toBeNull();
            expect(element.querySelector('.lesson-page-actions')).toBeNull();
            expect(buttons(element)).not.toContain('Изменить задания');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('keeps the teacher preview of the student screen read-only', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1/student/tasks?preview=student');
        try {
            answerLesson(http, publicLesson, publicStudent, 'student');
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('.lesson-source')?.textContent).toContain('Задания Анны');
            expect(element.querySelector('.vis.private')).toBeNull();
            expect(element.querySelector('.lesson-page-actions')).toBeNull();
            expect(buttons(element)).not.toContain('Изменить задания');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });

    it('reports a missing lesson in Russian instead of the page', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1');
        try {
            http.expectOne((request) => request.url === base).flush(student);
            http.expectOne((request) => request.url === base + '/lessons/l1').flush(
                { status: 404, code: 'NOT_FOUND', message: 'Resource unavailable.', requestId: 'synthetic' },
                { status: 404, statusText: 'Not Found' }
            );
            await renderResources();
            fixture.detectChanges();
            expect(element.querySelector('.lesson-page-actions')).toBeNull();
            expect(element.textContent).toContain('Не найдено: запись удалена или недоступна.');
            expect(element.textContent).not.toContain('Resource unavailable.');
            http.verify();
        } finally {
            fixture.destroy();
        }
    });
});

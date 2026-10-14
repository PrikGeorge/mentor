import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { RoadmapComponent } from '../roadmap/roadmap.component';
import { RoadmapStage, stageProgress } from '../roadmap/roadmap-api.service';
import { Move, MovesComponent, moveAction } from '../journal/moves.component';
import { CodeComment, CodeReviewComponent, codeLines } from './code-review.component';

const card = '/api/v1/workspaces/w1/students/s1';
const lessonRef = { workspaceId: 'w1', studentId: 's1', id: 'l1' };
const stages: RoadmapStage[] = [{ title: 'Синтаксис Java', note: 'сентябрь', state: 'done' }, { title: 'Коллекции', note: '', state: 'current' }, { title: 'Spring Boot', note: '', state: 'ahead' }];

function mount<T>(type: Type<T>, role: 'TEACHER' | 'STUDENT', inputs: Record<string, unknown>) {
    const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore);
    session.load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic-' + role, workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
    const fixture = TestBed.createComponent(type);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
}
function button(element: HTMLElement, text: string) { const found = Array.from(element.querySelectorAll('button')).find(item => item.textContent?.trim() === text); expect(found, text).toBeTruthy(); return found!; }

describe('Stage 3 helpers', () => {
    it('reports the current stage, or the last passed one when nothing is current', () => {
        expect(stageProgress(stages)).toEqual({ position: 2, total: 3, title: 'Коллекции' });
        expect(stageProgress([{ ...stages[0] }, { ...stages[2] }])).toEqual({ position: 1, total: 2, title: 'Синтаксис Java' });
        expect(stageProgress([{ ...stages[2] }])).toBeNull();
        expect(stageProgress([])).toBeNull();
    });
    it('counts code lines like the server and hides only the final newline', () => {
        expect(codeLines('a\r\nb\n')).toEqual(['a', 'b']);
        expect(codeLines('a\n\nb')).toEqual(['a', '', 'b']);
        expect(codeLines('')).toEqual(['']);
    });
    it('words every kind of move', () => {
        const move = (patch: Partial<Move>): Move => ({ kind: 'homework', side: 'student', at: '2026-10-05T10:00:00Z', lessonId: 'l1', lessonTitle: 'Коллекции', refId: 'r1', ...patch });
        expect(moveAction(move({ ordinal: 1 }))).toBe('сдана работа');
        expect(moveAction(move({ ordinal: 3 }))).toBe('сдана версия 3');
        expect(moveAction(move({ kind: 'review', side: 'teacher', status: 'needs_revision' }))).toBe('нужна доработка');
        expect(moveAction(move({ kind: 'attempt', detail: 'submit', status: 'wrong_answer', passed: 2, total: 5 }))).toBe('проверка в тренажёре · тесты 2 из 5');
        expect(moveAction(move({ kind: 'attempt', detail: 'run', status: 'queued' }))).toBe('примеры в тренажёре · в очереди');
        expect(moveAction(move({ kind: 'conducted', side: 'teacher' }))).toBe('занятие проведено');
    });
});

describe('Stage 3 components', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });

    it('lets the teacher reorder roadmap stages and saves them with the read revision', () => {
        const { http, element, fixture } = mount(RoadmapComponent, 'TEACHER', { workspaceId: 'w1', studentId: 's1', editable: true });
        http.expectOne(card + '/roadmap').flush({ stages, revision: 4 });
        fixture.detectChanges();
        expect(element.querySelector('.count')?.textContent).toContain('этап 2 из 3');
        expect(element.querySelector('[aria-current="step"]')?.textContent).toContain('Коллекции');
        button(element, 'Изменить этапы').click(); fixture.detectChanges();
        element.querySelector<HTMLButtonElement>('[aria-label="Опустить этап 1"]')!.click(); fixture.detectChanges();
        const state = element.querySelectorAll<HTMLSelectElement>('select')[2]; state.value = 'current'; state.dispatchEvent(new Event('change')); fixture.detectChanges();
        element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit')); fixture.detectChanges();
        const request = http.expectOne(card + '/roadmap');
        expect(request.request.method).toBe('PUT');
        expect(request.request.body).toEqual({ revision: 4, stages: [{ title: 'Коллекции', note: '', state: 'done' }, { title: 'Синтаксис Java', note: 'сентябрь', state: 'done' }, { title: 'Spring Boot', note: '', state: 'current' }] });
        request.flush({ message: 'Изменено' }, { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('в другой вкладке');
        expect(element.querySelector('form')).toBeTruthy();
    });

    it('shows the learner the stages read-only and asks for the student projection in a preview', () => {
        const learner = mount(RoadmapComponent, 'STUDENT', { workspaceId: 'w1', studentId: 's1', editable: true });
        learner.http.expectOne(card + '/roadmap').flush({ stages, revision: 1 }); learner.fixture.detectChanges();
        expect(learner.element.querySelectorAll('.stages li').length).toBe(3);
        expect(learner.element.querySelector('button')).toBeNull();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] });
        const preview = mount(RoadmapComponent, 'TEACHER', { workspaceId: 'w1', studentId: 's1', editable: true, preview: true });
        preview.http.expectOne(card + '/roadmap?audience=student').flush({ stages: [], revision: 0 }); preview.fixture.detectChanges();
        expect(preview.element.querySelector('button')).toBeNull();
        expect(preview.element.textContent).toContain('Этапы ещё не намечены');
    });

    it('names both sides of the moves journal and links each move to its lesson tab', () => {
        const { http, element, fixture } = mount(MovesComponent, 'TEACHER', { workspaceId: 'w1', studentId: 's1', base: '/teacher/students/s1', name: 'Тестовая Анна', size: 8 });
        const request = http.expectOne(card + '/moves?page=0&size=8');
        request.flush({ items: [
            { kind: 'review', side: 'teacher', at: '2026-10-05T12:00:00Z', lessonId: 'l1', lessonTitle: 'Коллекции', refId: 'h1', subject: 'Main.java', detail: 'Хорошо разобраны списки', status: 'reviewed', grade: 'good', ordinal: 1 },
            { kind: 'homework', side: 'student', at: '2026-10-05T10:00:00Z', lessonId: 'l1', lessonTitle: 'Коллекции', refId: 'h1', subject: 'Main.java', status: 'reviewed', ordinal: 1 },
        ], page: 0, size: 8, total: 12 });
        fixture.detectChanges();
        const rows = element.querySelectorAll('.moves li');
        expect(rows[0].classList).toContain('teacher');
        expect(rows[0].textContent).toContain('Вы · работа принята');
        expect(rows[0].querySelector('.ev')?.textContent).toContain('хорошо');
        expect(rows[1].textContent).toContain('Тестовая Анна · сдана работа');
        expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/teacher/students/s1/lessons/l1/teacher/review');
        expect(element.querySelector('.count')?.textContent).toContain('последние 2 из 12');
        button(element, 'Показать ещё').click(); fixture.detectChanges();
        http.expectOne(card + '/moves?page=0&size=28').flush({ items: [], page: 0, size: 28, total: 0 });
    });

    it('lets the teacher comment a line of a work with a grade and a variant', () => {
        const { http, element, fixture } = mount(CodeReviewComponent, 'TEACHER', { lesson: lessonRef, targetKind: 'homework', targetId: 'h1', files: { 'Main.java': 'class Main {\n  int x;\n}\n' }, editable: true });
        const existing: CodeComment = { id: 'c1', targetKind: 'homework', targetId: 'h1', file: 'Main.java', line: 1, body: 'Имя класса подходит', variant: '', createdAt: '2026-10-05T10:00:00Z' };
        http.expectOne(card + '/lessons/l1/code-comments?targetKind=homework&targetId=h1').flush({ items: [existing] });
        fixture.detectChanges();
        expect(element.querySelectorAll('.code-lines > li').length).toBe(3);
        expect(element.querySelector('.code-lines > li.noted .line-note')?.textContent).toContain('Имя класса подходит');
        element.querySelector<HTMLButtonElement>('[aria-label="Комментарий к строке 2 файла Main.java"]')!.click(); fixture.detectChanges();
        const radios = element.querySelectorAll<HTMLInputElement>('.note-form input[type="radio"]'); radios[5].checked = true; radios[5].dispatchEvent(new Event('change'));
        const [body, variant] = Array.from(element.querySelectorAll<HTMLTextAreaElement>('.note-form textarea'));
        body.value = '  Поле лучше сделать private  '; body.dispatchEvent(new Event('input'));
        variant.value = '  private int x;'; variant.dispatchEvent(new Event('input')); fixture.detectChanges();
        element.querySelector<HTMLFormElement>('.note-form')!.dispatchEvent(new Event('submit'));
        const request = http.expectOne(card + '/lessons/l1/code-comments');
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({ targetKind: 'homework', targetId: 'h1', file: 'Main.java', line: 2, grade: 'mistake', body: 'Поле лучше сделать private', variant: '  private int x;' });
        request.flush({ ...existing, id: 'c2', line: 2, grade: 'mistake', body: 'Поле лучше сделать private', variant: '  private int x;' }, { status: 201, statusText: 'Created' });
        fixture.detectChanges();
        const second = element.querySelectorAll('.code-lines > li')[1];
        expect(second.querySelector('.ev.bad')?.textContent).toContain('ошибка');
        expect(second.querySelector('pre')?.textContent).toBe('  private int x;');
        expect(element.querySelector('.note-form')).toBeNull();
        button(second as HTMLElement, 'Удалить').click();
        const removal = http.expectOne(card + '/lessons/l1/code-comments/c2');
        expect(removal.request.method).toBe('DELETE');
        removal.flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
        expect(element.querySelectorAll('.line-note').length).toBe(1);
    });

    it('shows the student mentor comments without any way to add or remove them', () => {
        const { http, element, fixture } = mount(CodeReviewComponent, 'STUDENT', { lesson: lessonRef, targetKind: 'attempt', targetId: 'a1', files: { 'Solution.java': 'return 1;' }, editable: false });
        http.expectOne(card + '/lessons/l1/code-comments?targetKind=attempt&targetId=a1').flush({ items: [{ id: 'c1', targetKind: 'attempt', targetId: 'a1', file: 'Solution.java', line: 1, grade: 'interesting', body: 'Неожиданное решение', variant: '', createdAt: '2026-10-05T10:00:00Z' }] });
        fixture.detectChanges();
        expect(element.querySelector('.line-note')?.textContent).toContain('Неожиданное решение');
        expect(element.querySelector('.add-note')).toBeNull();
        expect(element.querySelector('button')).toBeNull();
    });
});

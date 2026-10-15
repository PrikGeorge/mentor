import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MarkdownEditorComponent } from './markdown-editor.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { fileOf } from './markdown-test-support';
describe('Isolated one-text Markdown editor', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MarkdownEditorComponent], providers: [provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
    function editor(value = 'Исходный текст', lessonId = 'l1') {
        const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore);
        session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
        const fixture = TestBed.createComponent(MarkdownEditorComponent);
        fixture.componentRef.setInput('value', value); fixture.componentRef.setInput('revision', 4); fixture.componentRef.setInput('kind', 'teacherNotes'); fixture.componentRef.setInput('lesson', { workspaceId: 'w1', studentId: 's1', id: lessonId }); fixture.detectChanges();
        const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea'); return { fixture, component: fixture.componentInstance, textarea, http, session };
    }
    it('formats the selection and undoes source plus selection', () => {
        const { fixture, component, textarea } = editor('до текст после');
        textarea.setSelectionRange(3, 8); component.format('bold'); fixture.detectChanges();
        expect(textarea.value).toBe('до **текст** после'); component.undo(); fixture.detectChanges();
        expect(textarea.value).toBe('до текст после'); expect(textarea.selectionStart).toBe(3); expect(textarea.selectionEnd).toBe(8);
    });
    it('renders unchanged source when its revision is rebound before the preview debounce', () => {
        vi.useFakeTimers();
        try {
            const { fixture, component } = editor('**Тот же текст**');
            expect(component.rendered()).toBe(''); vi.advanceTimersByTime(60);
            fixture.componentRef.setInput('revision', 5); fixture.detectChanges(); vi.advanceTimersByTime(120);
            expect(component.rendered()).toBe('<p><strong>Тот же текст</strong></p>\n'); fixture.destroy();
        } finally { vi.useRealTimers(); }
    });
    it('imports append/replace as undoable edits preserving exact source', async () => {
        const { fixture, component, textarea } = editor('до');
        await component.importFile(fileOf(new TextEncoder().encode('  новое  \n'))); component.applyImport('append'); fixture.detectChanges();
        expect(textarea.value).toBe('до\n\n  новое  \n'); component.undo(); fixture.detectChanges(); expect(textarea.value).toBe('до');
        await component.importFile(fileOf(new TextEncoder().encode(' замена '))); component.applyImport('replace'); fixture.detectChanges(); expect(textarea.value).toBe(' замена ');
    });
    it('saves exactly one independently revised source and retains it on409', () => {
        const { fixture, component, textarea, http } = editor('  исходный\n');
        textarea.value = '  введённый 😀\n'; textarea.dispatchEvent(new Event('input')); component.save();
        const request = http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/texts/teacherNotes');
        expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual({ markdown: '  введённый 😀\n', revision: 4 });
        request.flush({ message: 'Ревизия устарела' }, { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
        expect(textarea.value).toBe('  введённый 😀\n'); expect(fixture.nativeElement.textContent).toContain('Текст уже изменили в другой вкладке.');expect(fixture.nativeElement.textContent).toContain('Скачать введённый .md');
    });
    it('rejects over-limit source and old-generation save handlers', () => {
        const { component, textarea, session, http } = editor();
        textarea.value = '😀'.repeat(100000) + 'a'; textarea.dispatchEvent(new Event('input')); component.save(); http.expectNone(request => request.method === 'PUT');
        session.invalidate(); textarea.value = 'old source'; textarea.dispatchEvent(new Event('input')); component.save(); http.expectNone(request => request.method === 'PUT');
    });
    it('does not write from a cancelled editor before its view is destroyed', () => {
        const { component, http } = editor(); component.cancel(); component.save();
        const requests = http.match(request => request.method === 'PUT'); for (const request of requests) request.flush({ kind: 'teacherNotes', markdown: '', revision: 5 });
        expect(requests).toHaveLength(0);
    });
    it('rejects an old DOM save between lesson input change and rendering', () => {
        const { fixture, component, http } = editor('old lesson source'); fixture.componentRef.setInput('lesson', { workspaceId: 'w1', studentId: 's1', id: 'l2' }); component.save();
        const requests = http.match(request => request.method === 'PUT'); for (const request of requests) request.flush({ kind: 'teacherNotes', markdown: '', revision: 5 });
        expect(requests).toHaveLength(0);
    });
    it('accepts exactly200000 UTF16 units and emits only the saved text kind', () => {
        const exact = '😀'.repeat(100000), { component, http } = editor(exact);
        let saved: unknown; component.saved.subscribe(value => saved = value); component.save();
        const request = http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/texts/teacherNotes'); expect(request.request.body).toEqual({ markdown: exact, revision: 4 });
        request.flush({ kind: 'teacherNotes', markdown: exact, revision: 5 }); expect(saved).toEqual({ kind: 'teacherNotes', markdown: exact, revision: 5 });
    });
    for (const boundary of ['close', 'lesson', 'account', 'typing'] as const) {
        it(`discards a late file after ${boundary}`, async () => {
            const { fixture, component, textarea, session } = editor(); let complete!: (value: ArrayBuffer) => void;
            const pending = component.importFile({ name: 'late.md', size: 4, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => complete = resolve) } as File);
            if (boundary === 'close') fixture.destroy();
            if (boundary === 'lesson') { fixture.componentRef.setInput('lesson', { workspaceId: 'w1', studentId: 's1', id: 'l2' }); fixture.componentRef.setInput('value', 'новый урок'); fixture.detectChanges(); }
            if (boundary === 'account') session.invalidate();
            if (boundary === 'typing') { textarea.value = 'новый ввод'; textarea.dispatchEvent(new Event('input')); }
            complete(new TextEncoder().encode('late').buffer); await pending; component.applyImport('replace');
            if (boundary !== 'close') { fixture.detectChanges(); expect(textarea.value).toBe(boundary === 'lesson' ? 'новый урок' : boundary === 'typing' ? 'новый ввод' : 'Исходный текст'); }
        });
    }
});


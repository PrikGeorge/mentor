import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MaterialFormComponent } from './material-form.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
describe('Teacher material form', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MaterialFormComponent], providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
    function form(lesson: string | null = 'l1') {
        const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore);
        session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
        const fixture = TestBed.createComponent(MaterialFormComponent); fixture.componentRef.setInput('workspaceId', 'w1'); fixture.componentRef.setInput('studentId', 's1'); fixture.componentRef.setInput('lessonId', lesson); fixture.detectChanges();
        return { fixture, http, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
    }
    it('posts a markdown document with its role and clears the text after success', () => {
        const { fixture, http, component, element } = form(); const saved: unknown[] = []; component.saved.subscribe(value => saved.push(value));
        component.markdown.set('# Заголовок\n\n## Часть'); component.contentKey.set('student'); component.title.set('  Заголовок  '); component.save();
        const request = http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials'); expect(request.request.method).toBe('POST'); const body = request.request.body as FormData;
        expect(body.get('kind')).toBe('doc'); expect(body.get('audience')).toBe('student'); expect(body.get('contentKey')).toBe('student'); expect(body.get('title')).toBe('Заголовок'); expect(body.get('markdown')).toBe('# Заголовок\n\n## Часть'); expect(body.has('file')).toBe(false);
        expect(request.request.headers.get('X-Mentor-Account')).toBe('teacher');
        request.flush({ id: 'm1', workspaceId: 'w1', studentId: 's1', lessonId: 'l1', bundleId: 'b1', audience: 'student', kind: 'doc', contentKey: 'student', filename: 'student.md', contentType: 'text/markdown', title: 'Заголовок' }, { status: 201, statusText: 'Created' }); fixture.detectChanges();
        expect(saved).toHaveLength(1); expect(component.markdown()).toBe(''); expect(component.title()).toBe(''); expect(component.busy()).toBe(false); expect(element.textContent).not.toContain('Не удалось');
    });
    it('refuses an empty document locally and explains a role conflict from the server', () => {
        const { fixture, http, component, element } = form(); component.save(); http.expectNone(request => request.method === 'POST'); fixture.detectChanges(); expect(element.textContent).toContain('Введите текст материала.');
        component.markdown.set('text'); component.save(); http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials').flush({ status: 409, code: 'MATERIAL_EXISTS', message: 'exists' }, { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
        expect(element.textContent).toContain('Документ с этой ролью уже есть'); expect(component.markdown()).toBe('text');
    });
    it('uploads a file to the card when no lesson is bound and offers only card roles', () => {
        const { fixture, http, component } = form(null); component.setKind('download'); component.setAudience('teacher'); expect(component.roles().map(role => role.key)).toEqual(['roadmap', 'profile']);
        component.file.set(new File(['PK'], 'kit.zip')); component.save();
        const request = http.expectOne('/api/v1/workspaces/w1/students/s1/materials'); const body = request.request.body as FormData; expect(body.get('kind')).toBe('download'); expect((body.get('file') as File).name).toBe('kit.zip'); expect(body.has('markdown')).toBe(false);
        request.flush({ id: 'm2', workspaceId: 'w1', studentId: 's1', lessonId: null, bundleId: null, audience: 'teacher', kind: 'download', contentKey: null, filename: 'kit.zip', contentType: 'application/zip', title: 'kit.zip' }, { status: 201, statusText: 'Created' }); fixture.detectChanges(); expect(component.file()).toBeNull();
    });
    it('keeps typing across renders but never posts the old draft to a new lesson before reset', () => {
        const { fixture, http, component } = form();
        component.markdown.set('Old lesson draft'); component.title.set('Draft title'); fixture.detectChanges();
        expect(component.markdown()).toBe('Old lesson draft'); expect(component.title()).toBe('Draft title');
        fixture.componentRef.setInput('lessonId', 'l2'); component.save();
        http.expectNone(request => request.method === 'POST');
        fixture.detectChanges(); expect(component.markdown()).toBe(''); expect(component.title()).toBe('');
    });
    it('ignores a previous lesson response before reset and cancels uploads when destroyed', () => {
        const { fixture, http, component } = form(); const saved: unknown[] = []; component.saved.subscribe(value => saved.push(value));
        component.markdown.set('First draft'); component.save();
        const old = http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials');
        fixture.componentRef.setInput('lessonId', 'l2');
        old.flush({ id: 'old-material' }); expect(saved).toEqual([]);
        fixture.detectChanges(); component.markdown.set('Second draft'); component.save();
        const pending = http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l2/materials');
        fixture.destroy(); expect(pending.cancelled).toBe(true); expect(saved).toEqual([]);
    });
});

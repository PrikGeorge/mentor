import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MaterialViewComponent } from './material-view.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import type { components } from '../api/schema';
const metadata: components['schemas']['MaterialMetadata'] = { id: 'doc1', workspaceId: 'w1', studentId: 's1', lessonId: 'l1', bundleId: 'bundle', audience: 'student', kind: 'doc', contentKey: 'student', filename: 'tasks.md', contentType: 'text/markdown', title: 'Задания' };
describe('Scoped material reading', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MaterialViewComponent], deferBlockBehavior: DeferBlockBehavior.Playthrough, providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
    function view(section = 'tasks', preview = true, lesson: string | null = 'l1') {
        const session = TestBed.inject(SessionStore), http = TestBed.inject(HttpTestingController);
        session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
        const fixture = TestBed.createComponent(MaterialViewComponent); fixture.componentRef.setInput('workspaceId', 'w1'); fixture.componentRef.setInput('studentId', 's1'); fixture.componentRef.setInput('lessonId', lesson); fixture.componentRef.setInput('section', section); fixture.componentRef.setInput('base', '/teacher/students/s1/lessons/l1'); fixture.componentRef.setInput('preview', preview); fixture.componentRef.setInput('learner', preview); fixture.detectChanges(); return { fixture, http, session, element: fixture.nativeElement as HTMLElement };
    }
    it('requests public projection before content and keeps literal section anchors', () => {
        const { fixture, http, element, session } = view();
        http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials?page=0&size=25&audience=student').flush({ items: [metadata], page: 0, size: 25, total: 1 });
        http.expectOne('/api/v1/workspaces/w1/materials/doc1?audience=student').flush({ ...metadata, kind: 'doc', document: { title: 'Задания', intro: '<p>Вступление</p>', raw: 'exact raw', html: '', sections: [{ id: 'section-0', title: 'Первая часть', html: '<p>Публичные задания</p>' }] } }); fixture.detectChanges();
        expect(session.actor()?.role).toBe('TEACHER'); expect(element.querySelector('#section-0')).toBeTruthy(); expect(element.querySelector('nav[aria-label="Оглавление материала"] a')?.getAttribute('href')).toContain('#section-0'); expect(element.textContent).toContain('Публичные задания');
    });
    it('reads profile-only discovery without inventing a lesson binding', () => {
        const { fixture, http, element } = view('roadmap', false, null);
        http.expectOne('/api/v1/workspaces/w1/students/s1/materials?page=0&size=25').flush({ items: [], page: 0, size: 25, total: 0 }); fixture.detectChanges(); expect(element.textContent).toContain('Материалы пока не добавлены');
    });
    it('groups the lesson listing by audience and hides download twins of code files', () => {
        const { fixture, http, element } = view('materials', false);
        const item = (id: string, audience: 'student' | 'teacher', kind: 'doc' | 'code' | 'download', contentKey: string | null, filename: string) => ({ ...metadata, id, audience, kind, contentKey, filename, title: filename });
        http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials?page=0&size=25').flush({ items: [item('guide', 'teacher', 'doc', 'guide', 'guide.md'), item('hw', 'student', 'doc', 'homework', 'homework.md'), item('tasks', 'student', 'doc', 'student', 'student.md'), item('code1', 'student', 'code', 'Task', 'Task.java'), item('dl1', 'student', 'download', null, 'Task.java'), item('zip', 'student', 'download', null, 'kit.zip')], page: 0, size: 25, total: 6 }); fixture.detectChanges();
        const groups = Array.from(element.querySelectorAll('.material-group'));
        expect(groups.map(group => group.querySelector('h2')?.textContent)).toEqual(['Видно ученику', 'Только вам']);
        expect(Array.from(groups[0].querySelectorAll('.material-text strong')).map(node => node.textContent)).toEqual(['student.md', 'homework.md', 'Task.java', 'kit.zip']);
        expect(groups[0].querySelector('a[download]')?.getAttribute('href')).toBe('/api/v1/workspaces/w1/materials/zip/file');
        expect(element.querySelector('nav.pagination')).toBeNull();
    });
    it('shows code text read-only beside a separately authorized download', () => {
        const { fixture, http, element } = view('code'); fixture.componentRef.setInput('detail', 'ListTask'); fixture.detectChanges();
        const list = http.match(request => request.url.endsWith('/lessons/l1/materials')); for (const request of list) if (!request.cancelled) request.flush({ items: [{ ...metadata, id: 'code1', kind: 'code', contentKey: 'ListTask' }], page: 0, size: 25, total: 1 });
        http.expectOne('/api/v1/workspaces/w1/materials/code1?audience=student').flush({ ...metadata, id: 'code1', kind: 'code', contentKey: 'ListTask', code: { text: '  class ListTask {}\n', teacher: false, materialId: 'download1', excerpt: { start: 0, end: 1 } } }); fixture.detectChanges();
        expect(element.querySelector('pre code')?.textContent).toBe('  class ListTask {}\n'); expect(element.textContent).toContain('только для чтения'); expect(element.querySelector('a[download]')?.getAttribute('href')).toBe('/api/v1/workspaces/w1/materials/download1/file?audience=student');
    });
    it('lets the owning teacher add and remove materials and reports each change', async () => {
        const { fixture, http, element } = view('materials', false); fixture.componentRef.setInput('editable', true); let changes = 0; fixture.componentInstance.changed.subscribe(() => changes++); fixture.detectChanges();
        http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials?page=0&size=25').flush({ items: [metadata], page: 0, size: 25, total: 1 }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(element.querySelector('mentor-material-form')).toBeTruthy(); expect(element.querySelector('.empty-state')).toBeNull();
        element.querySelector<HTMLButtonElement>('.material-remove')!.click(); fixture.detectChanges(); expect(element.textContent).toContain('Удалить?');
        element.querySelector<HTMLButtonElement>('.material-confirm .btn.danger')!.click();
        const request = http.expectOne('/api/v1/workspaces/w1/materials/doc1'); expect(request.request.method).toBe('DELETE'); request.flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
        http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/materials?page=0&size=25').flush({ items: [], page: 0, size: 25, total: 0 }); fixture.detectChanges();
        expect(changes).toBe(1); expect(element.textContent).toContain('Материалов пока нет');
    });
    it('cancels pending material content when the account changes', () => {
        const { http, session } = view(); http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [metadata], page: 0, size: 25, total: 1 }); const request = http.expectOne('/api/v1/workspaces/w1/materials/doc1?audience=student'); session.invalidate(); expect(request.cancelled).toBe(true);
    });
    it('drops the old lesson content error before the input reset effect runs', () => {
        const { fixture, http } = view();
        http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [metadata], page: 0, size: 25, total: 1 });
        const old = http.expectOne('/api/v1/workspaces/w1/materials/doc1?audience=student');
        fixture.componentRef.setInput('lessonId', 'l2');
        old.flush({ message: 'Old lesson material error' }, { status: 404, statusText: 'Not Found' });
        expect(fixture.componentInstance.error()).toBe('');
        fixture.detectChanges();
        http.expectOne(request => request.url.endsWith('/lessons/l2/materials')).flush({ items: [], page: 0, size: 25, total: 0 });
        expect(fixture.componentInstance.selected()).toBeNull();
    });
    it('cancels material removal on lesson rebind without reporting a change in the next lesson', () => {
        const { fixture, http } = view('materials', false); fixture.componentRef.setInput('editable', true); fixture.detectChanges();
        http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [metadata], page: 0, size: 25, total: 1 });
        const component = fixture.componentInstance; let changes = 0; component.changed.subscribe(() => changes++);
        component.remove(metadata); const remove = http.expectOne('/api/v1/workspaces/w1/materials/doc1');
        fixture.componentRef.setInput('lessonId', 'l2'); fixture.detectChanges();
        expect(remove.cancelled).toBe(true); expect(changes).toBe(0); expect(component.removing()).toBe(false);
        http.expectOne(request => request.url.endsWith('/lessons/l2/materials')).flush({ items: [], page: 0, size: 25, total: 0 });
        component.remove(metadata); http.expectNone(request => request.method === 'DELETE');
    });
    it('renders nested legacy source markers as read-only code and safe disclosures', () => {
        const { fixture, http, element } = view();
        http.expectOne(request=>request.url.endsWith('/lessons/l1/materials')).flush({ items: [metadata, { ...metadata, id: 'code1', kind: 'code', contentKey: 'ListTask' }], page: 0, size: 25, total: 2 });
        http.expectOne('/api/v1/workspaces/w1/materials/doc1?audience=student').flush({ ...metadata, kind: 'doc', document: { title: 'Задания', intro: '', raw: 'raw', html: '', sections: [{ id: 'section-0', title: 'Часть', html: '<div><p>Условие</p><article><!-- task-code:ListTask:practice --></article><details class="explanation-details" open><summary>Пояснение</summary><p onclick="evil()">Безопасно</p></details><img src="https://example.com/track"><script>evil()</script></div>' }] } });
        http.expectOne('/api/v1/workspaces/w1/materials/code1?audience=student').flush({ ...metadata, kind: 'code', contentKey: 'ListTask', code: { text: 'first\n    class ListTask {}\nlast', teacher: false, materialId: 'download1', excerpt: { start: 1, end: 2 } } }); fixture.detectChanges();
        expect(element.querySelector('.task-code pre code')?.textContent).toBe('class ListTask {}'); expect(element.querySelector<HTMLDetailsElement>('.explanation-details')?.open).toBe(true);
        expect(element.querySelector('script,img,[onclick]')).toBeNull();
    });
    it('preserves stored zero studentParts while linking positive values to known public targets', () => {
        const { fixture, http, element } = view('guide',false);
        http.expectOne(request=>request.url.endsWith('/lessons/l1/materials')).flush({ items: [{...metadata,id:'guide',audience:'teacher',contentKey:'guide'},metadata], page:0,size:25,total:2 });
        const parts = [0,1,9];
        http.expectOne('/api/v1/workspaces/w1/materials/guide').flush({ ...metadata,id:'guide',audience:'teacher',contentKey:'guide',kind:'doc',document:{title:'Методичка',intro:'',raw:'private source',html:'',sections:[{id:'section-0',title:'Метод',html:'<p>Подсказки</p>',studentParts:parts}]} });
        http.expectOne('/api/v1/workspaces/w1/materials/doc1?audience=student').flush({ ...metadata,kind:'doc',document:{title:'Задания',intro:'',raw:'raw',html:'',sections:[{id:'section-0',title:'Часть',html:'<p>Условие</p>'}]} }); fixture.detectChanges();
        const links=Array.from(element.querySelectorAll('a')).filter(link=>link.textContent?.includes('Открыть часть')); expect(links).toHaveLength(1); expect(links[0].getAttribute('href')).toContain('/student/tasks?preview=student#section-0'); expect(parts).toEqual([0,1,9]);
    });
});

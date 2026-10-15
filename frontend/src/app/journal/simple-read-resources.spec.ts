import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { MovesComponent } from './moves.component';
import { CodeReviewComponent } from '../comments/code-review.component';
import { RoadmapComponent } from '../roadmap/roadmap.component';
import { AccountAccessComponent } from '../students/account-access.component';
import { renderResources } from '../students/domain-test-support';

describe('Parameter-bound reading resources', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
    const root = '/api/v1/workspaces/w1/students';
    function mount<T>(type: Type<T>, inputs: Record<string, unknown>) {
        const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore);
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
        const fixture = TestBed.createComponent(type);
        for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
        fixture.detectChanges();
        return { fixture, http, component: fixture.componentInstance };
    }

    it('ignores an old journal error before rendering new parameters and retries the current page size', async () => {
        const { fixture, http, component } = mount(MovesComponent, { workspaceId: 'w1', studentId: 's1', base: '/teacher/students/s1', size: 8 });
        const old = http.expectOne(root + '/s1/moves?page=0&size=8');
        fixture.componentRef.setInput('studentId', 's2');
        old.flush({}, { status: 500, statusText: 'Old failure' });
        expect(component.error()).toBe('');
        fixture.detectChanges();
        http.expectOne(root + '/s2/moves?page=0&size=8').flush({ items: [], page: 0, size: 8, total: 30 });
        await renderResources();
        expect(component.total()).toBe(30);
        component.more(); fixture.detectChanges();
        http.expectOne(root + '/s2/moves?page=0&size=28').flush({}, { status: 500, statusText: 'Failure' });
        await renderResources();
        expect(component.error()).toBe('Не удалось загрузить ходы.');
        component.reload(); fixture.detectChanges();
        http.expectOne(root + '/s2/moves?page=0&size=28').flush({ items: [], page: 0, size: 28, total: 0 });
        await renderResources();
        expect(component.error()).toBe(''); expect(component.loaded()).toBe(true);
    });

    it('keeps moves while expanding or reloading the same pupil but clears them before rendering another pupil', async () => {
        const { fixture, http, component } = mount(MovesComponent, { workspaceId: 'w1', studentId: 's1', base: '/teacher/students/s1', name: 'First pupil', size: 8 });
        const move = { kind: 'homework', side: 'student', at: '2030-01-01T00:00:00Z', lessonId: 'l1', lessonTitle: 'First lesson', refId: 'h1', subject: 'Old work.java' };
        http.expectOne(root + '/s1/moves?page=0&size=8').flush({ items: [move], page: 0, size: 8, total: 30 });
        await renderResources();
        component.reload(); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Old work.java');
        http.expectOne(root + '/s1/moves?page=0&size=8').flush({ items: [move], page: 0, size: 8, total: 30 });
        await renderResources();
        component.more(); fixture.detectChanges();
        const more = http.expectOne(root + '/s1/moves?page=0&size=28');
        expect(fixture.nativeElement.textContent).toContain('First pupil');
        expect(fixture.nativeElement.textContent).toContain('Old work.java');
        fixture.componentRef.setInput('studentId', 's2');
        fixture.componentRef.setInput('base', '/teacher/students/s2');
        fixture.componentRef.setInput('name', 'Second pupil');
        more.flush({ items: [{ ...move, subject: 'Late old work.java' }], page: 0, size: 28, total: 30 });
        expect(component.items()[0]?.subject).toBe('Old work.java');
        fixture.detectChanges();
        const current = http.expectOne(request => request.url === root + '/s2/moves');
        expect(component.items()).toEqual([]);
        expect(component.total()).toBe(0); expect(component.loaded()).toBe(false); expect(component.limit()).toBe(8);
        expect(fixture.nativeElement.textContent).not.toContain('Old work.java');
        expect(fixture.nativeElement.textContent).not.toContain('Late old work.java');
        expect(fixture.nativeElement.textContent).toContain('Загружаем ходы…');
        expect(current.request.params.get('size')).toBe('8');
        current.flush({ items: [], page: 0, size: 8, total: 0 });
        await renderResources();
    });

    it('never emits comments from the old code target after its input changes', async () => {
        const lesson = { workspaceId: 'w1', studentId: 's1', id: 'l1' };
        const { fixture, http, component } = mount(CodeReviewComponent, { lesson, targetKind: 'homework', targetId: 'h1', files: { 'Main.java': 'class Main {}' } });
        const noted = vi.fn(); component.noted.subscribe(noted);
        const old = http.expectOne(root + '/s1/lessons/l1/code-comments?targetKind=homework&targetId=h1');
        fixture.componentRef.setInput('targetId', 'h2');
        old.flush({ items: [{ id: 'old', targetKind: 'homework', targetId: 'h1', file: 'Main.java', line: 1, body: 'Old comment', variant: '', createdAt: '2030-01-01T00:00:00Z' }] });
        expect(component.comments()).toEqual([]); expect(noted).not.toHaveBeenCalledWith(1);
        fixture.detectChanges();
        http.expectOne(root + '/s1/lessons/l1/code-comments?targetKind=homework&targetId=h2').flush({ items: [] });
        await renderResources();
        expect(component.comments()).toEqual([]); expect(noted).not.toHaveBeenCalledWith(1);
    });

    it('cancels the previous roadmap read on reload without resetting a new draft on a normal render', async () => {
        const { fixture, http, component } = mount(RoadmapComponent, { workspaceId: 'w1', studentId: 's1', editable: true });
        const old = http.expectOne(root + '/s1/roadmap');
        component.reload(); fixture.detectChanges(); expect(old.cancelled).toBe(true);
        http.expectOne(root + '/s1/roadmap').flush({ stages: [{ title: 'Collections', state: 'current', note: '' }], revision: 4 });
        await renderResources();
        component.edit(); component.add(); fixture.detectChanges();
        expect(component.draft()).toHaveLength(2);
        http.expectNone(root + '/s1/roadmap');
    });

    it('does not expose the previous student access response before the card reset runs', async () => {
        const { fixture, http, component } = mount(AccountAccessComponent, { workspaceId: 'w1', studentId: 's1' });
        const old = http.expectOne(root + '/s1/access');
        fixture.componentRef.setInput('studentId', 's2');
        old.flush({ account: null, invitation: { id: 'old-invite', state: 'pending', expiresAt: '2030-01-01T00:00:00Z' } });
        expect(component.data()).toBeNull();
        fixture.detectChanges();
        http.expectOne(root + '/s2/access').flush({ account: null, invitation: null });
        await renderResources();
        expect(component.data()?.invitation).toBeNull();
        component.reload(); fixture.detectChanges();
        http.expectOne(root + '/s2/access').flush({ account: null, invitation: null });
        await renderResources();
        expect(component.data()?.invitation).toBeNull();
    });
});

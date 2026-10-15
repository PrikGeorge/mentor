import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TeachersPageComponent } from '../admin/teachers-page.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { WorkspaceContext } from '../layout/workspace-context';
import { PracticePageComponent } from '../practice/practice-page.component';
import { DashboardComponent } from '../student/dashboard.component';
import { StudentsPageComponent } from './students-page.component';
import { base, lesson, lessonSummary, page, renderResources, student } from './domain-test-support';

describe('Page resource ownership and optional reads', () => {
    let http: HttpTestingController;
    let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let session: SessionStore;

    beforeEach(async () => {
        params = new BehaviorSubject(convertToParamMap({ studentId: 's1', lessonId: 'l1' }));
        const query = new BehaviorSubject(convertToParamMap({}));
        const data = new BehaviorSubject({});
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                provideHttpClient(withInterceptors([sessionInterceptor])),
                provideHttpClientTesting(),
                { provide: ActivatedRoute, useValue: { paramMap: params, queryParamMap: query, data, snapshot: { paramMap: params.value, queryParamMap: query.value, data: {} } } },
            ],
        });
        TestBed.overrideComponent(TeachersPageComponent, { set: { template: '' } });
        TestBed.overrideComponent(PracticePageComponent, { set: { template: '' } });
        TestBed.overrideComponent(DashboardComponent, { set: { template: '' } });
        TestBed.overrideComponent(StudentsPageComponent, { set: { template: '' } });
        await TestBed.compileComponents();
        http = TestBed.inject(HttpTestingController);
        session = TestBed.inject(SessionStore);
        loadSession('TEACHER');
    });
    afterEach(() => {
        // The student list also reads the schedule for the T16 reminder; these tests do not look at it.
        for (const request of http.match(candidate => candidate.url.includes('/schedule'))) if (!request.cancelled) request.flush({ from: '', to: '', items: [] });
        try { http.verify(); } finally { TestBed.resetTestingModule(); }
    });

    function loadSession(role: 'TEACHER' | 'ADMIN', userId = 'owner') {
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId, workspaceId: role === 'ADMIN' ? null : 'w1', role, authVersion: 1 }, csrfToken: 'synthetic',
        });
    }

    it('keeps the dashboard visible while optional panels load and after they fail', async () => {
        const fixture = TestBed.createComponent(DashboardComponent);
        fixture.detectChanges();
        http.expectOne(base + '/dashboard').flush({ student, lessonCount: 1, focus: { lesson: lessonSummary, upcoming: true } });
        await renderResources();
        const turns = http.expectOne(request => request.url.endsWith('/homework/turns'));
        const roadmap = http.expectOne(base + '/roadmap');
        expect(fixture.componentInstance.view()?.student.id).toBe('s1');
        expect(fixture.componentInstance.error()).toBe('');
        expect(TestBed.inject(WorkspaceContext).current()?.student.id).toBe('s1');
        turns.flush({ message: 'Optional turn unavailable' }, { status: 503, statusText: 'Unavailable' });
        roadmap.flush({ message: 'Optional roadmap unavailable' }, { status: 503, statusText: 'Unavailable' });
        await renderResources();
        expect(fixture.componentInstance.view()?.student.id).toBe('s1');
        expect(fixture.componentInstance.error()).toBe('');
        expect(fixture.componentInstance.turn()).toBeNull();
        expect(fixture.componentInstance.stage()).toBeNull();
    });

    it('shows student summaries before turns and cancels the old optional read on pagination', async () => {
        const fixture = TestBed.createComponent(StudentsPageComponent);
        fixture.detectChanges();
        http.expectOne('/api/v1/workspaces/w1/students/dashboards?page=0&size=25').flush(page([{ student, lessonCount: 0, focus: null }], 26));
        await renderResources();
        const turns = http.expectOne(request => request.url.endsWith('/homework/turns'));
        expect(fixture.componentInstance.students().map(value => value.id)).toEqual(['s1']);
        expect(fixture.componentInstance.loading()).toBe(true);
        fixture.componentInstance.page.set(1);
        await renderResources();
        expect(turns.cancelled).toBe(true);
        expect(fixture.componentInstance.students()).toEqual([]);
        http.expectOne('/api/v1/workspaces/w1/students/dashboards?page=1&size=25').flush({ message: 'Page unavailable' }, { status: 503, statusText: 'Unavailable' });
        await renderResources();
        expect(fixture.componentInstance.loading()).toBe(false);
        expect(fixture.componentInstance.error()).toBe('Page unavailable');
        expect(fixture.componentInstance.queue()).toEqual([]);
    });

    it('rejects a previous practice wrapper response before route rendering and clears on logout', async () => {
        const fixture = TestBed.createComponent(PracticePageComponent);
        fixture.detectChanges();
        const oldStudent = http.expectOne(base), oldLesson = http.expectOne(base + '/lessons/l1');
        params.next(convertToParamMap({ studentId: 's1', lessonId: 'l2' }));
        oldStudent.flush(student); oldLesson.flush(lesson);
        await renderResources();
        expect(fixture.componentInstance.lesson()).toBeNull();
        expect(TestBed.inject(WorkspaceContext).current()).toBeNull();
        http.expectOne(base).flush(student);
        http.expectOne(base + '/lessons/l2').flush({ ...lesson, id: 'l2', title: 'Current lesson' });
        await renderResources();
        expect(fixture.componentInstance.lesson()?.id).toBe('l2');
        expect(TestBed.inject(WorkspaceContext).current()?.lesson?.id).toBe('l2');
        session.invalidate();
        await renderResources();
        expect(fixture.componentInstance.lesson()).toBeNull();
        expect(TestBed.inject(WorkspaceContext).current()).toBeNull();
    });

    it('does not adopt another admin generation in an already mounted page', async () => {
        loadSession('ADMIN');
        const fixture = TestBed.createComponent(TeachersPageComponent);
        fixture.detectChanges();
        http.expectOne('/api/v1/admin/teachers?page=0&size=25').flush(page([{ userId: 't1', login: 'old-teacher', workspaceId: 'w1', accountDisabled: false, workspaceDisabled: false }]));
        http.expectOne('/api/v1/admin/teacher-invitations?page=0&size=25').flush(page([]));
        await renderResources();
        expect(fixture.componentInstance.teachers()).toHaveLength(1);
        loadSession('ADMIN', 'new-admin');
        fixture.componentInstance.invite();
        await renderResources();
        expect(fixture.componentInstance.teachers()).toEqual([]);
        expect(fixture.componentInstance.teacherTotal()).toBe(0);
        http.expectNone(request => request.url.startsWith('/api/v1/admin/'));
    });

    it('clears an admin read error after reload without clearing a mutation error', async () => {
        loadSession('ADMIN');
        const fixture = TestBed.createComponent(TeachersPageComponent);
        fixture.detectChanges();
        const teachers = http.expectOne('/api/v1/admin/teachers?page=0&size=25');
        const invitations = http.expectOne('/api/v1/admin/teacher-invitations?page=0&size=25');
        teachers.flush({ message: 'List unavailable' }, { status: 503, statusText: 'Unavailable' });
        await renderResources();
        expect(invitations.cancelled).toBe(true);
        expect(fixture.componentInstance.error()).toBe('List unavailable');
        fixture.componentInstance.teacherPage.set(1);
        fixture.detectChanges();
        expect(fixture.componentInstance.error()).toBe('');
        http.expectOne('/api/v1/admin/teachers?page=1&size=25').flush(page([]));
        http.expectOne('/api/v1/admin/teacher-invitations?page=0&size=25').flush(page([]));
        await renderResources();
        expect(fixture.componentInstance.error()).toBe('');
        fixture.componentInstance.invite();
        http.expectOne('/api/v1/admin/teacher-invitations').flush({ message: 'Invitation denied' }, { status: 409, statusText: 'Conflict' });
        fixture.componentInstance.invitationPage.set(1);
        fixture.detectChanges();
        http.expectOne('/api/v1/admin/teachers?page=1&size=25').flush(page([]));
        http.expectOne('/api/v1/admin/teacher-invitations?page=1&size=25').flush(page([]));
        await renderResources();
        expect(fixture.componentInstance.error()).toBe('Invitation denied');
    });
});

import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { LessonFormComponent } from '../lessons/lesson-form.component';
import { StudentFormComponent } from './student-form.component';
import { AccountAccessComponent } from './account-access.component';
import { RoadmapComponent } from '../roadmap/roadmap.component';
import { lesson, student } from './domain-test-support';

describe('Editors bound to one card and revision', () => {
    beforeEach(() =>
        TestBed.configureTestingModule({
            imports: [LessonFormComponent, StudentFormComponent, AccountAccessComponent, RoadmapComponent],
            providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
        })
    );
    afterEach(() => {
        TestBed.inject(HttpTestingController).verify();
        TestBed.resetTestingModule();
    });
    function mount<T>(type: Type<T>, inputs: Record<string, unknown>) {
        const http = TestBed.inject(HttpTestingController),
            session = TestBed.inject(SessionStore);
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 },
            csrfToken: 'synthetic',
        });
        const fixture = TestBed.createComponent(type);
        for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
        fixture.detectChanges();
        return { fixture, http, component: fixture.componentInstance };
    }
    const root = '/api/v1/workspaces/w1/students';

    it('does not send old lesson values to a new lesson before its reset effect runs', () => {
        const { fixture, http, component } = mount(LessonFormComponent, { workspaceId: 'w1', studentId: 's1', lesson });
        component.form.controls.title.setValue('Old draft');
        fixture.componentRef.setInput('lesson', { ...lesson, id: 'l2', title: 'Second lesson', revision: 7 });
        component.save(new Event('submit'));
        http.expectNone((request) => request.method === 'PATCH');
        fixture.detectChanges();
        component.save(new Event('submit'));
        const request = http.expectOne(root + '/s1/lessons/l2');
        expect(request.request.body).toMatchObject({ title: 'Second lesson', revision: 7 });
        request.flush({ ...lesson, id: 'l2', title: 'Second lesson', revision: 8 });
    });

    it('drops the previous card error before reset and cancels a request when the card is rebound', () => {
        const { fixture, http, component } = mount(StudentFormComponent, { workspaceId: 'w1', student });
        component.save(new Event('submit'));
        const old = http.expectOne(root + '/s1');
        fixture.componentRef.setInput('student', { ...student, id: 's2', name: 'Second pupil' });
        old.flush({ message: 'Old card conflict' }, { status: 409, statusText: 'Conflict' });
        expect(component.error()).toBe('');
        fixture.detectChanges();
        expect(component.form.controls.name.value).toBe('Second pupil');
        component.save(new Event('submit'));
        const pending = http.expectOne(root + '/s2');
        fixture.componentRef.setInput('student', student);
        fixture.detectChanges();
        expect(pending.cancelled).toBe(true);
        expect(component.busy()).toBe(false);
    });

    it('does not issue a link or reload another card from an invitation that finishes before reset', () => {
        const { fixture, http, component } = mount(AccountAccessComponent, { workspaceId: 'w1', studentId: 's1' });
        http.expectOne(root + '/s1/access').flush({ account: null, invitation: null });
        component.invite();
        const invitation = http.expectOne(root + '/s1/invitations');
        fixture.componentRef.setInput('studentId', 's2');
        invitation.flush({ id: 'i1', link: '/register?token=old-card', expiresAt: '2030-01-01T00:00:00Z' });
        expect(component.issued()).toBeNull();
        http.expectNone(root + '/s2/access');
        fixture.detectChanges();
        http.expectOne(root + '/s2/access').flush({ account: null, invitation: null });
        expect(component.busy()).toBe(false);
    });

    it('blocks an old access panel action before its student reset', () => {
        const { fixture, http, component } = mount(AccountAccessComponent, { workspaceId: 'w1', studentId: 's1' });
        http.expectOne(root + '/s1/access').flush({ account: null, invitation: null });
        fixture.componentRef.setInput('studentId', 's2');
        component.invite();
        http.expectNone((request) => request.method === 'POST');
        fixture.detectChanges();
        http.expectOne(root + '/s2/access').flush({ account: null, invitation: null });
    });

    it('drops an old roadmap save before reset and prevents sending its draft to the next pupil', () => {
        const { fixture, http, component } = mount(RoadmapComponent, { workspaceId: 'w1', studentId: 's1', editable: true });
        const roadmap = { stages: [{ title: 'Collections', state: 'current', note: '' }], revision: 3 };
        http.expectOne(root + '/s1/roadmap').flush(roadmap);
        component.edit();
        fixture.componentRef.setInput('studentId', 's2');
        component.save(new Event('submit'));
        http.expectNone((request) => request.method === 'PUT');
        fixture.detectChanges();
        http.expectOne(root + '/s2/roadmap').flush({ ...roadmap, revision: 8 });
        component.edit();
        component.save(new Event('submit'));
        const pending = http.expectOne(root + '/s2/roadmap');
        fixture.componentRef.setInput('studentId', 's1');
        pending.flush({ ...roadmap, revision: 9 });
        expect(component.view()?.revision).toBe(8);
        fixture.detectChanges();
        http.expectOne(root + '/s1/roadmap').flush(roadmap);
        expect(component.draft()).toBeNull();
        expect(component.busy()).toBe(false);
    });
});

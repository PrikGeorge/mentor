import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { StudentFormComponent } from './student-form.component';
import { renderResources, student } from './domain-test-support';

describe('Student form validation and creation', () => {
    beforeEach(() =>
        TestBed.configureTestingModule({
            imports: [StudentFormComponent],
            providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
        })
    );
    afterEach(() => {
        TestBed.inject(HttpTestingController).verify();
        TestBed.resetTestingModule();
    });

    function mount(role: 'TEACHER' | 'STUDENT' | 'ADMIN' = 'TEACHER', actorWorkspace: string | null = 'w1', existing = false) {
        const http = TestBed.inject(HttpTestingController);
        TestBed.inject(SessionStore).load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'synthetic-account', workspaceId: actorWorkspace, role, authVersion: 1 },
            csrfToken: 'synthetic',
        });
        const fixture = TestBed.createComponent(StudentFormComponent);
        fixture.componentRef.setInput('workspaceId', 'w1');
        if (existing) fixture.componentRef.setInput('student', { ...student, studentReview: 'Earlier feedback' });
        fixture.detectChanges();
        return { fixture, http, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
    }

    it('rejects empty and whitespace-only names with an inline error and focuses the field', async () => {
        const { fixture, http, component, element } = mount();
        const name = element.querySelector<HTMLInputElement>('[name="name"]')!;
        expect(element.querySelector('#student-name-error')).toBeNull();
        for (const invalid of ['', '  \t  ']) {
            component.form.controls.name.setValue(invalid);
            const event = new Event('submit', { cancelable: true });
            element.querySelector('form')!.dispatchEvent(event);
            await renderResources();
            expect(event.defaultPrevented).toBe(true);
            http.expectNone((request) => request.method === 'POST' || request.method === 'PATCH');
            expect(name.getAttribute('aria-invalid')).toBe('true');
            expect(name.getAttribute('aria-describedby')).toBe('student-name-error');
            expect(element.querySelector('#student-name-error')?.textContent).toBe('Введите имя.');
            expect(document.activeElement).toBe(name);
        }
        component.form.controls.name.setValue('Анна');
        fixture.detectChanges();
        expect(name.getAttribute('aria-invalid')).toBeNull();
        expect(element.querySelector('#student-name-error')).toBeNull();
    });

    it('enforces every text limit locally, including the editable archived feedback', async () => {
        const { fixture, http, component, element } = mount('TEACHER', 'w1', true);
        const limits = { name: 120, direction: 120, goal: 1000, schedule: 500, notes: 5000, studentRoadmap: 20000, studentReview: 20000 };
        for (const [field, limit] of Object.entries(limits)) component.form.controls[field as keyof typeof limits].setValue('x'.repeat(limit + 1));
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        await renderResources();
        http.expectNone((request) => request.method === 'POST' || request.method === 'PATCH');
        for (const [field, limit] of Object.entries(limits)) {
            const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`)!;
            expect(input.getAttribute('maxlength')).toBe(String(limit));
            expect(input.getAttribute('aria-invalid')).toBe('true');
            expect(input.closest('label')?.querySelector('.error')?.textContent).toContain('Не больше');
            component.form.controls[field as keyof typeof limits].setValue('x'.repeat(limit));
        }
        expect(document.activeElement).toBe(element.querySelector('[name="name"]'));
        fixture.detectChanges();
        expect(component.form.valid).toBe(true);
        expect(element.querySelector('[aria-invalid="true"]')).toBeNull();
    });

    it('posts exactly the new-card fields once while busy and emits the created card once', () => {
        const { fixture, http, component, element } = mount();
        const input = {
            name: 'Тестовый ученик',
            direction: 'Java Backend',
            goal: 'Освоить коллекции',
            schedule: 'Вт, 19:00 МСК',
            notes: '  Частная заметка\nВторая строка  ',
            studentRoadmap: '  План ученика\nСледующий этап  ',
            studentReview: '',
        };
        component.form.setValue(input);
        const saved = vi.fn();
        component.saved.subscribe(saved);
        component.save(new Event('submit'));
        component.save(new Event('submit'));
        fixture.detectChanges();
        const request = http.expectOne('/api/v1/workspaces/w1/students');
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual(input);
        expect(request.request.body).not.toHaveProperty('revision');
        expect(component.busy()).toBe(true);
        expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
        expect(saved).not.toHaveBeenCalled();
        const created = { ...student, ...input, id: 'created-student', revision: 1 };
        request.flush(created, { status: 201, statusText: 'Created' });
        fixture.detectChanges();
        expect(saved).toHaveBeenCalledExactlyOnceWith(created);
        expect(component.busy()).toBe(false);
        expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    });

    for (const actor of [
        { role: 'STUDENT' as const, workspace: 'w1' },
        { role: 'ADMIN' as const, workspace: null },
        { role: 'TEACHER' as const, workspace: 'w2' },
    ]) {
        it(`does not create a card for ${actor.role} in workspace ${actor.workspace}`, () => {
            const { http, component } = mount(actor.role, actor.workspace);
            component.form.controls.name.setValue('Valid name');
            component.save(new Event('submit'));
            http.expectNone((request) => request.url.startsWith('/api/v1/workspaces/'));
            expect(component.busy()).toBe(false);
        });
    }
});

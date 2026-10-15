import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { AccountAccessComponent } from './account-access.component';
import { renderResources } from './domain-test-support';

describe('Student account access boundaries', () => {
    const root = '/api/v1/workspaces/w1/students/s1';
    beforeEach(() =>
        TestBed.configureTestingModule({
            imports: [AccountAccessComponent],
            providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
        })
    );
    afterEach(() => {
        TestBed.inject(HttpTestingController).verify();
        TestBed.resetTestingModule();
    });

    function mount(role: 'TEACHER' | 'STUDENT' | 'ADMIN' = 'TEACHER', actorWorkspace: string | null = 'w1') {
        const http = TestBed.inject(HttpTestingController);
        TestBed.inject(SessionStore).load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'synthetic-account', workspaceId: actorWorkspace, role, authVersion: 1 },
            csrfToken: 'synthetic',
        });
        const fixture = TestBed.createComponent(AccountAccessComponent);
        fixture.componentRef.setInput('workspaceId', 'w1');
        fixture.componentRef.setInput('studentId', 's1');
        fixture.detectChanges();
        return { fixture, http, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
    }

    for (const link of ['https://elsewhere.example/register?token=synthetic', '/teacher/students?token=synthetic']) {
        it(`rejects an issued link with an unsafe origin or path: ${link}`, async () => {
            const { fixture, http, component, element } = mount();
            http.expectOne(root + '/access').flush({ account: null, invitation: null });
            await renderResources();
            component.invite();
            http.expectOne(root + '/invitations').flush({ id: 'i1', link, expiresAt: '2030-01-01T00:00:00Z' });
            fixture.detectChanges();
            http.expectNone(root + '/access');
            expect(component.issued()).toBeNull();
            expect(component.busy()).toBe(false);
            expect(element.querySelector('[name="accessLink"]')).toBeNull();
            expect(element.textContent).not.toContain(link);
            expect(element.querySelector('[role="alert"]')?.textContent).toContain('Не удалось изменить доступ.');
        });
    }

    it('requires the current password locally and moves focus into and back out of the confirmation', async () => {
        const { http, component, element } = mount();
        http.expectOne(root + '/access').flush({ account: { userId: 'p1', login: 'synthetic-pupil', disabled: false }, invitation: null });
        await renderResources();
        const trigger = element.querySelector<HTMLButtonElement>('.reset-link')!;
        trigger.click();
        await renderResources();
        const password = element.querySelector<HTMLInputElement>('[name="currentPassword"]')!;
        expect(document.activeElement).toBe(password);
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        await renderResources();
        http.expectNone((request) => request.method === 'POST');
        expect(password.getAttribute('aria-invalid')).toBe('true');
        expect(password.getAttribute('aria-describedby')).toContain('access-password-error');
        expect(element.querySelector('#access-password-error')?.textContent).toBe('Введите текущий пароль.');
        expect(document.activeElement).toBe(password);
        component.closeReset();
        await renderResources();
        expect(element.querySelector('[name="currentPassword"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(component.password.value).toBe('');
        expect(component.passwordMissing()).toBe(false);
    });

    for (const actor of [
        { role: 'STUDENT' as const, workspace: 'w1' },
        { role: 'ADMIN' as const, workspace: null },
        { role: 'TEACHER' as const, workspace: 'w2' },
    ]) {
        it(`does not read or change access for ${actor.role} in workspace ${actor.workspace}`, () => {
            const { http, component } = mount(actor.role, actor.workspace);
            component.invite();
            component.password.setValue('synthetic-current-password');
            component.reset(new Event('submit'));
            http.expectNone((request) => request.url.startsWith('/api/v1/workspaces/'));
            expect(component.issued()).toBeNull();
            expect(component.busy()).toBe(false);
        });
    }

    it('ignores clipboard completion from the previous pupil while current-pupil copying still works', async () => {
        const { fixture, http, component } = mount();
        http.expectOne(root + '/access').flush({ account: null, invitation: null });
        await renderResources();
        let finishOldCopy!: () => void;
        const writeText = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        finishOldCopy = resolve;
                    })
            )
            .mockResolvedValue(undefined);
        const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            const oldLink = location.origin + '/register?token=synthetic-old';
            component.copy(oldLink);
            fixture.componentRef.setInput('studentId', 's2');
            finishOldCopy();
            await Promise.resolve();
            expect(component.copied()).toBe(false);
            fixture.detectChanges();
            http.expectOne('/api/v1/workspaces/w1/students/s2/access').flush({ account: null, invitation: null });
            await renderResources();
            const currentLink = location.origin + '/register?token=synthetic-current';
            component.copy(currentLink);
            await Promise.resolve();
            expect(component.copied()).toBe(true);
            expect(writeText.mock.calls).toEqual([[oldLink], [currentLink]]);
        } finally {
            if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
            else Reflect.deleteProperty(navigator, 'clipboard');
        }
    });
});

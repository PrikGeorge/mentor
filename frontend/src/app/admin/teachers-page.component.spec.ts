import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TeachersPageComponent } from './teachers-page.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
const teacher = { userId: 't1', login: 'synthetic-teacher', workspaceId: 'w1', accountDisabled: false, workspaceDisabled: false };
describe('Administrator account controls', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TeachersPageComponent], providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'a1', workspaceId: null, role: 'ADMIN', authVersion: 1 }, csrfToken: 'synthetic-csrf' });
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });
  function open(view = teacher) {
    const fixture = TestBed.createComponent(TeachersPageComponent); fixture.detectChanges();
    http.expectOne('/api/v1/admin/teachers?page=0&size=25').flush({ items: [view], page: 0, size: 25, total: 1 });
    http.expectOne('/api/v1/admin/teacher-invitations?page=0&size=25').flush({ items: [{ id: 'i1', state: 'pending', expiresAt: '2026-10-04T10:00:00Z', createdAt: '2026-10-01T10:00:00Z' }], page: 0, size: 25, total: 1 });
    fixture.detectChanges(); return fixture;
  }
  it('shows issued invitation only for manual transfer and supports revoke', () => {
    const fixture = open();
    fixture.nativeElement.querySelector('[data-action="invite"]').click();
    const issued = http.expectOne('/api/v1/admin/teacher-invitations');
    expect(issued.request.body).toEqual({});
    issued.flush({ id: 'i2', link: '/register?token=synthetic', expiresAt: '2026-10-04T10:00:00Z' });
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('[name="issuedLink"]') as HTMLInputElement).value).toContain('/register?token=synthetic');
    http.match(request => request.method === 'GET').forEach(request => request.flush({ items: request.request.url.endsWith('teacher-invitations') ? [{ id: 'i1', state: 'pending', expiresAt: '2026-10-04T10:00:00Z', createdAt: '2026-10-01T10:00:00Z' }] : [], page: 0, size: 25, total: 1 }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-action="revoke"]').click();
    http.expectOne('/api/v1/admin/teacher-invitations/i1').flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    http.match(request => request.method === 'GET').forEach(request => request.flush({ items: request.request.url.endsWith('teacher-invitations') ? [{ id: 'i1', state: 'pending', expiresAt: '2026-10-04T10:00:00Z', createdAt: '2026-10-01T10:00:00Z' }] : [], page: 0, size: 25, total: 1 }));
  });
  it('blocks teacher and workspace independently using their server identifiers', () => {
    const fixture = open();
    fixture.nativeElement.querySelector('[data-action="teacher-access"]').click();
    const account = http.expectOne('/api/v1/admin/teachers/t1/access');
    expect(account.request.body).toEqual({ disabled: true });
    account.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    http.match(request => request.method === 'GET').forEach(request => request.flush({ items: request.request.url.endsWith('teachers') ? [teacher] : [], page: 0, size: 25, total: 1 }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-action="workspace-access"]').click();
    const workspace = http.expectOne('/api/v1/admin/workspaces/w1/access');
    expect(workspace.request.body).toEqual({ disabled: true });
    workspace.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges(); http.match(request => request.method === 'GET').forEach(request => request.flush({ items: request.request.url.endsWith('teacher-invitations') ? [{ id: 'i1', state: 'pending', expiresAt: '2026-10-04T10:00:00Z', createdAt: '2026-10-01T10:00:00Z' }] : [], page: 0, size: 25, total: 1 }));
  });
  it('requires current password before issuing a teacher reset link', () => {
    const fixture = open();
    fixture.nativeElement.querySelector('[data-action="reset"]').click(); fixture.detectChanges();
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit')); http.expectNone('/api/v1/admin/teachers/t1/password-reset');
    const password: HTMLInputElement = fixture.nativeElement.querySelector('[name="currentPassword"]');
    password.value = '  synthetic current  '; password.dispatchEvent(new Event('input')); form.dispatchEvent(new Event('submit'));
    const issue = http.expectOne('/api/v1/admin/teachers/t1/password-reset');
    expect(issue.request.body).toEqual({ currentPassword: '  synthetic current  ' });
    issue.flush({ link: '/reset-password?token=synthetic', expiresAt: '2026-10-01T10:30:00Z' }); fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('[name="issuedLink"]') as HTMLInputElement).value).toContain('/reset-password?token=synthetic');
    expect(fixture.nativeElement.querySelector('[name="currentPassword"]')).toBeNull();
  });
  it('restores a paused teacher account', () => {
    const fixture = open({ ...teacher, accountDisabled: true });
    fixture.nativeElement.querySelector('[data-action="teacher-access"]').click();
    const request = http.expectOne('/api/v1/admin/teachers/t1/access'); expect(request.request.body).toEqual({ disabled: false });
    request.flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
    http.match(request => request.method === 'GET').forEach(request => request.flush({ items: [], page: 0, size: 25, total: 0 }));
  });
  it('restores a paused workspace', () => {
    const fixture = open({ ...teacher, workspaceDisabled: true });
    fixture.nativeElement.querySelector('[data-action="workspace-access"]').click();
    const request = http.expectOne('/api/v1/admin/workspaces/w1/access'); expect(request.request.body).toEqual({ disabled: false });
    request.flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
    http.match(request => request.method === 'GET').forEach(request => request.flush({ items: [], page: 0, size: 25, total: 0 }));
  });
});

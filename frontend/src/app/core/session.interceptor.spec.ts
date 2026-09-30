import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SessionStore } from './session.store';
import { safeReturnUrl, sessionInterceptor } from './session.interceptor';
@Component({ template: '' }) class EmptyComponent {}
const first = { userId: 'first', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 };
const second = { userId: 'second', workspaceId: 'w2', role: 'TEACHER', authVersion: 1 };
describe('session HTTP boundary', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let session: SessionStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting(),
      provideRouter([{ path: 'teacher/students', component: EmptyComponent }, { path: 'login', component: EmptyComponent }]),
    ] });
    http = TestBed.inject(HttpTestingController); client = TestBed.inject(HttpClient); session = TestBed.inject(SessionStore);
    session.load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
  });
  afterEach(() => http.verify());
  it('uses the current CSRF and expected account on mutations', () => {
    client.patch('/api/v1/workspaces/w1/students/s1', { name: 'Synthetic' }).subscribe();
    const request = http.expectOne('/api/v1/workspaces/w1/students/s1');
    expect(request.request.headers.get('X-CSRF-TOKEN')).toBe('synthetic-first');
    expect(request.request.headers.get('X-Mentor-Account')).toBe('first');
    expect(request.request.headers.get('X-Mentor-Client')).toBe('web');
    expect(request.request.headers.has('Cookie')).toBe(false);
    request.flush({});
  });
  it('F401: preserves local returnUrl and never replays an expired POST after signing in', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/teacher/students');
    client.post('/api/v1/workspaces/w1/students', { name: 'One write' }).subscribe({ error: () => {} });
    http.expectOne('/api/v1/workspaces/w1/students').flush({}, { status: 401, statusText: 'Unauthorized' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.actor()).toBeNull();
    expect(router.url).toBe('/login?returnUrl=%2Fteacher%2Fstudents');
    const signedIn = firstValueFrom(session.signIn('second', 'synthetic-password'));
    http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic-after-expiry' });
    const request = http.expectOne('/api/v1/auth/login');
    expect(request.request.headers.get('X-CSRF-TOKEN')).toBe('synthetic-after-expiry');
    expect(request.request.headers.has('X-Mentor-Account')).toBe(false);
    request.flush({ account: second, csrfToken: 'synthetic-second' });
    http.expectOne('/api/v1/auth/session').flush({ account: second, csrfToken: 'synthetic-second' });
    await signedIn;
    http.expectNone('/api/v1/workspaces/w1/students');
  });
  it('cancels old private reads and clears their rendered data when the account changes', () => {
    const rendered = TestBed.createComponent(PrivateView);
    rendered.detectChanges();
    client.get<{ note: string }>('/api/v1/workspaces/w1/private').subscribe(view => rendered.componentInstance.note = view.note);
    const late = http.expectOne('/api/v1/workspaces/w1/private');
    session.signIn('second', 'synthetic-password').subscribe();
    expect(late.cancelled).toBe(true);
    http.expectOne('/api/v1/auth/login').flush({ account: second, csrfToken: 'synthetic-second' });
    http.expectOne('/api/v1/auth/session').flush({ account: second, csrfToken: 'synthetic-second' });
    rendered.detectChanges();
    expect(session.actor()?.userId).toBe('second');
    expect(rendered.nativeElement.textContent).not.toContain('first-private');
  });
  it('rotates the CSRF after logout and sends the previous account only on logout', () => {
    session.signOut().subscribe();
    const logout = http.expectOne('/api/v1/auth/logout');
    expect(logout.request.headers.get('X-Mentor-Account')).toBe('first');
    logout.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic-anonymous' });
    expect(session.actor()).toBeNull();
    expect(session.csrfToken()).toBe('synthetic-anonymous');
  });
});
@Component({ template: '{{ session.actor()?.userId === "first" ? note : "" }}' })
class PrivateView { readonly session = TestBed.inject(SessionStore); note = 'first-private'; }
describe('safe return URL', () => {
  for (const value of ['https://example.test', '//example.test', '/\\example.test', '/%2f%2fexample.test', '/%5cexample.test', '/bad%']) {
    it(`rejects ${value}`, () => expect(safeReturnUrl(value)).toBeNull());
  }
  it('retains a local path with query and fragment', () => expect(safeReturnUrl('/learn?a=1#section-0')).toBe('/learn?a=1#section-0'));
});

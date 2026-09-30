import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ShellComponent } from './shell.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { routes } from '../app.routes';
describe('Shell identity transitions', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ShellComponent], providers: [provideRouter(routes), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
  for (const path of ['/not-found', '/unknown/synthetic-page']) {
    it(`shows the public error heading and recovery link to an anonymous visitor at ${path}`, async () => {
      const session = TestBed.inject(SessionStore), http = TestBed.inject(HttpTestingController), router = TestBed.inject(Router);
      session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic' });
      const fixture = TestBed.createComponent(ShellComponent); fixture.detectChanges();
      await router.navigateByUrl(path); fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const heading = element.querySelector('h1');
      const recovery = element.querySelector<HTMLAnchorElement>('main a');
      expect(heading?.textContent).toBe('Страница не найдена');
      expect(recovery?.textContent).toBe('В кабинет');
      expect(heading?.closest('[hidden]')).toBeNull();
      expect(recovery?.closest('[hidden]')).toBeNull();
    });
  }
  it('still hides a private routed view immediately when its actor disappears', async () => {
    const session = TestBed.inject(SessionStore), http = TestBed.inject(HttpTestingController), router = TestBed.inject(Router);
    session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
    const fixture = TestBed.createComponent(ShellComponent); fixture.detectChanges();
    await router.navigateByUrl('/teacher/students'); fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h1')?.closest('[hidden]')).toBeNull();
    session.invalidate(); fixture.detectChanges();
    expect(element.querySelector('h1')?.closest('[hidden]')).not.toBeNull();
  });
  it('keeps the submitted login alive across the account generation change', async () => {
    const session = TestBed.inject(SessionStore), http = TestBed.inject(HttpTestingController), router = TestBed.inject(Router);
    session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic' });
    const fixture = TestBed.createComponent(ShellComponent); fixture.detectChanges();
    await router.navigateByUrl('/login'); fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const login = element.querySelector<HTMLInputElement>('[name="login"]')!;
    const password = element.querySelector<HTMLInputElement>('[name="password"]')!;
    login.value = 'synthetic'; login.dispatchEvent(new Event('input'));
    password.value = 'synthetic-password'; password.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit')); fixture.detectChanges();
    const request = http.expectOne('/api/v1/auth/login');
    expect(request.cancelled).toBe(false);
    request.flush({ account: { userId: 'synthetic', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic-rotated' });
    fixture.detectChanges();
    const refresh = http.expectOne('/api/v1/auth/session');
    expect(refresh.cancelled).toBe(false);
    refresh.flush({ account: session.actor(), csrfToken: 'synthetic-rotated' });
    await fixture.whenStable(); fixture.detectChanges();
    expect(router.url).toBe('/teacher/students');
    expect(element.textContent).toContain('Мои ученики');
  });
});

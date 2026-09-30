import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthPageComponent } from './auth-page.component';
import { routes } from '../app.routes';
describe('AuthPage routes', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('submits the entered password without trimming', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login', AuthPageComponent);
    const element = harness.routeNativeElement!;
    const login = element.querySelector<HTMLInputElement>('input[name="login"]')!;
    const password = element.querySelector<HTMLInputElement>('input[name="password"]')!;
    expect(login).not.toBeNull();
    login.value = 'second'; login.dispatchEvent(new Event('input'));
    password.value = '  exact password  '; password.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const http = TestBed.inject(HttpTestingController);
    // The anonymous token is fetched before the first auth mutation.
    const session = http.match('/api/v1/auth/session');
    for (const request of session) request.flush({ account: null, csrfToken: 'synthetic-anonymous' });
    const request = http.expectOne('/api/v1/auth/login');
    expect(request.request.body.password).toBe('  exact password  ');
    request.flush({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Неверные данные', fieldErrors: {}, requestId: 'synthetic' }, { status: 401, statusText: 'Unauthorized' });
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
  });
  for (const [path, heading] of [['/register?token=synthetic', 'Приглашение'], ['/reset-password?token=synthetic', 'Восстановление пароля']]) {
    it(`renders ${path} using its route mode`, async () => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(path, AuthPageComponent);
      expect(harness.routeNativeElement!.textContent).toContain(heading);
      expect(harness.routeNativeElement!.querySelector('input[name="password"]')).not.toBeNull();
    });
  }
});

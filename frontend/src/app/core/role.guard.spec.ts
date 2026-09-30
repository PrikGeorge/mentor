import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { routes } from '../app.routes';
import { SessionStore } from './session.store';
describe('role navigation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
  for (const [role, path] of [['ADMIN', '/teacher/students'], ['ADMIN', '/learn'], ['STUDENT', '/teacher/students'], ['TEACHER', '/admin/teachers']]) {
    it(`denies ${role} navigation into ${path}`, async () => {
      TestBed.inject(SessionStore).load().subscribe();
      TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic', workspaceId: role === 'ADMIN' ? null : 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
      const harness = await RouterTestingHarness.create(); await harness.navigateByUrl(path);
      expect(TestBed.inject(Router).url).toBe('/not-found');
      TestBed.inject(HttpTestingController).match(() => true).forEach(request => request.flush({ items: [], page: 0, size: 25, total: 0 }));
    });
  }
  it('retains returnUrl for an unauthenticated private path', async () => {
    TestBed.inject(SessionStore).load().subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic' });
    const harness = await RouterTestingHarness.create(); await harness.navigateByUrl('/teacher/students/s1?preview=student#section-0');
    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fteacher%2Fstudents%2Fs1%3Fpreview%3Dstudent%23section-0');
  });
});

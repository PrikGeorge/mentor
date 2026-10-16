import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ShellComponent } from './shell.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { routes } from '../app.routes';
import { lesson, renderResources, student } from '../students/domain-test-support';
import { Motion } from '../core/motion';
import { WorkspaceContext } from './workspace-context';
describe('Shell identity transitions', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ShellComponent], providers: [provideRouter(routes), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
  for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as const) {
    it(`uses ${role} footer copy before selected profile data loads`, () => {
      const session = TestBed.inject(SessionStore), http = TestBed.inject(HttpTestingController);
      session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic', workspaceId: role === 'ADMIN' ? null : 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
      const fixture = TestBed.createComponent(ShellComponent); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('footer').textContent).toContain(role === 'STUDENT' ? 'Кабинет ученика' : role === 'ADMIN' ? 'Администрирование' : 'Кабинет наставника');
    });
  }
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
    http.expectOne('/api/v1/workspaces/w1/students/dashboards?page=0&size=25').flush({items:[],page:0,size:25,total:0});fixture.detectChanges();
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
    const navigation = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd)));
    refresh.flush({ account: session.actor(), csrfToken: 'synthetic-rotated' });
    await navigation; fixture.detectChanges();
    http.expectOne('/api/v1/workspaces/w1/students/dashboards?page=0&size=25').flush({items:[],page:0,size:25,total:0});fixture.detectChanges();
    await renderResources(); fixture.detectChanges();
    expect(router.url).toBe('/teacher/students');
    expect(element.textContent).toContain('Мои ученики');
  });
});

describe('Shell lesson stamp (UX-28 M8)', () => {
  const animate = vi.fn((..._: unknown[]) => null);
  beforeEach(() => {
    animate.mockClear();
    TestBed.configureTestingModule({ imports: [ShellComponent], providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting(), { provide: Motion, useValue: { reduced: () => false, animate } }] });
    TestBed.inject(SessionStore).load().subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' });
  });
  afterEach(() => TestBed.resetTestingModule());
  const owner = {};
  function show(id: string, conductedAt?: string) {
    TestBed.inject(WorkspaceContext).set(owner, { student, lesson: { ...lesson, id, ...(conductedAt ? { conductedAt } : {}) }, base: '/teacher/students/' + student.id, preview: false, page: '', learner: false });
  }
  function render() {
    const fixture = TestBed.createComponent(ShellComponent);
    const tick = () => { fixture.detectChanges(); TestBed.tick(); };
    return { fixture, tick, stamps: () => animate.mock.calls.filter((call) => (call[0] as Element | null)?.classList.contains('lesson-tag')).length };
  }
  it('stamps the tag once when the shown lesson is marked held, never on first show', () => {
    const { tick, stamps } = render();
    show('l1', '2026-10-15T16:00:00Z');
    tick();
    expect(stamps()).toBe(0);
    show('l2');
    tick();
    show('l2', '2026-10-16T16:00:00Z');
    tick();
    expect(stamps()).toBe(1);
  });
  it('does not stamp another lesson that is already held or after an account change', () => {
    const { tick, stamps } = render();
    show('l1');
    tick();
    show('l3', '2026-10-15T16:00:00Z');
    tick();
    expect(stamps()).toBe(0);
    show('l4');
    tick();
    TestBed.inject(SessionStore).invalidate();
    show('l4', '2026-10-16T16:00:00Z');
    tick();
    expect(stamps()).toBe(0);
  });
});

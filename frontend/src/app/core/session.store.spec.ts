import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Actor, SessionStore } from './session.store';

const first: Actor = { userId: 'first', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 };
const second: Actor = { userId: 'second', workspaceId: 'w2', role: 'TEACHER', authVersion: 1 };

describe('SessionStore', () => {
  let store: SessionStore;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    store = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('signs out and forgets only the local trainer copies of that account', () => {
    const draft = (account: string) => JSON.stringify(['mentor.practice.source.v1', account, 'w1', 's1', 'l1', 'e1', ['number', 1]]);
    localStorage.setItem(draft('first'), JSON.stringify({ files: { 'A.java': 'unsaved' }, savedAt: Date.now() }));
    localStorage.setItem(draft('second'), JSON.stringify({ files: { 'B.java': 'other' }, savedAt: Date.now() }));
    try {
      store.load().subscribe();
      http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
      store.signOut().subscribe();
      expect(localStorage.getItem(draft('first'))).not.toBeNull();
      http.expectOne('/api/v1/auth/logout').flush({ account: null, csrfToken: 'synthetic-anonymous' });
      http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic-anonymous' });
      expect(store.actor()).toBeNull();
      expect(localStorage.getItem(draft('first'))).toBeNull();
      expect(localStorage.getItem(draft('second'))).not.toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it('keeps the local copies when sign-out fails and when the session merely expires', () => {
    const draft = JSON.stringify(['mentor.practice.source.v1', 'first', 'w1', 's1', 'l1', 'e1', ['number', 1]]);
    localStorage.setItem(draft, JSON.stringify({ files: { 'A.java': 'unsaved' }, savedAt: Date.now() }));
    try {
      store.load().subscribe();
      http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
      store.signOut().subscribe({ error: () => {} });
      http.expectOne('/api/v1/auth/logout').flush({ status: 500, code: 'INTERNAL_ERROR' }, { status: 500, statusText: 'Server Error' });
      expect(localStorage.getItem(draft)).not.toBeNull();
      store.load().subscribe();
      http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
      store.expire(store.generation());
      expect(store.actor()).toBeNull();
      expect(localStorage.getItem(draft)).not.toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it('forgets the copies when the server session had already ended at sign-out', () => {
    const draft = JSON.stringify(['mentor.practice.source.v1', 'first', 'w1', 's1', 'l1', 'e1', ['number', 1]]);
    localStorage.setItem(draft, JSON.stringify({ files: { 'A.java': 'unsaved' }, savedAt: Date.now() }));
    try {
      store.load().subscribe();
      http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
      store.signOut().subscribe({ error: () => {} });
      http.expectOne('/api/v1/auth/logout').flush({ status: 401, code: 'UNAUTHORIZED' }, { status: 401, statusText: 'Unauthorized' });
      expect(localStorage.getItem(draft)).toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it('drops copies older than two weeks when the app starts', () => {
    const old = JSON.stringify(['mentor.practice.source.v1', 'first', 'w1', 's1', 'l1', 'old', ['number', 1]]);
    localStorage.setItem(old, JSON.stringify({ files: { 'A.java': 'old' }, savedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 }));
    try {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
      TestBed.inject(SessionStore);
      http = TestBed.inject(HttpTestingController);
      expect(localStorage.getItem(old)).toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it('loads the server account and anonymous CSRF without browser storage', () => {
    store.load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
    expect(store.actor()?.userId).toBe('first');
  });

  it('keeps generation 2 when a generation 1 session response arrives after login', () => {
    store.load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
    store.load().subscribe();
    const late = http.expectOne('/api/v1/auth/session');
    store.signIn('second', '  exact password  ').subscribe();
    const login = http.expectOne('/api/v1/auth/login');
    expect(login.request.body).toEqual({ login: 'second', password: '  exact password  ' });
    login.flush({ account: second, csrfToken: 'synthetic-second' });
    http.expectOne('/api/v1/auth/session').flush({ account: second, csrfToken: 'synthetic-second' });
    late.flush({ account: first, csrfToken: 'synthetic-first' });
    expect(store.actor()?.userId).toBe('second');
    expect(store.generation()).toBeGreaterThanOrEqual(2);
  });
  it('registration establishes the server actor and refreshes CSRF', () => {
    store.register('synthetic-invite', 'synthetic-login', '  password  ').subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic-anonymous' });
    const request = http.expectOne('/api/v1/auth/register');
    expect(request.request.body).toEqual({ token: 'synthetic-invite', login: 'synthetic-login', password: '  password  ' });
    request.flush({ account: second, csrfToken: 'synthetic-second' });
    http.expectOne('/api/v1/auth/session').flush({ account: second, csrfToken: 'synthetic-second' });
    expect(store.actor()).toEqual(second);
  });
  it('a late password reset response cannot clear a newly signed-in actor', () => {
    store.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
    store.resetPassword('synthetic-reset', '  password  ').subscribe();
    const late = http.expectOne('/api/v1/auth/reset-password');
    store.signIn('second', 'synthetic-password').subscribe();
    http.expectOne('/api/v1/auth/login').flush({ account: second, csrfToken: 'synthetic-second' });
    http.expectOne('/api/v1/auth/session').flush({ account: second, csrfToken: 'synthetic-second' });
    late.flush(null, { status: 204, statusText: 'No Content' });
    expect(store.actor()?.userId).toBe('second'); http.expectNone('/api/v1/auth/session');
  });
  it('changes password with exact current/new values and adopts the new authVersion', () => {
    store.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
    store.changePassword('  current  ', '  new password  ').subscribe();
    const request = http.expectOne('/api/v1/auth/change-password');
    expect(request.request.body).toEqual({ currentPassword: '  current  ', newPassword: '  new password  ' });
    request.flush({ account: { ...first, authVersion: 2 }, csrfToken: 'synthetic-change' });
    expect(store.actor()?.authVersion).toBe(2); expect(store.csrfToken()).toBe('synthetic-change');
  });
  it('a successful password reset clears the actor and acquires anonymous CSRF', () => {
    store.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: first, csrfToken: 'synthetic-first' });
    store.resetPassword('synthetic-reset', '  password  ').subscribe();
    const request = http.expectOne('/api/v1/auth/reset-password');
    expect(request.request.body).toEqual({ token: 'synthetic-reset', password: '  password  ' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne('/api/v1/auth/session').flush({ account: null, csrfToken: 'synthetic-anonymous' });
    expect(store.actor()).toBeNull(); expect(store.csrfToken()).toBe('synthetic-anonymous');
  });
});

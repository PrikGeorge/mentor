import { inject, Injectable, signal } from '@angular/core';
import { defer, filter, map, Observable, of, Subject, switchMap, takeUntil, tap, throwError } from 'rxjs';
import { Actor, PlatformApi, SessionView } from './platform-api.service';
import { identityContext } from './session-context';
export type { Actor, SessionView } from './platform-api.service';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(PlatformApi);
  private readonly account = signal<Actor | null>(null);
  private readonly epoch = signal(0);
  private readonly token = signal<string | null>(null);
  private readonly changes = new Subject<number>();
  private pendingLogoutAccount: string | null = null;
  readonly actor = this.account.asReadonly();
  readonly generation = this.epoch.asReadonly();
  readonly csrfToken = this.token.asReadonly();
  readonly loaded = signal(false);

  load(): Observable<SessionView> {
    return defer(() => {
      const stamp = this.generation();
      return this.api.get('/auth/session', { context: identityContext() }).pipe(
        tap(view => { if (stamp === this.generation()) this.accept(view); })
      );
    });
  }
  ensureCsrf(): Observable<string> {
    if (this.csrfToken()) return of(this.csrfToken()!);
    const stamp = this.generation();
    return this.api.get('/auth/session', { context: identityContext() }).pipe(tap(view => {
      if (stamp === this.generation()) this.token.set(view.csrfToken);
    }), filter(() => stamp === this.generation()), map(view => view.csrfToken));
  }
  signIn(login: string, password: string): Observable<Actor> {
    return this.authenticate(() => this.api.post('/auth/login', { login, password }, { context: identityContext(null) }));
  }
  register(token: string, login: string, password: string): Observable<Actor> {
    return this.authenticate(() => this.api.post('/auth/register', { token, login, password }, { context: identityContext(null) }));
  }
  resetPassword(token: string, password: string): Observable<void> {
    return defer(() => {
      const stamp = this.generation();
      return this.ensureCsrf().pipe(
        switchMap(() => this.api.post('/auth/reset-password', { token, password }, { context: identityContext(null) })),
        filter(() => stamp === this.generation()),
        tap(() => { this.invalidate(); this.token.set(null); }),
        switchMap(() => this.load()), map(() => undefined)
      );
    });
  }
  private authenticate(action: () => Observable<SessionView>): Observable<Actor> {
    return defer(() => {
      this.invalidate();
      const stamp = this.generation();
      return this.ensureCsrf().pipe(
        switchMap(action),
        switchMap(view => {
          if (this.generation() !== stamp || !view.account) return throwError(() => new Error('Аккаунт изменился.'));
          this.accept(view);
          const authenticatedGeneration = this.generation();
          return this.load().pipe(filter(() => authenticatedGeneration === this.generation()), map(() => view.account!));
        })
      );
    });
  }
  signOut(): Observable<void> {
    return defer(() => {
      const previous = this.actor()?.userId ?? this.pendingLogoutAccount;
      this.pendingLogoutAccount = previous;
      this.invalidate();
      const stamp = this.generation();
      return this.ensureCsrf().pipe(
        switchMap(() => this.api.post('/auth/logout', undefined as never, { context: identityContext(previous) })),
        filter(() => stamp === this.generation()),
        tap(() => { this.token.set(null); this.pendingLogoutAccount = null; }),
        switchMap(() => this.load()), map(() => undefined)
      );
    });
  }
  changePassword(currentPassword: string, newPassword: string): Observable<SessionView> {
    return defer(() => {
      const stamp = this.generation();
      return this.api.post('/auth/change-password', { currentPassword, newPassword }, { context: identityContext() }).pipe(filter(() => stamp === this.generation()), tap(view => this.accept(view)));
    });
  }
  invalidate(expectedGeneration = this.generation()): void {
    if (expectedGeneration !== this.generation()) return;
    this.account.set(null);
    this.epoch.update(value => value + 1);
    this.changes.next(this.generation());
  }
  expire(expectedGeneration: number): void {
    if (expectedGeneration !== this.generation()) return;
    this.invalidate(expectedGeneration);
    this.token.set(null);
  }
  scope<T>(source: Observable<T>, stamp = this.generation()): Observable<T> {
    return defer(() => stamp === this.generation() ? source.pipe(takeUntil(this.changes.pipe(filter(value => value !== stamp)))) : of<T>());
  }
  private accept(view: SessionView): void {
    const old = this.actor();
    const next = view.account;
    if (old?.userId !== next?.userId || old?.authVersion !== next?.authVersion || old?.workspaceId !== next?.workspaceId || old?.role !== next?.role) {
      this.epoch.update(value => value + 1);
      this.changes.next(this.generation());
    }
    this.account.set(next);
    if (next) this.pendingLogoutAccount = null;
    this.token.set(view.csrfToken);
    this.loaded.set(true);
  }
}

import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { SessionStore } from '../core/session.store';

@Component({ selector: 'mentor-shell', imports: [RouterOutlet, RouterLink, RouterLinkActive], template: `
  <a class="skip" href="#main">К содержимому</a>
  @if (session.actor(); as actor) {
    <aside class="sidebar" [class.open]="menuOpen()" id="sidebar"><a class="brand" routerLink="/" (click)="menuOpen.set(false)"><span class="monogram">м.</span><span>Наставник<small>Личный кабинет</small></span></a>
      <nav aria-label="Главное меню">
        @if (actor.role === 'ADMIN') { <a routerLink="/admin/teachers" routerLinkActive="active" ariaCurrentWhenActive="page" (click)="menuOpen.set(false)">Преподаватели</a> }
        @if (actor.role === 'TEACHER') { <a routerLink="/teacher/students" routerLinkActive="active" ariaCurrentWhenActive="page" (click)="menuOpen.set(false)">Мои ученики</a> }
        @if (actor.role === 'STUDENT') { <a routerLink="/learn" routerLinkActive="active" ariaCurrentWhenActive="page" (click)="menuOpen.set(false)">Мои занятия</a> }
        <a routerLink="/account/password" routerLinkActive="active" ariaCurrentWhenActive="page" (click)="menuOpen.set(false)">Сменить пароль</a>
      </nav><div class="sidebar-foot">{{ roleLabels[actor.role] }}</div>
    </aside>
  }
  <div class="workspace" [class.auth-screen]="!session.actor()"><header class="topbar">
    @if (session.actor(); as actor) {
      <button class="menu-button" (click)="menuOpen.set(!menuOpen())" aria-controls="sidebar" [attr.aria-expanded]="menuOpen()" aria-label="Меню">☰</button>
      <span class="breadcrumb">Кабинет наставника</span><div class="auth-topbar"><span class="auth-identity">{{ roleLabels[actor.role] }}</span><button class="auth-control" (click)="signOut()" [disabled]="signingOut()">Выйти</button></div>
    }
  </header><main id="main" tabindex="-1">
    @if (preview()) { <p class="callout" role="status">Предпросмотр кабинета ученика · только чтение</p> }
    @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p><button class="btn" (click)="signOut()" [disabled]="signingOut()">Повторить выход</button> }
    <!-- Destroy the routed view at account changes before private state can persist. -->
    <div [hidden]="!publicRoute() && !session.actor()">@for (view of views(); track view.id) { <router-outlet /> }</div>
  </main><footer class="site-footer">Кабинет наставника <span>Свои занятия и материалы.</span></footer></div>`,
})
export class ShellComponent {
  readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly menuOpen = signal(false);
  readonly signingOut = signal(false);
  readonly preview = signal(false);
  readonly error = signal('');
  readonly publicRoute = signal(true);
  readonly views = computed(() => [{ id: this.publicRoute() ? 'auth' : this.session.generation() }]);
  readonly roleLabels = { ADMIN: 'Администратор', TEACHER: 'Преподаватель', STUDENT: 'Ученик' };
  constructor() {
    effect(() => { this.session.generation(); this.menuOpen.set(false); this.error.set(''); });
    this.router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      let activeRoute = this.router.routerState.snapshot.root;
      while (activeRoute.firstChild) activeRoute = activeRoute.firstChild;
      this.publicRoute.set(activeRoute.data['missing'] === true || /^\/(login|register|reset-password|account\/password)(?:[/?#]|$)/.test(this.router.url));
      this.preview.set(this.session.actor()?.role === 'TEACHER' && this.router.parseUrl(this.router.url).queryParams['preview'] === 'student');
    });
  }
  signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.session.signOut().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.signingOut.set(false); void this.router.navigate(['/login']); },
      error: () => { this.signingOut.set(false); this.error.set('Не удалось завершить сессию. Повторите выход.'); },
    });
  }
}

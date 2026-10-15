import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { DatePipe } from '@angular/common';
import { SessionStore } from '../core/session.store';
import { WorkspaceContext } from './workspace-context';
import { StudentNavigationComponent } from '../student/student-navigation.component';
import { PracticeExit } from '../core/practice-exit.service';
import { PracticeExitDialog } from '../core/practice-exit-dialog.component';
import { IconComponent } from '../core/icon.component';
import { lessonStatus } from '../lessons/lesson-status';
import { ErrorBannerComponent } from '../core/error-banner.component';
type NavItem = { label: string; link: string; query: Record<string, string>; active: boolean };

@Component({ selector: 'mentor-shell', imports: [RouterOutlet, RouterLink, DatePipe, StudentNavigationComponent, PracticeExitDialog, IconComponent, ErrorBannerComponent], host: { '(document:click)': 'outside($event)', '(document:keydown.escape)': 'escape()' }, template: `
  <mentor-practice-exit/><a class="skip" href="#main">К содержимому</a>
  <div class="workspace" [class.auth-screen]="!session.actor()">
  @if (session.actor(); as actor) {
    @if (preview(); as back) {
      <div class="preview-banner" role="status"><span class="lab"><mentor-icon name="eye"/>Предпросмотр кабинета ученика · только чтение</span><a class="back" [routerLink]="back.link"><mentor-icon name="arrow-left"/>{{back.label}}</a></div>
    }
    <header class="site-header">
      <div class="header-bar">
        <a class="brand" [routerLink]="homeLink()" [queryParams]="learnerQuery()" (click)="closeMenus()"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>Наставник</span></a>
        <nav class="primary-nav" aria-label="Главное меню">
          @for (item of nav(); track item.link) { <a [routerLink]="item.link" [queryParams]="item.query" [class.active]="item.active" [attr.aria-current]="item.active ? 'page' : null"><span>{{ item.label }}</span></a> }
        </nav>
        <div class="profile" #profile>
          @if (preview()) {
            <span class="profile-button" aria-label="Кабинет ученика · только чтение"><span class="profile-name">{{ identity().name }}</span><mentor-icon name="lock"/></span>
          } @else {
            <button class="profile-button" type="button" (click)="profileOpen.set(!profileOpen())" [attr.aria-expanded]="profileOpen()" aria-controls="profile-menu" aria-haspopup="true"><span class="profile-avatar"><mentor-icon name="user"/></span><span class="profile-name">{{ identity().name }}</span><mentor-icon name="chevron-down"/></button>
            @if (profileOpen()) {
              <div class="profile-menu" id="profile-menu"><div class="profile-me"><b>{{ identity().name }}</b><span>{{ identity().detail }}</span></div>
                <ul class="menu-list"><li><a routerLink="/account/password" (click)="closeMenus()"><mentor-icon name="key-round"/>Сменить пароль</a></li><li><button type="button" (click)="signOut()" [disabled]="signingOut()"><mentor-icon name="log-out"/>Выйти</button></li></ul></div>
            }
          }
        </div>
        <button class="menu-button" type="button" (click)="menuOpen.set(!menuOpen())" aria-controls="mobile-menu" [attr.aria-expanded]="menuOpen()" [attr.aria-label]="menuOpen() ? 'Закрыть меню' : 'Меню'"><mentor-icon [name]="menuOpen() ? 'x' : 'menu'"/>{{ menuOpen() ? 'Закрыть' : 'Меню' }}</button>
      </div>
      <div class="mobile-menu" id="mobile-menu" [class.open]="menuOpen()" [hidden]="!menuOpen()">
        @if (menuOpen()) {
          <nav aria-label="Главное меню">@for (item of nav(); track item.link) { <a [routerLink]="item.link" [queryParams]="item.query" [class.active]="item.active" [attr.aria-current]="item.active ? 'page' : null" (click)="closeMenus()">{{ item.label }}<mentor-icon name="chevron-right"/></a> }</nav>
          <div class="mobile-me"><b>{{ identity().name }}</b><span>{{ identity().detail }}</span></div>
          @if (!preview()) { <ul class="menu-list"><li><a routerLink="/account/password" (click)="closeMenus()"><mentor-icon name="key-round"/>Сменить пароль</a></li><li><button type="button" (click)="signOut()" [disabled]="signingOut()"><mentor-icon name="log-out"/>Выйти</button></li></ul> }
        }
      </div>
    </header>
  }
  <main id="main" tabindex="-1">
    @if (error()) { <mentor-error-banner [message]="error()" retryLabel="Повторить выход" icon="log-out" [busy]="signingOut()" (retry)="signOut()"/> }
    @if (session.actor() && selection.current(); as context) { @if (context.lesson; as lesson) {
      <div class="context-head">
        <nav class="crumbs" aria-label="Путь">@if (context.learner) { <a [routerLink]="context.base + '/lessons'" [queryParams]="learnerQuery()">Мои занятия</a> } @else { <a routerLink="/teacher/students">Мои ученики</a><span aria-hidden="true">›</span><a [routerLink]="context.base">{{ context.student.name }}</a> }<span aria-hidden="true">›</span><span>Занятие {{ lesson.number }}</span></nav>
        <div class="context-title"><div>
          <p class="kick"><a class="backlink" [routerLink]="context.learner ? context.base + '/lessons' : context.base" [queryParams]="learnerQuery()"><mentor-icon name="arrow-left"/>Все занятия</a><span aria-hidden="true">·</span><span>Занятие {{ lesson.number }}</span>@if (status(lesson, context.learner ? 'student' : 'teacher'); as tag) {<span class="tag" [class.on]="tag.on" [class.quiet]="tag.quiet"><mentor-icon [name]="tag.icon"/>{{ tag.label }}</span>}</p>
          <h1>{{ lesson.title }}</h1>
          <p class="meta">@if (!context.learner) { <b>{{ context.student.name }}</b> · }{{ lesson.date | date:'dd.MM.yyyy' }} · {{ lesson.time }} МСК · {{ lesson.duration }} мин</p>
        </div></div>
        <mentor-student-navigation [selection]="context" level="lesson"/>
      </div>
    } }
    <!-- Destroy the routed view at account changes before private state can persist. -->
    <div [hidden]="!publicRoute() && !session.actor()">@for (view of views(); track view.id) { <router-outlet /> }</div>
  </main>
  @if (session.actor()) { <footer class="site-footer"><div><span>Наставник · {{ learnerContext() ? 'Кабинет ученика' : session.actor()?.role === 'ADMIN' ? 'Администрирование' : 'Кабинет наставника' }}</span><span>Все даты и время — по Москве (МСК).</span></div></footer> }
  </div>`,
})
export class ShellComponent {
  readonly session = inject(SessionStore);
  private readonly practiceExit = inject(PracticeExit);
  readonly selection = inject(WorkspaceContext);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly profile = viewChild<ElementRef<HTMLElement>>('profile');
  private readonly url = toSignal(this.router.events.pipe(filter(event => event instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  readonly menuOpen = signal(false);
  readonly profileOpen = signal(false);
  readonly signingOut = signal(false);
  readonly error = signal('');
  readonly publicRoute = signal(true);
  readonly views = computed(() => [{ id: this.publicRoute() ? 'auth' : this.session.generation() }]);
  readonly roleLabels = { ADMIN: 'Администратор', TEACHER: 'Преподаватель', STUDENT: 'Ученик' };
  // The learner's own profile route, remembered for the header while a page without profile data is open.
  private readonly learner = signal<{ generation: number; base: string; name: string; direction: string } | null>(null);
  readonly learnerContext = computed(() => this.session.actor()?.role === 'STUDENT' || this.selection.current()?.learner === true);
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);
  private readonly queryPreview = computed(() => /[?&]preview=student(?:&|#|$)/.test(this.url()));
  readonly preview = computed<{ link: string; label: string } | null>(() => {
    const context = this.selection.current();
    if (this.session.actor()?.role !== 'TEACHER' || !(context?.preview || this.queryPreview())) return null;
    // The path keeps the exit target even while the previewed data is still loading or failed.
    const match = /^\/teacher\/students\/([^/]+)(?:\/lessons\/([^/]+))?/.exec(this.path());
    if (!match) return { link: '/teacher/students', label: 'К ученикам' };
    return match[2] ? { link: `/teacher/students/${match[1]}/lessons/${match[2]}`, label: 'К занятию' } : { link: `/teacher/students/${match[1]}`, label: 'К карточке ученика' };
  });
  readonly learnerQuery = computed((): Record<string, string> => this.preview() ? { preview: 'student' } : {});
  private readonly learnerBase = computed(() => {
    const context = this.selection.current();
    if (context?.learner) return context.base;
    const remembered = this.learner();
    return this.session.actor()?.role === 'STUDENT' && remembered?.generation === this.session.generation() ? remembered.base : null;
  });
  readonly identity = computed(() => {
    const actor = this.session.actor(), context = this.selection.current(), remembered = this.learner();
    if (actor?.role === 'STUDENT' || this.preview()) {
      const student = context?.learner ? context.student : remembered?.generation === this.session.generation() ? remembered : null;
      return { name: student?.name || 'Ученик', detail: ['Ученик', student?.direction].filter(Boolean).join(' · ') };
    }
    const role = actor ? this.roleLabels[actor.role] : '';
    return { name: this.session.login() || role, detail: role };
  });
  readonly homeLink = computed(() => {
    const role = this.session.actor()?.role;
    if (role === 'ADMIN') return '/admin/teachers';
    if (role === 'TEACHER' && !this.preview()) return '/teacher/students';
    return this.learnerBase() ?? '/learn';
  });
  readonly nav = computed<NavItem[]>(() => {
    const role = this.session.actor()?.role, path = this.path();
    if (role === 'ADMIN') return [{ label: 'Преподаватели', link: '/admin/teachers', query: {}, active: path.startsWith('/admin/teachers') }];
    if (role === 'TEACHER' && !this.preview()) return [
      { label: 'Мои ученики', link: '/teacher/students', query: {}, active: path.startsWith('/teacher/students') },
      { label: 'Расписание', link: '/teacher/schedule', query: {}, active: path.startsWith('/teacher/schedule') },
    ];
    if (!role) return [];
    const base = this.learnerBase(), query = this.learnerQuery();
    if (!base) return [{ label: 'Главная', link: '/learn', query, active: path === '/learn' }];
    return [
      { label: 'Главная', link: base, query, active: path === base || path === '/learn' || path === base + '/goal' },
      { label: 'Занятия', link: base + '/lessons', query, active: path.startsWith(base + '/lessons') },
      { label: 'Маршрут обучения', link: base + '/roadmap', query, active: path === base + '/roadmap' },
      { label: 'Материалы', link: base + '/materials', query, active: path.startsWith(base + '/materials') },
    ];
  });
  constructor() {
    effect(() => { this.session.generation(); this.closeMenus(); this.error.set(''); });
    effect(() => {
      const context = this.selection.current();
      if (this.session.actor()?.role === 'STUDENT' && context?.learner) this.learner.set({ generation: this.session.generation(), base: context.base, name: context.student.name, direction: context.student.direction });
    });
    this.router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      let activeRoute = this.router.routerState.snapshot.root;
      while (activeRoute.firstChild) activeRoute = activeRoute.firstChild;
      this.publicRoute.set(activeRoute.data['missing'] === true || /^\/(login|register|reset-password|account\/password)(?:[/?#]|$)/.test(this.router.url));
      this.closeMenus();
    });
  }
  readonly status = lessonStatus;
  closeMenus(): void { this.menuOpen.set(false); this.profileOpen.set(false); }
  outside(event: Event): void { if (this.profileOpen() && !this.profile()?.nativeElement.contains(event.target as Node)) this.profileOpen.set(false); }
  escape(): void {
    if (!this.profileOpen() && !this.menuOpen()) return;
    const button = this.profileOpen() ? this.profile()?.nativeElement.querySelector<HTMLElement>('.profile-button') : document.querySelector<HTMLElement>('.menu-button');
    this.closeMenus(); button?.focus();
  }
  async signOut(): Promise<void> {
    if (this.signingOut()) return;
    const owner = this.session.generation();
    if (!await this.practiceExit.ask() || owner !== this.session.generation()) return;
    this.signingOut.set(true); this.closeMenus();
    this.session.signOut().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.signingOut.set(false); void this.router.navigate(['/login']); },
      error: () => { this.signingOut.set(false); this.error.set('Не удалось завершить сессию. Повторите выход.'); },
    });
  }
}

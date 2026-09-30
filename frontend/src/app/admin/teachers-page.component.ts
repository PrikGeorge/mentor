import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, forkJoin, Observable } from 'rxjs';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
type Teacher = components['schemas']['TeacherView'];
type Invitation = components['schemas']['InvitationView'];
type LinkIssue = components['schemas']['PasswordResetIssue'];

@Component({
  selector: 'mentor-teachers-page', imports: [ReactiveFormsModule, DatePipe],
  template: `
    <div class="page-head"><div><p class="eyebrow">Администрирование</p><h1>Преподаватели</h1><p class="subtitle">Приглашения и доступ к кабинетам.</p></div>
      <button class="btn primary" data-action="invite" (click)="invite()" [disabled]="busy()">+ Пригласить преподавателя</button></div>
    @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p> }
    @if (loading()) { <p role="status">Загружаем…</p> }
    @if (issued()) {
      <section class="panel panel-inner issued-link"><h2>Ссылка для ручной передачи</h2><p>Действует до {{ issued()!.expiresAt | date:'dd.MM.yyyy HH:mm':'UTC' }} UTC. Передайте её получателю лично.</p>
        <label class="auth-field">Одноразовая ссылка<input name="issuedLink" [value]="issued()!.link" readonly (focus)="selectLink($event)"></label>
        <button class="btn" (click)="issued.set(null)">Скрыть ссылку</button></section>
    }
    @if (resetTeacher()) {
      <section class="panel panel-inner"><h2>Восстановить доступ: {{ resetTeacher()!.login }}</h2>
        <form (submit)="issueReset($event)"><label class="auth-field">Ваш текущий пароль<input name="currentPassword" type="password" [formControl]="currentPassword" autocomplete="current-password" required></label>
          <div class="actions"><button type="submit" class="btn primary" [disabled]="busy()">Выдать ссылку восстановления</button><button type="button" class="btn" (click)="cancelReset()">Отмена</button></div>
        </form></section>
    }
    <section aria-label="Преподаватели" class="admin-list">
      @for (teacher of teachers(); track teacher.userId) {
        <article class="panel panel-inner"><h2>{{ teacher.login }}</h2>
          <p class="small-muted">Аккаунт: {{ teacher.accountDisabled ? 'приостановлен' : 'активен' }} · Пространство: {{ teacher.workspaceDisabled ? 'приостановлено' : 'активно' }}</p>
          <div class="actions">
            <button class="btn" data-action="teacher-access" (click)="teacherAccess(teacher)" [disabled]="busy()">{{ teacher.accountDisabled ? 'Восстановить аккаунт' : 'Блокировать аккаунт' }}</button>
            <button class="btn" data-action="workspace-access" (click)="workspaceAccess(teacher)" [disabled]="busy()">{{ teacher.workspaceDisabled ? 'Восстановить пространство' : 'Блокировать пространство' }}</button>
            <button class="btn" data-action="reset" (click)="startReset(teacher)" [disabled]="busy()">Восстановить пароль</button>
          </div></article>
      } @empty { @if (!loading()) { <p class="subtitle">Преподавателей пока нет.</p> } }
    </section>
    <nav class="pagination" aria-label="Страницы преподавателей"><button class="btn" (click)="teacherPage.set(teacherPage()-1)" [disabled]="teacherPage() === 0 || loading()">Назад</button><span>Страница {{ teacherPage()+1 }}</span><button class="btn" (click)="teacherPage.set(teacherPage()+1)" [disabled]="(teacherPage()+1)*25 >= teacherTotal() || loading()">Далее</button></nav>
    <section class="panel panel-inner"><h2>Приглашения</h2>
      @for (invitation of invitations(); track invitation.id) {
        <article class="invitation-row"><div><strong>{{ invitationLabels[invitation.state] }}</strong><p class="small-muted">До {{ invitation.expiresAt | date:'dd.MM.yyyy HH:mm':'UTC' }} UTC</p></div>
          @if (invitation.state === 'pending') { <button class="btn" data-action="revoke" (click)="revoke(invitation.id)" [disabled]="busy()">Отозвать</button> }</article>
      } @empty { <p class="small-muted">Приглашений пока нет.</p> }
      <nav class="pagination" aria-label="Страницы приглашений"><button class="btn" (click)="invitationPage.set(invitationPage()-1)" [disabled]="invitationPage() === 0 || loading()">Назад</button><span>Страница {{ invitationPage()+1 }}</span><button class="btn" (click)="invitationPage.set(invitationPage()+1)" [disabled]="(invitationPage()+1)*25 >= invitationTotal() || loading()">Далее</button></nav>
    </section>`,
})
export class TeachersPageComponent {
  private readonly api = inject(PlatformApi);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refresh = signal(0);
  private ownerGeneration = -1;
  readonly teachers = signal<Teacher[]>([]);
  readonly invitations = signal<Invitation[]>([]);
  readonly teacherPage = signal(0);
  readonly invitationPage = signal(0);
  readonly teacherTotal = signal(0);
  readonly invitationTotal = signal(0);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly issued = signal<LinkIssue | null>(null);
  readonly resetTeacher = signal<Teacher | null>(null);
  readonly currentPassword = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  readonly invitationLabels = { pending: 'Ожидает регистрации', used: 'Использовано', revoked: 'Отозвано', expired: 'Истекло' };
  constructor() {
    effect(onCleanup => {
      const generation = this.session.generation();
      const actor = this.session.actor();
      const teacherPage = this.teacherPage();
      const invitationPage = this.invitationPage();
      this.refresh();
      this.teachers.set([]); this.invitations.set([]);
      if (generation !== this.ownerGeneration) {
        this.ownerGeneration = generation; this.issued.set(null); this.cancelReset(); this.error.set(''); this.busy.set(false);
      }
      if (actor?.role !== 'ADMIN') { this.loading.set(false); return; }
      this.loading.set(true);
      const subscription = forkJoin({
        teachers: this.api.get('/admin/teachers', { query: { page: teacherPage, size: 25 } }),
        invitations: this.api.get('/admin/teacher-invitations', { query: { page: invitationPage, size: 25 } }),
      }).pipe(finalize(() => this.loading.set(false))).subscribe({
        next: view => { this.teachers.set(view.teachers.items); this.teacherTotal.set(view.teachers.total); this.invitations.set(view.invitations.items); this.invitationTotal.set(view.invitations.total); },
        error: (failure: HttpErrorResponse) => this.error.set(failure.error?.message ?? 'Не удалось загрузить список.'),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }
  invite(): void { this.mutate(this.api.post('/admin/teacher-invitations', {}), issue => this.showIssue(issue)); }
  revoke(id: string): void { this.mutate(this.api.delete('/admin/teacher-invitations/{id}', { pathParams: { id } })); }
  teacherAccess(teacher: Teacher): void { this.mutate(this.api.patch('/admin/teachers/{id}/access', { disabled: !teacher.accountDisabled }, { pathParams: { id: teacher.userId } })); }
  workspaceAccess(teacher: Teacher): void { this.mutate(this.api.patch('/admin/workspaces/{id}/access', { disabled: !teacher.workspaceDisabled }, { pathParams: { id: teacher.workspaceId } })); }
  startReset(teacher: Teacher): void { this.currentPassword.reset(); this.resetTeacher.set(teacher); this.issued.set(null); }
  cancelReset(): void { this.resetTeacher.set(null); this.currentPassword.reset(); }
  issueReset(event: Event): void {
    event.preventDefault();
    if (this.currentPassword.invalid || !this.resetTeacher()) { this.error.set('Подтвердите действие своим текущим паролем.'); return; }
    this.mutate(this.api.post('/admin/teachers/{id}/password-reset', { currentPassword: this.currentPassword.value }, { pathParams: { id: this.resetTeacher()!.userId } }), issue => { this.showIssue(issue); this.cancelReset(); }, false);
  }
  selectLink(event: Event): void { (event.target as HTMLInputElement).select(); }
  private showIssue(issue: LinkIssue): void {
    try {
      const url = new URL(issue.link, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) throw new Error('Invalid issue link');
      this.issued.set({ ...issue, link: url.href });
    } catch { this.error.set('Ссылка недоступна. Проверьте адрес кабинета.'); }
  }
  private mutate<T>(action: Observable<T>, done?: (value: T) => void, reload = true): void {
    if (this.busy() || this.session.actor()?.role !== 'ADMIN') return;
    this.busy.set(true); this.error.set('');
    this.session.scope(action).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe({
      next: value => { done?.(value); if (reload) this.refresh.update(count => count + 1); },
      error: (failure: HttpErrorResponse) => { this.currentPassword.reset(); this.error.set(failure.error?.message ?? 'Действие не выполнено. Попробуйте ещё раз.'); },
    });
  }
}

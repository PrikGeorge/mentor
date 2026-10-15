import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, forkJoin, Observable } from 'rxjs';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
import { IconComponent } from '../core/icon.component';
type Teacher = components['schemas']['TeacherView'];
type Invitation = components['schemas']['InvitationView'];
type LinkIssue = components['schemas']['PasswordResetIssue'];

@Component({
  selector: 'mentor-teachers-page', imports: [ReactiveFormsModule, DatePipe, IconComponent],
  template: `
    <div class="page-head"><div><h1>Преподаватели</h1><p class="subtitle">Приглашения и доступ к кабинетам.</p></div>
      <button class="btn primary" data-action="invite" (click)="invite()" [disabled]="busy()"><mentor-icon name="plus"/>Пригласить преподавателя</button></div>
    @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p> }
    @if (loading()) { <p class="loading" role="status">Загружаем…</p> }
    @if (issued()) {
      <section class="issued-link section-block" aria-labelledby="issued-title"><h2 id="issued-title"><mentor-icon name="link"/> Ссылка для ручной передачи</h2><p>Действует до {{ issued()!.expiresAt | date:'dd.MM.yyyy, HH:mm':'+0300' }} МСК. Передайте её получателю лично.</p>
        <label class="auth-field">Одноразовая ссылка<input name="issuedLink" [value]="issued()!.link" readonly (focus)="selectLink($event)"></label>
        <div class="form-actions"><button class="btn sm" type="button" (click)="copy(issued()!.link)"><mentor-icon name="copy"/>{{ copied() ? 'Скопировано' : 'Скопировать' }}</button><button class="btn sm text" (click)="issued.set(null)">Скрыть ссылку</button></div></section>
    }
    @if (resetTeacher()) {
      <section class="confirm-box section-block" aria-labelledby="reset-title"><h2 id="reset-title">Восстановить доступ: {{ resetTeacher()!.login }}</h2><p>Подтвердите действие своим текущим паролем.</p>
        <form (submit)="issueReset($event)"><label class="auth-field">Ваш текущий пароль<input name="currentPassword" type="password" [formControl]="currentPassword" autocomplete="current-password" required></label>
          <div class="form-actions"><button type="submit" class="btn primary" [disabled]="busy()"><mentor-icon name="key-round"/>Выдать ссылку восстановления</button><button type="button" class="btn" (click)="cancelReset()">Отмена</button></div>
        </form></section>
    }
    <div class="admin-page">
    <section aria-label="Преподаватели" class="admin-list"><div class="sh"><div class="title-group"><h2>Преподаватели</h2><span class="count">Всего: {{ teacherTotal() }}</span></div></div>
      @if (teachers().length) {
        <div class="table-wrap"><table class="tbl admin-table"><thead><tr><th scope="col">Логин</th><th scope="col">Аккаунт</th><th scope="col">Пространство</th><th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>
        @for (teacher of teachers(); track teacher.userId) {
          <tr><td><code>{{ teacher.login }}</code></td>
            <td><span class="tag" [class.on]="!teacher.accountDisabled"><mentor-icon [name]="teacher.accountDisabled ? 'circle-pause' : 'check'"/>Аккаунт {{ teacher.accountDisabled ? 'приостановлен' : 'активен' }}</span></td>
            <td><span class="tag" [class.quiet]="teacher.workspaceDisabled"><mentor-icon [name]="teacher.workspaceDisabled ? 'circle-pause' : 'check'"/>Пространство {{ teacher.workspaceDisabled ? 'приостановлено' : 'активно' }}</span></td>
            <td class="act"><div class="actions m-0">
              @if(confirming()===teacher.userId+':account'){<span class="inline-confirm" role="group" aria-label="Подтверждение"><span class="small-muted">{{ teacher.accountDisabled ? 'Восстановить аккаунт?' : 'Блокировать аккаунт? Преподаватель потеряет вход.' }}</span><button class="btn sm" [class.danger]="!teacher.accountDisabled" data-action="teacher-access" (click)="teacherAccess(teacher)" [disabled]="busy()">{{ teacher.accountDisabled ? 'Да, восстановить' : 'Да, блокировать' }}</button><button class="btn sm text" type="button" (click)="confirming.set(null)" [disabled]="busy()">Отмена</button></span>}
              @else{<button class="btn sm" [class.danger]="!teacher.accountDisabled" data-action="teacher-access-ask" (click)="confirming.set(teacher.userId+':account')" [disabled]="busy()">{{ teacher.accountDisabled ? 'Восстановить аккаунт' : 'Блокировать аккаунт' }}</button>}
              @if(confirming()===teacher.userId+':workspace'){<span class="inline-confirm" role="group" aria-label="Подтверждение"><span class="small-muted">{{ teacher.workspaceDisabled ? 'Восстановить пространство?' : 'Блокировать пространство? Ученики этого преподавателя потеряют доступ.' }}</span><button class="btn sm" [class.danger]="!teacher.workspaceDisabled" data-action="workspace-access" (click)="workspaceAccess(teacher)" [disabled]="busy()">{{ teacher.workspaceDisabled ? 'Да, восстановить' : 'Да, блокировать' }}</button><button class="btn sm text" type="button" (click)="confirming.set(null)" [disabled]="busy()">Отмена</button></span>}
              @else{<button class="btn sm" [class.danger]="!teacher.workspaceDisabled" data-action="workspace-access-ask" (click)="confirming.set(teacher.userId+':workspace')" [disabled]="busy()">{{ teacher.workspaceDisabled ? 'Восстановить пространство' : 'Блокировать пространство' }}</button>}
              <button class="btn sm" data-action="reset" (click)="startReset(teacher)" [disabled]="busy()"><mentor-icon name="key-round"/>Восстановить пароль</button>
            </div></td></tr>
        }</tbody></table></div>
      } @else if (!loading()) { <div class="empty-state mt-16"><h3>Преподавателей пока нет</h3><p>Пригласите первого преподавателя — он получит своё пространство.</p></div> }
      @if (teacherTotal() > 25) { <nav class="pagination" aria-label="Страницы преподавателей"><button class="btn" (click)="teacherPage.set(teacherPage()-1)" [disabled]="teacherPage() === 0 || loading()"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{ teacherPage()+1 }}</span><button class="btn" (click)="teacherPage.set(teacherPage()+1)" [disabled]="(teacherPage()+1)*25 >= teacherTotal() || loading()">Далее<mentor-icon name="chevron-right"/></button></nav> }
    </section>
    <section aria-label="Приглашения" class="admin-list"><div class="sh"><div class="title-group"><h2>Приглашения</h2><span class="count">Всего: {{ invitationTotal() }}</span></div></div>
      @if (invitations().length) {
        <div class="table-wrap"><table class="tbl admin-table"><thead><tr><th scope="col">Статус</th><th scope="col">Действует до</th><th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>
        @for (invitation of invitations(); track invitation.id) {
          <tr class="invitation-row"><td><span class="tag" [class.quiet]="invitation.state !== 'pending'"><mentor-icon [name]="invitation.state === 'pending' ? 'mail' : invitation.state === 'used' ? 'user-check' : 'ban'"/>{{ invitationLabels[invitation.state] }}</span></td><td>{{ invitation.expiresAt | date:'dd.MM.yyyy, HH:mm':'+0300' }} МСК</td>
            <td class="act">@if (invitation.state === 'pending') { <button class="btn sm danger" data-action="revoke" (click)="revoke(invitation.id)" [disabled]="busy()"><mentor-icon name="ban"/>Отозвать</button> }</td></tr>
        }</tbody></table></div>
      } @else if (!loading()) { <div class="empty-state mt-16"><h3>Приглашений пока нет</h3><p>Создайте приглашение кнопкой «Пригласить преподавателя».</p></div> }
      @if (invitationTotal() > 25) { <nav class="pagination" aria-label="Страницы приглашений"><button class="btn" (click)="invitationPage.set(invitationPage()-1)" [disabled]="invitationPage() === 0 || loading()"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{ invitationPage()+1 }}</span><button class="btn" (click)="invitationPage.set(invitationPage()+1)" [disabled]="(invitationPage()+1)*25 >= invitationTotal() || loading()">Далее<mentor-icon name="chevron-right"/></button></nav> }
    </section></div>`,
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
  readonly copied = signal(false);
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
  // Blocking is a two-step action: the first click only opens the confirmation beside the button.
  readonly confirming = signal<string | null>(null);
  teacherAccess(teacher: Teacher): void { this.confirming.set(null); this.mutate(this.api.patch('/admin/teachers/{id}/access', { disabled: !teacher.accountDisabled }, { pathParams: { id: teacher.userId } })); }
  workspaceAccess(teacher: Teacher): void { this.confirming.set(null); this.mutate(this.api.patch('/admin/workspaces/{id}/access', { disabled: !teacher.workspaceDisabled }, { pathParams: { id: teacher.workspaceId } })); }
  startReset(teacher: Teacher): void { this.currentPassword.reset(); this.resetTeacher.set(teacher); this.issued.set(null); }
  cancelReset(): void { this.resetTeacher.set(null); this.currentPassword.reset(); }
  issueReset(event: Event): void {
    event.preventDefault();
    if (this.currentPassword.invalid || !this.resetTeacher()) { this.error.set('Подтвердите действие своим текущим паролем.'); return; }
    this.mutate(this.api.post('/admin/teachers/{id}/password-reset', { currentPassword: this.currentPassword.value }, { pathParams: { id: this.resetTeacher()!.userId } }), issue => { this.showIssue(issue); this.cancelReset(); }, false);
  }
  selectLink(event: Event): void { (event.target as HTMLInputElement).select(); }
  copy(link: string): void { void navigator.clipboard?.writeText(link).then(() => this.copied.set(true), () => this.copied.set(false)); }
  private showIssue(issue: LinkIssue): void {
    try {
      const url = new URL(issue.link, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) throw new Error('Invalid issue link');
      this.issued.set({ ...issue, link: url.href }); this.copied.set(false);
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

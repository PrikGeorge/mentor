import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SessionStore } from '../core/session.store';
import { safeReturnUrl } from '../core/session.interceptor';
import { passwordValidator } from '../core/password.validator';
import { IconComponent } from '../core/icon.component';
import { NgTemplateOutlet } from '@angular/common';

@Component({
  selector: 'mentor-auth-page', imports: [ReactiveFormsModule, RouterLink, IconComponent, NgTemplateOutlet],
  template: `
    @if (session.actor() && mode === 'password') {
      <div class="page-head"><div><h1 id="auth-title">{{ heading }}</h1><p class="subtitle">{{ description }}</p></div></div>
      <section class="auth-layout" aria-labelledby="auth-title"><div class="auth-card"><ng-container *ngTemplateOutlet="body"/></div></section>
    } @else {
      <div class="auth-split">
        <aside class="auth-side" aria-hidden="true"><span class="brand"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>Наставник</span></span>
          <p class="motto">Ход — ответ.</p><p>Кабинет индивидуального наставничества по Java backend.</p>
          <div class="auth-art"><div class="auth-clock"><div class="on"><b>Ученик</b><span>твой ход</span></div><div><b>Наставник</b><span>ответил</span></div></div><div class="auth-board"></div></div></aside>
        <div class="auth-main"><section class="auth-layout" aria-labelledby="auth-title"><div class="auth-card"><h1 id="auth-title">{{ heading }}</h1><p class="auth-description">{{ description }}</p><ng-container *ngTemplateOutlet="body"/></div></section></div>
      </div>
    }
    <ng-template #body>
      @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p> }
      @if (message()) { <p class="success-banner" role="status">{{ message() }}</p> }
      <form [formGroup]="form" (ngSubmit)="submit()">
        @if (mode === 'login' || mode === 'register') {
          <label class="auth-field">Логин<input name="login" formControlName="login" autocomplete="username" required maxlength="200" spellcheck="false" autocapitalize="none"></label>
        }
        @if (mode === 'password') {
          <label class="auth-field">Текущий пароль<input name="currentPassword" type="password" formControlName="currentPassword" autocomplete="current-password" required></label>
        }
        <label class="auth-field">{{ mode === 'login' ? 'Пароль' : 'Новый пароль' }}
          <input name="password" type="password" formControlName="password" [attr.autocomplete]="mode === 'login' ? 'current-password' : 'new-password'" required [attr.aria-describedby]="mode === 'login' ? null : 'password-hint'">
          @if (mode !== 'login') { <small id="password-hint">От 8 до 128 символов. Пробелы сохраняются.</small> }
        </label>
        @if (mode !== 'login') {
          <label class="auth-field">Повторите пароль<input name="confirmation" type="password" formControlName="confirmation" autocomplete="new-password" required></label>
        }
        @if (mode === 'password') { <p class="warning-banner m-0"><span>Остальные сессии будут завершены.</span></p> }
        <button class="btn primary" type="submit" [disabled]="busy()">@if (busy()) {<mentor-icon class="spin" name="loader"/>Сохраняем…} @else {<mentor-icon [name]="mode === 'login' ? 'log-in' : mode === 'register' ? 'user-check' : 'save'"/>{{ submitLabel }}}</button>
      </form>
      @if (mode !== 'login' && !session.actor()) { <p class="auth-links"><a routerLink="/login">Перейти ко входу</a></p> }
      @if (mode === 'login') { <p class="auth-note"><mentor-icon name="info"/><span>Для восстановления доступа попросите ссылку у преподавателя или администратора.</span></p> }
    </ng-template>`,
})
export class AuthPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly mode = this.route.snapshot.data['mode'] as 'register' | 'reset' | 'password' | undefined ?? 'login';
  readonly heading = { login: 'Вход', register: 'Приглашение', reset: 'Восстановление пароля', password: 'Смена пароля' }[this.mode];
  readonly description = { login: 'Войдите, чтобы открыть свои занятия и материалы.', register: 'Создайте аккаунт по приглашению. Роль назначит пригласивший.', reset: 'Задайте новый пароль по одноразовой ссылке.', password: 'Подтвердите текущий пароль. Остальные сессии будут завершены.' }[this.mode];
  readonly submitLabel = { login: 'Войти', register: 'Принять приглашение', reset: 'Сохранить пароль', password: 'Изменить пароль' }[this.mode];
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly form = new FormGroup({
    login: new FormControl('', { nonNullable: true, validators: this.mode === 'login' || this.mode === 'register' ? [Validators.required] : [] }),
    password: new FormControl('', { nonNullable: true, validators: this.mode === 'login' ? [Validators.required] : [passwordValidator] }),
    currentPassword: new FormControl('', { nonNullable: true, validators: this.mode === 'password' ? [Validators.required] : [] }),
    confirmation: new FormControl('', { nonNullable: true, validators: this.mode !== 'login' ? [Validators.required] : [] }),
  });
  submit(): void {
    if (this.busy()) return;
    this.error.set(''); this.message.set('');
    const value = this.form.getRawValue();
    if (this.form.invalid || (this.mode !== 'login' && value.password !== value.confirmation)) {
      this.form.markAllAsTouched(); this.error.set('Заполните поля и проверьте совпадение паролей.'); return;
    }
    const token = this.route.snapshot.queryParamMap.get('token');
    if ((this.mode === 'register' || this.mode === 'reset') && !token) { this.error.set('Откройте полную ссылку приглашения или восстановления.'); return; }
    this.busy.set(true);
    const action: Observable<unknown> = this.mode === 'login' ? this.session.signIn(value.login, value.password)
      : this.mode === 'register' ? this.session.register(token!, value.login, value.password)
      : this.mode === 'reset' ? this.session.resetPassword(token!, value.password)
      : this.session.changePassword(value.currentPassword, value.password);
    action.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.form.reset();
        // Remove one-use tokens from history after successful redemption.
        if (this.mode === 'reset') { void this.router.navigate(['/login'], { replaceUrl: true }); return; }
        if (this.mode === 'password') { this.message.set('Пароль изменён.'); return; }
        const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
        const home = this.session.actor()?.role === 'ADMIN' ? '/admin/teachers' : this.session.actor()?.role === 'TEACHER' ? '/teacher/students' : '/learn';
        void this.router.navigateByUrl(returnUrl && !/^\/(login|register|reset-password)(?:[/?#]|$)/.test(returnUrl) ? returnUrl : home, { replaceUrl: true });
      },
      error: (failure: HttpErrorResponse) => { this.form.controls.password.reset(); this.form.controls.confirmation.reset(); this.form.controls.currentPassword.reset(); this.error.set(failure.error?.message ?? 'Не удалось выполнить действие. Попробуйте ещё раз.'); },
    });
  }
}

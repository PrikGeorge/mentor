import { Component, ElementRef, Injector, afterNextRender, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Observable, switchMap } from 'rxjs';
import type { components } from '../api/schema';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { StudentsApi, StudentAccessView } from './students-api.service';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
@Component({ selector: 'mentor-account-access', imports: [ReactiveFormsModule, DatePipe, IconComponent, ErrorBannerComponent], template: `
  <section class="side-section account-access" [class.compact]="compact()" aria-labelledby="access-title"><div class="sh"><h2 id="access-title">Доступ к кабинету</h2></div>
    @if(data();as access){@if(access.account;as account){<div class="account-identity"><span class="small-muted">Логин</span><code>{{account.login}}</code></div>
      <p class="status-line"><span class="tag" [class.on]="!account.disabled"><mentor-icon [name]="account.disabled?'circle-pause':'check'"/>{{account.disabled?'Доступ приостановлен':'Доступ открыт'}}</span></p>
      <div class="access-actions"><button class="btn text reset-link" type="button" (click)="openReset()" [disabled]="busy()"><mentor-icon name="key-round"/>Ссылка для смены пароля</button>@if(confirming()){<span class="inline-confirm" role="group" aria-label="Подтверждение" tabindex="-1"><span class="small-muted">{{account.disabled?'Восстановить доступ ученика?':'Приостановить доступ? Ученик не сможет войти, его работы сохранятся.'}}</span><button class="btn sm" [class.danger]="!account.disabled" type="button" (click)="setDisabled(!account.disabled)" [disabled]="busy()">{{account.disabled?'Да, восстановить':'Да, приостановить'}}</button><button class="btn sm text" type="button" (click)="cancelConfirm()" [disabled]="busy()">Отмена</button></span>}@else{<button class="btn text access-toggle" [class.danger]="!account.disabled" type="button" (click)="confirm()" [disabled]="busy()"><mentor-icon [name]="account.disabled?'circle-play':'circle-pause'"/>{{account.disabled?'Восстановить доступ':'Приостановить доступ'}}</button>}</div>}
    @else{<p>Ученик создаст логин и пароль по вашей ссылке. Его занятия и работы сохранятся.</p>@if(access.invitation;as invitation){<p class="status-line"><span class="tag" [class.quiet]="invitation.state!=='pending'"><mentor-icon [name]="invitation.state==='pending'?'mail':invitation.state==='used'?'user-check':'ban'"/>{{invitationLabels[invitation.state]}}</span><span class="small-muted">до {{invitation.expiresAt|date:'dd.MM.yyyy, HH:mm':'+0300'}} МСК</span></p>}
      <div class="access-actions"><button class="btn sm" (click)="invite()" [disabled]="busy()"><mentor-icon name="link"/>{{access.invitation?.state==='pending'?'Создать новое приглашение':'Создать приглашение'}}</button>@if(access.invitation?.state==='pending'){<button class="btn text danger" (click)="revoke()" [disabled]="busy()"><mentor-icon name="ban"/>Отозвать</button>}</div>}}
    @else if(!error()){<p class="loading" role="status">Загружаем доступ…</p>}
    @if(issued();as issue){<div class="issued-link box"><label class="field">Одноразовая ссылка<input name="accessLink" [value]="issue.link" readonly (focus)="select($event)"></label><p>До {{issue.expiresAt|date:'dd.MM.yyyy, HH:mm':'+0300'}} МСК. Передайте ученику лично. После ухода со страницы ссылка скрывается.</p><div class="form-actions"><button class="btn sm" (click)="copy(issue.link)"><mentor-icon name="copy"/>{{copied()?'Скопировано':'Скопировать'}}</button><button class="btn text" (click)="issued.set(null)">Скрыть ссылку</button></div></div>}
    @if(resetOpen()){<form class="confirm-box box" (submit)="reset($event)" novalidate><label class="field">Ваш текущий пароль<input type="password" name="currentPassword" autocomplete="current-password" [formControl]="password" required [attr.aria-invalid]="passwordMissing()||null" [attr.aria-describedby]="passwordMissing()?'access-password-hint access-password-error':'access-password-hint'"><small id="access-password-hint">Подтвердите действие своим текущим паролем.</small>@if(passwordMissing()){<small class="error" id="access-password-error">Введите текущий пароль.</small>}</label><div class="form-actions"><button class="btn primary" type="submit" [disabled]="busy()">Создать ссылку</button><button class="btn" type="button" (click)="closeReset()">Отмена</button></div></form>}
    @if(error()){<mentor-error-banner [message]="error()" retryLabel="Повторить загрузку" [busy]="busy()" (retry)="reload()"/>}
  </section>` })
export class AccountAccessComponent {
    readonly compact = input(false);
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    private readonly api = inject(StudentsApi);
    private readonly session = inject(SessionStore);
    private readonly scope = createBoundScope(() => [this.workspaceId(), this.studentId()]);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    private readonly refresh = signal(0);
    readonly data = signal<StudentAccessView | null>(null);
    readonly error = signal('');
    readonly busy = signal(false);
    readonly issued = signal<components['schemas']['PasswordResetIssue'] | null>(null);
    readonly resetOpen = signal(false);
    readonly passwordMissing = signal(false);
    readonly copied = signal(false);
    readonly password = new FormControl('', { nonNullable: true, validators: Validators.required });
    // Wording bound by students/student-page.component.spec.ts; the administrator's page uses the short design words.
    readonly invitationLabels = { pending: 'Приглашение действует', used: 'Приглашение использовано', revoked: 'Приглашение отозвано', expired: 'Приглашение истекло' };
    constructor() { effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(); this.refresh(); this.scope.bind(); this.data.set(null); this.error.set(''); this.issued.set(null); this.busy.set(false); this.confirming.set(false); this.copied.set(false); this.cancelReset(); if (!this.scope.current() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== w)
        return; const sub = this.scope.track(this.api.access(w, s)).subscribe({ next: v => this.data.set(v), error: e => this.error.set(e.error?.message ?? 'Не удалось загрузить доступ.') }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    cancelReset() { this.resetOpen.set(false); this.password.reset(); this.passwordMissing.set(false); }
    // Opening and closing by hand move keyboard focus with the box: into the password field, back to the link button.
    openReset() { if (!this.scope.active()) return; this.resetOpen.set(true); this.focus('[name="currentPassword"]'); }
    closeReset() { this.cancelReset(); this.focus('.reset-link'); }
    private focus(selector: string) { const current = this.scope.capture(); afterNextRender(() => { if (current()) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); }, { injector: this.injector }); }
    select(event: Event) { (event.target as HTMLInputElement).select(); }
    copy(link: string) { if (!this.scope.active()) return; const current = this.scope.capture(); void navigator.clipboard?.writeText(link).then(() => { if (current()) this.copied.set(true); }, () => { if (current()) this.copied.set(false); }); }
    private run(action: Observable<unknown>, issue = false) { if (this.busy() || !this.scope.active() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId())
        return; const current = this.scope.capture(), workspace = this.workspaceId(), student = this.studentId(); this.busy.set(true); this.error.set(''); this.issued.set(null); this.copied.set(false); this.scope.track(action.pipe(switchMap(value => { if (!current()) return EMPTY; if (issue) {
        const link = value as components['schemas']['PasswordResetIssue'];
        const url = new URL(link.link, location.origin);
        if (url.origin !== location.origin || !['/register', '/reset-password'].includes(url.pathname))
            throw new Error('Некорректная ссылка.');
        this.issued.set({ ...link, link: url.href });
    } return this.api.access(workspace, student); }))).subscribe({ next: view => { this.data.set(view); this.busy.set(false); }, error: error => { this.error.set(error.error?.message ?? 'Не удалось изменить доступ.'); this.busy.set(false); } }); }
    invite() { if (this.data()?.account)
        return; this.run(this.api.invite(this.workspaceId(), this.studentId()), true); }
    revoke() { const invitation = this.data()?.invitation; if (invitation?.state !== 'pending')
        return; this.run(this.api.revoke(this.workspaceId(), this.studentId(), invitation.id)); }
    // Suspending access is a two-step action: the first click only opens the confirmation and focuses it.
    readonly confirming = signal(false);
    confirm() { if (!this.scope.active()) return; this.confirming.set(true); this.focus('.inline-confirm'); }
    cancelConfirm() { this.confirming.set(false); this.focus('.access-toggle'); }
    setDisabled(disabled: boolean) { if (!this.data()?.account)
        return; this.confirming.set(false); this.run(this.api.changeAccess(this.workspaceId(), this.studentId(), disabled)); }
    reset(event: Event) { event.preventDefault(); if (this.busy() || !this.scope.active()) return; if (this.password.invalid) { this.passwordMissing.set(true); this.focus('[name="currentPassword"]'); return; }
        const password = this.password.value; this.cancelReset(); this.run(this.api.reset(this.workspaceId(), this.studentId(), password), true); }
}

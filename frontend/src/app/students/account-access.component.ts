import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, switchMap } from 'rxjs';
import type { components } from '../api/schema';
import { SessionStore } from '../core/session.store';
import { StudentsApi, StudentAccessView } from './students-api.service';
@Component({ selector: 'mentor-account-access', imports: [ReactiveFormsModule, DatePipe], styleUrl: './account-access.component.scss', template: `
  <section class="panel panel-inner account-access" [class.compact]="compact()"><p class="eyebrow">АККАУНТ УЧЕНИКА</p><h2>Доступ к кабинету</h2>
    @if(data();as access){@if(access.account;as account){<div class="account-identity"><span class="small-muted">Логин</span><strong>{{account.login}}</strong><span class="pill neutral">{{account.disabled?'Доступ приостановлен':'Доступ открыт'}}</span></div><div class="actions"><button class="btn" (click)="setDisabled(!account.disabled)" [disabled]="busy()">{{account.disabled?'Восстановить доступ':'Приостановить доступ'}}</button><button class="btn" (click)="resetOpen.set(true)" [disabled]="busy()">Ссылка для смены пароля</button></div>}
    @else{<p>Ученик создаст логин и пароль по вашей ссылке. Его занятия и работы сохранятся.</p>@if(access.invitation;as invitation){<p>{{invitationLabels[invitation.state]}} · до {{invitation.expiresAt|date:'dd.MM.yyyy HH:mm':'+0300'}} МСК</p>}<div class="actions"><button class="btn" (click)="invite()" [disabled]="busy()">{{access.invitation?.state==='pending'?'Создать новое приглашение':'Создать приглашение'}}</button>@if(access.invitation?.state==='pending'){<button class="btn" (click)="revoke()" [disabled]="busy()">Отозвать</button>}</div>}}
    @else{<p role="status">Загружаем доступ…</p>}
    @if(issued();as issue){<div class="callout"><label class="auth-field">Одноразовая ссылка<input name="accessLink" [value]="issue.link" readonly (focus)="select($event)"></label><p>До {{issue.expiresAt|date:'dd.MM.yyyy HH:mm':'+0300'}} МСК. Передайте ученику лично. После ухода ссылка скрывается.</p><button class="btn" (click)="issued.set(null)">Скрыть ссылку</button></div>}
    @if(resetOpen()){<form (submit)="reset($event)"><label class="auth-field">Ваш текущий пароль<input type="password" name="currentPassword" autocomplete="current-password" [formControl]="password" required></label><div class="actions"><button class="btn primary" type="submit" [disabled]="busy()">Создать ссылку</button><button class="btn" type="button" (click)="cancelReset()">Отмена</button></div></form>}
    @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()" [disabled]="busy()">Повторить загрузку</button>}
  </section>` })
export class AccountAccessComponent {
    readonly compact = input(false);
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    private readonly api = inject(StudentsApi);
    private readonly session = inject(SessionStore);
    private readonly ownerGeneration = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    private readonly refresh = signal(0);
    readonly data = signal<StudentAccessView | null>(null);
    readonly error = signal('');
    readonly busy = signal(false);
    readonly issued = signal<components['schemas']['PasswordResetIssue'] | null>(null);
    readonly resetOpen = signal(false);
    readonly password = new FormControl('', { nonNullable: true, validators: Validators.required });
    readonly invitationLabels = { pending: 'Приглашение действует', used: 'Приглашение использовано', revoked: 'Приглашение отозвано', expired: 'Приглашение истекло' };
    constructor() { effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(); this.refresh(); this.data.set(null); this.error.set(''); this.issued.set(null); this.cancelReset(); if (this.session.actor()?.role !== 'TEACHER')
        return; const sub = this.api.access(w, s).subscribe({ next: v => this.data.set(v), error: e => this.error.set(e.error?.message ?? 'Не удалось загрузить доступ.') }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    cancelReset() { this.resetOpen.set(false); this.password.reset(); }
    select(event: Event) { (event.target as HTMLInputElement).select(); }
    private run(action: Observable<unknown>, issue = false) { if (this.busy() || this.ownerGeneration !== this.session.generation() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId())
        return; this.busy.set(true); this.error.set(''); this.issued.set(null); action.pipe(switchMap(value => { if (issue) {
        const link = value as components['schemas']['PasswordResetIssue'];
        const url = new URL(link.link, location.origin);
        if (url.origin !== location.origin || !['/register', '/reset-password'].includes(url.pathname))
            throw new Error('Некорректная ссылка.');
        this.issued.set({ ...link, link: url.href });
    } return this.api.access(this.workspaceId(), this.studentId()); }), takeUntilDestroyed(this.destroyRef)).subscribe({ next: view => { this.data.set(view); this.busy.set(false); }, error: error => { this.error.set(error.error?.message ?? 'Не удалось изменить доступ.'); this.busy.set(false); } }); }
    invite() { if (this.data()?.account)
        return; this.run(this.api.invite(this.workspaceId(), this.studentId()), true); }
    revoke() { const invitation = this.data()?.invitation; if (invitation?.state !== 'pending')
        return; this.run(this.api.revoke(this.workspaceId(), this.studentId(), invitation.id)); }
    setDisabled(disabled: boolean) { if (!this.data()?.account)
        return; this.run(this.api.changeAccess(this.workspaceId(), this.studentId(), disabled)); }
    reset(event: Event) { event.preventDefault(); if (this.password.invalid || this.busy())
        return; const password = this.password.value; this.cancelReset(); this.run(this.api.reset(this.workspaceId(), this.studentId(), password), true); }
}

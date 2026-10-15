import { Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { HomeworkApi, Submission, validateHomework } from './homework-api.service';
import { LessonReviewComponent } from '../reviews/lesson-review.component';
import { IconComponent } from '../core/icon.component';
import { TurnClockComponent, turnOf } from './turn-clock.component';
import { GradeComponent } from './grade.component';
import { CodeReviewComponent } from '../comments/code-review.component';
@Component({ selector: 'mentor-homework-page', imports: [LessonReviewComponent, IconComponent, TurnClockComponent, GradeComponent, CodeReviewComponent], template: `
<section class="homework-page" [class.single]="!canSubmit()" [hidden]="!active()">
@if(canSubmit()){
<section class="homework-upload" aria-labelledby="homework-upload-title"><div class="sh"><h2 id="homework-upload-title">Сдать домашнюю работу</h2></div><p class="subtitle">Прикрепи проект или отдельный файл. Обратная связь появится под отправленной работой.</p>
<form (submit)="upload($event)" [attr.aria-busy]="busy()">
<label>Файл работы<input #fileInput type="file" name="homeworkFile" accept=".zip,.java,.txt,.md,.pdf" (change)="chooseFile($event)" [disabled]="busy()"><small>ZIP, Java, TXT, Markdown или PDF · непустой файл до 20 МиБ. Проекты не распаковываются и не запускаются.</small></label>
<label>Репозиторий <span class="label-note">· необязательно</span><input type="url" name="repositoryUrl" maxlength="2000" placeholder="https://github.com/…" [value]="repositoryUrl()" (input)="setRepositoryUrl($any($event.target).value)" [readOnly]="busy()"><small>HTTPS-адрес без логина и пароля. Ссылка не загружается сервером.</small></label>
<label>Комментарий к работе <span class="label-note">· необязательно</span><textarea name="comment" rows="3" maxlength="10000" [value]="comment()" (input)="setComment($any($event.target).value)" [readOnly]="busy()"></textarea><small class="counter">{{comment().length}} / 10 000</small></label>
@if(busy()){<div class="upload-progress" role="status" aria-live="polite">{{progress()===null?'Передаём файл…':progress()===100?'Файл передан. Ожидаем подтверждение сохранения…':'Передаём файл: '+progress()+'%'}}@if(progress()!==null){<progress max="100" [value]="progress()" aria-label="Передача файла"></progress>}</div>}
<div class="form-actions"><button class="btn primary" type="submit" [disabled]="busy()||loading()">@if(busy()){<mentor-icon class="spin" name="loader"/>}@else{<mentor-icon name="send"/>}{{unknown()?'Повторить отправку':'Отправить на ревью'}}</button></div>
</form>
@if(succeeded()){<p class="success-banner mt-20" role="status">Работа отправлена на ревью.</p>}
@if(error()){<p class="auth-error mt-20" role="alert">{{error()}}</p>}
@if(unknown()){<div class="warning-banner mt-20"><p>Результат отправки неизвестен. Ответ сервера не дошёл. Повторить безопасно: сервер узнает ту же работу и не создаст дубликат. Можно и сначала обновить историю.</p><button class="btn sm" type="button" (click)="refreshHistory()" [disabled]="loading()"><mentor-icon name="refresh"/>Обновить историю</button></div>}
</section>
}@else if(preview()){<p class="callout">Предпросмотр ученика · Только для чтения. Работу отправляет ученик из своего кабинета.</p>}
<section class="homework-history" aria-labelledby="homework-history-title">@if(latest()!==undefined){<mentor-turn-clock class="mb-16" [turn]="turn()" [viewer]="canReview()?'teacher':'student'" [name]="studentName()" [mini]="true"/>}<div class="sh"><h2 id="homework-history-title">{{mode()==='review'?'Ревью сданных работ':'Отправленные работы'}}</h2>@if(!unknown()){<button class="btn sm" type="button" (click)="refreshHistory()" [disabled]="loading()||busy()"><mentor-icon name="refresh"/>Обновить историю</button>}</div>
<p class="small-muted mt-6">Отзыв к файлу относится только к этой работе. Общий отзыв занятия показан отдельно.</p>
@if(listError()){<p class="auth-error" role="alert">{{listError()}}</p><button class="btn sm" type="button" (click)="refreshHistory()"><mentor-icon name="refresh"/>Повторить загрузку</button>}
@if(loading()){<p class="loading" role="status">Загружаем историю работ…</p>}@else if(!submissions().length&&!listError()){<div class="empty-state mt-16"><h3>Работ пока нет</h3><p>По этому занятию ещё нет сданных работ.</p></div>}
<ol class="works">@for(submission of submissions();track submission.id;let i=$index){<li class="homework-submission"><span class="n">{{total()-page()*25-i}}</span><div><header><h3>{{submission.filename}}</h3><span class="small-muted">{{date(submission.createdAt)}} · {{bytes(submission.size)}}</span><span class="pill" [class.on]="submission.status==='reviewed'" [class.danger]="submission.status==='needs_revision'"><mentor-icon [name]="submission.status==='reviewed'?'check-check':submission.status==='needs_revision'?'rotate-ccw':'clock'"/>{{labels[submission.status]}}</span></header>
@if(submission.comment){<p class="prewrap">«{{submission.comment}}»</p>}<div class="actions"><button class="btn sm text" type="button" (click)="download(submission)"><mentor-icon name="download"/>Скачать файл</button>@if(repositoryLink(submission.repositoryUrl);as url){<a class="btn sm text" [href]="url" target="_blank" rel="noopener noreferrer">Репозиторий ↗</a>}@if(isText(submission)){<button class="btn sm text" type="button" (click)="toggleCode(submission)" [attr.aria-expanded]="openCode()===submission.id"><mentor-icon name="code"/>{{openCode()===submission.id?'Скрыть код':canReview()?'Открыть код и прокомментировать':'Открыть код'}}</button>}</div>
@if(openCode()===submission.id){<div class="submission-code">@if(code();as c){<mentor-code-review [lesson]="lesson()" targetKind="homework" [targetId]="submission.id" [files]="c" [editable]="canReview()" [preview]="preview()"/>}@else if(codeError()){<p class="auth-error" role="alert">{{codeError()}}</p>}@else{<p class="loading" role="status">Загружаем код…</p>}</div>}
@if(downloadErrors()[submission.id]){<p class="auth-error" role="alert">{{downloadErrors()[submission.id]}}</p>}
@if(submission.feedback||submission.grade){<div class="submission-feedback"><h4>Обратная связь к работе@if(submission.reviewedAt){ · {{date(submission.reviewedAt)}}}</h4>@if(submission.grade){<p class="grade-line"><mentor-grade [grade]="submission.grade"/></p>}@if(submission.feedback){<p class="prewrap">{{submission.feedback}}</p>}</div>}
@if(canReview()){<mentor-lesson-review [lesson]="lesson()" [submission]="submission" [preview]="preview()" (reviewed)="updatedReview($event)"/>}
</div></li>}</ol>
@if(total()>25){<nav class="pagination" aria-label="Страницы работ"><button class="btn" type="button" [disabled]="loading()||page()===0" (click)="setPage(page()-1)"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{page()+1}}</span><button class="btn" type="button" [disabled]="loading()||(page()+1)*25>=total()" (click)="setPage(page()+1)">Далее<mentor-icon name="chevron-right"/></button></nav>}
</section></section>` })
export class HomeworkPageComponent {
    readonly lesson = input.required<LessonRef>(); readonly preview = input(false); readonly mode = input<'homework'|'review'>('homework'); readonly studentName = input('');
    // The newest submission of this lesson decides whose turn it is; undefined until the first page arrives.
    readonly latest = signal<Submission | null | undefined>(undefined); readonly turn = computed(() => turnOf(this.latest()));
    readonly file = signal<File|null>(null); readonly comment = signal(''); readonly repositoryUrl = signal(''); readonly succeeded = signal(false); readonly progress = signal<number|null>(null); readonly unknown = signal(false); readonly error = signal('');
    readonly submissions = signal<Submission[]>([]); readonly loading = signal(false); readonly listError = signal(''); readonly page = signal(0); readonly total = signal(0); readonly busy = signal(false); readonly downloadErrors = signal<Record<string,string>>({});
    // One work's code is open at a time; its text is fetched on demand and never cached across lessons.
    readonly openCode = signal<string | null>(null); readonly code = signal<Record<string, string> | null>(null); readonly codeError = signal(''); private codeRequest?: Subscription;
    readonly labels = { submitted: 'Ожидает проверки', reviewed: 'Проверено', needs_revision: 'Нужна доработка' };
    private readonly session = inject(SessionStore); private readonly api = inject(HomeworkApi); private readonly owner = this.session.generation();
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    private readonly bound = signal<LessonRef|null>(null); private alive = true; private sequence = 0; private uploadRequest?: Subscription; private listRequest?: Subscription; private downloads: Subscription[] = []; private urls = new Set<string>();
    readonly active = computed(() => { const b = this.bound(), l = this.lesson(); return this.alive && this.owner === this.session.generation() && this.session.actor()?.workspaceId === l.workspaceId && b?.workspaceId === l.workspaceId && b.studentId === l.studentId && b.id === l.id; });
    readonly canSubmit = computed(() => this.active() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.mode() === 'homework');
    readonly canReview = computed(() => this.active() && this.session.actor()?.role === 'TEACHER' && !this.preview());
    constructor() {
        effect(() => { const lesson = this.lesson(); this.session.generation(); this.preview(); this.mode(); this.cancel(); this.bound.set({ ...lesson }); this.file.set(null); untracked(() => { const input = this.fileInput(); if (input) input.nativeElement.value = ''; }); this.comment.set(''); this.repositoryUrl.set(''); this.idempotencyKey = null; this.succeeded.set(false); this.progress.set(null); this.unknown.set(false); this.error.set(''); this.listError.set(''); this.downloadErrors.set({}); this.submissions.set([]); this.latest.set(undefined); this.page.set(0); this.total.set(0); if (this.active()) this.load(0); });
        inject(DestroyRef).onDestroy(() => { this.alive = false; this.cancel(); });
    }
    private cancel() { this.sequence++; this.codeRequest?.unsubscribe(); this.openCode.set(null); this.code.set(null); this.codeError.set(''); this.uploadRequest?.unsubscribe(); this.listRequest?.unsubscribe(); for (const request of this.downloads) request.unsubscribe(); this.downloads = []; for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear(); this.busy.set(false); this.loading.set(false); }
    private load(page: number) {
        if (!this.active()) return; this.listRequest?.unsubscribe(); this.loading.set(true); this.listError.set(''); const stamp = this.sequence;
        this.listRequest = this.api.list(this.lesson(), page).subscribe({ next: result => { if (this.active() && stamp === this.sequence) { this.submissions.set(result.items); if (page === 0) this.latest.set(result.items[0] ?? null); this.total.set(result.total); this.loading.set(false); this.unknown.set(false); } }, error: error => { if (this.active() && stamp === this.sequence) { this.loading.set(false); this.listError.set(error.error?.message ?? 'Не удалось загрузить историю работ.'); } } });
    }
    refreshHistory() { if (!this.active() || this.busy()) return; this.page.set(0); this.load(0); }
    setPage(page: number) { if (!this.active() || this.busy() || this.loading()) return; this.page.set(page); this.load(page); }
    // One Idempotency-Key per upload attempt: kept while the same file, comment and link are retried after a lost
    // response, dropped as soon as any of them changes or the work is confirmed, so a changed form never collides.
    private idempotencyKey: string | null = null;
    private resetKey() { this.idempotencyKey = null; this.unknown.set(false); }
    private newKey() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
    chooseFile(event: Event) { if (!this.canSubmit() || this.busy()) return; this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); this.succeeded.set(false); this.error.set(''); this.resetKey(); }
    setComment(value: string) { if (this.busy()) return; this.comment.set(value); this.resetKey(); }
    setRepositoryUrl(value: string) { if (this.busy()) return; this.repositoryUrl.set(value); this.resetKey(); }
    // After a confirmed upload the form is emptied so a second click cannot send the same work again by accident.
    private clearForm() { this.file.set(null); const input = this.fileInput(); if (input) input.nativeElement.value = ''; this.comment.set(''); this.repositoryUrl.set(''); this.resetKey(); }
    upload(event?: Event) {
        event?.preventDefault(); if (!this.canSubmit() || this.busy() || this.loading()) return; this.succeeded.set(false); this.error.set('');
        const file = this.file(), invalid = validateHomework(file, this.comment(), this.repositoryUrl()); if (invalid) { this.error.set(invalid); return; }
        const key = this.idempotencyKey ??= this.newKey();
        this.busy.set(true); this.progress.set(null); const stamp = this.sequence;
        this.uploadRequest = this.api.upload(this.lesson(), file!, this.comment(), this.repositoryUrl(), () => this.canSubmit() && stamp === this.sequence, key).subscribe({ next: event => {
            if (!this.active() || stamp !== this.sequence) return;
            if (event.type === HttpEventType.UploadProgress) this.progress.set(event.total ? Math.min(100, Math.floor(event.loaded/event.total*100)) : null);
            if (event instanceof HttpResponse && event.status === 201 && event.body) { this.busy.set(false); this.clearForm(); this.succeeded.set(true); this.page.set(0); this.load(0); }
        }, error: error => { if (this.active() && stamp === this.sequence) { this.busy.set(false); this.progress.set(null); this.unknown.set(error.status === 0 || error.status === 503); this.error.set(error.error?.message ?? error.message ?? 'Не удалось подтвердить отправку.'); } } });
    }
    updatedReview(result: Submission) { if (!this.canReview()) return; this.submissions.update(items => items.map(item => item.id === result.id ? result : item)); if (this.latest()?.id === result.id) this.latest.set(result); }
    isText(submission: Submission) { return /\.(java|txt|md)$/i.test(submission.filename) && submission.size <= 262144; }
    toggleCode(submission: Submission) {
        this.codeRequest?.unsubscribe(); this.code.set(null); this.codeError.set('');
        if (this.openCode() === submission.id) { this.openCode.set(null); return; }
        this.openCode.set(submission.id); const stamp = this.sequence;
        this.codeRequest = this.api.text(this.lesson(), submission.id).subscribe({ next: text => { if (this.active() && stamp === this.sequence) this.code.set({ [text.filename]: text.text }); }, error: error => { if (this.active() && stamp === this.sequence) this.codeError.set(error.status === 415 ? 'Этот файл нельзя показать как текст. Скачайте его.' : 'Не удалось загрузить код работы.'); } });
    }
    download(submission: Submission) {
        if (!this.active()) return; const stamp = this.sequence;
        const request = this.api.download(this.lesson(), submission.id).subscribe({ next: blob => { if (!this.active() || stamp !== this.sequence) return; const url = URL.createObjectURL(blob); this.urls.add(url); const anchor = document.createElement('a'); anchor.href = url; anchor.download = submission.filename; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); }, 0); }, error: error => { if (this.active() && stamp === this.sequence) this.downloadErrors.update(errors => ({ ...errors, [submission.id]: error.error?.message ?? 'Не удалось скачать работу.' })); } }); this.downloads.push(request);
    }
    date(value: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
    bytes(value: number) { return value >= 1048576 ? (value/1048576).toFixed(1)+' МиБ' : value >= 1024 ? (value/1024).toFixed(1)+' КиБ' : value+' байт'; }
    repositoryLink(value: string) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; } }
}


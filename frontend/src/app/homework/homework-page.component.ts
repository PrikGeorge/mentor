import { Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { HomeworkApi, Submission, validateHomework } from './homework-api.service';
import { LessonReviewComponent } from '../reviews/lesson-review.component';
@Component({ selector: 'mentor-homework-page', imports: [LessonReviewComponent], template: `
<section class="homework-page" [hidden]="!active()">
@if(canSubmit()){
<section class="panel panel-inner homework-upload"><p class="eyebrow">НА РЕВЬЮ</p><h2>Сдать домашнюю работу</h2><p class="subtitle">Прикрепите проект или отдельный файл. Обратная связь появится под отправленной работой.</p>
<form (submit)="upload($event)" [attr.aria-busy]="busy()">
<label>Файл работы<input #fileInput type="file" name="homeworkFile" accept=".zip,.java,.txt,.md,.pdf" (change)="chooseFile($event)" [disabled]="busy()"><small>ZIP, Java, TXT, Markdown или PDF · непустой файл до 20 МиБ. Проекты не распаковываются и не запускаются.</small></label>
<label>Комментарий к работе<textarea name="comment" rows="3" maxlength="10000" [value]="comment()" (input)="comment.set($any($event.target).value)" [readOnly]="busy()"></textarea></label>
<label>Репозиторий · необязательно<input type="url" name="repositoryUrl" maxlength="2000" placeholder="https://github.com/…" [value]="repositoryUrl()" (input)="repositoryUrl.set($any($event.target).value)" [readOnly]="busy()"><small>HTTPS-адрес без логина и пароля. Ссылка не загружается сервером.</small></label>
@if(busy()){<div role="status" aria-live="polite">{{progress()===null?'Передаём файл…':progress()===100?'Файл передан. Ожидаем подтверждение сохранения…':'Передаём файл: '+progress()+'%'}}@if(progress()!==null){<progress max="100" [value]="progress()" aria-label="Передача файла"></progress>}</div>}
<div class="actions"><button class="btn primary" type="submit" [disabled]="busy()||unknown()||loading()">Отправить на ревью</button></div>
</form>
@if(succeeded()){<p class="success-banner" role="status">Работа отправлена на ревью.</p>}
@if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
@if(unknown()){<div class="callout"><p>Результат отправки неизвестен. Работа могла сохраниться. Обновите историю перед повторной отправкой — новая отправка создаёт отдельную работу.</p><button class="btn" type="button" (click)="refreshHistory()" [disabled]="loading()">Обновить историю</button></div>}
</section>
}@else if(preview()){<p class="callout">Предпросмотр ученика · Только для чтения. Работу отправляет ученик из своего кабинета.</p>}
<section class="panel panel-inner homework-history"><h2>{{mode()==='review'?'Ревью сданных работ':'Отправленные работы'}}</h2><p class="small-muted">Отзыв к файлу относится только к этой работе. Общий отзыв занятия показан отдельно.</p>
@if(listError()){<p class="auth-error" role="alert">{{listError()}}</p><button class="btn" type="button" (click)="refreshHistory()">Повторить загрузку</button>}
@if(loading()){<p role="status">Загружаем историю работ…</p>}@else if(!submissions().length&&!listError()){<p class="empty-state">По этому занятию ещё нет сданных работ.</p>}
@for(submission of submissions();track submission.id){<article class="homework-submission"><header><div><h3>{{submission.filename}}</h3><p class="small-muted">{{date(submission.createdAt)}} · {{bytes(submission.size)}}</p></div><span class="pill" [class.success]="submission.status==='reviewed'">{{labels[submission.status]}}</span></header>
@if(submission.comment){<p class="prewrap">{{submission.comment}}</p>}<div class="actions"><button class="btn" type="button" (click)="download(submission)">↓ Скачать файл</button>@if(repositoryLink(submission.repositoryUrl);as url){<a class="btn" [href]="url" target="_blank" rel="noopener noreferrer">Репозиторий ↗</a>}</div>
@if(downloadErrors()[submission.id]){<p class="auth-error" role="alert">{{downloadErrors()[submission.id]}}</p>}
@if(submission.feedback){<div class="submission-feedback"><h4>Обратная связь к работе</h4>@if(submission.reviewedAt){<p class="small-muted">{{date(submission.reviewedAt)}}</p>}<p class="prewrap">{{submission.feedback}}</p></div>}
@if(canReview()){<mentor-lesson-review [lesson]="lesson()" [submission]="submission" [preview]="preview()" (reviewed)="updatedReview($event)"/>}
</article>}
@if(total()>25){<nav class="pagination" aria-label="Страницы работ"><button class="btn" type="button" [disabled]="loading()||page()===0" (click)="setPage(page()-1)">Назад</button><span>Страница {{page()+1}}</span><button class="btn" type="button" [disabled]="loading()||(page()+1)*25>=total()" (click)="setPage(page()+1)">Далее</button></nav>}
</section></section>` })
export class HomeworkPageComponent {
    readonly lesson = input.required<LessonRef>(); readonly preview = input(false); readonly mode = input<'homework'|'review'>('homework');
    readonly file = signal<File|null>(null); readonly comment = signal(''); readonly repositoryUrl = signal(''); readonly succeeded = signal(false); readonly progress = signal<number|null>(null); readonly unknown = signal(false); readonly error = signal('');
    readonly submissions = signal<Submission[]>([]); readonly loading = signal(false); readonly listError = signal(''); readonly page = signal(0); readonly total = signal(0); readonly busy = signal(false); readonly downloadErrors = signal<Record<string,string>>({});
    readonly labels = { submitted: 'Ожидает проверки', reviewed: 'Проверено', needs_revision: 'Нужна доработка' };
    private readonly session = inject(SessionStore); private readonly api = inject(HomeworkApi); private readonly owner = this.session.generation();
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    private readonly bound = signal<LessonRef|null>(null); private alive = true; private sequence = 0; private uploadRequest?: Subscription; private listRequest?: Subscription; private downloads: Subscription[] = []; private urls = new Set<string>();
    readonly active = computed(() => { const b = this.bound(), l = this.lesson(); return this.alive && this.owner === this.session.generation() && this.session.actor()?.workspaceId === l.workspaceId && b?.workspaceId === l.workspaceId && b.studentId === l.studentId && b.id === l.id; });
    readonly canSubmit = computed(() => this.active() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.mode() === 'homework');
    readonly canReview = computed(() => this.active() && this.session.actor()?.role === 'TEACHER' && !this.preview());
    constructor() {
        effect(() => { const lesson = this.lesson(); this.session.generation(); this.preview(); this.mode(); this.cancel(); this.bound.set({ ...lesson }); this.file.set(null); untracked(() => { const input = this.fileInput(); if (input) input.nativeElement.value = ''; }); this.comment.set(''); this.repositoryUrl.set(''); this.succeeded.set(false); this.progress.set(null); this.unknown.set(false); this.error.set(''); this.listError.set(''); this.downloadErrors.set({}); this.submissions.set([]); this.page.set(0); this.total.set(0); if (this.active()) this.load(0); });
        inject(DestroyRef).onDestroy(() => { this.alive = false; this.cancel(); });
    }
    private cancel() { this.sequence++; this.uploadRequest?.unsubscribe(); this.listRequest?.unsubscribe(); for (const request of this.downloads) request.unsubscribe(); this.downloads = []; for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear(); this.busy.set(false); this.loading.set(false); }
    private load(page: number) {
        if (!this.active()) return; this.listRequest?.unsubscribe(); this.loading.set(true); this.listError.set(''); const stamp = this.sequence;
        this.listRequest = this.api.list(this.lesson(), page).subscribe({ next: result => { if (this.active() && stamp === this.sequence) { this.submissions.set(result.items); this.total.set(result.total); this.loading.set(false); this.unknown.set(false); } }, error: error => { if (this.active() && stamp === this.sequence) { this.loading.set(false); this.listError.set(error.error?.message ?? 'Не удалось загрузить историю работ.'); } } });
    }
    refreshHistory() { if (!this.active() || this.busy()) return; this.page.set(0); this.load(0); }
    setPage(page: number) { if (!this.active() || this.busy() || this.loading()) return; this.page.set(page); this.load(page); }
    chooseFile(event: Event) { if (!this.canSubmit() || this.busy()) return; this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); this.succeeded.set(false); this.error.set(''); }
    upload(event?: Event) {
        event?.preventDefault(); if (!this.canSubmit() || this.busy() || this.unknown() || this.loading()) return; this.succeeded.set(false); this.error.set('');
        const file = this.file(), invalid = validateHomework(file, this.comment(), this.repositoryUrl()); if (invalid) { this.error.set(invalid); return; }
        this.busy.set(true); this.progress.set(null); const stamp = this.sequence;
        this.uploadRequest = this.api.upload(this.lesson(), file!, this.comment(), this.repositoryUrl(), () => this.canSubmit() && stamp === this.sequence).subscribe({ next: event => {
            if (!this.active() || stamp !== this.sequence) return;
            if (event.type === HttpEventType.UploadProgress) this.progress.set(event.total ? Math.min(100, Math.floor(event.loaded/event.total*100)) : null);
            if (event instanceof HttpResponse && event.status === 201 && event.body) { this.busy.set(false); this.succeeded.set(true); this.page.set(0); this.load(0); }
        }, error: error => { if (this.active() && stamp === this.sequence) { this.busy.set(false); this.progress.set(null); this.unknown.set(error.status === 0 || error.status === 503); this.error.set(error.error?.message ?? error.message ?? 'Не удалось подтвердить отправку.'); } } });
    }
    updatedReview(result: Submission) { if (!this.canReview()) return; this.submissions.update(items => items.map(item => item.id === result.id ? result : item)); }
    download(submission: Submission) {
        if (!this.active()) return; const stamp = this.sequence;
        const request = this.api.download(this.lesson(), submission.id).subscribe({ next: blob => { if (!this.active() || stamp !== this.sequence) return; const url = URL.createObjectURL(blob); this.urls.add(url); const anchor = document.createElement('a'); anchor.href = url; anchor.download = submission.filename; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); }, 0); }, error: error => { if (this.active() && stamp === this.sequence) this.downloadErrors.update(errors => ({ ...errors, [submission.id]: error.error?.message ?? 'Не удалось скачать работу.' })); } }); this.downloads.push(request);
    }
    date(value: string) { return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }); }
    bytes(value: number) { return value >= 1048576 ? (value/1048576).toFixed(1)+' МиБ' : value >= 1024 ? (value/1024).toFixed(1)+' КиБ' : value+' байт'; }
    repositoryLink(value: string) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; } }
}


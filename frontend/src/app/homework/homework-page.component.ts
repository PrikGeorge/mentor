import { Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { readResource } from '../core/read-resource';
import { HomeworkApi, Submission, validateHomework } from './homework-api.service';
import { LessonReviewComponent } from '../reviews/lesson-review.component';
import { IconComponent } from '../core/icon.component';
import { TurnClockComponent, turnOf } from './turn-clock.component';
import { GradeComponent } from './grade.component';
import { CodeReviewComponent } from '../comments/code-review.component';
import { PaginationComponent } from '../core/pagination.component';
import { FileSizePipe } from '../core/file-size.pipe';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { AnswerFormat, answerBytes, answerFile, answerFilename, answerSize, validateAnswer } from './text-answer';
import { afterDeadline, dueLine, HomeworkDue } from './homework-due';
import { errorMessage, apiProblem } from '../core/api-error';
import { saveBlob } from '../core/download';
@Component({ selector: 'mentor-homework-page', imports: [LessonReviewComponent, IconComponent, TurnClockComponent, GradeComponent, CodeReviewComponent, PaginationComponent, FileSizePipe, ErrorBannerComponent], template: `
<section class="homework-page" [class.single]="!canSubmit()" [hidden]="!active()">
@if(canSubmit()){
<section class="homework-upload" aria-labelledby="homework-upload-title"><div class="sh"><h2 id="homework-upload-title">Сдать домашнюю работу</h2></div><p class="subtitle">Прикрепи проект или файл либо напиши ответ текстом. Ревью наставника появится под отправленной работой.</p>
@if(due();as d){<p class="due-line" [class.overdue]="d.state==='overdue'"><mentor-icon name="clock"/>{{dueText(d,'student')}}</p>}
<form (submit)="upload($event)" novalidate [attr.aria-busy]="busy()">
<div class="seg answer-mode" role="group" aria-label="Способ сдачи"><button type="button" [attr.aria-pressed]="answerMode()==='file'" (click)="setAnswerMode('file')" [disabled]="busy()"><mentor-icon name="file-up"/>Файл</button><button type="button" [attr.aria-pressed]="answerMode()==='text'" (click)="setAnswerMode('text')" [disabled]="busy()"><mentor-icon name="pencil"/>Текстом</button></div>
<label class="field" [hidden]="answerMode()!=='file'">Файл работы<input #fileInput type="file" name="homeworkFile" accept=".zip,.java,.txt,.md,.pdf" (change)="chooseFile($event)" [disabled]="busy()"><small>ZIP, Java, TXT, Markdown или PDF · непустой файл до 20 МиБ. Проекты не распаковываются и не запускаются.</small></label>
@if(answerMode()==='text'){<div class="field answer-field"><label for="homework-answer">Ответ</label><textarea id="homework-answer" class="answer" name="answer" rows="14" spellcheck="false" autocomplete="off" [value]="answer()" (input)="setAnswer($any($event.target).value)" [readOnly]="busy()" [attr.aria-invalid]="answerError()?true:null" aria-describedby="homework-answer-hint homework-answer-size"></textarea>
<div class="answer-format"><div class="seg" role="group" aria-label="Формат ответа"><button type="button" [attr.aria-pressed]="format()==='java'" (click)="setFormat('java')" [disabled]="busy()">Код Java</button><button type="button" [attr.aria-pressed]="format()==='md'" (click)="setFormat('md')" [disabled]="busy()">Текст или Markdown</button></div><small class="counter" id="homework-answer-size">{{answerSize()}}</small></div>
<small id="homework-answer-hint">Сохранится как файл <span class="mono">{{answerName()}}</span> — наставник сможет прокомментировать строки.</small>@if(answerError();as text){<small class="error" role="alert">{{text}}</small>}</div>}
<label class="field">Репозиторий <span class="label-note">· необязательно</span><input type="url" name="repositoryUrl" maxlength="2000" placeholder="https://github.com/…" [value]="repositoryUrl()" (input)="setRepositoryUrl($any($event.target).value)" [readOnly]="busy()"><small>HTTPS-адрес без логина и пароля. Ссылка не загружается сервером.</small></label>
<label class="field">Комментарий к работе <span class="label-note">· необязательно</span><textarea name="comment" rows="3" maxlength="10000" [value]="comment()" (input)="setComment($any($event.target).value)" [readOnly]="busy()"></textarea><small class="counter">{{comment().length}} / 10 000</small></label>
@if(busy()){<div class="upload-progress" role="status" aria-live="polite">{{progress()===null?'Передаём файл…':progress()===100?'Файл передан. Сервер сохраняет работу…':'Передаём файл: '+progress()+'%'}}@if(progress()!==null){<progress max="100" [value]="progress()" aria-label="Передача файла"></progress>}</div>}
<div class="form-actions"><button class="btn primary" type="submit" [disabled]="busy()||loading()">@if(busy()){<mentor-icon class="spin" name="loader"/>}@else{<mentor-icon name="send"/>}{{unknown()?'Повторить отправку':'Отправить на ревью'}}</button></div>
</form>
@if(succeeded()){<p class="success-banner mt-20" role="status">Работа отправлена на ревью.</p>}
@if(error()){<mentor-error-banner class="mt-20" [message]="error()"/>}
@if(unknown()){<div class="warning-banner mt-20"><p>Ответ сервера не дошёл, поэтому неясно, сохранилась ли работа. Отправь ещё раз: повтор не создаст копию. Или сначала обнови историю и проверь.</p><button class="btn sm" type="button" (click)="refreshHistory()" [disabled]="loading()"><mentor-icon name="refresh"/>Обновить историю</button></div>}
</section>
}@else if(preview()){<p class="callout">Предпросмотр кабинета ученика · только чтение. Работу отправляет ученик из своего кабинета.</p>}
<section class="homework-history" aria-labelledby="homework-history-title">@if(latest()!==undefined){<mentor-turn-clock class="mb-16" [turn]="turn()" [viewer]="canReview()?'teacher':'student'" [name]="studentName()" [mini]="true" [motionKey]="lesson().id"/>}<div class="sh"><h2 id="homework-history-title">{{mode()==='review'?'Ревью сданных работ':'Отправленные работы'}}</h2>@if(!unknown()){<button class="btn sm" type="button" (click)="refreshHistory()" [disabled]="loading()||busy()"><mentor-icon name="refresh"/>Обновить историю</button>}</div>
<p class="small-muted mt-6">Ревью к файлу относится только к этой работе. Общее ревью занятия показано отдельно.</p>
@if(canReview()&&due();as d){<p class="due-line mt-6" [class.overdue]="d.state==='overdue'"><mentor-icon name="clock"/>{{dueText(d,'teacher')}}</p>}
@if(listError()){<mentor-error-banner class="mt-16" [message]="listError()" retryLabel="Повторить загрузку" [busy]="loading()" (retry)="refreshHistory()"/>}
@if(loading()){<p class="loading" role="status">Загружаем историю работ…</p>}@else if(!submissions().length&&!listError()){<div class="empty-state mt-16"><h3>Работ пока нет</h3><p>По этому занятию ещё нет сданных работ.</p></div>}
<ol class="works">@for(submission of submissions();track submission.id;let i=$index){<li class="homework-submission"><span class="n">{{total()-page()*25-i}}</span><div><header><h3>{{submission.filename}}</h3><span class="small-muted">{{date(submission.createdAt)}} · {{submission.size|fileSize}}@if(late(submission)){ · после срока}</span><span class="tag" [class.on]="submission.status==='reviewed'" [class.danger]="submission.status==='needs_revision'"><mentor-icon [name]="submission.status==='reviewed'?'check-check':submission.status==='needs_revision'?'rotate-ccw':'clock'"/>{{labels[submission.status]}}</span></header>
@if(submission.comment){<p class="prewrap">«{{submission.comment}}»</p>}<div class="actions"><button class="btn sm text" type="button" (click)="download(submission)"><mentor-icon name="download"/>Скачать файл</button>@if(repositoryLink(submission.repositoryUrl);as url){<a class="btn sm text" [href]="url" target="_blank" rel="noopener noreferrer">Репозиторий ↗</a>}@if(isText(submission)){<button class="btn sm text" type="button" (click)="toggleCode(submission)" [attr.aria-expanded]="openCode()===submission.id"><mentor-icon name="code"/>{{openCode()===submission.id?'Скрыть код':canReview()?'Открыть код и прокомментировать':'Открыть код'}}</button>}</div>
@if(openCode()===submission.id){<div class="submission-code">@if(code();as c){<mentor-code-review [lesson]="lesson()" targetKind="homework" [targetId]="submission.id" [files]="c" [editable]="canReview()" [preview]="preview()"/>}@else if(codeError()){<mentor-error-banner [message]="codeError()" retryLabel="Повторить загрузку" (retry)="loadCode(submission)"/>}@else{<p class="loading" role="status">Загружаем код…</p>}</div>}
@if(downloadErrors()[submission.id]){<mentor-error-banner class="mt-16" [message]="downloadErrors()[submission.id]" retryLabel="Повторить скачивание" icon="download" (retry)="download(submission)"/>}
@if(submission.feedback||submission.grade){<div class="submission-feedback"><h4>Ревью работы@if(submission.reviewedAt){ · {{date(submission.reviewedAt)}}}</h4>@if(submission.grade){<p class="grade-line"><mentor-grade [grade]="submission.grade"/></p>}@if(submission.feedback){<p class="prewrap">{{submission.feedback}}</p>}</div>}
@if(canReview()){<mentor-lesson-review [lesson]="lesson()" [submission]="submission" [preview]="preview()" (reviewed)="updatedReview($event)"/>}
</div></li>}</ol>
<mentor-pagination [page]="page()" [total]="total()" [disabled]="loading()||busy()" label="Страницы работ" (pageChange)="setPage($event)"/>
</section></section>` })
export class HomeworkPageComponent {
    readonly lesson = input.required<LessonRef>(); readonly preview = input(false); readonly mode = input<'homework'|'review'>('homework'); readonly studentName = input('');
    // T09: the lesson's homework deadline, if any; it never blocks a submission.
    readonly due = input<HomeworkDue | null>(null);
    dueText(due: HomeworkDue, viewer: 'teacher'|'student') { return dueLine(due, viewer); }
    late(submission: Submission) { return afterDeadline(this.due(), submission.createdAt); }
    // The newest submission of this lesson decides whose turn it is; undefined until the first page arrives.
    readonly latest = signal<Submission | null | undefined>(undefined); readonly turn = computed(() => turnOf(this.latest()));
    // T13: the work is either a chosen file or an answer typed here; the typed answer is sent as one text file.
    readonly answerMode = signal<'file'|'text'>('file'); readonly answer = signal(''); readonly format = signal<AnswerFormat>('java'); readonly answerError = signal('');
    readonly answerName = computed(() => answerFilename(this.answer(), this.format())); readonly answerSize = computed(() => answerSize(answerBytes(this.answer())));
    readonly file = signal<File|null>(null); readonly comment = signal(''); readonly repositoryUrl = signal(''); readonly succeeded = signal(false); readonly progress = signal<number|null>(null); readonly unknown = signal(false); readonly error = signal('');
    readonly submissions = signal<Submission[]>([]); readonly loading = signal(false); readonly listError = signal(''); readonly page = signal(0); readonly total = signal(0); readonly busy = signal(false); readonly downloadErrors = signal<Record<string,string>>({});
    // One work's code is open at a time; its text is fetched on demand and never cached across lessons.
    readonly openCode = signal<string | null>(null); readonly code = signal<Record<string, string> | null>(null); readonly codeError = signal(''); private codeRequest?: Subscription;
    readonly labels = { submitted: 'Ожидает проверки', reviewed: 'Проверено', needs_revision: 'Нужна доработка' };
    private readonly session = inject(SessionStore); private readonly api = inject(HomeworkApi);
    private readonly scope = createBoundScope(() => { const lesson = this.lesson(); return [lesson.workspaceId, lesson.studentId, lesson.id, this.preview(), this.mode()]; });
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    private sequence = 0; private uploadRequest?: Subscription; private downloads: Subscription[] = [];
    readonly active = computed(() => this.scope.active() && this.session.actor()?.workspaceId === this.lesson().workspaceId);
    readonly canSubmit = computed(() => this.active() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.mode() === 'homework');
    readonly canReview = computed(() => this.active() && this.session.actor()?.role === 'TEACHER' && !this.preview());
    private readonly historyRefresh = signal(0);
    private readonly historyReading = readResource({
        scope: this.scope,
        params: () => this.active() ? { lesson: this.lesson(), page: this.page(), refresh: this.historyRefresh() } : undefined,
        load: request => this.api.list(request.lesson, request.page),
    });
    constructor() {
        effect(() => { this.session.generation(); this.scope.bind(); this.cancel(); this.file.set(null); untracked(() => { const input = this.fileInput(); if (input) input.nativeElement.value = ''; }); this.comment.set(''); this.repositoryUrl.set(''); this.answerMode.set('file'); this.answer.set(''); this.format.set('java'); this.answerError.set(''); this.idempotencyKey = null; this.succeeded.set(false); this.progress.set(null); this.unknown.set(false); this.error.set(''); this.listError.set(''); this.downloadErrors.set({}); this.submissions.set([]); this.latest.set(undefined); this.page.set(0); this.total.set(0); });
        effect(() => {
            const state = this.historyReading.state();
            this.loading.set(state.status === 'loading');
            this.listError.set(state.status === 'error' ? errorMessage(state.error, 'Не удалось загрузить историю работ.') : '');
            if (state.status !== 'resolved') return;
            this.submissions.set(state.value.items); this.total.set(state.value.total); this.unknown.set(false);
            if (state.params.page === 0) this.latest.set(state.value.items[0] ?? null);
        });
        inject(DestroyRef).onDestroy(() => this.cancel());
    }
    private cancel() { this.sequence++; this.codeRequest?.unsubscribe(); this.openCode.set(null); this.code.set(null); this.codeError.set(''); this.uploadRequest?.unsubscribe(); for (const request of this.downloads) request.unsubscribe(); this.downloads = []; this.busy.set(false); this.loading.set(false); }
    private load(page: number) { if (this.active()) { this.page.set(page); this.historyRefresh.update(value => value + 1); } }
    refreshHistory() { if (!this.active() || this.busy()) return; this.page.set(0); this.load(0); }
    setPage(page: number) { if (!this.active() || this.busy() || this.loading()) return; this.page.set(page); this.load(page); }
    // One Idempotency-Key per upload attempt: kept while the same file, comment and link are retried after a lost
    // response, dropped as soon as any of them changes or the work is confirmed, so a changed form never collides.
    private idempotencyKey: string | null = null;
    private resetKey() { this.idempotencyKey = null; this.unknown.set(false); }
    private newKey() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
    chooseFile(event: Event) { if (!this.canSubmit() || this.busy()) return; this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); this.succeeded.set(false); this.error.set(''); this.resetKey(); }
    // Switching keeps what was typed or chosen in the other mode; only the active one is sent.
    setAnswerMode(mode: 'file'|'text') { if (!this.canSubmit() || this.busy() || this.answerMode() === mode) return; this.answerMode.set(mode); this.succeeded.set(false); this.error.set(''); this.answerError.set(''); this.resetKey(); }
    setAnswer(value: string) { if (this.busy()) return; this.answer.set(value); this.answerError.set(''); this.succeeded.set(false); this.resetKey(); }
    setFormat(format: AnswerFormat) { if (this.busy() || this.format() === format) return; this.format.set(format); this.resetKey(); }
    setComment(value: string) { if (this.busy()) return; this.comment.set(value); this.resetKey(); }
    setRepositoryUrl(value: string) { if (this.busy()) return; this.repositoryUrl.set(value); this.resetKey(); }
    // After a confirmed upload the form is emptied so a second click cannot send the same work again by accident.
    private clearForm() { this.file.set(null); const input = this.fileInput(); if (input) input.nativeElement.value = ''; this.answer.set(''); this.answerError.set(''); this.comment.set(''); this.repositoryUrl.set(''); this.resetKey(); }
    upload(event?: Event) {
        event?.preventDefault(); if (!this.canSubmit() || this.busy() || this.loading()) return; this.succeeded.set(false); this.error.set('');
        let file = this.file();
        if (this.answerMode() === 'text') { const wrong = validateAnswer(this.answer()); this.answerError.set(wrong ?? ''); if (wrong) return; file = answerFile(this.answer(), this.format()); }
        const invalid = validateHomework(file, this.comment(), this.repositoryUrl()); if (invalid) { this.error.set(invalid); return; }
        const key = this.idempotencyKey ??= this.newKey();
        this.busy.set(true); this.progress.set(null); const stamp = this.sequence;
        this.uploadRequest = this.scope.track(this.api.upload(this.lesson(), file!, this.comment(), this.repositoryUrl(), () => this.canSubmit() && stamp === this.sequence, key)).subscribe({ next: event => {
            if (!this.active() || stamp !== this.sequence) return;
            if (event.type === HttpEventType.UploadProgress) this.progress.set(event.total ? Math.min(100, Math.floor(event.loaded/event.total*100)) : null);
            if (event instanceof HttpResponse && event.status === 201 && event.body) { this.busy.set(false); this.clearForm(); this.succeeded.set(true); this.page.set(0); this.load(0); }
        }, error: error => { if (this.active() && stamp === this.sequence) { this.busy.set(false); this.progress.set(null); this.unknown.set(error.status === 0 || error.status === 503); this.error.set(apiProblem(error).status === null && error instanceof Error ? error.message : errorMessage(error, 'Не удалось подтвердить отправку.')); } } });
    }
    updatedReview(result: Submission) { if (!this.canReview()) return; this.submissions.update(items => items.map(item => item.id === result.id ? result : item)); if (this.latest()?.id === result.id) this.latest.set(result); }
    isText(submission: Submission) { return /\.(java|txt|md)$/i.test(submission.filename) && submission.size <= 262144; }
    toggleCode(submission: Submission) {
        this.codeRequest?.unsubscribe(); this.code.set(null); this.codeError.set('');
        if (this.openCode() === submission.id) { this.openCode.set(null); return; }
        this.openCode.set(submission.id); this.loadCode(submission);
    }
    loadCode(submission: Submission) {
        this.codeRequest?.unsubscribe(); this.code.set(null); this.codeError.set(''); const stamp = this.sequence;
        this.codeRequest = this.scope.track(this.api.text(this.lesson(), submission.id)).subscribe({ next: text => { if (this.active() && stamp === this.sequence) this.code.set({ [text.filename]: text.text }); }, error: error => { if (this.active() && stamp === this.sequence) this.codeError.set(error.status === 415 ? 'Этот файл нельзя показать как текст, его можно только скачать.' : 'Не удалось загрузить код работы.'); } });
    }
    download(submission: Submission) {
        if (!this.active()) return; const stamp = this.sequence; this.downloadErrors.update(errors => Object.fromEntries(Object.entries(errors).filter(([id]) => id !== submission.id)));
        const request = this.scope.track(this.api.download(this.lesson(), submission.id)).subscribe({ next: blob => { if (!this.active() || stamp !== this.sequence) return; saveBlob(blob, submission.filename); }, error: error => { if (this.active() && stamp === this.sequence) this.downloadErrors.update(errors => ({ ...errors, [submission.id]: errorMessage(error, 'Не удалось скачать работу.') })); } }); this.downloads.push(request);
    }
    date(value: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
    repositoryLink(value: string) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; } }
}


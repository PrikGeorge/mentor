import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { EMPTY, Subject, Subscription, expand, forkJoin, map, reduce, takeUntil } from 'rxjs';
import type { components } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { PracticeExit } from '../core/practice-exit.service';
import { MarkdownRenderer } from '../editor/markdown-renderer.service';
import { MaterialsApi, MaterialView } from '../materials/materials-api.service';
import { PracticeApi, Attempt, AttemptIntent, HistoryEntry, LessonPracticeView, Mode, SourceFiles } from './practice-api.service';
import { PracticeDraft } from './practice-draft.service';
import { AttemptPoller } from './attempt-poller.service';
import { MonacoEditorComponent } from './monaco-editor.component';
import { TeacherPracticeComponent, lessonKey } from './teacher-practice.component';
@Component({ selector: 'mentor-practice-workbench', imports: [MonacoEditorComponent, TeacherPracticeComponent, DatePipe], providers: [PracticeDraft], template: `
@if(checking()){<p role="status">Проверяем сессию перед возвратом к коду…</p>}
@if(sessionError()){<p class="auth-error" role="alert">{{sessionError()}}</p><button class="btn" (click)="revalidate()">Повторить проверку сессии</button>}
<section class="practice-page" [hidden]="!owned()">
 <div class="practice-heading"><div><p class="eyebrow">JAVA · ПРАКТИКА</p><h2>Тренажёр занятия</h2><p class="subtitle">Код сохраняется отдельно для каждого упражнения.</p></div><button class="btn" (click)="refreshCatalog()" [disabled]="loading()">Обновить задания</button></div>
 @if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
 @if(loading()){<p role="status">Загружаем упражнения…</p>}
 @if(view();as practice){
  @if(teacher()){<mentor-teacher-practice [lesson]="lesson()" [view]="practice" (saved)="assignmentsSaved($event)"/>}
  <nav class="practice-exercises" aria-label="Упражнения занятия">
   @for(row of practice.exercises;track row.exercise.id){<button class="btn" [attr.aria-current]="selectedId()===row.exercise.id?'page':null" (click)="choose(row.exercise.id)">{{row.exercise.title}} <small>{{row.placement==='homework'?'Домой':'На занятии'}}</small></button>}
   @for(row of removed();track row.exerciseId){<button class="btn" [attr.aria-current]="selectedId()===row.exerciseId?'page':null" (click)="choose(row.exerciseId)">История · {{row.exerciseId}}</button>}
  </nav>
  @if(!practice.exercises.length&&!history().length){<p class="empty-state">Упражнения пока не назначены.</p>}
 }
 @if(selectedId()){
  @if(displayExercise();as exercise){<div class="practice-panes"><article class="panel panel-inner practice-reading"><p class="eyebrow">УСЛОВИЕ · ТОЛЬКО ДЛЯ ЧТЕНИЯ</p><h3>{{exercise.title}}</h3><div class="markdown-body" [innerHTML]="renderer.render(exercise.statement)"></div><p class="small-muted">{{exercise.environment.title}} · Java {{exercise.environment.javaVersion}}@for(dependency of exercise.environment.dependencies;track dependency){ · {{dependency}}}</p>
   <details class="practice-reference"><summary>Исходные заготовки · только чтение</summary>@for(name of names(exercise.starterFiles);track name){<h4>{{name}}</h4><pre><code>{{exercise.starterFiles[name]}}</code></pre>}<p class="small-muted">Для сравнения с вашим кодом. Заготовки не заменяют черновик автоматически.</p></details>
   @if(notes()){<details><summary>Материалы занятия</summary><div class="markdown-body" [innerHTML]="renderer.render(notes())"></div></details>}
   @for(reference of references();track reference.id){@if(reference.kind==='code'&&!reference.code.teacher){<details class="practice-reference"><summary>{{reference.title||reference.filename}} · исходная заготовка</summary><pre><code>{{reference.code.text}}</code></pre><p class="small-muted">Только для чтения. Этот исходник не заменяет ваш черновик.</p></details>}}
  </article><section class="panel practice-editor"><header><h3>Ваши файлы</h3><span class="small-muted" role="status">{{draft.busy()?'Сохраняем…':draft.dirty()?'Есть несохранённые изменения':'Черновик сохранён'}}</span></header>
   @if(!draft.compatible()){<p class="callout">Упражнение обновилось. Ваш код остался на прежней ревизии. Экспортируйте его перед переходом.</p>}
   @if(draft.error()){<p class="auth-error" role="alert">{{draft.error()}}</p>}
   <nav class="practice-files" aria-label="Файлы решения">@for(name of fileNames();track name){<button [attr.aria-pressed]="file()===name" (click)="file.set(name)">{{name}}</button>}</nav>
   @if(file();as name){<mentor-monaco-editor [value]="draft.files()[name]||''" [file]="name" [context]="editorContext()" [readonly]="!writable()||draft.paused()||resetting()" (changed)="draft.edit(name,$event)"/>}
   @if(writable()){<div class="practice-controls"><button class="btn" (click)="draft.save()" [disabled]="draft.busy()||!draft.compatible()">Сохранить код</button><button class="btn" (click)="exportFiles()">Экспортировать код</button><button class="btn" data-action="run" (click)="run('run')" [disabled]="sending()||!runnable()">Проверить примеры</button><button class="btn primary" data-action="submit" (click)="run('submit')" [disabled]="sending()||!runnable()">Отправить на все проверки</button></div>
    @if(!draft.compatible()||draft.conflict()){<div class="callout"><p>Переход выполняется только по вашему выбору. Сервер сохранит архив прежнего сохранённого черновика.</p><button class="btn" (click)="resetChoice.set('keep')">Перенести мой код</button><button class="btn" (click)="resetChoice.set('template')">Взять новые заготовки</button></div>}
   }@else{<p class="callout">Просмотр сохранённого кода · только чтение. Сохранение и запуск недоступны.</p>@if(sourceOwner()){<button class="btn" (click)="exportFiles()">Экспортировать код</button>}}
  </section></div>}
  @else{<section class="panel panel-inner"><h3>История упражнения {{selectedId()}}</h3><p class="callout">Упражнение снято с назначения или недоступно. Сохранённый код и попытки доступны только для чтения.</p>@for(name of historicalNames();track name){<h4>{{name}}</h4><pre class="code-view"><code>{{historicalFiles()[name]}}</code></pre>}</section>}
  @if(sourceOwner()&&draft.pending()&&!attempt()){<button class="btn" (click)="recoverAttempt()" [disabled]="sending()">Восстановить отправленную попытку</button>}
  @if(resetChoice()){<section class="panel panel-inner reset-confirm" role="region" aria-label="Подтверждение перехода"><h3>Перейти на новую ревизию?</h3><p>{{resetChoice()==='template'?'Новые заготовки заменят код только после подтверждённого сохранения.':'Ваши файлы будут сохранены в новой ревизии, если их имена соответствуют объявленным файлам.'}}</p><button class="btn" (click)="exportFiles()">Сначала экспортировать код</button><button class="btn primary" [disabled]="resetting()" (click)="reset()">Подтвердить переход</button><button class="btn" [disabled]="resetting()" (click)="resetChoice.set(null)">Отмена</button></section>}
  @if(attempt();as result){<section class="panel panel-inner attempt-result" aria-live="polite"><h3>{{stateLabel(result)}}</h3><p class="small-muted">Попытка {{result.id}} · {{result.mode==='run'?'Примеры':'Все проверки'}} · {{result.createdAt|date:'dd.MM.yyyy HH:mm'}}</p>@if(result.environmentRevision===null){<p class="small-muted">Версия окружения не сохранена</p>}@if(result.result;as check){<p>{{check.passed}} / {{check.total}} · {{check.elapsedMs}} мс</p>@if(check.diagnostics){<pre class="code-view">{{check.diagnostics}}</pre>}@for(test of check.tests;track $index){<article><h4>{{test.name}} · {{test.status}}</h4>@if(test.expected!==undefined){<p>Ожидалось: <code>{{scalar(test.expected)}}</code></p>}@if(test.actual!==undefined){<p>Получено: <code>{{scalar(test.actual)}}</code></p>}@if(test.message){<pre class="code-view">{{test.message}}</pre>}@if(test.stdout){<pre class="code-view">{{test.stdout}}</pre>}</article>}}<details><summary>Точный код этой попытки · только чтение</summary>@for(name of names(result.files);track name){<h4>{{name}}</h4><pre class="code-view"><code>{{result.files[name]}}</code></pre>}</details></section>}
  <section class="panel panel-inner practice-history"><h3>История попыток</h3>@for(row of attempts();track row.id){<button class="history-row" (click)="showAttempt(row.id)"><span>{{row.mode==='run'?'Примеры':'Все проверки'}} · {{row.createdAt|date:'dd.MM.yyyy HH:mm'}}</span><span>{{row.result?.status||row.jobState}}</span></button>}@if(!attempts().length){<p>Попыток пока нет.</p>}<nav class="pagination" aria-label="Страницы попыток"><button class="btn" [disabled]="attemptPage()===0" (click)="attemptPage.set(attemptPage()-1)">Назад</button><span>Страница {{attemptPage()+1}}</span><button class="btn" [disabled]="(attemptPage()+1)*25>=attemptTotal()" (click)="attemptPage.set(attemptPage()+1)">Далее</button></nav>
   <h3>Архив черновиков</h3>@for(row of archives();track row.id){<button class="history-row" (click)="showArchive(row.id)">{{row.updatedAt|date:'dd.MM.yyyy HH:mm'}} · Ревизия {{row.exerciseRevision}}</button>}@if(archive();as item){<details open><summary>Архив {{item.id}} · только чтение</summary>@for(name of names(item.files);track name){<h4>{{name}}</h4><pre class="code-view"><code>{{item.files[name]}}</code></pre>}</details>}<nav class="pagination" aria-label="Страницы архива"><button class="btn" [disabled]="archivePage()===0" (click)="archivePage.set(archivePage()-1)">Назад</button><span>Страница {{archivePage()+1}}</span><button class="btn" [disabled]="(archivePage()+1)*25>=archiveTotal()" (click)="archivePage.set(archivePage()+1)">Далее</button></nav>
  </section>
 }
</section>` })
export class PracticeWorkbench {
    readonly checking=signal(false);readonly sessionError=signal('');private checkRequest:Subscription|null=null;private readonly loadTick=signal(0);private readonly selectionTick=signal(0);
    readonly lesson = input.required<LessonRef>();
    readonly preview = input(false);
    readonly notes = input('');
    readonly initialExercise = input<string | null>(null);
    readonly draft = inject(PracticeDraft);
    readonly renderer = inject(MarkdownRenderer);
    private readonly api = inject(PracticeApi);
    private readonly materials = inject(MaterialsApi);
    private readonly poller = inject(AttemptPoller);
    private readonly session = inject(SessionStore);
    private readonly owner = this.session.generation();
    private readonly exit = inject(PracticeExit);
    private readonly destroyRef = inject(DestroyRef);
    readonly view = signal<LessonPracticeView | null>(null);
    readonly history = signal<HistoryEntry[]>([]);
    readonly selectedId = signal('');
    readonly file = signal('');
    readonly error = signal('');
    readonly loading = signal(false);
    readonly sending = signal(false);
    readonly resetting = signal(false);
    readonly resetChoice = signal<'keep' | 'template' | null>(null);
    readonly references = signal<MaterialView[]>([]);
    readonly attempt = signal<Attempt | null>(null);
    readonly attempts = signal<components['schemas']['AttemptSummary'][]>([]);
    readonly archives = signal<components['schemas']['DraftArchiveSummary'][]>([]);
    readonly archive = signal<components['schemas']['DraftArchive'] | null>(null);
    readonly historicalFiles = signal<SourceFiles>({});
    readonly attemptPage = signal(0);
    readonly attemptTotal = signal(0);
    readonly archivePage = signal(0);
    readonly archiveTotal = signal(0);
    readonly current = computed(() => this.view()?.exercises.find(row => row.exercise.id === this.selectedId())?.exercise ?? null);
    readonly displayExercise = computed(() => this.current() ?? (this.draft.exercise()?.id === this.selectedId() ? this.draft.exercise() : null));
    readonly removed = computed(() => this.history().filter(row => !this.view()?.exercises.some(assigned => assigned.exercise.id === row.exerciseId)));
    readonly fileNames = computed(() => Object.keys(this.draft.files()));
    readonly historicalNames = computed(() => Object.keys(this.historicalFiles()));
    readonly editorContext = computed(() => this.bound + ':' + this.selectedId() + ':' + this.file());
    readonly teacher = computed(() => this.session.actor()?.role === 'TEACHER' && !this.preview());
    private bound = '';
    private selection = '';
    private alive = true;
    private poll: Subscription | null = null;
    private readonly changed = new Subject<void>();
    private readonly selectionChanged = new Subject<void>();
    constructor() {
        const unregister = this.exit.register({ valid: () => this.sourceOwner(),blocked:()=>this.alive&&this.owner===this.session.generation()&&this.checking(), dirty: () => this.draft.dirty(), pause: value => this.draft.pause(value), save: () => this.draft.save(), export: () => this.exportFiles(), discard: () => this.draft.discard() });
        const beforeUnload = (event: BeforeUnloadEvent) => { if (this.sourceOwner() && this.draft.dirty()) {
            event.preventDefault();
            event.returnValue = '';
        } };
        window.addEventListener('beforeunload', beforeUnload);
        const visibility=()=>{if(document.visibilityState==='hidden')this.suspend();else this.revalidate();};document.addEventListener('visibilitychange',visibility);
        this.destroyRef.onDestroy(() => { this.alive = false; this.draft.stop(); this.changed.next(); this.selectionChanged.next(); this.poll?.unsubscribe();this.checkRequest?.unsubscribe(); unregister(); window.removeEventListener('beforeunload', beforeUnload);document.removeEventListener('visibilitychange',visibility); });
        effect(onCleanup => {
            const lesson = this.lesson(), preview = this.preview();this.loadTick();
            this.session.generation();
            this.bound = lessonKey(lesson);
            this.selectedId.set('');
            this.view.set(null);
            this.history.set([]);
            this.references.set([]);
            this.error.set('');
            this.draft.stop();
            this.changed.next();
            this.poll?.unsubscribe();
            if (!this.owned())
                return;
            this.loading.set(true);
            const history = this.api.history(lesson, preview).pipe(expand(page => page.items.length && (page.page + 1) * page.size < page.total ? this.api.history(lesson, preview, page.page + 1) : EMPTY), map(page => page.items), reduce((all, items) => [...all, ...items], [] as HistoryEntry[]));
            const sub = forkJoin({ view: this.api.practice(lesson, preview), history }).subscribe({ next: result => { if (!this.owned())
                    return; this.view.set(result.view); this.history.set(result.history); this.loading.set(false); const preferred = this.initialExercise(); this.selectedId.set(preferred && (result.view.exercises.some(row => row.exercise.id === preferred) || result.history.some(row => row.exerciseId === preferred)) ? preferred : result.view.exercises[0]?.exercise.id ?? result.history[0]?.exerciseId ?? ''); }, error: () => { if (this.owned()) {
                    this.loading.set(false);
                    this.error.set('Не удалось загрузить тренажёр. Обновите страницу.');
                } } });
            const sources = this.materials.catalog(lesson.workspaceId, lesson.studentId, lesson.id, preview).subscribe({ next: rows => { const publicCode = rows.filter(row => row.kind === 'code' && row.audience === 'student'); if (!publicCode.length)
                    return; forkJoin(publicCode.map(row => this.materials.load(lesson.workspaceId, row.id, preview))).pipe(takeUntil(this.changed)).subscribe({ next: items => { if (this.owned())
                        this.references.set(items); }, error: () => { if (this.owned())
                        this.error.set('Исходные материалы временно недоступны. Черновик остаётся в редакторе.'); } }); }, error: () => { } });
            onCleanup(() => { sub.unsubscribe(); sources.unsubscribe(); this.changed.next(); this.draft.stop(); this.poll?.unsubscribe(); });
        });
        effect(onCleanup => {
            const id = this.selectedId(), lesson = this.lesson(), preview = this.preview();this.selectionTick();
            this.session.generation();
            this.selection = id;
            this.selectionChanged.next();
            this.poll?.unsubscribe();
            this.draft.stop();
            this.attempt.set(null);
            this.archive.set(null);
            this.attempts.set([]);
            this.archives.set([]);
            this.historicalFiles.set({});
            this.sending.set(false);
            this.resetting.set(false);
            this.resetChoice.set(null);
            this.attemptPage.set(0);
            this.archivePage.set(0);
            if (!id || !this.owned())
                return;
            const exercise = untracked(this.current);
            const key = this.bound;
            const hasDraft = exercise || untracked(this.history).some(row => row.exerciseId === id && row.hasDraft);
            const sub = hasDraft ? this.api.draft(lesson, id, preview).subscribe({ next: result => { if (!this.validSelection(id, key))
                    return; if (exercise) {
                    this.draft.bind(lesson, exercise, result, preview, () => this.validSelection(id, key));
                    this.file.set(Object.keys(this.draft.files())[0] ?? '');
                    const pending = this.draft.pending();
                    if (pending?.attemptId)
                        this.watch(pending.attemptId);
                }
                else
                    this.historicalFiles.set({ ...result.files }); }, error: () => { if (this.validSelection(id, key))
                    this.error.set('Не удалось загрузить сохранённый черновик. История остаётся доступна.'); } }) : new Subscription();
            onCleanup(() => { sub.unsubscribe(); this.selectionChanged.next(); this.draft.stop(); this.poll?.unsubscribe(); });
        });
        effect(() => { const exercise = this.current(); if (exercise)
            this.draft.updateExercise(exercise); });
        effect(onCleanup => { const id = this.selectedId(), page = this.attemptPage(), preview = this.preview(), lesson = this.lesson(); if (!id || !this.owned())
            return; const key = this.bound; const sub = this.api.attempts(lesson, id, preview, page).subscribe({ next: result => { if (this.validSelection(id, key)) {
                this.attempts.set(result.items);
                this.attemptTotal.set(result.total);
            } }, error: () => { if (this.validSelection(id, key))
                this.error.set('Не удалось загрузить историю попыток.'); } }); onCleanup(() => sub.unsubscribe()); });
        effect(onCleanup => { const id = this.selectedId(), page = this.archivePage(), preview = this.preview(), lesson = this.lesson(); if (!id || !this.owned())
            return; const key = this.bound; const sub = this.api.archives(lesson, id, preview, page).subscribe({ next: result => { if (this.validSelection(id, key)) {
                this.archives.set(result.items);
                this.archiveTotal.set(result.total);
            } }, error: () => { if (this.validSelection(id, key))
                this.error.set('Не удалось загрузить архив черновиков.'); } }); onCleanup(() => sub.unsubscribe()); });
    }
    private suspend(){if(!this.owned())return;this.draft.suspend();this.poll?.unsubscribe();this.selectionChanged.next();this.sending.set(false);this.resetting.set(false);this.checking.set(true);}
    revalidate(){
        if(!this.alive||this.owner!==this.session.generation()||this.bound!==lessonKey(this.lesson())||this.checkRequest&&!this.checkRequest.closed)return;
        this.suspend();this.checking.set(true);this.sessionError.set('');const key=this.bound;
        this.checkRequest=this.session.load().pipe(takeUntil(this.changed)).subscribe({next:()=>{
            if(!this.alive||this.owner!==this.session.generation()||key!==lessonKey(this.lesson()))return;
            this.checking.set(false);this.draft.pause(false);
            if(!this.view())this.loadTick.update(value=>value+1);else if(this.current()&&!this.draft.exercise())this.selectionTick.update(value=>value+1);else{const id=this.attempt()?.id??this.draft.pending()?.attemptId;if(id)this.watch(id);}
        },error:()=>{if(this.alive&&this.owner===this.session.generation()&&key===lessonKey(this.lesson()))this.sessionError.set('Не удалось проверить сессию. Несохранённый код остаётся в этой вкладке.');}});
    }
    owned() { return this.alive && this.owner === this.session.generation() && this.bound === lessonKey(this.lesson())&&!untracked(this.checking); }
    private validSelection(id = this.selection, key = this.bound) { return this.owned() && id === this.selectedId() && key === this.bound; }
    sourceOwner() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.draft.exercise()?.id === this.selectedId(); }
    writable() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && !!this.current(); }
    runnable() { return this.writable() && this.draft.editable() && this.draft.compatible() && !this.draft.conflict() && !this.draft.paused() && !this.resetting(); }
    async choose(id: string) { const key = this.bound; if (id === this.selectedId() || !this.owned())
        return; if (!await this.exit.ask() || !this.owned() || key !== this.bound)
        return; this.selectedId.set(id); }
    assignmentsSaved(view: LessonPracticeView) { if (!this.owned() || !this.teacher())
        return; this.view.set(view); if (!view.exercises.some(row => row.exercise.id === this.selectedId()))
        this.selectedId.set(view.exercises[0]?.exercise.id ?? ''); }
    refreshCatalog() { if (!this.owned() || this.loading())
        return; const key = this.bound; this.api.practice(this.lesson(), this.preview()).pipe(takeUntil(this.changed)).subscribe({ next: view => { if (!this.owned() || key !== this.bound)
            return; this.view.set(view); if (!this.selectedId())
            this.selectedId.set(view.exercises[0]?.exercise.id ?? ''); }, error: () => { if (this.owned())
            this.error.set('Не удалось обновить задания. Ваш код не изменён.'); } }); }
    run(mode: Mode) { if (!this.runnable() || this.sending())
        return; const intent = this.draft.intent(mode); if (intent)
        this.enqueue(intent); }
    recoverAttempt() { if (!this.sourceOwner() || this.sending())
        return; const intent = this.draft.pending(); if (intent)
        this.enqueue(intent); }
    private enqueue(intent: AttemptIntent) {
        if (intent.attemptId) {
            this.watch(intent.attemptId);
            return;
        }
        const id = this.selectedId(), key = this.bound;
        this.sending.set(true);
        this.error.set('');
        this.api.enqueue(this.lesson(), id, intent.request.files, intent.request.exerciseRevision, intent.request.mode, intent.key).pipe(takeUntil(this.selectionChanged), takeUntil(this.changed)).subscribe({ next: attempt => { if (!this.validSelection(id, key))
                return; this.sending.set(false); this.draft.accepted(attempt, intent.key); this.attempt.set(attempt); this.watch(attempt.id); }, error: error => { if (!this.validSelection(id, key))
                return; this.sending.set(false); this.error.set(error.status === 409 ? 'Задание изменилось. Ваш код сохранён; обновите задания и явно выберите переход.' : error.status === 429 ? 'Очередь заполнена. Повтор использует тот же ключ попытки.' : 'Ответ не получен. Повтор этой проверки использует тот же ключ и точный код.'); } });
    }
    private watch(id: string) { this.poll?.unsubscribe(); const exercise = this.selectedId(), key = this.bound; this.poll = this.poller.watch(this.lesson(), exercise, id, this.preview()).pipe(takeUntil(this.selectionChanged), takeUntil(this.changed)).subscribe({ next: attempt => { if (this.validSelection(exercise, key)){
            this.attempt.set(attempt);if(this.attemptPage()===0){const {files,...summary}=attempt;if(!this.attempts().some(row=>row.id===attempt.id))this.attemptTotal.update(total=>total+1);this.attempts.update(rows=>[summary,...rows.filter(row=>row.id!==attempt.id)].slice(0,25));}
            } }, error: () => { if (this.validSelection(exercise, key))
            this.error.set('Не удалось прочитать попытку. Обновите историю.'); } }); }
    showAttempt(id: string) { if (this.validSelection())
        this.watch(id); }
    showArchive(id: string) { if (!this.validSelection())
        return; const selected = this.selectedId(), key = this.bound; this.api.archive(this.lesson(), id, this.preview()).pipe(takeUntil(this.selectionChanged), takeUntil(this.changed)).subscribe({ next: archive => { if (this.validSelection(selected, key))
            this.archive.set(archive); }, error: () => { if (this.validSelection(selected, key))
            this.error.set('Не удалось загрузить архив.'); } }); }
    async reset() { if (!this.writable() || !this.resetChoice() || this.resetting())
        return; const id = this.selectedId(), key = this.bound, template = this.resetChoice() === 'template'; this.resetting.set(true); this.draft.pause(true); this.api.draft(this.lesson(), id).pipe(takeUntil(this.selectionChanged), takeUntil(this.changed)).subscribe({ next: async (server) => { if (!this.validSelection(id, key))
            return; this.draft.refreshCounter(server); const saved = await this.draft.reset(template); if (this.validSelection(id, key)) {
            this.resetting.set(false);
            this.draft.pause(false);
            if (saved)
                this.resetChoice.set(null);
        } }, error: () => { if (this.validSelection(id, key)) {
            this.resetting.set(false);
            this.draft.pause(false);
            this.error.set('Не удалось обновить ревизию черновика. Код сохранён в редакторе.');
        } } }); }
    exportFiles(): boolean { if (!this.sourceOwner())
        return false; try {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ exerciseId: this.selectedId(), exerciseRevision: this.draft.sourceRevision(), files: this.draft.files() }, null, 2)], { type: 'application/json' })), link = document.createElement('a');
        link.href = url;
        link.download = 'practice-source.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
    }
    catch {
        this.error.set('Экспорт недоступен. Скопируйте файлы перед выходом.');
        return false;
    } }
    names(files: SourceFiles) { return Object.keys(files); }
    scalar(value: components['schemas']['PublicResultValue']) { return value === null ? 'null' : String(value); }
    stateLabel(attempt: Attempt) { return attempt.jobState === 'queued' ? 'В очереди' : attempt.jobState === 'running' ? 'Выполняется' : attempt.result?.status === 'accepted' ? 'Все проверки пройдены' : attempt.result?.status === 'wrong_answer' ? 'Есть неверный ответ' : attempt.result?.status === 'compile_error' ? 'Ошибка компиляции' : attempt.result?.status === 'runtime_error' ? 'Ошибка выполнения' : attempt.result?.status === 'time_limit' ? 'Превышено время' : attempt.jobState === 'failed' ? 'Проверка временно недоступна' : 'Результат проверки'; }
}

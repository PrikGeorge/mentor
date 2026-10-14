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
import { IconComponent } from '../core/icon.component';
import { CodeReviewComponent } from '../comments/code-review.component';
const THEME_KEY = 'mentor.trainer-theme';
const storedTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; } };
@Component({ selector: 'mentor-practice-workbench', imports: [MonacoEditorComponent, TeacherPracticeComponent, DatePipe, IconComponent, CodeReviewComponent], providers: [PracticeDraft], template: `
@if(checking()){<p class="loading" role="status">Проверяем сессию перед возвратом к коду…</p>}
@if(sessionError()){<div class="shell-error"><p class="auth-error" role="alert">{{sessionError()}}</p><button class="btn" (click)="revalidate()"><mentor-icon name="refresh"/>Повторить проверку сессии</button></div>}
<div class="trainer" [class.theme-dark]="dark()">
<section class="practice-page" [hidden]="!owned()">
 <div class="practice-heading"><div><h2>Тренажёр занятия</h2><p class="subtitle">Java · код сохраняется отдельно для каждого упражнения.</p></div><div class="actions"><button class="btn sm theme-toggle" type="button" (click)="toggleTheme()" [attr.aria-pressed]="dark()"><mentor-icon [name]="dark()?'sun':'moon'"/>{{dark()?'Светлая тема':'Тёмная тема'}}</button><button class="btn sm" (click)="refreshCatalog()" [disabled]="loading()"><mentor-icon name="refresh"/>Обновить задания</button></div></div>
 @if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
 @if(loading()){<p class="loading" role="status">Загружаем упражнения…</p>}
 @if(view();as practice){
  @if(teacher()){<mentor-teacher-practice [lesson]="lesson()" [view]="practice" (saved)="assignmentsSaved($event)"/>}
  @if(!practice.exercises.length&&!history().length){<div class="empty-state"><h3>Упражнения пока не назначены</h3><p>{{teacher()?'Выберите упражнения в каталоге выше — они появятся у ученика.':'Наставник добавит упражнения к занятию. Загляни позже или открой задания.'}}</p></div>}
 }
 @if(selectedId()){
 <div class="trainer-grid">
  <aside class="trainer-side" aria-label="Упражнения и условие">
   <h3>Упражнения</h3>
   <nav class="practice-exercises" aria-label="Упражнения занятия">
    @for(row of view()?.exercises??[];track row.exercise.id){<button type="button" [attr.aria-current]="selectedId()===row.exercise.id?'page':null" (click)="choose(row.exercise.id)">{{row.exercise.title}} <small>{{row.placement==='homework'?'Домашняя работа':'На занятии'}}</small></button>}
    @for(row of removed();track row.exerciseId){<button type="button" [attr.aria-current]="selectedId()===row.exerciseId?'page':null" (click)="choose(row.exerciseId)">История · {{row.exerciseId}} <small>Снято с назначения</small></button>}
   </nav>
   @if(displayExercise();as exercise){<article class="practice-reading"><p class="eyebrow">Условие, только чтение · Java {{exercise.environment.javaVersion}}</p><h3>{{exercise.title}}</h3><div class="markdown-body" [innerHTML]="renderer.render(exercise.statement)"></div><p class="small-muted">{{exercise.environment.title}}@for(dependency of exercise.environment.dependencies;track dependency){ · {{dependency}}}</p>
    <details class="practice-reference"><summary>Исходные заготовки · только чтение</summary>@for(name of names(exercise.starterFiles);track name){<h4>{{name}}</h4><pre><code>{{exercise.starterFiles[name]}}</code></pre>}<p class="small-muted">Для сравнения с вашим кодом. Заготовки не заменяют черновик автоматически.</p></details>
    @if(notes()){<details><summary>Материалы занятия</summary><div class="markdown-body" [innerHTML]="renderer.render(notes())"></div></details>}
    @for(reference of references();track reference.id){@if(reference.kind==='code'&&!reference.code.teacher){<details class="practice-reference"><summary>{{reference.title||reference.filename}} · исходная заготовка</summary><pre><code>{{reference.code.text}}</code></pre><p class="small-muted">Только для чтения. Этот исходник не заменяет ваш черновик.</p></details>}}
   </article>}
  </aside>
  @if(displayExercise()){<section class="practice-editor" aria-label="Ваши файлы"><header><nav class="practice-files" aria-label="Файлы решения">@for(name of fileNames();track name){<button type="button" [attr.aria-pressed]="file()===name" (click)="file.set(name)">{{name}}</button>}</nav>
    <div class="file-actions">@if(writable()){<button class="btn text sm" (click)="draft.save()" [disabled]="draft.busy()||!draft.compatible()"><mentor-icon name="save"/>Сохранить код</button>}@if(writable()||sourceOwner()){<button class="btn text sm" (click)="exportFiles()"><mentor-icon name="download"/>Экспортировать код</button>}</div></header>
   <span class="draft-state" role="status">{{draft.busy()?'Сохраняем…':draft.dirty()?'Есть несохранённые изменения':'Черновик сохранён'}}</span>
   @if(!draft.compatible()){<p class="warning-banner">Упражнение обновилось. Ваш код остался на прежней ревизии. Экспортируйте его перед переходом.</p>}
   @if(draft.error()){<p class="auth-error" role="alert">{{draft.error()}}</p>}
   @if(file();as name){<mentor-monaco-editor [value]="draft.files()[name]||''" [file]="name" [context]="editorContext()" [readonly]="!writable()||draft.paused()||resetting()" [dark]="dark()" (changed)="draft.edit(name,$event)"/>}
   @if(writable()){<div class="practice-controls"><button class="btn" data-action="run" (click)="run('run')" [disabled]="sending()||!runnable()"><mentor-icon name="play"/>Проверить примеры</button><button class="btn primary" data-action="submit" (click)="run('submit')" [disabled]="sending()||!runnable()">@if(sending()){<mentor-icon class="spin" name="loader"/>}@else{<mentor-icon name="send"/>}Отправить на все проверки</button></div>
    @if(!draft.compatible()||draft.conflict()){<div class="callout reset-choice"><p>Переход выполняется только по вашему выбору. Сервер сохранит архив прежнего сохранённого черновика.</p><div class="actions"><button class="btn sm" (click)="resetChoice.set('keep')">Перенести мой код</button><button class="btn sm" (click)="resetChoice.set('template')">Взять новые заготовки</button></div></div>}
   }@else{<p class="callout">Просмотр сохранённого кода · только чтение. Сохранение и запуск недоступны.</p>}
  </section>}
  @else{<section class="practice-editor history-only"><h3>История упражнения {{selectedId()}}</h3><p class="callout">Упражнение снято с назначения или недоступно. Сохранённый код и попытки доступны только для чтения.</p>@for(name of historicalNames();track name){<h4>{{name}}</h4><pre class="code-view"><code>{{historicalFiles()[name]}}</code></pre>}</section>}
  <section class="trainer-result" aria-label="Результат проверки">
   @if(sourceOwner()&&draft.pending()&&!attempt()){<button class="btn" (click)="recoverAttempt()" [disabled]="sending()"><mentor-icon name="history"/>Восстановить отправленную попытку</button>}
   @if(resetChoice()){<section class="reset-confirm" role="region" aria-label="Подтверждение перехода"><h3>Перейти на новую ревизию?</h3><p>{{resetChoice()==='template'?'Новые заготовки заменят код только после подтверждённого сохранения.':'Ваши файлы будут сохранены в новой ревизии, если их имена соответствуют объявленным файлам.'}}</p><div class="actions"><button class="btn sm" (click)="exportFiles()"><mentor-icon name="download"/>Сначала экспортировать код</button><button class="btn sm primary" [disabled]="resetting()" (click)="reset()">Подтвердить переход</button><button class="btn sm text" [disabled]="resetting()" (click)="resetChoice.set(null)">Отмена</button></div></section>}
   @if(attempt();as result){<section class="attempt-result" aria-live="polite"><p class="small-muted">Попытка · {{result.mode==='run'?'Примеры':'Все проверки'}} · {{result.createdAt|date:'dd.MM.yyyy HH:mm'}}</p>
    <h3 class="attempt-state" [class.ok]="result.result?.status==='accepted'" [class.bad]="isFailure(result)"><mentor-icon [class.spin]="result.jobState==='running'" [name]="stateIcon(result)"/>{{stateLabel(result)}}</h3>
    @if(result.environmentRevision===null){<p class="small-muted">Версия окружения не сохранена</p>}
    @if(result.result;as check){<p class="check-summary">Тесты: {{check.passed}} из {{check.total}} пройдены · {{check.elapsedMs}} мс</p>
     @if(check.tests.length){<div class="test-cells" role="img" [attr.aria-label]="'Пройдено '+check.passed+' из '+check.total">@for(test of check.tests;track $index){<span [class.pass]="test.status==='accepted'" [class.fail]="test.status!=='accepted'"><mentor-icon [name]="test.status==='accepted'?'check':'x'"/></span>}</div>}
     @if(check.diagnostics){<pre class="diagnostics">{{check.diagnostics}}</pre>}
     <ul class="test-list">@for(test of check.tests;track $index){<li [class.fail]="test.status!=='accepted'"><h4><mentor-icon [name]="test.status==='accepted'?'check':'x'"/><span>{{$index+1}}. {{test.name}} · <span class="status-word">{{testLabel(test.status)}}</span></span></h4>
      @if(test.expected!==undefined||test.actual!==undefined){<div class="io">@if(test.expected!==undefined){<p>Ожидалось: <code>{{scalar(test.expected)}}</code></p>}@if(test.actual!==undefined){<p>Получено: <code>{{scalar(test.actual)}}</code></p>}</div>}@if(test.message){<pre class="code-view">{{test.message}}</pre>}@if(test.stdout){<pre class="code-view">{{test.stdout}}</pre>}</li>}</ul>}
    <details class="attempt-code" [open]="teacher()||noted()>0"><summary>{{teacher()?'Код этой попытки · комментарии по строкам':noted()?'Точный код этой попытки · комментарии наставника: '+noted():'Точный код этой попытки · только чтение'}}</summary><mentor-code-review [lesson]="lesson()" targetKind="attempt" [targetId]="result.id" [files]="filesOf(result)" [editable]="teacher()" [preview]="preview()" (noted)="noted.set($event)"/></details></section>}
   <section class="practice-history"><h3>История попыток</h3>@for(row of attempts();track row.id){<button class="history-row" (click)="showAttempt(row.id)"><span>{{row.mode==='run'?'Примеры':'Все проверки'}} · {{row.createdAt|date:'dd.MM.yyyy HH:mm'}}</span><span>{{historyLabel(row)}}</span></button>}@if(!attempts().length){<p class="small-muted">Попыток пока нет.</p>}@if(attemptTotal()>25){<nav class="pagination" aria-label="Страницы попыток"><button class="btn" [disabled]="attemptPage()===0" (click)="attemptPage.set(attemptPage()-1)"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{attemptPage()+1}}</span><button class="btn" [disabled]="(attemptPage()+1)*25>=attemptTotal()" (click)="attemptPage.set(attemptPage()+1)">Далее<mentor-icon name="chevron-right"/></button></nav>}
    <h3>Архив черновиков</h3>@for(row of archives();track row.id){<button class="history-row" (click)="showArchive(row.id)"><span>{{row.updatedAt|date:'dd.MM.yyyy HH:mm'}}</span><span>Ревизия {{row.exerciseRevision}}</span></button>}@if(!archives().length){<p class="small-muted">Архивных черновиков нет.</p>}@if(archive();as item){<details open><summary>Архив {{item.id}} · только чтение</summary>@for(name of names(item.files);track name){<h4>{{name}}</h4><pre class="code-view"><code>{{item.files[name]}}</code></pre>}</details>}@if(archiveTotal()>25){<nav class="pagination" aria-label="Страницы архива"><button class="btn" [disabled]="archivePage()===0" (click)="archivePage.set(archivePage()-1)"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{archivePage()+1}}</span><button class="btn" [disabled]="(archivePage()+1)*25>=archiveTotal()" (click)="archivePage.set(archivePage()+1)">Далее<mentor-icon name="chevron-right"/></button></nav>}
   </section>
  </section>
 </div>
 }
</section></div>` })
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
    // Mentor comments on the shown attempt; the code opens by itself once the student has some to read.
    readonly noted = signal(0);
    filesOf(attempt: Attempt): Record<string, string> { return attempt.files ?? {}; }
    // Display preference only: no lesson data is kept in browser storage.
    readonly dark = signal(storedTheme());
    private bound = '';
    private selection = '';
    private alive = true;
    private poll: Subscription | null = null;
    private readonly changed = new Subject<void>();
    private readonly selectionChanged = new Subject<void>();
    constructor() {
        const unregister = this.exit.register({ valid: () => this.sourceOwner(),blocked:()=>this.alive&&this.owner===this.session.generation()&&this.checking(), dirty: () => this.draft.dirty(), pause: value => this.draft.pause(value), save: () => this.draft.save(), export: () => this.exportFiles(), discard: () => this.draft.discard() });
        const beforeUnload = (event: BeforeUnloadEvent) => { if (this.retainedDirtySource()) {
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
    private retainedDirtySource() {
        return this.alive && this.owner === this.session.generation()
            && this.bound === lessonKey(this.lesson()) && this.selection === this.selectedId()
            && this.session.actor()?.role === 'STUDENT' && this.session.actor()?.workspaceId === this.lesson().workspaceId
            && !this.preview() && this.draft.exercise()?.id === this.selectedId() && this.draft.dirty();
    }
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
    names(files: SourceFiles | null | undefined) { return Object.keys(files ?? {}); }
    scalar(value: components['schemas']['PublicResultValue']) { return value === null ? 'null' : String(value); }
    toggleTheme() { const dark = !this.dark(); this.dark.set(dark); try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* the toggle still works for this page */ } }
    isFailure(attempt: Attempt) { const status = attempt.result?.status; return status === 'wrong_answer' || status === 'compile_error' || status === 'runtime_error' || status === 'time_limit'; }
    stateIcon(attempt: Attempt) { return attempt.jobState === 'queued' ? 'hourglass' : attempt.jobState === 'running' ? 'loader' : attempt.result?.status === 'accepted' ? 'circle-check' : attempt.result?.status === 'wrong_answer' ? 'circle-x' : attempt.result?.status === 'compile_error' ? 'file-x' : attempt.result?.status === 'runtime_error' ? 'bug' : attempt.result?.status === 'time_limit' ? 'timer-off' : 'cloud-off'; }
    testLabel(status: string) { return ({ accepted: 'пройден', wrong_answer: 'не пройден', runtime_error: 'ошибка выполнения', time_limit: 'превышено время' } as Record<string, string>)[status] ?? status; }
    historyLabel(row: components['schemas']['AttemptSummary']) { const status = row.result?.status; return status ? ({ accepted: 'Все проверки пройдены', wrong_answer: 'Есть неверный ответ', compile_error: 'Ошибка компиляции', runtime_error: 'Ошибка выполнения', time_limit: 'Превышено время', error: 'Проверка временно недоступна', unavailable: 'Проверка временно недоступна' } as Record<string, string>)[status] ?? status : row.jobState === 'queued' ? 'В очереди' : row.jobState === 'running' ? 'Выполняется' : row.jobState; }
    stateLabel(attempt: Attempt) { return attempt.jobState === 'queued' ? 'В очереди' : attempt.jobState === 'running' ? 'Выполняется' : attempt.result?.status === 'accepted' ? 'Все проверки пройдены' : attempt.result?.status === 'wrong_answer' ? 'Есть неверный ответ' : attempt.result?.status === 'compile_error' ? 'Ошибка компиляции' : attempt.result?.status === 'runtime_error' ? 'Ошибка выполнения' : attempt.result?.status === 'time_limit' ? 'Превышено время' : attempt.jobState === 'failed' ? 'Проверка временно недоступна' : 'Результат проверки'; }
}

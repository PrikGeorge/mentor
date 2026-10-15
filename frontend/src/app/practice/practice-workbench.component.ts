import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { EMPTY, Subscription, expand, forkJoin, map, reduce } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { PracticeExit } from '../core/practice-exit.service';
import { MarkdownRenderer } from '../editor/markdown-renderer.service';
import { MaterialsApi, MaterialView } from '../materials/materials-api.service';
import { PracticeApi, AttemptIntent, HistoryEntry, LessonPracticeView, Mode } from './practice-api.service';
import { PracticeDraft } from './practice-draft.service';
import { PracticeSessionStore, ResetChoice } from './practice-session.store';
import { TeacherPracticeComponent, lessonKey } from './teacher-practice.component';
import { IconComponent } from '../core/icon.component';
import { PracticeErrorComponent } from './practice-error.component';
import { ExerciseListComponent } from './exercise-list.component';
import { ExerciseStatementComponent } from './exercise-statement.component';
import { EditorPanelComponent } from './editor-panel.component';
import { AttemptResultComponent } from './attempt-result.component';
import { AttemptHistoryComponent } from './attempt-history.component';
const THEME_KEY = 'mentor.trainer-theme';
const storedTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; } };
// The trainer of one lesson. Owns the session guards (account generation, lesson key, chosen exercise), the draft and the
// loading of catalog, history and materials; the result state lives in PracticeSessionStore and the children only render.
@Component({
    selector: 'mentor-practice-workbench',
    imports: [TeacherPracticeComponent, IconComponent, PracticeErrorComponent, ExerciseListComponent, ExerciseStatementComponent, EditorPanelComponent, AttemptResultComponent, AttemptHistoryComponent],
    providers: [PracticeDraft, PracticeSessionStore],
    templateUrl: './practice-workbench.component.html',
})
export class PracticeWorkbench {
    readonly lesson = input.required<LessonRef>();
    readonly preview = input(false);
    readonly notes = input('');
    readonly initialExercise = input<string | null>(null);
    readonly draft = inject(PracticeDraft);
    readonly store = inject(PracticeSessionStore);
    private readonly renderer = inject(MarkdownRenderer);
    private readonly api = inject(PracticeApi);
    private readonly materials = inject(MaterialsApi);
    private readonly session = inject(SessionStore);
    private readonly owner = this.session.generation();
    private readonly exit = inject(PracticeExit);
    private readonly destroyRef = inject(DestroyRef);
    // Session revalidation after the tab was hidden: source is frozen until the same account is confirmed.
    readonly checking = signal(false);
    readonly sessionError = signal('');
    private checkRequest: Subscription | null = null;
    private readonly loadTick = signal(0);
    private readonly selectionTick = signal(0);
    readonly view = signal<LessonPracticeView | null>(null);
    readonly history = signal<HistoryEntry[]>([]);
    readonly selectedId = signal('');
    readonly file = signal('');
    readonly loading = signal(false);
    readonly references = signal<MaterialView[]>([]);
    readonly current = computed(() => this.view()?.exercises.find(row => row.exercise.id === this.selectedId())?.exercise ?? null);
    readonly displayExercise = computed(() => this.current() ?? (this.draft.exercise()?.id === this.selectedId() ? this.draft.exercise() : null));
    readonly removed = computed(() => this.history().filter(row => !this.view()?.exercises.some(assigned => assigned.exercise.id === row.exerciseId)));
    readonly historicalNames = computed(() => Object.keys(this.store.historicalFiles()));
    readonly editorContext = computed(() => this.bound + ':' + this.selectedId() + ':' + this.file());
    readonly teacher = computed(() => this.session.actor()?.role === 'TEACHER' && !this.preview());
    // Markdown is parsed once per exercise or notes change, not on every polling cycle (FE-08).
    readonly statementHtml = computed(() => { const exercise = this.displayExercise(); return exercise ? this.renderer.render(exercise.statement) : ''; });
    readonly notesHtml = computed(() => this.notes() ? this.renderer.render(this.notes()) : '');
    // Display preference only: no lesson data is kept in browser storage.
    readonly dark = signal(storedTheme());
    private bound = '';
    private selection = '';
    private alive = true;
    constructor() {
        this.store.attach({ lesson: () => this.lesson(), preview: () => this.preview(), selectedId: () => this.selectedId(), key: () => this.bound, valid: (id, key) => this.validSelection(id, key) });
        const unregister = this.exit.register({ valid: () => this.sourceOwner(), blocked: () => this.alive && this.owner === this.session.generation() && this.checking(), dirty: () => this.draft.dirty(), pause: value => this.draft.pause(value), save: () => this.draft.save(), export: () => this.exportFiles(), discard: () => this.draft.discard() });
        const beforeUnload = (event: BeforeUnloadEvent) => { if (this.retainedDirtySource()) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload);
        const visibility = () => { if (document.visibilityState === 'hidden') this.suspend(); else this.revalidate(); };
        document.addEventListener('visibilitychange', visibility);
        this.destroyRef.onDestroy(() => {
            this.alive = false;
            this.draft.stop();
            this.store.cancelLesson();
            this.store.cancelSelection();
            this.checkRequest?.unsubscribe();
            unregister();
            window.removeEventListener('beforeunload', beforeUnload);
            document.removeEventListener('visibilitychange', visibility);
            document.body.classList.remove('theme-dark');
        });
        // The dark trainer covers the whole page, header and footer included, while this screen is open.
        effect(() => document.body.classList.toggle('theme-dark', this.dark()));
        // Lesson scope: assignments, history and public code materials; everything restarts when the lesson or account changes.
        effect(onCleanup => {
            const lesson = this.lesson(), preview = this.preview();
            this.loadTick();
            this.session.generation();
            this.bound = lessonKey(lesson);
            this.selectedId.set('');
            this.view.set(null);
            this.history.set([]);
            this.references.set([]);
            this.store.clearFailure();
            this.draft.stop();
            this.store.cancelLesson();
            if (!this.owned()) return;
            this.loading.set(true);
            const history = this.api.history(lesson, preview).pipe(
                expand(page => page.items.length && (page.page + 1) * page.size < page.total ? this.api.history(lesson, preview, page.page + 1) : EMPTY),
                map(page => page.items), reduce((all, items) => [...all, ...items], [] as HistoryEntry[]));
            const sub = forkJoin({ view: this.api.practice(lesson, preview), history }).subscribe({
                next: result => {
                    if (!this.owned()) return;
                    this.view.set(result.view);
                    this.history.set(result.history);
                    this.loading.set(false);
                    const preferred = this.initialExercise();
                    const known = preferred && (result.view.exercises.some(row => row.exercise.id === preferred) || result.history.some(row => row.exerciseId === preferred));
                    this.selectedId.set(known ? preferred : result.view.exercises[0]?.exercise.id ?? result.history[0]?.exerciseId ?? '');
                },
                error: () => { if (this.owned()) { this.loading.set(false); this.store.fail('Не удалось загрузить тренажёр. Обновите страницу.', () => this.reload()); } },
            });
            const sources = this.loadReferences(lesson, preview);
            onCleanup(() => { sub.unsubscribe(); sources.unsubscribe(); this.store.cancelLesson(); this.draft.stop(); });
        });
        // Exercise scope: the draft (or the read-only files of a removed exercise) and a pending attempt to resume.
        effect(onCleanup => {
            const id = this.selectedId(), lesson = this.lesson(), preview = this.preview();
            this.selectionTick();
            this.session.generation();
            this.selection = id;
            this.store.resetSelection();
            this.draft.stop();
            if (!id || !this.owned()) return;
            const exercise = untracked(this.current), key = this.bound;
            const hasDraft = exercise || untracked(this.history).some(row => row.exerciseId === id && row.hasDraft);
            const sub = hasDraft ? this.api.draft(lesson, id, preview).subscribe({
                next: result => {
                    if (!this.validSelection(id, key)) return;
                    if (!exercise) { this.store.historicalFiles.set({ ...result.files }); return; }
                    this.draft.bind(lesson, exercise, result, preview, () => this.validSelection(id, key));
                    this.file.set(Object.keys(this.draft.files())[0] ?? '');
                    const pending = this.draft.pending();
                    if (pending?.attemptId) this.store.watch(pending.attemptId);
                },
                error: () => { if (this.validSelection(id, key)) this.store.fail('Не удалось загрузить сохранённый черновик. История остаётся доступна.', () => this.selectionTick.update(value => value + 1)); },
            }) : new Subscription();
            onCleanup(() => { sub.unsubscribe(); this.store.cancelSelection(); this.draft.stop(); });
        });
        // A republished catalog updates the exercise shown next to the retained draft.
        effect(() => { const exercise = this.current(); if (exercise) this.draft.updateExercise(exercise); });
        effect(() => {
            const id = this.selectedId(), page = this.store.attemptPage(), preview = this.preview(), lesson = this.lesson();
            if (id && this.owned()) this.store.loadAttempts(lesson, id, preview, page);
        });
        effect(() => {
            const id = this.selectedId(), page = this.store.archivePage(), preview = this.preview(), lesson = this.lesson();
            if (id && this.owned()) this.store.loadArchives(lesson, id, preview, page);
        });
    }
    private loadReferences(lesson: LessonRef, preview: boolean): Subscription {
        return this.materials.catalog(lesson.workspaceId, lesson.studentId, lesson.id, preview).subscribe({
            next: rows => {
                const publicCode = rows.filter(row => row.kind === 'code' && row.audience === 'student');
                if (!publicCode.length) return;
                forkJoin(publicCode.map(row => this.materials.load(lesson.workspaceId, row.id, preview))).pipe(this.store.untilLessonChange()).subscribe({
                    next: items => { if (this.owned()) this.references.set(items); },
                    error: () => { if (this.owned()) this.store.fail('Исходные материалы временно недоступны. Черновик остаётся в редакторе.', () => { this.loadReferences(lesson, preview); }); },
                });
            },
            error: () => { /* references are optional; the statement and the draft stay usable without them */ },
        });
    }
    private reload() { this.loadTick.update(value => value + 1); }
    private suspend() {
        if (!this.owned()) return;
        this.draft.suspend();
        this.store.cancelSelection();
        this.store.sending.set(false);
        this.store.resetting.set(false);
        this.checking.set(true);
    }
    revalidate() {
        if (!this.alive || this.owner !== this.session.generation() || this.bound !== lessonKey(this.lesson()) || this.checkRequest && !this.checkRequest.closed) return;
        this.suspend();
        this.checking.set(true);
        this.sessionError.set('');
        const key = this.bound;
        this.checkRequest = this.session.load().pipe(this.store.untilLessonChange()).subscribe({
            next: () => {
                if (!this.alive || this.owner !== this.session.generation() || key !== lessonKey(this.lesson())) return;
                this.checking.set(false);
                this.draft.pause(false);
                if (!this.view()) this.reload();
                else if (this.current() && !this.draft.exercise()) this.selectionTick.update(value => value + 1);
                else { const id = this.store.attempt()?.id ?? this.draft.pending()?.attemptId; if (id) this.store.watch(id); }
            },
            error: () => { if (this.alive && this.owner === this.session.generation() && key === lessonKey(this.lesson())) this.sessionError.set('Не удалось проверить сессию. Несохранённый код остаётся в этой вкладке.'); },
        });
    }
    owned() { return this.alive && this.owner === this.session.generation() && this.bound === lessonKey(this.lesson()) && !untracked(this.checking); }
    private validSelection(id = this.selection, key = this.bound) { return this.owned() && id === this.selectedId() && key === this.bound; }
    private retainedDirtySource() {
        return this.alive && this.owner === this.session.generation()
            && this.bound === lessonKey(this.lesson()) && this.selection === this.selectedId()
            && this.session.actor()?.role === 'STUDENT' && this.session.actor()?.workspaceId === this.lesson().workspaceId
            && !this.preview() && this.draft.exercise()?.id === this.selectedId() && this.draft.dirty();
    }
    sourceOwner() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.draft.exercise()?.id === this.selectedId(); }
    writable() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && !!this.current(); }
    runnable() { return this.writable() && this.draft.editable() && this.draft.compatible() && !this.draft.conflict() && !this.draft.paused() && !this.store.resetting(); }
    editorReadonly() { return !this.writable() || this.draft.paused() || this.store.resetting(); }
    async choose(id: string) {
        const key = this.bound;
        if (id === this.selectedId() || !this.owned()) return;
        if (!await this.exit.ask() || !this.owned() || key !== this.bound) return;
        this.selectedId.set(id);
    }
    assignmentsSaved(view: LessonPracticeView) {
        if (!this.owned() || !this.teacher()) return;
        this.view.set(view);
        if (!view.exercises.some(row => row.exercise.id === this.selectedId())) this.selectedId.set(view.exercises[0]?.exercise.id ?? '');
    }
    refreshCatalog() {
        if (!this.owned() || this.loading()) return;
        const key = this.bound;
        this.api.practice(this.lesson(), this.preview()).pipe(this.store.untilLessonChange()).subscribe({
            next: view => {
                if (!this.owned() || key !== this.bound) return;
                this.view.set(view);
                if (!this.selectedId()) this.selectedId.set(view.exercises[0]?.exercise.id ?? '');
            },
            error: () => { if (this.owned()) this.store.fail('Не удалось обновить задания. Твой код не изменён.', () => this.refreshCatalog()); },
        });
    }
    run(mode: Mode) {
        if (!this.runnable() || this.store.sending()) return;
        const intent = this.draft.intent(mode);
        if (intent) this.enqueue(intent);
    }
    recoverAttempt() {
        if (!this.sourceOwner() || this.store.sending()) return;
        const intent = this.draft.pending();
        if (intent) this.enqueue(intent);
    }
    // The same intent (key and exact files) is sent again after an unknown outcome; an accepted ID is only polled.
    private enqueue(intent: AttemptIntent) {
        if (intent.attemptId) { this.store.watch(intent.attemptId); return; }
        const id = this.selectedId(), key = this.bound;
        this.store.sending.set(true);
        this.store.clearFailure();
        this.api.enqueue(this.lesson(), id, intent.request.files, intent.request.exerciseRevision, intent.request.mode, intent.key).pipe(this.store.untilSelectionChange()).subscribe({
            next: attempt => {
                if (!this.validSelection(id, key)) return;
                this.store.sending.set(false);
                this.draft.accepted(attempt, intent.key);
                this.store.attempt.set(attempt);
                this.store.watch(attempt.id);
            },
            error: error => {
                if (!this.validSelection(id, key)) return;
                this.store.sending.set(false);
                if (error.status === 409) this.store.fail('Задание изменилось. Твой код сохранён; обновите задания и явно выберите переход.', () => this.refreshCatalog(), 'Обновить задания');
                else if (error.status === 429) this.store.fail('Очередь заполнена. Повтор использует тот же ключ попытки.', () => this.recoverAttempt());
                else this.store.fail('Ответ не получен. Повтор этой проверки использует тот же ключ и точный код.', () => this.recoverAttempt());
            },
        });
    }
    showAttempt(id: string) { if (this.validSelection()) this.store.watch(id); }
    showArchive(id: string) { if (this.validSelection()) this.store.showArchive(id); }
    chooseReset(choice: ResetChoice) { this.store.resetChoice.set(choice); }
    // Explicit move of the draft to the republished exercise revision; the server archives the previous saved draft.
    reset() {
        if (!this.writable() || !this.store.resetChoice() || this.store.resetting()) return;
        const id = this.selectedId(), key = this.bound, template = this.store.resetChoice() === 'template';
        this.store.resetting.set(true);
        this.draft.pause(true);
        this.api.draft(this.lesson(), id).pipe(this.store.untilSelectionChange()).subscribe({
            next: async server => {
                if (!this.validSelection(id, key)) return;
                this.draft.refreshCounter(server);
                const saved = await this.draft.reset(template);
                if (!this.validSelection(id, key)) return;
                this.store.resetting.set(false);
                this.draft.pause(false);
                if (saved) this.store.resetChoice.set(null);
            },
            error: () => {
                if (!this.validSelection(id, key)) return;
                this.store.resetting.set(false);
                this.draft.pause(false);
                this.store.fail('Не удалось обновить ревизию черновика. Код сохранён в редакторе.', () => this.reset());
            },
        });
    }
    exportFiles(): boolean {
        if (!this.sourceOwner()) return false;
        try {
            const payload = JSON.stringify({ exerciseId: this.selectedId(), exerciseRevision: this.draft.sourceRevision(), files: this.draft.files() }, null, 2);
            const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' })), link = document.createElement('a');
            link.href = url;
            link.download = 'practice-source.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            return true;
        } catch {
            this.store.fail('Экспорт недоступен. Скопируйте файлы перед выходом.');
            return false;
        }
    }
    toggleTheme() {
        const dark = !this.dark();
        this.dark.set(dark);
        try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* the toggle still works for this page */ }
    }
}

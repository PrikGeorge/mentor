import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { EMPTY, Subscription, catchError, expand, forkJoin, map, of, reduce, switchMap } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { readResource } from '../core/read-resource';
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
import { DraftArchiveComponent } from './draft-archive.component';
import { saveBlob } from '../core/download';
const THEME_KEY = 'mentor.trainer-theme';
const storedTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; } };
const TREE_KEY = 'mentor.trainer-tree';
// A display preference like the theme: without a stored choice the tree starts folded on medium screens to give code room.
const storedTree = () => {
    try { const value = localStorage.getItem(TREE_KEY); if (value) return value === 'collapsed'; } catch { /* fall back to the screen width */ }
    return typeof matchMedia === 'function' && matchMedia('(min-width: 700px) and (max-width: 1099px)').matches;
};
export type PanelTab = 'statement' | 'result' | 'attempts' | 'archive';
// The trainer of one lesson. Owns the session guards (account generation, lesson key, chosen exercise), the draft and the
// loading of catalog, history and materials; the result state lives in PracticeSessionStore and the children only render.
@Component({
    selector: 'mentor-practice-workbench',
    imports: [TeacherPracticeComponent, IconComponent, PracticeErrorComponent, ExerciseListComponent, ExerciseStatementComponent, EditorPanelComponent, AttemptResultComponent, AttemptHistoryComponent, DraftArchiveComponent],
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
    private readonly scope = createBoundScope(() => { const lesson = this.lesson(); return [lesson.workspaceId, lesson.studentId, lesson.id, this.preview()]; });
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
    readonly treeCollapsed = signal(storedTree());
    // The bottom panel under the editor: the statement, the open attempt, the attempt list and an opened archived draft.
    readonly panel = signal<PanelTab>('statement');
    private panelChosen = false;
    readonly tabs = computed(() => {
        const total = this.store.attemptTotal(), tabs: { id: PanelTab; label: string }[] = [
            { id: 'statement', label: 'Условие' }, { id: 'result', label: 'Результат' }, { id: 'attempts', label: total ? 'Попытки · ' + total : 'Попытки' }];
        return this.store.archive() ? [...tabs, { id: 'archive' as const, label: 'Архивный черновик' }] : tabs;
    });
    readonly fileNames = computed(() => Object.keys(this.draft.files()));
    private readonly attemptId = computed(() => this.store.attempt()?.id ?? null);
    private readonly archiveId = computed(() => this.store.archive()?.id ?? null);
    readonly archiveNames = computed(() => Object.keys(this.store.archive()?.files ?? {}));
    private bound = '';
    private selection = '';
    private readonly lessonReading = readResource({
        scope: this.scope,
        params: () => ({ lesson: this.lesson(), preview: this.preview() }),
        load: ({ lesson, preview }) => {
            const history = this.api.history(lesson, preview).pipe(
                expand(page => page.items.length && (page.page + 1) * page.size < page.total ? this.api.history(lesson, preview, page.page + 1) : EMPTY),
                map(page => page.items), reduce((all, items) => [...all, ...items], [] as HistoryEntry[]));
            return forkJoin({ view: this.api.practice(lesson, preview), history });
        },
    });
    private readonly referenceReading = readResource({
        scope: this.scope,
        params: () => ({ lesson: this.lesson(), preview: this.preview() }),
        load: ({ lesson, preview }) => this.scope.track(this.materials.catalog(lesson.workspaceId, lesson.studentId, lesson.id, preview)).pipe(
            // Discovery is optional; a known material that fails to load still offers a retry.
            catchError(() => of([])),
            switchMap(rows => {
                const publicCode = rows.filter(row => row.kind === 'code' && row.audience === 'student');
                return publicCode.length ? forkJoin(publicCode.map(row => this.materials.load(lesson.workspaceId, row.id, preview))) : of([] as MaterialView[]);
            })),
    });
    private readonly selectionScope = createBoundScope(() => [lessonKey(this.lesson()), this.preview(), this.selectedId(), this.selectionTick()]);
    private readonly draftReading = readResource({
        scope: this.selectionScope,
        params: () => {
            const id = this.selectedId(), refresh = this.selectionTick();
            const exercise = untracked(this.current), history = untracked(this.history);
            return id && this.owned() && (exercise || history.some(row => row.exerciseId === id && row.hasDraft))
                ? { lesson: this.lesson(), preview: this.preview(), id, exercise, refresh } : undefined;
        },
        load: ({ lesson, preview, id }) => this.api.draft(lesson, id, preview).pipe(this.store.untilSelectionChange()),
    });
    constructor() {
        this.store.attach({ lesson: () => this.lesson(), preview: () => this.preview(), selectedId: () => this.selectedId(), key: () => this.bound, valid: (id, key) => this.validSelection(id, key) });
        const unregister = this.exit.register({ valid: () => this.sourceOwner(), blocked: () => this.scope.current() && this.checking(), dirty: () => this.draft.dirty(), pause: value => this.draft.pause(value), save: () => this.draft.save(), export: () => this.exportFiles(), discard: () => this.draft.discard() });
        const beforeUnload = (event: BeforeUnloadEvent) => { if (this.retainedDirtySource()) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload);
        const visibility = () => { if (document.visibilityState === 'hidden') this.suspend(); else this.revalidate(); };
        document.addEventListener('visibilitychange', visibility);
        this.destroyRef.onDestroy(() => {
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
            const lesson = this.lesson(); this.preview(); this.loadTick(); this.session.generation();
            this.scope.bind(); this.bound = lessonKey(lesson); this.selectedId.set('');
            this.view.set(null); this.history.set([]); this.references.set([]); this.loading.set(false);
            this.store.clearFailure(); this.draft.stop(); this.store.cancelLesson();
            onCleanup(() => { this.store.cancelLesson(); this.draft.stop(); });
        });
        effect(() => {
            const state = this.lessonReading.state();
            this.loading.set(state.status === 'loading');
            if (!this.owned()) return;
            if (state.status === 'resolved') {
                this.view.set(state.value.view); this.history.set(state.value.history);
                const preferred = untracked(this.initialExercise);
                const known = preferred && (state.value.view.exercises.some(row => row.exercise.id === preferred) || state.value.history.some(row => row.exerciseId === preferred));
                this.selectedId.set(known ? preferred : state.value.view.exercises[0]?.exercise.id ?? state.value.history[0]?.exerciseId ?? '');
            } else if (state.status === 'error') this.store.fail('Не удалось загрузить тренажёр. Обновите страницу.', () => this.reload());
        });
        effect(() => {
            const state = this.referenceReading.state();
            if (!this.owned()) return;
            if (state.status === 'resolved') this.references.set(state.value);
            else if (state.status === 'error') this.store.fail('Исходные материалы временно недоступны. Черновик остаётся в редакторе.', () => this.referenceReading.reload());
        });
        // Selection resets remain local; only the resource owns the draft GET.
        effect(onCleanup => {
            const id = this.selectedId(); this.lesson(); this.preview(); this.selectionTick(); this.session.generation();
            this.selectionScope.bind(); this.selection = id; this.store.resetSelection(); this.draft.stop();
            onCleanup(() => { this.store.cancelSelection(); this.draft.stop(); });
        });
        effect(() => {
            const state = this.draftReading.state();
            untracked(() => {
            if (!this.owned()) return;
            if (state.status === 'error') { this.store.fail('Не удалось загрузить сохранённый черновик. История остаётся доступна.', () => this.selectionTick.update(value => value + 1)); return; }
            if (state.status !== 'resolved') return;
            const { lesson, preview, id, exercise } = state.params, key = lessonKey(lesson);
            if (!this.validSelection(id, key)) return;
            if (!exercise) { this.store.historicalFiles.set({ ...state.value.files }); return; }
            this.draft.bind(lesson, exercise, state.value, preview, () => this.validSelection(id, key));
            this.file.set(Object.keys(this.draft.files())[0] ?? '');
            const pending = this.draft.pending();
            if (pending?.attemptId) untracked(() => this.store.watch(pending.attemptId!));
            });
        });
        // Each exercise opens on its statement; the teacher, who comes to review, opens on the attempt list.
        effect(() => { this.selectedId(); this.session.generation(); untracked(() => { this.panelChosen = false; this.panel.set('statement'); }); });
        // The teacher comes to review: once the exercise turns out to have attempts, the list opens unless a tab was already chosen.
        effect(() => { if (this.store.attemptTotal() > 0) untracked(() => { if ((this.teacher() || this.preview()) && !this.panelChosen && this.panel() === 'statement') this.panel.set('attempts'); }); });
        // A new or reopened attempt is shown at once, like a run window in an IDE; so is an opened archived draft.
        // Keyed by id: polling replaces the attempt object every few seconds and must not pull the student out of another tab.
        effect(() => { if (this.attemptId()) untracked(() => this.panel.set('result')); });
        effect(() => { if (this.archiveId()) untracked(() => this.panel.set('archive')); else untracked(() => { if (this.panel() === 'archive') this.panel.set('statement'); }); });
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
        if (!this.scope.active() || this.checkRequest && !this.checkRequest.closed) return;
        this.suspend();
        this.checking.set(true);
        this.sessionError.set('');
        const key = this.bound;
        this.checkRequest = this.scope.track(this.session.load().pipe(this.store.untilLessonChange())).subscribe({
            next: () => {
                if (!this.scope.active() || key !== lessonKey(this.lesson())) return;
                this.checking.set(false);
                this.draft.pause(false);
                if (!this.view()) this.reload();
                else if (this.current() && !this.draft.exercise()) this.selectionTick.update(value => value + 1);
                else { const id = this.store.attempt()?.id ?? this.draft.pending()?.attemptId; if (id) this.store.watch(id); }
            },
            error: () => { if (this.scope.active() && key === lessonKey(this.lesson())) this.sessionError.set('Не удалось проверить сессию. Несохранённый код остаётся в этой вкладке.'); },
        });
    }
    owned() { return this.scope.active() && !untracked(this.checking); }
    private validSelection(id = this.selection, key = this.bound) { return this.owned() && id === this.selectedId() && key === this.bound; }
    private retainedDirtySource() {
        return this.scope.active() && this.selection === this.selectedId()
            && this.session.actor()?.role === 'STUDENT' && this.session.actor()?.workspaceId === this.lesson().workspaceId
            && !this.preview() && this.draft.exercise()?.id === this.selectedId() && this.draft.dirty();
    }
    sourceOwner() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && this.draft.exercise()?.id === this.selectedId(); }
    writable() { return this.validSelection() && this.session.actor()?.role === 'STUDENT' && !this.preview() && !!this.current(); }
    runnable() { return this.writable() && this.draft.editable() && this.draft.compatible() && !this.draft.conflict() && !this.draft.paused() && !this.store.resetting(); }
    editorReadonly() { return !this.writable() || this.draft.paused() || this.store.resetting(); }
    async choose(id: string) {
        const key = this.bound, accepted = this.scope.capture();
        if (id === this.selectedId() || !this.owned()) return;
        if (!await this.exit.ask() || !accepted() || !this.owned() || key !== this.bound) return;
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
        this.scope.track(this.api.practice(this.lesson(), this.preview()).pipe(this.store.untilLessonChange())).subscribe({
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
        this.scope.track(this.api.enqueue(this.lesson(), id, intent.request.files, intent.request.exerciseRevision, intent.request.mode, intent.key).pipe(this.store.untilSelectionChange())).subscribe({
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
    // Reopening the attempt or archive already loaded only brings its tab back.
    showAttempt(id: string) { if (!this.validSelection()) return; if (this.attemptId() === id) this.panel.set('result'); this.store.watch(id); }
    showArchive(id: string) { if (!this.validSelection()) return; if (this.archiveId() === id) this.panel.set('archive'); else this.store.showArchive(id); }
    chooseReset(choice: ResetChoice) { this.store.resetChoice.set(choice); }
    // Explicit move of the draft to the republished exercise revision; the server archives the previous saved draft.
    reset() {
        if (!this.writable() || !this.store.resetChoice() || this.store.resetting()) return;
        const id = this.selectedId(), key = this.bound, template = this.store.resetChoice() === 'template', accepted = this.scope.capture();
        this.store.resetting.set(true);
        this.draft.pause(true);
        this.scope.track(this.api.draft(this.lesson(), id).pipe(this.store.untilSelectionChange())).subscribe({
            next: async server => {
                if (!accepted() || !this.validSelection(id, key)) return;
                this.draft.refreshCounter(server);
                const saved = await this.draft.reset(template);
                if (!accepted() || !this.validSelection(id, key)) return;
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
            saveBlob(new Blob([payload], { type: 'application/json' }), 'practice-source.json');
            return true;
        } catch {
            this.store.fail('Экспорт недоступен. Скопируйте файлы перед выходом.');
            return false;
        }
    }
    toggleTree() {
        const collapsed = !this.treeCollapsed();
        this.treeCollapsed.set(collapsed);
        try { localStorage.setItem(TREE_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* the toggle still works for this page */ }
    }
    chooseTab(tab: PanelTab) { this.panelChosen = true; this.panel.set(tab); }
    // Arrow keys move between the panel tabs (WAI-ARIA tabs pattern).
    moveTab(event: KeyboardEvent) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const tabs = this.tabs(), index = tabs.findIndex(tab => tab.id === this.panel());
        const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        this.chooseTab(next.id);
        (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('#trainer-tab-' + next.id)?.focus();
        event.preventDefault();
    }
    toggleTheme() {
        const dark = !this.dark();
        this.dark.set(dark);
        try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* the toggle still works for this page */ }
    }
}

import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import { MonoTypeOperatorFunction, Subject, Subscription, takeUntil } from 'rxjs';
import type { components } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { PracticeApi, Attempt, SourceFiles } from './practice-api.service';
import { AttemptPoller } from './attempt-poller.service';
import { readResource } from '../core/read-resource';
import type { AttemptSummary, WorkerStatus } from './attempt-labels';
export type DraftArchive = components['schemas']['DraftArchive'];
export type DraftArchiveSummary = components['schemas']['DraftArchiveSummary'];
export type WorkerAvailability = Pick<WorkerStatus, 'available' | 'lastSeenAt'>;
export type ResetChoice = 'keep' | 'template' | null;
// A failure the student can act on: the message and, when it makes sense, the action that repeats the failed step.
export interface PracticeFailure { message: string; retry: (() => void) | null; retryLabel: string; }
// The workbench lends the store its session guards so every answer is checked against the live lesson, selection and account generation.
export interface PracticeScope {
    lesson(): LessonRef;
    preview(): boolean;
    selectedId(): string;
    key(): string;
    valid(id?: string, key?: string): boolean;
}
export const PAGE_SIZE = 25;
// Selection-scoped trainer state: the shown attempt, its polling, the paged attempt and archive lists and the single error block.
// HTTP answers are accepted only while the scope still points at the same lesson, exercise and account generation.
@Injectable()
export class PracticeSessionStore implements OnDestroy {
    private readonly api = inject(PracticeApi);
    private readonly poller = inject(AttemptPoller);
    readonly failure = signal<PracticeFailure | null>(null);
    readonly attempt = signal<Attempt | null>(null);
    readonly attempts = signal<AttemptSummary[]>([]);
    readonly attemptPage = signal(0);
    readonly attemptTotal = signal(0);
    readonly archives = signal<DraftArchiveSummary[]>([]);
    readonly archivePage = signal(0);
    readonly archiveTotal = signal(0);
    readonly archive = signal<DraftArchive | null>(null);
    readonly historicalFiles = signal<SourceFiles>({});
    // Executor availability, fetched only while an attempt has been queued for a while.
    readonly worker = signal<WorkerAvailability | null>(null);
    // Mentor comments on the shown attempt; the code opens by itself once the student has some to read.
    readonly noted = signal(0);
    readonly sending = signal(false);
    readonly resetting = signal(false);
    readonly resetChoice = signal<ResetChoice>(null);
    private scope: PracticeScope | null = null;
    private readonly lessonChanged = new Subject<void>();
    private readonly selectionChanged = new Subject<void>();
    private poll: Subscription | null = null;
    private readonly attemptsRequest = signal<HistoryRequest | undefined>(undefined);
    private readonly archivesRequest = signal<HistoryRequest | undefined>(undefined);
    private readonly attemptsReading = readResource({
        params: () => this.attemptsRequest(),
        load: request => this.api.attempts(request.lesson, request.id, request.preview, request.page).pipe(this.untilSelectionChange()),
    });
    private readonly archivesReading = readResource({
        params: () => this.archivesRequest(),
        load: request => this.api.archives(request.lesson, request.id, request.preview, request.page).pipe(this.untilSelectionChange()),
    });
    constructor() {
        effect(() => {
            const state = this.attemptsReading.state();
            if (state.status === 'idle' || !this.scope?.valid(state.params.id, state.params.key)) return;
            if (state.status === 'resolved') { this.attempts.set(state.value.items); this.attemptTotal.set(state.value.total); }
            else if (state.status === 'error') this.fail('Не удалось загрузить историю попыток.', () => this.attemptsReading.reload());
        });
        effect(() => {
            const state = this.archivesReading.state();
            if (state.status === 'idle' || !this.scope?.valid(state.params.id, state.params.key)) return;
            if (state.status === 'resolved') { this.archives.set(state.value.items); this.archiveTotal.set(state.value.total); }
            else if (state.status === 'error') this.fail('Не удалось загрузить архив черновиков.', () => this.archivesReading.reload());
        });
    }
    private queuedSince = 0;
    private workerChecked = 0;
    attach(scope: PracticeScope) { this.scope = scope; }
    ngOnDestroy() { this.cancelLesson(); this.cancelSelection(); }
    // Requests that must stop when the lesson or the account changes.
    untilLessonChange<T>(): MonoTypeOperatorFunction<T> { return takeUntil(this.lessonChanged); }
    // Requests that must also stop when another exercise is chosen or the tab is suspended.
    untilSelectionChange<T>(): MonoTypeOperatorFunction<T> { return source => source.pipe(takeUntil(this.selectionChanged), takeUntil(this.lessonChanged)); }
    cancelLesson() { this.lessonChanged.next(); this.stopWatching(); this.attemptsRequest.set(undefined); this.archivesRequest.set(undefined); }
    cancelSelection() { this.selectionChanged.next(); this.stopWatching(); this.attemptsRequest.set(undefined); this.archivesRequest.set(undefined); }
    stopWatching() { this.poll?.unsubscribe(); this.poll = null; }
    // Everything that belongs to one chosen exercise; called before a new selection loads.
    resetSelection() {
        this.cancelSelection();
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
    }
    fail(message: string, retry: (() => void) | null = null, retryLabel = 'Повторить') { this.failure.set({ message, retry, retryLabel }); }
    clearFailure() { this.failure.set(null); }
    retryFailure() { const failure = this.failure(); this.failure.set(null); failure?.retry?.(); }
    loadAttempts(lesson: LessonRef, id: string, preview: boolean, page: number) {
        this.attemptsRequest.set({ lesson, id, preview, page, key: this.scope!.key() });
    }
    loadArchives(lesson: LessonRef, id: string, preview: boolean, page: number) {
        this.archivesRequest.set({ lesson, id, preview, page, key: this.scope!.key() });
    }
    // Follows one attempt until it finishes; each answer refreshes the shown result and the first page of history.
    watch(id: string) {
        const scope = this.scope!, lesson = scope.lesson(), exercise = scope.selectedId(), key = scope.key();
        this.stopWatching();
        this.poll = this.poller.watch(lesson, exercise, id, scope.preview()).pipe(this.untilSelectionChange()).subscribe({
            next: attempt => { if (scope.valid(exercise, key)) this.record(attempt, lesson.workspaceId); },
            error: () => { if (scope.valid(exercise, key)) this.fail('Не удалось загрузить попытку.', () => this.watch(id)); },
        });
    }
    showArchive(id: string) {
        const scope = this.scope!, selected = scope.selectedId(), key = scope.key();
        this.api.archive(scope.lesson(), id, scope.preview()).pipe(this.untilSelectionChange()).subscribe({
            next: archive => { if (scope.valid(selected, key)) this.archive.set(archive); },
            error: () => { if (scope.valid(selected, key)) this.fail('Не удалось загрузить архив.', () => this.showArchive(id)); },
        });
    }
    private record(attempt: Attempt, workspaceId: string) {
        this.attempt.set(attempt);
        this.trackQueue(attempt, workspaceId);
        if (this.attemptPage() !== 0) return;
        const { files, ...summary } = attempt;
        if (!this.attempts().some(row => row.id === attempt.id)) this.attemptTotal.update(total => total + 1);
        this.attempts.update(rows => [summary, ...rows.filter(row => row.id !== attempt.id)].slice(0, PAGE_SIZE));
    }
    private trackQueue(attempt: Attempt, workspaceId: string) {
        if (attempt.jobState !== 'queued') { this.queuedSince = 0; this.worker.set(null); return; }
        const now = Date.now();
        if (!this.queuedSince) this.queuedSince = now;
        if (now - this.queuedSince < 15000 || now - this.workerChecked < 15000) return;
        this.workerChecked = now;
        this.api.worker(workspaceId).subscribe({ next: status => this.worker.set(status), error: () => this.worker.set(null) });
    }
}

interface HistoryRequest { lesson: LessonRef; id: string; preview: boolean; page: number; key: string; }

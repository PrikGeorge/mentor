import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { SessionStore } from '../core/session.store';
import { DraftRecovery } from './draft-recovery.service';
import { PracticeApi, filesError, revisionKey } from './practice-api.service';
import type { LessonRef } from '../editor/lesson-text-api.service';
import type { SourceFiles, PublicExercise, Draft, Mode, Attempt, AttemptIntent } from './practice-api.service';
@Injectable()
export class PracticeDraft {
    readonly files = signal<SourceFiles>({});
    readonly dirty = signal(false);
    readonly error = signal('');
    readonly busy = signal(false);
    readonly conflict = signal(false);
    readonly paused = signal(false);
    readonly exercise = signal<PublicExercise | null>(null);
    readonly sourceRevision = signal<Draft['exerciseRevision']>(0);
    private readonly api = inject(PracticeApi);
    private readonly recovery = inject(DraftRecovery);
    private readonly session = inject(SessionStore);
    private lesson: LessonRef | null = null;
    private counter = 0;
    private owner = -1;
    private stamp = 0;
    private key = '';
    private preview = false;
    private valid = () => false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readonly cancel = new Subject<void>();
    private currentIntent: AttemptIntent | null = null;
    private resetting = false;
    bind(lesson: LessonRef, exercise: PublicExercise, draft: Draft, preview = false, valid: () => boolean = () => true): void {
        this.stop();
        this.lesson = { ...lesson };
        this.exercise.set(exercise);
        this.sourceRevision.set(draft.exerciseRevision);
        this.counter = draft.revision;
        this.preview = preview;
        this.valid = valid;
        this.owner = this.session.generation();
        this.conflict.set(false);
        this.paused.set(false);
        this.error.set('');
        this.busy.set(false);
        const actor = this.session.actor();
        this.key = actor ? this.recovery.key(actor.userId, lesson.workspaceId, lesson.studentId, lesson.id, exercise.id, draft.exerciseRevision) : '';
        const recovered = this.active() ? this.recovery.read(this.key) : null;
        const names = Object.keys(draft.files);
        const files = recovered && !filesError(recovered.files, names) ? recovered.files : draft.files;
        this.files.set({ ...files });
        this.dirty.set(!same(files, draft.files));
        const intent = this.active() ? this.recovery.readIntent(this.key) : null;
        this.currentIntent = intent && revisionKey(intent.request.exerciseRevision) === revisionKey(draft.exerciseRevision) && !filesError(intent.request.files, names) ? intent : null;
    }
    compatible() { const exercise = this.exercise(); return !!exercise && revisionKey(this.sourceRevision()) === revisionKey(exercise.revision); }
    updateExercise(exercise: PublicExercise) { if (this.exercise()?.id === exercise.id)
        this.exercise.set(exercise); }
    refreshCounter(draft: Draft) { if (this.active() && draft.exerciseId === this.exercise()?.id) {
        this.counter = draft.revision;
        this.conflict.set(false);
    } }
    editable() { return this.active(); }
    pause(value: boolean) { if (!this.active())
        return; this.paused.set(value); this.clearTimer(); if (!value && this.dirty())
        this.schedule(); }
    suspend(){if(!this.active())return;this.pause(true);this.cancel.next();this.busy.set(false);this.resetting=false;}
    discard() { if (!this.active())
        return; this.clearTimer(); this.clearRecovery(this.files()); this.dirty.set(false); }
    intent(mode: Mode): AttemptIntent | null {
        if (!this.active() || !this.compatible() || this.conflict())
            return null;
        const failure = filesError(this.files(), Object.keys(this.exercise()!.starterFiles));
        if (failure) {
            this.error.set(failure);
            return null;
        }
        const current = this.currentIntent;
        if (!current || current.request.mode !== mode || revisionKey(current.request.exerciseRevision) !== revisionKey(this.sourceRevision()) || !same(current.request.files, this.files())) {
            this.currentIntent = { key: crypto.randomUUID(), request: { files: { ...this.files() }, exerciseRevision: this.sourceRevision(), mode } };
            this.persistIntent();
        }
        return this.pending();
    }
    accepted(attempt: Attempt, key = this.currentIntent?.key): void {
        const intent = this.currentIntent;
        if (!this.active() || !intent || intent.key !== key || attempt.exerciseId !== this.exercise()?.id || attempt.mode !== intent.request.mode || revisionKey(attempt.exerciseRevision) !== revisionKey(intent.request.exerciseRevision) || !same(attempt.files, intent.request.files))
            return;
        this.currentIntent = { ...intent, attemptId: attempt.id };
        this.persistIntent();
    }
    pending(): AttemptIntent | null { const intent = this.currentIntent; return this.active() && intent ? { ...intent, request: { ...intent.request, files: { ...intent.request.files } } } : null; }
    private persistIntent() { if (!this.active() || !this.currentIntent)
        return; try {
        this.recovery.saveIntent(this.key, this.currentIntent);
    }
    catch {
        this.error.set('Браузер не сохранил попытку. Повтор в этой вкладке использует прежний ключ; экспортируйте код перед выходом.');
    } }
    async reset(template: boolean): Promise<boolean> {
        this.clearTimer();
        if (!this.active() || this.busy() || !this.lesson || !this.exercise())
            return false;
        const exercise = this.exercise()!, files = { ...(template ? exercise.starterFiles : this.files()) }, failure = filesError(files, Object.keys(exercise.starterFiles));
        if (failure) {
            this.error.set(failure);
            return false;
        }
        const stamp = this.stamp;
        this.resetting = true;
        this.busy.set(true);
        this.persist();
        try {
            const saved = await firstValueFrom(this.api.saveDraft(this.lesson, exercise.id, { files, revision: this.counter, exerciseRevision: exercise.revision, resetForRevision: exercise.revision }).pipe(takeUntil(this.cancel)));
            if (stamp !== this.stamp || !this.active())
                return false;
            this.counter = saved.revision;
            this.sourceRevision.set(saved.exerciseRevision);
            this.files.set({ ...saved.files });
            this.dirty.set(false);
            this.conflict.set(false);
            this.error.set('');
            const actor = this.session.actor()!;
            this.key = this.recovery.key(actor.userId, this.lesson.workspaceId, this.lesson.studentId, this.lesson.id, exercise.id, saved.exerciseRevision);
            this.currentIntent = null;
            this.clearRecovery(saved.files);
            this.recovery.removeIntent(this.key);
            return true;
        }
        catch {
            if (stamp === this.stamp && this.active())
                this.error.set('Переход не подтверждён. Ваш код остаётся в редакторе.');
            return false;
        }
        finally {
            if (stamp === this.stamp && this.active()) {
                this.busy.set(false);
                this.resetting = false;
            }
        }
    }
    private active() { return !!this.lesson && !this.preview && this.valid() && this.owner === this.session.generation() && this.session.actor()?.role === 'STUDENT' && this.session.actor()?.workspaceId === this.lesson.workspaceId; }
    edit(name: string, text: string): void {
        if (!this.active() || this.paused() || this.resetting || !Object.hasOwn(this.files(), name))
            return;
        this.files.set({ ...this.files(), [name]: text });
        this.dirty.set(true);
        this.persist();
        this.schedule();
    }
    private persist() { if (!this.active())
        return; try {
        this.recovery.save(this.key, this.files());
    }
    catch {
        this.error.set('Браузер не сохранил резервную копию. Код остаётся в редакторе; сохраните или выгрузите его.');
    } }
    private schedule() { this.clearTimer(); if (this.active() && !this.paused() && !this.conflict() && this.compatible())
        this.timer = setTimeout(() => { void this.save(); }, 1200); }
    private clearTimer() { if (this.timer !== undefined)
        clearTimeout(this.timer); this.timer = undefined; }
    async save(): Promise<boolean> {
        this.clearTimer();
        if (!this.active() || this.busy() || !this.lesson || !this.exercise())
            return false;
        if (!this.dirty())
            return true;
        if (!this.compatible()) {
            this.error.set('Упражнение обновилось. Сохраните копию кода и явно выберите переход на новую ревизию.');
            return false;
        }
        const failure = filesError(this.files(), Object.keys(this.exercise()!.starterFiles));
        if (failure) {
            this.error.set(failure);
            return false;
        }
        const stamp = this.stamp, files = { ...this.files() };
        this.busy.set(true);
        this.error.set('');
        try {
            const saved = await firstValueFrom(this.api.saveDraft(this.lesson, this.exercise()!.id, { exerciseRevision: this.sourceRevision(), revision: this.counter, files }).pipe(takeUntil(this.cancel)));
            if (stamp !== this.stamp || !this.active())
                return false;
            this.counter = saved.revision;
            this.conflict.set(false);
            if (same(this.files(), files)) {
                this.dirty.set(false);
                this.clearRecovery(files);
            }
            else
                this.schedule();
            return true;
        }
        catch (error) {
            if (stamp === this.stamp && this.active()) {
                const status = (error as {
                    status?: number;
                }).status;
                this.conflict.set(status === 409);
                this.error.set(status === 409 ? 'Черновик или упражнение изменились. Ваш код сохранён локально; обновите данные перед повтором.' : 'Сохранение не подтверждено. Код остаётся в редакторе; повторите сохранение.');
            }
            return false;
        }
        finally {
            if (stamp === this.stamp && this.active())
                this.busy.set(false);
        }
    }
    private clearRecovery(files:SourceFiles){const recovery=this.recovery.read(this.key);if(recovery&&same(recovery.files,files))this.recovery.remove(this.key);}
    stop(): void { this.clearTimer(); this.stamp++; this.cancel.next(); this.owner = -1; this.resetting = false; this.exercise.set(null); this.files.set({}); this.dirty.set(false); this.currentIntent = null; }
}
function same(left: SourceFiles, right: SourceFiles) { const names = Object.keys(left); return names.length === Object.keys(right).length && names.every(name => left[name] === right[name]); }

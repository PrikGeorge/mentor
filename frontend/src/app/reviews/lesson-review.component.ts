import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { HomeworkApi, Submission, ReviewStatus } from '../homework/homework-api.service';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
@Component({ selector: 'mentor-lesson-review', template: `
@if(active()){
<details class="submission-review"><summary>{{submission().feedback?'Изменить ревью':'Оставить ревью'}}</summary>
<form (submit)="save($event)" class="homework-review-form" [attr.aria-busy]="busy()">
<label>Обратная связь к этой работе<textarea name="feedback" rows="4" maxlength="20000" [value]="feedback()" (input)="feedback.set($any($event.target).value)" [readOnly]="busy()"></textarea></label>
<label>Результат ревью<select name="reviewStatus" [value]="status()" (change)="status.set($any($event.target).value)" [disabled]="busy()"><option value="reviewed">Проверено</option><option value="needs_revision">Нужна доработка</option></select></label>
@if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
@if(succeeded()){<p class="success-banner" role="status">Ревью сохранено.</p>}
<div class="actions"><button class="btn primary" type="submit" [disabled]="busy()">Сохранить ревью</button></div>
</form></details>}` })
export class LessonReviewComponent {
    readonly lesson = input.required<LessonRef>(); readonly submission = input.required<Submission>(); readonly preview = input(false);
    readonly reviewed = output<Submission>(); readonly feedback = signal(''); readonly status = signal<ReviewStatus>('reviewed'); readonly error = signal(''); readonly busy = signal(false); readonly succeeded = signal(false);
    private readonly session = inject(SessionStore); private readonly api = inject(HomeworkApi); private readonly owner = this.session.generation();
    private readonly bound = signal<{ workspace: string; student: string; lesson: string; submission: string; revision: number } | null>(null);
    private request?: Subscription; private alive = true;
    readonly active = computed(() => { const b = this.bound(), l = this.lesson(), s = this.submission(); return this.alive && this.owner === this.session.generation() && this.session.actor()?.role === 'TEACHER' && this.session.actor()?.workspaceId === l.workspaceId && !this.preview() && b?.workspace === l.workspaceId && b.student === l.studentId && b.lesson === l.id && b.submission === s.id && b.revision === s.revision; });
    constructor() {
        effect(() => { const l = this.lesson(), s = this.submission(); this.session.generation(); this.preview(); this.request?.unsubscribe(); this.bound.set({ workspace: l.workspaceId, student: l.studentId, lesson: l.id, submission: s.id, revision: s.revision }); this.feedback.set(s.feedback); this.status.set(s.status === 'needs_revision' ? 'needs_revision' : 'reviewed'); this.error.set(''); this.busy.set(false); this.succeeded.set(false); });
        inject(DestroyRef).onDestroy(() => { this.alive = false; this.request?.unsubscribe(); });
    }
    save(event?: Event) {
        event?.preventDefault(); if (!this.active() || this.busy()) return;
        this.error.set(''); this.succeeded.set(false);
        if (this.feedback().length > 20000) { this.error.set('Отзыв должен быть не больше 20 000 символов.'); return; }
        const submission = this.submission(); this.busy.set(true);
        this.request = this.api.review(this.lesson(), submission.id, submission.revision, this.status(), this.feedback().trim()).subscribe({
            next: result => { if (this.active()) { this.busy.set(false); this.succeeded.set(true); this.reviewed.emit(result); } },
            error: error => { if (this.active()) { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить ревью. Введённый отзыв сохранён в форме.'); } }
        });
    }
}

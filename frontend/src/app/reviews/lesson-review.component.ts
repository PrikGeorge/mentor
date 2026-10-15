import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { HomeworkApi, Submission, ReviewStatus } from '../homework/homework-api.service';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { Grade, GradeComponent, GRADES } from '../homework/grade.component';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
@Component({ selector: 'mentor-lesson-review', imports: [IconComponent, GradeComponent, ErrorBannerComponent], template: `
@if(active()){
<details class="submission-review" [open]="!submission().feedback"><summary>{{submission().feedback?'Изменить ревью':'Оставить ревью'}}</summary>
<form (submit)="save($event)" class="homework-review-form" novalidate [attr.aria-busy]="busy()">
<label class="field">Ревью этой работы<textarea name="feedback" rows="4" maxlength="20000" [value]="feedback()" (input)="feedback.set($any($event.target).value)" [readOnly]="busy()" [attr.aria-invalid]="tooLong()?true:null" [attr.aria-describedby]="tooLong()?'review-feedback-error-'+submission().id:null"></textarea>@if(tooLong()){<small class="error" [id]="'review-feedback-error-'+submission().id">Не больше 20 000 символов.</small>}</label>
<fieldset class="grade-picker"><legend>Оценка <span class="label-note">· необязательно, знак всегда со словом</span></legend><div class="grade-options"><label class="check-row"><input type="radio" [name]="'grade-'+submission().id" [checked]="grade()===null" (change)="grade.set(null)" [disabled]="busy()">Без оценки</label>@for(option of grades;track option.value){<label class="check-row"><input type="radio" [name]="'grade-'+submission().id" [checked]="grade()===option.value" (change)="grade.set(option.value)" [disabled]="busy()"><mentor-grade [grade]="option.value"/></label>}</div></fieldset>
<label class="field">Результат ревью<select name="reviewStatus" [value]="status()" (change)="status.set($any($event.target).value)" [disabled]="busy()"><option value="reviewed">Проверено</option><option value="needs_revision">Нужна доработка</option></select></label>
@if(error()){<mentor-error-banner [message]="error()"/>}
@if(succeeded()){<p class="success-banner" role="status">Ревью сохранено.</p>}
<div class="form-actions"><button class="btn primary" type="submit" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>}@else{<mentor-icon name="send"/>}Сохранить ревью</button></div>
</form></details>}` })
export class LessonReviewComponent {
    readonly lesson = input.required<LessonRef>(); readonly submission = input.required<Submission>(); readonly preview = input(false);
    readonly reviewed = output<Submission>(); readonly feedback = signal(''); readonly status = signal<ReviewStatus>('reviewed'); readonly error = signal(''); readonly busy = signal(false); readonly succeeded = signal(false);
    readonly grade = signal<Grade | null>(null); readonly grades = GRADES;
    // The textarea caps input at 20 000, so this guards only text pasted in by other means.
    readonly tooLong = computed(() => this.feedback().length > 20000);
    private readonly session = inject(SessionStore); private readonly api = inject(HomeworkApi);
    private readonly scope = createBoundScope(() => { const lesson = this.lesson(), submission = this.submission(); return [lesson.workspaceId, lesson.studentId, lesson.id, submission.id, submission.revision, this.preview()]; });
    private request?: Subscription;
    readonly active = computed(() => this.scope.active() && this.session.actor()?.role === 'TEACHER' && this.session.actor()?.workspaceId === this.lesson().workspaceId && !this.preview());
    constructor() {
        effect(() => { const s = this.submission(); this.session.generation(); this.scope.bind(); this.request?.unsubscribe(); this.feedback.set(s.feedback); this.grade.set(s.grade ?? null); this.status.set(s.status === 'needs_revision' ? 'needs_revision' : 'reviewed'); this.error.set(''); this.busy.set(false); this.succeeded.set(false); });
        inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
    }
    save(event?: Event) {
        event?.preventDefault(); if (!this.active() || this.busy()) return;
        this.error.set(''); this.succeeded.set(false);
        if (this.tooLong()) return;
        const submission = this.submission(); this.busy.set(true);
        this.request = this.scope.track(this.api.review(this.lesson(), submission.id, submission.revision, this.status(), this.feedback().trim(), this.grade() !== null || submission.grade ? this.grade() : undefined)).subscribe({
            next: result => { if (this.active()) { this.busy.set(false); this.succeeded.set(true); this.reviewed.emit(result); } },
            error: error => { if (this.active()) { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить ревью. Введённый текст сохранён в форме.'); } }
        });
    }
}

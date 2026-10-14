import { SessionStore } from '../core/session.store';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LessonsApi, LessonView } from './lessons-api.service';
import { IconComponent } from '../core/icon.component';
const moscowDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
@Component({ selector: 'mentor-lesson-form', imports: [ReactiveFormsModule, IconComponent], template: `
  <section class="editor box" aria-labelledby="lesson-form-title"><h2 id="lesson-form-title">{{lesson()?'Изменить занятие':'Новое занятие'}}</h2>
    <form [formGroup]="form" (submit)="save($event)"><label class="auth-field">Тема занятия<input name="title" formControlName="title" required maxlength="200" autocomplete="off"></label>
      <div class="form-grid"><label class="auth-field">Дата<input name="date" type="date" formControlName="date" required></label><label class="auth-field">Время (по Москве)<input name="time" type="time" formControlName="time" required></label><label class="auth-field">Длительность, мин<input name="duration" type="number" formControlName="duration" min="15" max="240" step="1" required><small>От 15 до 240 минут.</small></label></div>
      <p class="auth-note"><mentor-icon name="info"/>Материалы можно добавить после создания.</p>
      @if(error()){<p role="alert" class="auth-error">{{error()}}</p>}<div class="form-actions"><button type="submit" class="btn primary" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>Сохраняем…}@else{{{lesson()?'Сохранить':'Создать занятие'}}}</button><button type="button" class="btn" (click)="cancel.emit()" [disabled]="busy()">Отмена</button></div></form></section>` })
export class LessonFormComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly lesson = input<LessonView | null>(null);
    readonly saved = output<LessonView>();
    readonly cancel = output<void>();
    private readonly api = inject(LessonsApi);
    private readonly session = inject(SessionStore);
    private readonly ownerGeneration = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly form = new FormGroup({ title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }), date: new FormControl(moscowDate(), { nonNullable: true, validators: Validators.required }), time: new FormControl('12:00', { nonNullable: true, validators: Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/) }), duration: new FormControl(60, { nonNullable: true, validators: [Validators.required, Validators.min(15), Validators.max(240)] }) });
    constructor() { effect(() => { const l = this.lesson(); this.form.reset({ title: l?.title ?? '', date: l?.date ?? moscowDate(), time: l?.time ?? '12:00', duration: l?.duration ?? 60 }); }); }
    save(event: Event) { event.preventDefault(); if (this.ownerGeneration !== this.session.generation() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; if (this.busy())
        return; this.error.set(''); const values = this.form.getRawValue(); const parsed = new Date(values.date + 'T00:00:00Z'); if (this.form.invalid || !values.title.trim() || !Number.isInteger(values.duration) || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== values.date) {
        this.error.set('Проверьте тему, дату, время и длительность от 15 до 240 минут.');
        return;
    } this.busy.set(true); const l = this.lesson(); const request = l ? this.api.save(this.workspaceId(), this.studentId(), l.id, { ...values, revision: l.revision }) : this.api.create(this.workspaceId(), this.studentId(), values); request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: view => { this.busy.set(false); this.saved.emit(view); }, error: error => { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить занятие. Поля сохранены в форме.'); } }); }
}

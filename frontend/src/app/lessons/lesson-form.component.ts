import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { Component, ElementRef, Injector, afterNextRender, effect, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { LessonCreateInput, LessonsApi, LessonView } from './lessons-api.service';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
const moscowDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// A real calendar day in ISO form: «2026-02-30» is rejected, not silently rolled over.
function calendarDate(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value ?? ''); if (!value) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? null : { date: true };
}
const integer = (control: AbstractControl): ValidationErrors | null => control.value === null || control.value === '' || Number.isInteger(Number(control.value)) ? null : { integer: true };
type Field = 'title' | 'date' | 'time' | 'duration' | 'dueDate' | 'dueTime';
// T09: an optional homework deadline (Moscow date and time) never earlier than the lesson start.
function dueAfterStart(group: AbstractControl): ValidationErrors | null {
    const { date, time, dueDate, dueTime } = group.value as Record<string, string>;
    if (!dueDate || !date || !time || !dueTime) return null;
    return `${dueDate}T${dueTime}` < `${date}T${time}` ? { dueBeforeStart: true } : null;
}
@Component({ selector: 'mentor-lesson-form', imports: [ReactiveFormsModule, IconComponent, ErrorBannerComponent], template: `
  <section class="editor box" aria-labelledby="lesson-form-title"><h2 id="lesson-form-title">{{lesson()?'Изменить занятие':'Новое занятие'}}</h2>
    <form [formGroup]="form" (submit)="save($event)" novalidate><label class="field">Тема занятия<input name="title" formControlName="title" required maxlength="200" autocomplete="off" [attr.aria-invalid]="fieldError('title')?true:null" [attr.aria-describedby]="fieldError('title')?'lesson-title-error':null">@if(fieldError('title');as text){<small class="error" id="lesson-title-error">{{text}}</small>}</label>
      <div class="form-grid"><label class="field">Дата<input name="date" type="date" formControlName="date" required [attr.aria-invalid]="fieldError('date')?true:null" [attr.aria-describedby]="fieldError('date')?'lesson-date-error':null">@if(fieldError('date');as text){<small class="error" id="lesson-date-error">{{text}}</small>}</label><label class="field">Время (по Москве)<input name="time" type="time" formControlName="time" required [attr.aria-invalid]="fieldError('time')?true:null" [attr.aria-describedby]="fieldError('time')?'lesson-time-error':null">@if(fieldError('time');as text){<small class="error" id="lesson-time-error">{{text}}</small>}</label><label class="field">Длительность, мин<input name="duration" type="number" formControlName="duration" min="15" max="240" step="1" required [attr.aria-invalid]="fieldError('duration')?true:null" [attr.aria-describedby]="fieldError('duration')?'lesson-duration-hint lesson-duration-error':'lesson-duration-hint'"><small id="lesson-duration-hint">От 15 до 240 минут.</small>@if(fieldError('duration');as text){<small class="error" id="lesson-duration-error">{{text}}</small>}</label></div>
      <fieldset class="due-fields"><legend class="due-legend">Срок домашней работы <span class="label-note">· необязательно</span></legend><div class="form-grid"><label class="field">Сдать до<input name="dueDate" type="date" formControlName="dueDate" [attr.aria-invalid]="fieldError('dueDate')?true:null" [attr.aria-describedby]="fieldError('dueDate')?'lesson-due-hint lesson-due-error':'lesson-due-hint'">@if(fieldError('dueDate');as text){<small class="error" id="lesson-due-error">{{text}}</small>}</label><label class="field">Время срока (по Москве)<input name="dueTime" type="time" formControlName="dueTime" [attr.aria-invalid]="fieldError('dueTime')?true:null" [attr.aria-describedby]="fieldError('dueTime')?'lesson-due-time-error':null">@if(fieldError('dueTime');as text){<small class="error" id="lesson-due-time-error">{{text}}</small>}</label><div class="field due-actions">@if(form.controls.dueDate.value){<button type="button" class="btn sm text" (click)="clearDue()" [disabled]="busy()"><mentor-icon name="x"/>Убрать срок</button>}</div></div><small class="due-hint" id="lesson-due-hint">Ученик увидит срок. Сдать работу можно и позже.</small></fieldset>
      <p class="auth-note"><mentor-icon name="info"/>Материалы можно добавить после создания.</p>
      @if(error()){<mentor-error-banner [message]="error()"/>}<div class="form-actions"><button type="submit" class="btn primary" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>Сохраняем…}@else{{{lesson()?'Сохранить':'Создать занятие'}}}</button><button type="button" class="btn" (click)="cancel.emit()" [disabled]="busy()">Отмена</button></div></form></section>` })
export class LessonFormComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly lesson = input<LessonView | null>(null);
    readonly saved = output<LessonView>();
    readonly cancel = output<void>();
    private readonly api = inject(LessonsApi);
    private readonly session = inject(SessionStore);
    private readonly scope = createBoundScope(() => [this.workspaceId(), this.studentId(), this.lesson()?.id ?? null, this.lesson()?.revision ?? null]);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    readonly busy = signal(false);
    readonly error = signal('');
    // Field errors appear after the first submit attempt and stay until the field becomes valid.
    readonly submitted = signal(false);
    readonly form = new FormGroup({ title: new FormControl('', { nonNullable: true, validators: [Validators.required, notBlank, Validators.maxLength(200)] }), date: new FormControl(moscowDate(), { nonNullable: true, validators: [Validators.required, calendarDate] }), time: new FormControl('12:00', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)] }), duration: new FormControl(60, { nonNullable: true, validators: [Validators.required, integer, Validators.min(15), Validators.max(240)] }), dueDate: new FormControl('', { nonNullable: true, validators: [calendarDate] }), dueTime: new FormControl('23:59', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)] }) }, { validators: dueAfterStart });
    constructor() { effect(() => { this.workspaceId(); this.studentId(); const l = this.lesson(); this.scope.bind(); this.busy.set(false); this.error.set(''); this.submitted.set(false); this.form.reset({ title: l?.title ?? '', date: l?.date ?? moscowDate(), time: l?.time ?? '12:00', duration: l?.duration ?? 60, dueDate: l?.homeworkDue?.date ?? '', dueTime: l?.homeworkDue?.time ?? '23:59' }); }); }
    clearDue() { this.form.patchValue({ dueDate: '', dueTime: '23:59' }); }
    fieldError(field: Field): string {
        if (!this.submitted()) return ''; const control = this.form.controls[field];
        if (field === 'dueDate' && control.valid && this.form.hasError('dueBeforeStart')) return 'Срок не может быть раньше начала занятия.';
        if (control.valid) return '';
        switch (field) {
            case 'title': return control.hasError('maxlength') ? 'Не больше 200 символов.' : 'Введите тему занятия.';
            case 'date': return 'Укажите дату занятия.';
            case 'dueDate': return 'Укажите настоящую дату срока.';
            case 'time': return 'Укажите время в формате ЧЧ:ММ.';
            case 'dueTime': return 'Укажите время срока в формате ЧЧ:ММ.';
            default: return 'Целое число от 15 до 240.';
        }
    }
    save(event: Event) { event.preventDefault(); if (!this.scope.active() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; if (this.busy())
        return; this.error.set(''); this.submitted.set(true); if (this.form.invalid) {
        this.form.markAllAsTouched(); const current = this.scope.capture(); afterNextRender(() => { if (current()) this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, { injector: this.injector });
        return;
    } const { dueDate, dueTime, ...values } = this.form.getRawValue(); const homeworkDue = dueDate ? { date: dueDate, time: dueTime } : null; this.busy.set(true); const l = this.lesson();
        // Creation sends a deadline only when there is one; an edit always states it, so clearing it removes it.
        const created: LessonCreateInput = homeworkDue ? { ...values, homeworkDue } : values;
        const request = l ? this.api.save(this.workspaceId(), this.studentId(), l.id, { ...values, homeworkDue, revision: l.revision }) : this.api.create(this.workspaceId(), this.studentId(), created); this.scope.track(request).subscribe({ next: view => { this.busy.set(false); this.submitted.set(false); this.saved.emit(view); }, error: error => { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить занятие. Поля сохранены в форме.'); } }); }
}
// A title of spaces only is no title.
function notBlank(control: AbstractControl): ValidationErrors | null { return typeof control.value === 'string' && control.value.length > 0 && !control.value.trim() ? { blank: true } : null; }

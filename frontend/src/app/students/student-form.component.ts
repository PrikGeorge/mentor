import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { Component, ElementRef, Injector, afterNextRender, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { StudentsApi, StudentView } from './students-api.service';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
type Field = 'name' | 'direction' | 'goal' | 'schedule' | 'notes' | 'studentRoadmap' | 'studentReview';
@Component({ selector: 'mentor-student-form', imports: [ReactiveFormsModule, IconComponent, ErrorBannerComponent], template: `
  <section class="editor box" aria-labelledby="student-form-title"><h2 id="student-form-title">{{student()?'Карточка ученика':'Новый ученик'}}</h2><p>У каждого ученика будут свои занятия и материалы.</p>
    <form [formGroup]="form" (submit)="save($event)" novalidate><fieldset><legend>Основные сведения</legend>
      <div class="form-grid two"><label class="field">Имя<input name="name" formControlName="name" maxlength="120" required autocomplete="off" [attr.aria-invalid]="fieldError('name')?true:null" [attr.aria-describedby]="fieldError('name')?'student-name-error':null">@if(fieldError('name');as text){<small class="error" id="student-name-error">{{text}}</small>}</label>
      <label class="field">Направление<input name="direction" formControlName="direction" maxlength="120" [attr.aria-invalid]="fieldError('direction')?true:null" [attr.aria-describedby]="fieldError('direction')?'student-direction-error':null">@if(fieldError('direction');as text){<small class="error" id="student-direction-error">{{text}}</small>}</label></div>
      <label class="field">Цель обучения<input name="goal" formControlName="goal" maxlength="1000" aria-describedby="student-goal-hint" [attr.aria-invalid]="fieldError('goal')?true:null"><small id="student-goal-hint">Видно ученику на главной.</small>@if(fieldError('goal');as text){<small class="error">{{text}}</small>}</label>
      <label class="field">Расписание<input name="schedule" formControlName="schedule" maxlength="500" placeholder="Например: Вт и Пт, 19:00 МСК" [attr.aria-invalid]="fieldError('schedule')?true:null">@if(fieldError('schedule');as text){<small class="error">{{text}}</small>}</label></fieldset>
      <fieldset class="private-strip"><legend class="legend-row">Для преподавателя <span class="vis private"><mentor-icon name="eye-off"/>Только вам</span></legend><label class="field">Заметки наставника<textarea name="notes" formControlName="notes" maxlength="5000" aria-describedby="student-notes-hint" [attr.aria-invalid]="fieldError('notes')?true:null"></textarea><small id="student-notes-hint">В кабинете ученика не показываются.</small>@if(fieldError('notes');as text){<small class="error">{{text}}</small>}</label></fieldset>
      <fieldset><legend class="legend-row">Материалы ученика <span class="vis public"><mentor-icon name="eye"/>Видно ученику</span></legend><label class="field">Маршрут обучения<textarea name="studentRoadmap" formControlName="studentRoadmap" maxlength="20000" [attr.aria-invalid]="fieldError('studentRoadmap')?true:null"></textarea>@if(fieldError('studentRoadmap');as text){<small class="error">{{text}}</small>}</label>
        @if(student()?.studentReview){<label class="field">Архивный отзыв без занятия<textarea name="studentReview" formControlName="studentReview" maxlength="20000" aria-describedby="student-review-hint" [attr.aria-invalid]="fieldError('studentReview')?true:null"></textarea><small id="student-review-hint">Новые ревью добавляйте в конкретное занятие.</small>@if(fieldError('studentReview');as text){<small class="error">{{text}}</small>}</label>}</fieldset>
      @if(error()){<mentor-error-banner [message]="error()"/>}<div class="form-actions"><button type="submit" class="btn primary" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>Сохраняем…}@else{{{student()?'Сохранить':'Добавить'}}}</button><button type="button" class="btn" (click)="cancel.emit()" [disabled]="busy()">Отмена</button></div>
    </form></section>` })
export class StudentFormComponent {
    readonly workspaceId = input.required<string>();
    readonly student = input<StudentView | null>(null);
    readonly saved = output<StudentView>();
    readonly cancel = output<void>();
    private readonly api = inject(StudentsApi);
    private readonly session = inject(SessionStore);
    private readonly scope = createBoundScope(() => [this.workspaceId(), this.student()?.id ?? null, this.student()?.revision ?? null]);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    readonly busy = signal(false);
    readonly error = signal('');
    // Field errors appear after the first submit attempt and stay until the field becomes valid.
    readonly submitted = signal(false);
    readonly form = new FormGroup({ name: new FormControl('', { nonNullable: true, validators: [Validators.required, notBlank, Validators.maxLength(120)] }), direction: new FormControl('Java Backend', { nonNullable: true, validators: Validators.maxLength(120) }), goal: new FormControl('', { nonNullable: true, validators: Validators.maxLength(1000) }), schedule: new FormControl('', { nonNullable: true, validators: Validators.maxLength(500) }), notes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(5000) }), studentRoadmap: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }), studentReview: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }) });
    constructor() { effect(() => { this.workspaceId(); const s = this.student(); this.scope.bind(); this.busy.set(false); this.error.set(''); this.submitted.set(false); this.form.reset({ name: s?.name ?? '', direction: s?.direction ?? 'Java Backend', goal: s?.goal ?? '', schedule: s?.schedule ?? '', notes: s && 'notes' in s ? s.notes : '', studentRoadmap: s?.studentRoadmap ?? '', studentReview: s?.studentReview ?? '' }); }); }
    fieldError(field: Field): string {
        if (!this.submitted()) return ''; const control = this.form.controls[field];
        if (control.hasError('required') || control.hasError('blank')) return 'Введите имя.';
        const long = control.getError('maxlength') as { requiredLength: number } | null;
        return long ? `Не больше ${long.requiredLength.toLocaleString('ru-RU')} символов.` : '';
    }
    save(event: Event) { event.preventDefault(); if (!this.scope.active() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; if (this.busy())
        return; this.error.set(''); this.submitted.set(true); if (this.form.invalid) {
        this.form.markAllAsTouched(); const current = this.scope.capture(); afterNextRender(() => { if (current()) this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, { injector: this.injector });
        return;
    } this.busy.set(true); const s = this.student(); this.scope.track(this.api.save(this.workspaceId(), s?.id ?? null, this.form.getRawValue(), s?.revision)).subscribe({ next: view => { this.busy.set(false); this.submitted.set(false); this.saved.emit(view); }, error: error => { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить карточку. Поля сохранены в форме.'); } }); }
}
// A name of spaces only is no name.
function notBlank(control: { value: unknown }) { return typeof control.value === 'string' && control.value.length > 0 && !control.value.trim() ? { blank: true } : null; }

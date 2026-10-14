import { SessionStore } from '../core/session.store';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StudentsApi, StudentView } from './students-api.service';
import { IconComponent } from '../core/icon.component';
@Component({ selector: 'mentor-student-form', imports: [ReactiveFormsModule, IconComponent], template: `
  <section class="editor box" aria-labelledby="student-form-title"><h2 id="student-form-title">{{student()?'Карточка ученика':'Новый ученик'}}</h2><p>У каждого ученика будут свои занятия и материалы.</p>
    <form [formGroup]="form" (submit)="save($event)"><fieldset><legend>Основные сведения</legend>
      <div class="form-grid two"><label class="auth-field">Имя<input name="name" formControlName="name" maxlength="120" required autocomplete="off"></label>
      <label class="auth-field">Направление<input name="direction" formControlName="direction" maxlength="120"></label></div>
      <label class="auth-field">Цель обучения<input name="goal" formControlName="goal" maxlength="1000"><small>Видно ученику на главной.</small></label>
      <label class="auth-field">Расписание<input name="schedule" formControlName="schedule" maxlength="500" placeholder="Например: Вт и Пт, 19:00 МСК"></label></fieldset>
      <fieldset class="private-strip"><legend class="legend-row">Для преподавателя <span class="vis private"><mentor-icon name="eye-off"/>Только вам</span></legend><label class="auth-field">Заметки наставника<textarea name="notes" formControlName="notes" maxlength="5000"></textarea><small>В кабинете ученика не показываются.</small></label></fieldset>
      <fieldset><legend class="legend-row">Материалы ученика <span class="vis public"><mentor-icon name="eye"/>Видно ученику</span></legend><label class="auth-field">Маршрут обучения<textarea name="studentRoadmap" formControlName="studentRoadmap" maxlength="20000"></textarea></label>
        @if(student()?.studentReview){<label class="auth-field">Архивный отзыв без занятия<textarea name="studentReview" formControlName="studentReview" maxlength="20000"></textarea><small>Новые отзывы добавляйте в конкретное занятие.</small></label>}</fieldset>
      @if(error()){<p role="alert" class="auth-error">{{error()}}</p>}<div class="form-actions"><button type="submit" class="btn primary" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>Сохраняем…}@else{{{student()?'Сохранить':'Добавить'}}}</button><button type="button" class="btn" (click)="cancel.emit()" [disabled]="busy()">Отмена</button></div>
    </form></section>` })
export class StudentFormComponent {
    readonly workspaceId = input.required<string>();
    readonly student = input<StudentView | null>(null);
    readonly saved = output<StudentView>();
    readonly cancel = output<void>();
    private readonly api = inject(StudentsApi);
    private readonly session = inject(SessionStore);
    private readonly ownerGeneration = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly form = new FormGroup({ name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }), direction: new FormControl('Java Backend', { nonNullable: true, validators: Validators.maxLength(120) }), goal: new FormControl('', { nonNullable: true, validators: Validators.maxLength(1000) }), schedule: new FormControl('', { nonNullable: true, validators: Validators.maxLength(500) }), notes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(5000) }), studentRoadmap: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }), studentReview: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }) });
    constructor() { effect(() => { const s = this.student(); this.form.reset({ name: s?.name ?? '', direction: s?.direction ?? 'Java Backend', goal: s?.goal ?? '', schedule: s?.schedule ?? '', notes: s && 'notes' in s ? s.notes : '', studentRoadmap: s?.studentRoadmap ?? '', studentReview: s?.studentReview ?? '' }); }); }
    save(event: Event) { event.preventDefault(); if (this.ownerGeneration !== this.session.generation() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; if (this.busy())
        return; this.error.set(''); if (this.form.invalid || !this.form.controls.name.value.trim()) {
        this.error.set('Проверьте имя и длину полей.');
        return;
    } this.busy.set(true); const s = this.student(); this.api.save(this.workspaceId(), s?.id ?? null, this.form.getRawValue(), s?.revision).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: view => { this.busy.set(false); this.saved.emit(view); }, error: error => { this.busy.set(false); this.error.set(error.error?.message ?? 'Не удалось сохранить карточку. Поля сохранены в форме.'); } }); }
}

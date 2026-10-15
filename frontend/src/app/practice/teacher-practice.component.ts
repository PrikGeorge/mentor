import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, takeUntil } from 'rxjs';
import type { components } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { SessionStore } from '../core/session.store';
import { PracticeApi, LessonPracticeView, PublicExercise } from './practice-api.service';
import { IconComponent } from '../core/icon.component';
export const lessonKey = (lesson: LessonRef) => JSON.stringify([lesson.workspaceId, lesson.studentId, lesson.id]);
@Component({ selector: 'mentor-teacher-practice', imports: [IconComponent], template: `<section class="teacher-practice" aria-labelledby="assignments-title"><div class="sh"><h2 id="assignments-title">Назначения тренажёра</h2></div><p class="subtitle">Выберите упражнения и место: занятие или домашняя работа. Порядок сохраняется.</p>@if(error()){<div class="warning-banner"><p role="alert">{{error()}}</p><button class="btn sm" (click)="refreshCounter()"><mentor-icon name="refresh"/>Обновить ревизию, сохранив мой выбор</button></div>}<div class="assignment-list">@for(exercise of catalog();track exercise.id){<div><label><input type="checkbox" [checked]="assigned(exercise.id)" (change)="toggle(exercise.id,$event)" [disabled]="busy()"/> {{exercise.title}}</label>@if(assigned(exercise.id)){<label class="placement">Размещение <select [value]="placement(exercise.id)" (change)="place(exercise.id,$event)" [disabled]="busy()"><option value="class">На занятии</option><option value="homework">Домашняя работа</option></select></label>}</div>}@empty{<p class="small-muted mt-16">Каталог упражнений пуст.</p>}</div><div class="form-actions">@if(total()>100){<nav class="pagination" aria-label="Страницы каталога"><button class="btn" [disabled]="page()===0||busy()" (click)="page.set(page()-1)"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{page()+1}}</span><button class="btn" [disabled]="(page()+1)*100>=total()||busy()" (click)="page.set(page()+1)">Далее<mentor-icon name="chevron-right"/></button></nav>}<button class="btn primary" (click)="save()" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>}@else{<mentor-icon name="save"/>}Сохранить назначения</button></div></section>` })
export class TeacherPracticeComponent {
    readonly lesson = input.required<LessonRef>();
    readonly view = input.required<LessonPracticeView>();
    readonly saved = output<LessonPracticeView>();
    readonly catalog = signal<PublicExercise[]>([]);
    readonly page = signal(0);
    readonly total = signal(0);
    readonly busy = signal(false);
    readonly error = signal('');
    private readonly api = inject(PracticeApi);
    private readonly session = inject(SessionStore);
    private readonly owner = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    private readonly cancel = new Subject<void>();
    private bound = '';
    private counter = 0;
    private selection: components['schemas']['AssignmentsPut']['assignments'] = [];
    private alive = true;
    constructor() { this.destroyRef.onDestroy(() => { this.alive = false; this.cancel.next(); }); effect(onCleanup => { const lesson = this.lesson(), view = this.view(), key = lessonKey(lesson), page = this.page(); this.session.generation(); if (key !== this.bound) {
        this.cancel.next();
        this.selection = view.exercises.map(row => ({ exerciseId: row.exercise.id, placement: row.placement }));
        this.counter = view.revision;
        this.bound = key;
        this.error.set('');
        this.busy.set(false);
    } if (!this.active())
        return; const sub = this.api.catalog(lesson.workspaceId, false, page).subscribe({ next: result => { if (this.active()) {
            this.catalog.set(result.items);
            this.total.set(result.total);
        } }, error: () => this.error.set('Не удалось загрузить каталог.') }); onCleanup(() => sub.unsubscribe()); }); }
    private active() { return this.alive && this.owner === this.session.generation() && this.session.actor()?.role === 'TEACHER' && this.bound === lessonKey(this.lesson()); }
    assigned(id: string) { return this.selection.some(row => row.exerciseId === id); }
    placement(id: string) { return this.selection.find(row => row.exerciseId === id)?.placement; }
    toggle(id: string, event: Event) { if (!this.active() || this.busy())
        return; const checked = (event.target as HTMLInputElement).checked; if (checked && !this.assigned(id))
        this.selection = [...this.selection, { exerciseId: id, placement: 'class' }]; if (!checked)
        this.selection = this.selection.filter(row => row.exerciseId !== id); }
    place(id: string, event: Event) { if (!this.active() || this.busy())
        return; const placement = (event.target as HTMLSelectElement).value; if (placement === 'class' || placement === 'homework')
        this.selection = this.selection.map(row => row.exerciseId === id ? { ...row, placement } : row); }
    save() { if (!this.active() || this.busy())
        return; const key = this.bound; this.busy.set(true); this.api.assignments(this.lesson(), { revision: this.counter, assignments: this.selection.map(row => ({ ...row })) }).pipe(takeUntil(this.cancel), takeUntilDestroyed(this.destroyRef)).subscribe({ next: view => { if (!this.active() || key !== this.bound)
            return; this.counter = view.revision; this.busy.set(false); this.error.set(''); this.saved.emit(view); }, error: () => { if (!this.active() || key !== this.bound)
            return; this.busy.set(false); this.error.set('Назначения не сохранены. Ваш выбор остаётся на экране; проверьте новую ревизию перед повтором.'); } }); }
    refreshCounter() { if (!this.active() || this.busy())
        return; const key = this.bound; this.api.practice(this.lesson()).pipe(takeUntil(this.cancel), takeUntilDestroyed(this.destroyRef)).subscribe({ next: view => { if (this.active() && key === this.bound) {
            this.counter = view.revision;
            this.error.set('Ревизия обновлена. Проверьте свой выбор и сохраните ещё раз.');
        } }, error: () => { if (this.active())
            this.error.set('Не удалось обновить ревизию.'); } }); }
}

import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DomainPage } from '../students/domain-page';
import { StudentsApi } from '../students/students-api.service';
import { LessonsApi, LessonView } from '../lessons/lessons-api.service';
import { PracticeWorkbench } from './practice-workbench.component';
export { PracticeWorkbench } from './practice-workbench.component';
@Component({ selector: 'mentor-practice-page', imports: [RouterLink, PracticeWorkbench], template: `<a class="text-link" [routerLink]="base()+'/lessons'" [queryParams]="previewQuery()">← Все занятия</a>@if(error()){<p class="auth-error" role="alert">{{error()}}</p>}@if(lesson();as l){<mentor-practice-workbench [lesson]="l" [preview]="preview()" [notes]="l.studentNotes" [initialExercise]="params().get('detail')"/>}@else if(!error()){<p role="status">Загружаем занятие…</p>}` })
export class PracticePageComponent extends DomainPage {
    readonly lesson = signal<LessonView | null>(null);
    readonly error = signal('');
    private readonly students = inject(StudentsApi);
    private readonly lessons = inject(LessonsApi);
    constructor() { super(); effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), id = this.lessonId(), preview = this.preview(); this.lesson.set(null); this.error.set(''); this.context.clear(this); if (!w || !s || !id)
        return; const sub = forkJoin({ student: this.students.load(w, s, preview), lesson: this.lessons.load(w, s, id, preview) }).subscribe({ next: result => { this.lesson.set(result.lesson); this.context.set(this, { student: result.student, lesson: result.lesson, base: this.base(), preview, learner: this.learner(), page: 'practice' }); }, error: error => this.error.set(this.message(error)) }); onCleanup(() => sub.unsubscribe()); }); }
}

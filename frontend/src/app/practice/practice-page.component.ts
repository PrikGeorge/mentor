import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DomainPage } from '../students/domain-page';
import { StudentsApi } from '../students/students-api.service';
import { LessonsApi, LessonView } from '../lessons/lessons-api.service';
import { PracticeWorkbench } from './practice-workbench.component';
import { readResource } from '../core/read-resource';
export { PracticeWorkbench } from './practice-workbench.component';
@Component({ selector: 'mentor-practice-page', imports: [RouterLink, PracticeWorkbench], template: `@if(error()){<p class="auth-error" role="alert">{{error()}}</p><a class="text-link" [routerLink]="base()+'/lessons'" [queryParams]="previewQuery()">← Все занятия</a>}@if(lesson();as l){<mentor-practice-workbench [lesson]="l" [preview]="preview()" [notes]="l.studentNotes" [initialExercise]="params().get('detail')"/>}@else if(!error()){<p class="loading-line" role="status">Загружаем занятие…</p>}` })
export class PracticePageComponent extends DomainPage {
    readonly lesson = signal<LessonView | null>(null);
    readonly error = signal('');
    private readonly students = inject(StudentsApi);
    private readonly lessons = inject(LessonsApi);
    private readonly pageResource = readResource({
        scope: this.scope,
        params: () => {
            const workspace = this.workspaceId(), student = this.studentId(), lesson = this.lessonId();
            return workspace && student && lesson
                ? { workspace, student, lesson, preview: this.preview(), base: this.base(), learner: this.learner() }
                : undefined;
        },
        load: ({ workspace, student, lesson, preview }) => forkJoin({
            student: this.students.load(workspace, student, preview),
            lesson: this.lessons.load(workspace, student, lesson, preview),
        }),
    });
    constructor() {
        super();
        effect(() => {
            const state = this.pageResource.state();
            untracked(() => {
                this.lesson.set(state.status === 'resolved' ? state.value.lesson : null);
                this.error.set(state.status === 'error' ? this.message(state.error) : '');
                if (state.status === 'resolved') {
                    const { base, preview, learner } = state.params;
                    this.context.set(this, { student: state.value.student, lesson: state.value.lesson, base, preview, learner, page: 'practice' });
                } else this.context.clear(this);
            });
        });
    }
}

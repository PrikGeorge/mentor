import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { components } from '../api/schema';
import type { HistoryEntry } from './practice-api.service';
export type AssignedExercise = components['schemas']['AssignedExercise'];
// Side list of the lesson's exercises plus history-only rows for exercises no longer assigned.
@Component({
    selector: 'mentor-exercise-list',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <h3>Упражнения</h3>
        <nav class="practice-exercises" aria-label="Упражнения занятия">
            @for (row of rows(); track row.exercise.id) {
                <button type="button" [attr.aria-current]="selectedId() === row.exercise.id ? 'page' : null" (click)="chosen.emit(row.exercise.id)">{{ row.exercise.title }} <small>{{ row.placement === 'homework' ? 'Домашняя работа' : 'На занятии' }}</small></button>
            }
            @for (row of removed(); track row.exerciseId) {
                <button type="button" [attr.aria-current]="selectedId() === row.exerciseId ? 'page' : null" (click)="chosen.emit(row.exerciseId)">История · {{ row.exerciseId }} <small>Снято с назначения</small></button>
            }
        </nav>
    `,
})
export class ExerciseListComponent {
    readonly rows = input.required<AssignedExercise[]>();
    readonly removed = input<HistoryEntry[]>([]);
    readonly selectedId = input('');
    readonly chosen = output<string>();
}

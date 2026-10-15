import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { components } from '../api/schema';
import type { HistoryEntry } from './practice-api.service';
export type AssignedExercise = components['schemas']['AssignedExercise'];
// The trainer's project tree: the lesson's exercises, the files of the open one nested under it (as in an IDE),
// then history-only rows for exercises no longer assigned.
@Component({
    selector: 'mentor-exercise-list',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <nav class="practice-exercises" aria-label="Упражнения занятия">
            @for (row of rows(); track row.exercise.id) {
                <button
                    type="button"
                    class="tree-exercise"
                    [attr.aria-current]="selectedId() === row.exercise.id ? 'page' : null"
                    [attr.aria-expanded]="selectedId() === row.exercise.id"
                    (click)="chosen.emit(row.exercise.id)"
                >
                    {{ row.exercise.title }} <small>{{ row.placement === 'homework' ? 'Домашняя работа' : 'На занятии' }}</small>
                </button>
                @if (selectedId() === row.exercise.id && files().length) {
                    <ul class="tree-files" aria-label="Файлы решения">
                        @for (name of files(); track name) {
                            <li>
                                <button type="button" [attr.aria-pressed]="file() === name" (click)="fileChosen.emit(name)">
                                    {{ name }}
                                    @if (dirty() && file() === name) {
                                        <span class="tree-dirty" title="Есть несохранённые изменения"><span class="visually-hidden">не сохранён</span></span>
                                    }
                                </button>
                            </li>
                        }
                    </ul>
                }
            }
            @for (row of removed(); track row.exerciseId) {
                <button
                    type="button"
                    class="tree-exercise"
                    [attr.aria-current]="selectedId() === row.exerciseId ? 'page' : null"
                    (click)="chosen.emit(row.exerciseId)"
                >
                    История · {{ row.exerciseId }} <small>Снято с назначения</small>
                </button>
            }
        </nav>
    `,
})
export class ExerciseListComponent {
    readonly rows = input.required<AssignedExercise[]>();
    readonly removed = input<HistoryEntry[]>([]);
    readonly selectedId = input('');
    // Files of the open exercise; the current one and its unsaved state are marked in the tree.
    readonly files = input<string[]>([]);
    readonly file = input('');
    readonly dirty = input(false);
    readonly chosen = output<string>();
    readonly fileChosen = output<string>();
}

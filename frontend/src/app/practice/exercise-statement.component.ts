import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { MaterialView } from '../materials/materials-api.service';
import type { PublicExercise } from './practice-api.service';
// Read-only statement of the chosen exercise: rendered markdown, starter files, lesson notes and public code references.
// Markdown arrives already rendered so the parent parses it once per exercise, not on every check cycle.
@Component({
    selector: 'mentor-exercise-statement',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <article class="practice-reading">
            <p class="eyebrow">Условие, только чтение · Java {{ exercise().environment.javaVersion }}</p>
            <h3>{{ exercise().title }}</h3>
            <div class="markdown-body" [innerHTML]="statementHtml()"></div>
            <p class="small-muted">{{ exercise().environment.title }}@for (dependency of exercise().environment.dependencies; track dependency) { · {{ dependency }}}</p>
            <details class="practice-reference">
                <summary>Исходные заготовки · только чтение</summary>
                @for (name of starterNames(); track name) {
                    <h4>{{ name }}</h4>
                    <pre><code>{{ exercise().starterFiles[name] }}</code></pre>
                }
                <p class="small-muted">Для сравнения с твоим кодом. Заготовки не заменяют черновик автоматически.</p>
            </details>
            @if (notesHtml()) {
                <details>
                    <summary>Материалы занятия</summary>
                    <div class="markdown-body" [innerHTML]="notesHtml()"></div>
                </details>
            }
            @for (reference of references(); track reference.id) {
                @if (reference.kind === 'code' && !reference.code.teacher) {
                    <details class="practice-reference">
                        <summary>{{ reference.title || reference.filename }} · исходная заготовка</summary>
                        <pre><code>{{ reference.code.text }}</code></pre>
                        <p class="small-muted">Только для чтения. Этот исходник не заменяет твой черновик.</p>
                    </details>
                }
            }
        </article>
    `,
})
export class ExerciseStatementComponent {
    readonly exercise = input.required<PublicExercise>();
    readonly statementHtml = input('');
    readonly notesHtml = input('');
    readonly references = input<MaterialView[]>([]);
    readonly starterNames = computed(() => Object.keys(this.exercise().starterFiles));
}

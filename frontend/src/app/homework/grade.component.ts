import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { components } from '../api/schema';

export type Grade = components['schemas']['Grade'];
// A sign never stands alone: the word carries the meaning, the colour only repeats it.
export const GRADES: { value: Grade; sign: string; word: string; bad: boolean }[] = [
    { value: 'excellent', sign: '!!', word: 'отлично', bad: false },
    { value: 'good', sign: '!', word: 'хорошо', bad: false },
    { value: 'interesting', sign: '!?', word: 'интересно', bad: false },
    { value: 'dubious', sign: '?!', word: 'сомнительно', bad: true },
    { value: 'mistake', sign: '?', word: 'ошибка', bad: true },
];
export const gradeOf = (value: Grade | null | undefined) => GRADES.find(grade => grade.value === value) ?? null;

@Component({
    selector: 'mentor-grade', changeDetection: ChangeDetectionStrategy.OnPush,
    template: `@if (info(); as grade) {<span class="ev" [class.bad]="grade.bad"><b aria-hidden="true">{{ grade.sign }}</b>{{ grade.word }}</span>}`,
})
export class GradeComponent {
    readonly grade = input<Grade | null | undefined>(null);
    readonly info = computed(() => gradeOf(this.grade()));
}

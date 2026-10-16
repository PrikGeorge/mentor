import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { lessonStatus } from '../lessons/lesson-status';
import { CalendarEntry, upcomingOf } from './calendar';
import { UPCOMING_STYLES } from './calendar-styles';
import { endTime, lessonEnd, lessonStart, shortDayLabel } from './schedule-dates';

// T23: «Ближайшие занятия» — lessons that have not ended, over the next two weeks, at most ten rows.
@Component({
    selector: 'mentor-upcoming-lessons',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    styles: [UPCOMING_STYLES],
    template: `
        <section class="upcoming" aria-labelledby="upcoming-title">
            <h2 id="upcoming-title">Ближайшие занятия</h2>
            @if (failed()) {
                <p class="small-muted" role="alert">
                    Не удалось загрузить ближайшие занятия.
                    <button class="btn sm text" type="button" (click)="retry.emit()">Повторить загрузку</button>
                </p>
            } @else if (!loaded()) {
                <p class="loading" role="status">Загружаем…</p>
            } @else if (upcoming().shown.length) {
                <ol class="upcoming-list">
                    @for (entry of upcoming().shown; track entry.lesson.id) {
                        <li [class.now]="isNow(entry)">
                            <time [attr.datetime]="entry.lesson.date + 'T' + entry.lesson.time + '+03:00'"
                                >{{ shortDayLabel(entry.lesson.date) }} · {{ entry.lesson.time }}–{{ endTime(entry.lesson) }}</time
                            >
                            <div class="who">
                                @if (entry.studentName) {
                                    <b>{{ entry.studentName }}</b>
                                }
                                <a class="text-link" [routerLink]="entry.link" [queryParams]="entry.query"
                                    >№&nbsp;{{ entry.lesson.number }} · {{ entry.lesson.title }}</a
                                >
                            </div>
                            @if (isNow(entry)) {
                                <span class="tag on">Идёт сейчас</span>
                            } @else {
                                <span class="tag" [class.on]="status(entry).on" [class.quiet]="status(entry).quiet">{{ status(entry).label }}</span>
                            }
                            <a
                                class="btn sm"
                                [routerLink]="entry.link"
                                [queryParams]="entry.query"
                                [attr.aria-label]="'Открыть занятие ' + entry.lesson.number + (entry.studentName ? ' · ' + entry.studentName : '')"
                                >Открыть</a
                            >
                        </li>
                    }
                </ol>
                @if (upcoming().more) {
                    <p class="small-muted">Ещё {{ upcoming().more }} за две недели.</p>
                }
            } @else {
                <p class="small-muted">
                    {{ viewer() === 'student' ? 'Ближайших занятий пока нет. Наставник назначит дату.' : 'На ближайшие две недели занятий нет.' }}
                </p>
            }
        </section>
    `,
})
export class UpcomingLessonsComponent {
    readonly entries = input.required<CalendarEntry[]>();
    readonly now = input.required<number>();
    readonly loaded = input(true);
    readonly failed = input(false);
    readonly retry = output<void>();
    readonly viewer = input<'teacher' | 'student'>('teacher');
    readonly upcoming = computed(() => upcomingOf(this.entries(), this.now()));
    readonly shortDayLabel = shortDayLabel;
    readonly endTime = endTime;
    status(entry: CalendarEntry) {
        return lessonStatus(entry.lesson, this.viewer(), this.now());
    }
    isNow(entry: CalendarEntry) {
        const now = this.now();
        return lessonStart(entry.lesson) <= now && now < lessonEnd(entry.lesson);
    }
}

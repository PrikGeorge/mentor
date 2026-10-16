import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { lessonStatus } from '../lessons/lesson-status';
import { CalendarEntry, lessonsCount } from './calendar';
import { MONTH_CALENDAR_STYLES } from './calendar-styles';
import { dayLabel, dayOfMonthLabel, endTime, lessonEnd, lessonStart, monthLabel, monthOf, monthWeeks } from './schedule-dates';

const IN_CELL = 3;
const WEEKDAYS = [
    ['Пн', 'Понедельник'],
    ['Вт', 'Вторник'],
    ['Ср', 'Среда'],
    ['Чт', 'Четверг'],
    ['Пт', 'Пятница'],
    ['Сб', 'Суббота'],
    ['Вс', 'Воскресенье'],
];

// T23: a Monday-first month grid by Moscow dates. Wide screens list up to three lessons in each day; on a phone
// the cells shrink to a number and a dot, and the chosen day's lessons are listed under the grid.
@Component({
    selector: 'mentor-month-calendar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    styles: [MONTH_CALENDAR_STYLES],
    template: `
        <table class="month-grid">
            <caption class="visually-hidden">
                {{
                    label()
                }}
            </caption>
            <thead>
                <tr>
                    @for (day of weekdays; track day[0]) {
                        <th scope="col">
                            <abbr [title]="day[1]">{{ day[0] }}</abbr>
                        </th>
                    }
                </tr>
            </thead>
            <tbody>
                @for (week of weeks(); track week[0]) {
                    <tr>
                        @for (date of week; track date) {
                            @let list = byDate().get(date) ?? [];
                            <td [class.out]="!inMonth(date)" [class.past]="date < today()" [class.today]="date === today()" [class.chosen]="chosen() === date">
                                @if (inMonth(date)) {
                                    <div class="day-head">
                                        <span class="day-num">{{ dayNumber(date) }}</span>
                                        <button
                                            class="day-pick"
                                            type="button"
                                            [attr.aria-pressed]="chosen() === date"
                                            [attr.aria-label]="dayAria(date, list.length)"
                                            (click)="chosen.set(date)"
                                        >
                                            {{ dayNumber(date) }}
                                            @if (list.length) {
                                                <i class="dot" aria-hidden="true"></i>
                                            }
                                        </button>
                                        @if (date === today()) {
                                            <span class="tag on">сегодня</span>
                                        }
                                    </div>
                                    @if (list.length) {
                                        <ul class="day-lessons">
                                            @for (entry of list.slice(0, inCell); track entry.lesson.id) {
                                                <li [class.done]="ended(entry)">
                                                    <a [routerLink]="entry.link" [queryParams]="entry.query" [attr.aria-label]="entryAria(entry)"
                                                        >{{ entry.lesson.time }} · {{ entryName(entry) }}</a
                                                    >
                                                    @if (isNow(entry)) {
                                                        <span class="tag on">Идёт сейчас</span>
                                                    } @else if (ended(entry)) {
                                                        <span class="tag quiet">{{ status(entry) }}</span>
                                                    }
                                                </li>
                                            }
                                            @if (list.length > inCell) {
                                                <li class="more">ещё {{ list.length - inCell }}</li>
                                            }
                                        </ul>
                                    }
                                } @else {
                                    <span class="day-num" aria-hidden="true">{{ dayNumber(date) }}</span>
                                }
                            </td>
                        }
                    </tr>
                }
            </tbody>
        </table>
        @if (chosen(); as date) {
            @let list = byDate().get(date) ?? [];
            <section class="day-agenda" [attr.aria-label]="'Занятия: ' + dayLabel(date)">
                <h3 aria-live="polite">{{ dayLabel(date) }}</h3>
                @if (list.length) {
                    <ol class="upcoming-list">
                        @for (entry of list; track entry.lesson.id) {
                            <li [class.now]="isNow(entry)">
                                <time [attr.datetime]="entry.lesson.date + 'T' + entry.lesson.time + '+03:00'"
                                    >{{ entry.lesson.time }}–{{ endTime(entry.lesson) }}</time
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
                                    <span class="tag" [class.quiet]="ended(entry)">{{ status(entry) }}</span>
                                }
                            </li>
                        }
                    </ol>
                } @else {
                    <p class="small-muted">Свободно</p>
                }
            </section>
        }
    `,
})
export class MonthCalendarComponent {
    readonly month = input.required<string>();
    readonly today = input.required<string>();
    readonly now = input.required<number>();
    readonly entries = input.required<CalendarEntry[]>();
    readonly viewer = input<'teacher' | 'student'>('teacher');
    readonly weekdays = WEEKDAYS;
    readonly inCell = IN_CELL;
    readonly weeks = computed(() => monthWeeks(this.month()));
    readonly label = computed(() => monthLabel(this.month()));
    readonly byDate = computed(() => {
        const map = new Map<string, CalendarEntry[]>();
        for (const entry of this.entries()) map.set(entry.lesson.date, [...(map.get(entry.lesson.date) ?? []), entry]);
        return map;
    });
    // The phone list starts on today when it is in this month, else on the first day with lessons, else on the 1st.
    // It follows the entries too, so a new student filter in another month starts again from its first lesson.
    readonly chosen = linkedSignal(() => {
        const month = this.month(),
            today = this.today();
        if (monthOf(today) === month) return today;
        const first = this.entries().find((entry) => monthOf(entry.lesson.date) === month);
        return first ? first.lesson.date : month + '-01';
    });
    readonly dayLabel = dayLabel;
    readonly endTime = endTime;
    inMonth(date: string) {
        return monthOf(date) === this.month();
    }
    dayNumber(date: string) {
        return Number(date.slice(8, 10));
    }
    dayAria(date: string, count: number) {
        return dayOfMonthLabel(date) + (date === this.today() ? ', сегодня' : '') + ', ' + (count ? lessonsCount(count) : 'занятий нет');
    }
    entryName(entry: CalendarEntry) {
        return entry.studentName ? entry.studentName.trim().split(/\s+/)[0] : '№ ' + entry.lesson.number;
    }
    status(entry: CalendarEntry) {
        return lessonStatus(entry.lesson, this.viewer(), this.now()).label;
    }
    entryAria(entry: CalendarEntry) {
        const state = this.isNow(entry) ? 'идёт сейчас' : this.status(entry);
        return [entry.lesson.time, entry.studentName, 'занятие № ' + entry.lesson.number, entry.lesson.title, state].filter(Boolean).join(', ');
    }
    isNow(entry: CalendarEntry) {
        const now = this.now();
        return lessonStart(entry.lesson) <= now && now < lessonEnd(entry.lesson);
    }
    ended(entry: CalendarEntry) {
        return lessonEnd(entry.lesson) <= this.now();
    }
}

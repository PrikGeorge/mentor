import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { createBoundScope } from '../core/bound-scope';
import { Clock } from '../core/clock';
import { LessonsApi } from '../lessons/lessons-api.service';
import { REMINDER_LIMIT, reminderWindow, unmarkedLessons } from './reminder';
import { SessionStore } from '../core/session.store';
import { readResource } from '../core/read-resource';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { lessonStatus } from '../lessons/lesson-status';
import { Schedule, ScheduleApi, ScheduleItem } from './schedule-api.service';
import {
    addDays,
    addMonths,
    dayLabel,
    endTime,
    isCalendarDate,
    isMonth,
    lessonEnd,
    lessonStart,
    mondayOf,
    monthLabel,
    monthOf,
    monthRange,
    weekDays,
    weekLabel,
} from './schedule-dates';
import { CalendarEntry, upcomingWindow } from './calendar';
import { CALENDAR_PAGE_STYLES } from './calendar-styles';
import { MonthCalendarComponent } from './month-calendar.component';
import { UpcomingLessonsComponent } from './upcoming-lessons.component';
import { focusAfterRender } from '../core/focus';
import { initialOf, moscowDate } from '../core/format';
// T04: the teacher's lessons of all active cards for today or one week, by Moscow time; T23 adds the month.
@Component({
    selector: 'mentor-schedule-page',
    imports: [RouterLink, NgTemplateOutlet, IconComponent, ErrorBannerComponent, MonthCalendarComponent, UpcomingLessonsComponent],
    styles: [CALENDAR_PAGE_STYLES],
    template: `
        <div class="page-head">
            <div>
                <h1>Расписание</h1>
                <p class="subtitle">Время по Москве. Ученики в архиве не показываются.</p>
            </div>
        </div>
        <div class="schedule-toolbar">
            <div class="seg" role="group" aria-label="Период">
                <button type="button" [attr.aria-pressed]="view() === 'today'" (click)="show('today')">Сегодня</button
                ><button type="button" [attr.aria-pressed]="view() === 'week'" (click)="show('week')">Неделя</button
                ><button type="button" [attr.aria-pressed]="view() === 'month'" (click)="show('month')">Месяц</button>
            </div>
            @if (view() === 'week') {
                <nav class="schedule-week-nav" aria-label="Недели">
                    <button class="btn sm text" type="button" (click)="shiftWeek(-7)"><mentor-icon name="arrow-left" />Прошлая неделя</button>
                    @if (monday() !== mondayOf(today())) {
                        <button class="btn sm text" type="button" (click)="show('week')">Эта неделя</button>
                    }
                    <button class="btn sm text" type="button" (click)="shiftWeek(7)">Следующая<mentor-icon name="arrow-right" /></button>
                    <span class="count" aria-live="polite">{{ weekLabel(monday()) }}</span>
                </nav>
            }
            @if (view() === 'month') {
                <nav class="schedule-week-nav" aria-label="Месяцы">
                    <button class="btn sm text" type="button" (click)="shiftMonth(-1)"><mentor-icon name="arrow-left" />Прошлый месяц</button>
                    @if (month() !== monthOf(today())) {
                        <button class="btn sm text" type="button" (click)="thisMonth()">Этот месяц</button>
                    }
                    <button class="btn sm text" type="button" (click)="shiftMonth(1)">Следующий<mentor-icon name="arrow-right" /></button>
                    <span class="count month-label" tabindex="-1" aria-live="polite">{{ monthLabel(month()) }}</span>
                </nav>
                @if (monthStudents().length) {
                    <label class="field calendar-filter"
                        >Ученик
                        <select aria-label="Ученик" (change)="filterStudent($any($event.target).value)">
                            <option value="" [selected]="!studentFilter()">Все ученики</option>
                            @for (student of monthStudents(); track student.id) {
                                <option [value]="student.id" [selected]="student.id === studentFilter()">{{ student.name }}</option>
                            }
                        </select>
                    </label>
                }
            }
        </div>
        @if (view() === 'today' && unmarked().length) {
            <section class="warning-banner conducted-reminder" aria-labelledby="conducted-reminder-title">
                <h2 id="conducted-reminder-title">Отметьте проведённые занятия</h2>
                <p>Занятия последних двух недель, которые закончились без отметки «Проведено».</p>
                <ul class="reminder-list">
                    @for (item of unmarked().slice(0, limit); track item.lesson.id) {
                        <li>
                            <span
                                ><b>{{ item.studentName }}</b> · №&nbsp;{{ item.lesson.number }} · {{ shortDate(item.lesson.date) }},
                                {{ item.lesson.time }}</span
                            >
                            <button
                                class="btn sm primary"
                                type="button"
                                (click)="markConducted(item)"
                                [disabled]="marking() !== null"
                                [attr.aria-label]="'Отметить проведённым: ' + item.studentName + ', занятие ' + item.lesson.number"
                            >
                                @if (marking() === item.lesson.id) {
                                    <mentor-icon class="spin" name="loader" />
                                } @else {
                                    <mentor-icon name="check-check" />
                                }
                                Проведено
                            </button>
                            <a class="text-link" [routerLink]="lessonLink(item)">Открыть</a>
                        </li>
                    }
                </ul>
                @if (unmarked().length > limit) {
                    <p>
                        Ещё {{ unmarked().length - limit }} за две недели.
                        <button class="btn sm text" type="button" (click)="openWeek(-7)">Открыть прошлую неделю →</button>
                    </p>
                }
            </section>
        }
        @if (notice()) {
            <p class="success-banner" role="status">{{ notice() }}</p>
        }
        @if (markError()) {
            <mentor-error-banner [message]="markError()" />
        }
        @if (error()) {
            <mentor-error-banner [message]="error()" retryLabel="Повторить загрузку" (retry)="reload()" />
        }
        @if (view() === 'month') {
            <div class="calendar-layout">
                <div class="calendar-main">
                    @if (schedule()) {
                        <mentor-month-calendar [month]="month()" [today]="today()" [now]="now()" [entries]="monthEntries()" viewer="teacher" />
                        @if (!schedule()!.items.length) {
                            <p class="small-muted calendar-empty">В этом месяце занятий нет.</p>
                        } @else if (studentFilter() && !monthEntries().length) {
                            <p class="small-muted calendar-empty">
                                У этого ученика в этом месяце занятий нет.
                                <button class="btn sm text" type="button" (click)="filterStudent('')">Все ученики</button>
                            </p>
                        }
                    } @else if (!error()) {
                        <p class="loading" role="status">Загружаем расписание…</p>
                    }
                </div>
                <mentor-upcoming-lessons
                    [entries]="upcomingEntries()"
                    [now]="now()"
                    [loaded]="upcomingLoaded()"
                    [failed]="upcomingFailed()"
                    (retry)="reload()"
                    viewer="teacher"
                />
            </div>
        } @else if (schedule(); as s) {
            @if (view() === 'today') {
                <section class="schedule-day" aria-labelledby="schedule-today">
                    <div class="sh">
                        <div class="title-group">
                            <h2 id="schedule-today">{{ dayLabel(today()) }}</h2>
                            <span class="count">{{ countLabel(s.items.length) }}</span>
                        </div>
                    </div>
                    @if (s.items.length) {
                        <ng-container *ngTemplateOutlet="rows; context: { $implicit: s.items }" />
                    } @else {
                        <div class="empty-state">
                            <h3>Сегодня занятий нет.</h3>
                            <p><button class="btn sm text" type="button" (click)="show('week')">Посмотреть неделю →</button></p>
                        </div>
                    }
                </section>
            } @else {
                @if (!s.items.length) {
                    <div class="empty-state"><h3>На этой неделе занятий нет.</h3></div>
                }
                @for (day of days(); track day.date) {
                    <section class="schedule-day" [attr.aria-labelledby]="'schedule-' + day.date">
                        <div class="sh">
                            <div class="title-group">
                                <h2 [id]="'schedule-' + day.date">
                                    {{ dayLabel(day.date) }}
                                    @if (day.date === today()) {
                                        <span class="tag on">сегодня</span>
                                    }
                                </h2>
                                @if (day.items.length) {
                                    <span class="count">{{ countLabel(day.items.length) }}</span>
                                }
                            </div>
                        </div>
                        @if (day.items.length) {
                            <ng-container *ngTemplateOutlet="rows; context: { $implicit: day.items }" />
                        } @else {
                            <p class="small-muted schedule-free">Свободно</p>
                        }
                    </section>
                }
            }
        } @else if (!error()) {
            <p class="loading" role="status">Загружаем расписание…</p>
        }
        <ng-template #rows let-items>
            <ol class="schedule-list">
                @for (item of asItems(items); track item.lesson.id) {
                    <li [class.now]="isNow(item)">
                        <time [attr.datetime]="item.lesson.date + 'T' + item.lesson.time + '+03:00'">{{ item.lesson.time }}–{{ endTime(item.lesson) }}</time>
                        <span class="avatar" aria-hidden="true">{{ initial(item.studentName) }}</span>
                        <div class="who">
                            <b>{{ item.studentName }}</b>
                            <a class="text-link" [routerLink]="lessonLink(item)">№&nbsp;{{ item.lesson.number }} · {{ item.lesson.title }}</a>
                        </div>
                        <div class="tags">
                            @if (isNow(item)) {
                                <span class="tag on"><mentor-icon name="clock" />Идёт сейчас</span>
                            }
                            @if (status(item.lesson); as tag) {
                                <span class="tag" [class.on]="tag.on && !isNow(item)" [class.quiet]="tag.quiet"
                                    ><mentor-icon [name]="tag.icon" />{{ tag.label }}</span
                                >
                            }
                        </div>
                        <a class="btn sm" [routerLink]="lessonLink(item)" [attr.aria-label]="'Открыть занятие ' + item.lesson.number + ' · ' + item.studentName"
                            >Открыть</a
                        >
                    </li>
                }
            </ol>
        </ng-template>
    `,
})
export class SchedulePageComponent {
    private readonly session = inject(SessionStore);
    private readonly api = inject(ScheduleApi);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
    // The shared 30-second clock (FE-17) moves «today» and «Идёт сейчас».
    readonly now = inject(Clock).watch();
    readonly today = computed(() => moscowDate(this.now()));
    readonly view = computed<'today' | 'week' | 'month'>(() => {
        const view = this.query().get('view');
        return view === 'week' || view === 'month' ? view : 'today';
    });
    // T23: the month shown (?month=YYYY-MM, otherwise the current one) and the optional single student (?student=).
    readonly month = computed(() => {
        const month = this.query().get('month');
        return isMonth(month) ? month : monthOf(this.today());
    });
    readonly studentFilter = computed(() => this.query().get('student') || null);
    // The week shown: the Monday of ?from when it is a real date, otherwise the current week.
    readonly monday = computed(() => {
        const from = this.query().get('from');
        return mondayOf(isCalendarDate(from) ? from : this.today());
    });
    private readonly refresh = signal(0);
    private readonly scheduleResource = readResource({
        params: () => {
            const actor = this.session.actor();
            if (actor?.role !== 'TEACHER' || !actor.workspaceId) return undefined;
            const view = this.view();
            if (view === 'month') return { workspace: actor.workspaceId, ...monthRange(this.month()), refresh: this.refresh() };
            const from = view === 'week' ? this.monday() : this.today();
            return { workspace: actor.workspaceId, from, to: view === 'week' ? addDays(from, 6) : from, refresh: this.refresh() };
        },
        load: ({ workspace, from, to }) => this.api.get(workspace, from, to),
    });
    readonly schedule = signal<Schedule | null>(null);
    readonly error = signal('');
    readonly days = computed(() => {
        const items = this.schedule()?.items ?? [];
        return weekDays(this.monday()).map((date) => ({ date, items: items.filter((item) => item.lesson.date === date) }));
    });
    private readonly upcomingResource = readResource({
        params: () => {
            const actor = this.session.actor();
            if (actor?.role !== 'TEACHER' || !actor.workspaceId || this.view() !== 'month') return undefined;
            return { workspace: actor.workspaceId, ...upcomingWindow(this.today()), refresh: this.refresh() };
        },
        load: ({ workspace, from, to }) => this.api.get(workspace, from, to),
    });
    readonly upcomingFailed = computed(() => this.upcomingResource.state().status === 'error');
    readonly upcomingLoaded = computed(() => this.upcomingResource.state().status === 'resolved');
    private entry(item: ScheduleItem): CalendarEntry {
        return { lesson: item.lesson, studentName: item.studentName, link: this.lessonLink(item), query: {} };
    }
    readonly monthEntries = computed(() => {
        const student = this.studentFilter();
        return (this.schedule()?.items ?? []).filter((item) => !student || item.lesson.studentId === student).map((item) => this.entry(item));
    });
    readonly upcomingEntries = computed(() => {
        const state = this.upcomingResource.state();
        return state.status === 'resolved' && state.value ? state.value.items.map((item) => this.entry(item)) : [];
    });
    // The filter offers the students who have lessons in the month shown; the list needs no extra request.
    readonly monthStudents = computed(() => {
        const seen = new Map<string, string>();
        for (const item of this.schedule()?.items ?? []) seen.set(item.lesson.studentId, item.studentName);
        const students = [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        const chosen = this.studentFilter();
        return chosen && !seen.has(chosen) && students.length ? [...students, { id: chosen, name: 'Выбранный ученик' }] : students;
    });
    readonly monthLabel = monthLabel;
    readonly monthOf = monthOf;
    private readonly focusLater = focusAfterRender();
    readonly status = lessonStatus;
    readonly dayLabel = dayLabel;
    readonly weekLabel = weekLabel;
    readonly mondayOf = mondayOf;
    readonly endTime = endTime;
    constructor() {
        // A new account never inherits the previous one's pending mark or its messages.
        effect(() => {
            this.session.generation();
            untracked(() => {
                this.marking.set(null);
                this.notice.set('');
                this.markError.set('');
            });
        });
        effect(() => {
            const state = this.scheduleResource.state();
            untracked(() => {
                this.schedule.set(state.status === 'resolved' ? state.value : null);
                // Server messages are English (UX-26); the schedule always explains itself in Russian.
                this.error.set(state.status === 'error' ? 'Не удалось загрузить расписание.' : '');
            });
        });
    }
    // T16: ended lessons of the last 14 days still waiting for the «Проведено» mark, shown above «Сегодня».
    readonly limit = REMINDER_LIMIT;
    private readonly lessons = inject(LessonsApi);
    private readonly writes = createBoundScope();
    private readonly reminderResource = readResource({
        params: () => {
            const actor = this.session.actor();
            if (actor?.role !== 'TEACHER' || !actor.workspaceId || this.view() !== 'today') return undefined;
            return { workspace: actor.workspaceId, ...reminderWindow(this.today()), refresh: this.refresh() };
        },
        load: ({ workspace, from, to }) => this.api.get(workspace, from, to).pipe(catchError(() => of(null))),
    });
    readonly unmarked = computed(() => {
        const state = this.reminderResource.state();
        return state.status === 'resolved' && state.value ? unmarkedLessons(state.value.items, this.now()) : [];
    });
    readonly marking = signal<string | null>(null);
    readonly notice = signal('');
    readonly markError = signal('');
    // The same revision-guarded PATCH as the lesson page; a stale revision asks for a fresh schedule instead of guessing.
    markConducted(item: ScheduleItem) {
        const actor = this.session.actor();
        if (actor?.role !== 'TEACHER' || actor.workspaceId !== item.lesson.workspaceId || this.marking() !== null) return;
        this.marking.set(item.lesson.id);
        this.notice.set('');
        this.markError.set('');
        this.writes
            .track(this.lessons.save(item.lesson.workspaceId, item.lesson.studentId, item.lesson.id, { revision: item.lesson.revision, conducted: true }))
            .subscribe({
                next: () => {
                    this.marking.set(null);
                    this.notice.set(`Занятие № ${item.lesson.number} · ${item.studentName} отмечено проведённым.`);
                    this.reload();
                },
                error: (error: { status?: number }) => {
                    this.marking.set(null);
                    this.markError.set(error?.status === 409 ? 'Занятие изменилось. Обновите расписание.' : 'Не удалось отметить занятие. Попробуйте ещё раз.');
                },
            });
    }
    openWeek(days: number) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'week', from: addDays(this.today(), days) } });
    }
    // «14.10».
    shortDate(date: string) {
        return date.slice(8, 10) + '.' + date.slice(5, 7);
    }
    show(view: 'today' | 'week' | 'month') {
        this.notice.set('');
        this.markError.set('');
        void this.router.navigate([], { relativeTo: this.route, queryParams: view === 'today' ? {} : { view } });
    }
    shiftMonth(count: number) {
        const student = this.studentFilter();
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { view: 'month', month: addMonths(this.month(), count), ...(student ? { student } : {}) },
        });
    }
    // «Этот месяц» disappears once pressed, so the focus moves to the month's name.
    thisMonth() {
        const student = this.studentFilter();
        void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'month', ...(student ? { student } : {}) } });
        this.focusLater('.month-label');
    }
    filterStudent(student: string) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'month', month: this.month(), ...(student ? { student } : {}) } });
    }
    shiftWeek(days: number) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'week', from: addDays(this.monday(), days) } });
    }
    reload() {
        this.refresh.update((value) => value + 1);
    }
    isNow(item: ScheduleItem) {
        const now = this.now();
        return lessonStart(item.lesson) <= now && now < lessonEnd(item.lesson);
    }
    lessonLink(item: ScheduleItem) {
        return ['/teacher/students', item.lesson.studentId, 'lessons', item.lesson.id];
    }
    asItems(items: unknown) {
        return items as ScheduleItem[];
    }
    readonly initial = initialOf;
    countLabel(n: number) {
        const last = n % 10,
            tens = n % 100;
        return n + (last === 1 && tens !== 11 ? ' занятие' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? ' занятия' : ' занятий');
    }
}

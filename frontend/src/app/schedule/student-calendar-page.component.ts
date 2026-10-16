import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Clock } from '../core/clock';
import { readResource } from '../core/read-resource';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { focusAfterRender } from '../core/focus';
import { moscowDate } from '../core/format';
import { DomainPage } from '../students/domain-page';
import { StudentsApi } from '../students/students-api.service';
import { CalendarEntry, upcomingWindow } from './calendar';
import { CALENDAR_PAGE_STYLES } from './calendar-styles';
import { MonthCalendarComponent } from './month-calendar.component';
import { ScheduleApi, StudentSchedule } from './schedule-api.service';
import { addMonths, isMonth, monthLabel, monthOf, monthRange } from './schedule-dates';
import { UpcomingLessonsComponent } from './upcoming-lessons.component';

// T23: the student's own calendar — the month by Moscow dates and the next two weeks. The teacher sees the same
// page in the read-only preview of the student's cabinet.
@Component({
    selector: 'mentor-student-calendar-page',
    imports: [IconComponent, ErrorBannerComponent, MonthCalendarComponent, UpcomingLessonsComponent],
    styles: [CALENDAR_PAGE_STYLES],
    template: `
        <div class="page-head">
            <div>
                <h1>Календарь</h1>
                <p class="subtitle">Время по Москве.</p>
            </div>
        </div>
        <div class="schedule-toolbar">
            <nav class="schedule-week-nav" aria-label="Месяцы">
                <button class="btn sm text" type="button" (click)="shiftMonth(-1)"><mentor-icon name="arrow-left" />Прошлый месяц</button>
                @if (month() !== monthOf(today())) {
                    <button class="btn sm text" type="button" (click)="thisMonth()">Этот месяц</button>
                }
                <button class="btn sm text" type="button" (click)="shiftMonth(1)">Следующий<mentor-icon name="arrow-right" /></button>
                <span class="count month-label" tabindex="-1" aria-live="polite">{{ monthLabel(month()) }}</span>
            </nav>
        </div>
        @if (error()) {
            <mentor-error-banner [message]="error()" retryLabel="Повторить загрузку" (retry)="reload()" />
        }
        <div class="calendar-layout">
            <div class="calendar-main">
                @if (calendar(); as c) {
                    <mentor-month-calendar [month]="month()" [today]="today()" [now]="now()" [entries]="monthEntries()" viewer="student" />
                    @if (!c.items.length) {
                        <p class="small-muted calendar-empty">В этом месяце занятий нет.</p>
                    }
                } @else if (!error()) {
                    <p class="loading" role="status">Загружаем календарь…</p>
                }
            </div>
            <mentor-upcoming-lessons
                [entries]="upcomingEntries()"
                [now]="now()"
                [loaded]="upcomingLoaded()"
                [failed]="upcomingFailed()"
                (retry)="reload()"
                viewer="student"
            />
        </div>
    `,
})
export class StudentCalendarPageComponent extends DomainPage {
    private readonly api = inject(ScheduleApi);
    private readonly students = inject(StudentsApi);
    private readonly router = inject(Router);
    readonly now = inject(Clock).watch();
    readonly today = computed(() => moscowDate(this.now()));
    readonly month = computed(() => {
        const month = this.query().get('month');
        return isMonth(month) ? month : monthOf(this.today());
    });
    private readonly refresh = signal(0);
    private readonly card = computed(() => {
        const workspace = this.workspaceId(),
            student = this.studentId();
        return workspace && student ? { workspace, student } : undefined;
    });
    private readonly monthResource = readResource({
        scope: this.scope,
        params: () => {
            const card = this.card();
            return card ? { ...card, ...monthRange(this.month()), refresh: this.refresh() } : undefined;
        },
        load: ({ workspace, student, from, to }) => this.api.student(workspace, student, from, to),
    });
    private readonly upcomingResource = readResource({
        scope: this.scope,
        params: () => {
            const card = this.card();
            return card ? { ...card, ...upcomingWindow(this.today()), refresh: this.refresh() } : undefined;
        },
        load: ({ workspace, student, from, to }) => this.api.student(workspace, student, from, to),
    });
    readonly upcomingFailed = computed(() => this.upcomingResource.state().status === 'error');
    // The card itself names the student in the header and keeps the learner navigation, as on the other pages.
    private readonly cardResource = readResource({
        scope: this.scope,
        params: () => {
            const card = this.card();
            return card ? { ...card, preview: this.preview(), learner: this.learner(), base: this.base() } : undefined;
        },
        load: ({ workspace, student, preview }) => this.students.load(workspace, student, preview),
    });
    readonly calendar = signal<StudentSchedule | null>(null);
    readonly error = signal('');
    readonly upcomingLoaded = computed(() => this.upcomingResource.state().status === 'resolved');
    readonly monthEntries = computed(() => (this.calendar()?.items ?? []).map((lesson) => this.entry(lesson)));
    readonly upcomingEntries = computed(() => {
        const state = this.upcomingResource.state();
        return state.status === 'resolved' && state.value ? state.value.items.map((lesson) => this.entry(lesson)) : [];
    });
    readonly monthLabel = monthLabel;
    readonly monthOf = monthOf;
    private readonly focusLater = focusAfterRender();
    constructor() {
        super();
        effect(() => {
            const state = this.monthResource.state();
            untracked(() => {
                this.calendar.set(state.status === 'resolved' ? state.value : null);
                this.error.set(state.status === 'error' ? this.message(state.error) : '');
            });
        });
        effect(() => {
            const state = this.cardResource.state();
            untracked(() => {
                if (state.status === 'resolved')
                    this.context.set(this, {
                        student: state.value,
                        base: state.params.base,
                        preview: state.params.preview,
                        learner: state.params.learner,
                        page: 'calendar',
                    });
                else this.context.clear(this);
            });
        });
    }
    private entry(lesson: StudentSchedule['items'][number]): CalendarEntry {
        return { lesson, link: [this.base(), 'lessons', lesson.id], query: this.preview() ? { preview: 'student' } : {} };
    }
    private go(month: string | null) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { ...this.previewQuery(), ...(month ? { month } : {}) } });
    }
    shiftMonth(count: number) {
        this.go(addMonths(this.month(), count));
    }
    // «Этот месяц» disappears once pressed, so the focus moves to the month's name.
    thisMonth() {
        this.go(null);
        this.focusLater('.month-label');
    }
    reload() {
        this.refresh.update((value) => value + 1);
    }
}

import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, throwError } from 'rxjs';
import { Dashboard, StudentsApi } from '../students/students-api.service';
import { DomainPage } from '../students/domain-page';
import type { LessonView } from '../lessons/lessons-api.service';
import { IconComponent } from '../core/icon.component';
import { HomeworkApi } from '../homework/homework-api.service';
import { Turn, TurnClockComponent, turnHeadline, turnOf } from '../homework/turn-clock.component';
import { MovesComponent } from '../journal/moves.component';
import { RoadmapApi, stageProgress } from '../roadmap/roadmap-api.service';
const moscowToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
@Component({
    selector: 'mentor-dashboard',
    imports: [RouterLink, DatePipe, NgTemplateOutlet, IconComponent, TurnClockComponent, MovesComponent],
    template: ` @if (error()) {
            <div class="shell-error">
                <p class="auth-error" role="alert">{{ error() }}</p>
                <button class="btn" (click)="reload()"><mentor-icon name="refresh" />Повторить загрузку</button>
            </div>
        }
        @if (view(); as d) {
            @if (d.focus; as focus) {
                <div class="home learner-lesson">
                    <section aria-labelledby="focus-title">
                        <p class="eyebrow">
                            <span>{{ focus.upcoming ? 'Ближайшее занятие' : 'Последнее занятие' }}</span
                            ><span> · №&nbsp;{{ focus.lesson.number }}</span>
                            @if (relative(focus.lesson); as when) {
                                <span> · {{ when }}</span>
                            }
                        </p>
                        <h1 id="focus-title">{{ focus.lesson.title }}</h1>
                        <dl class="sheet">
                            <div>
                                <dt>Дата</dt>
                                <dd>{{ focus.lesson.date | date: 'dd.MM.yyyy' }}</dd>
                            </div>
                            <div>
                                <dt>Начало</dt>
                                <dd>{{ focus.lesson.time }} МСК</dd>
                            </div>
                            <div>
                                <dt>Длительность</dt>
                                <dd>{{ focus.lesson.duration }} мин</dd>
                            </div>
                            <div>
                                <dt>Материалы</dt>
                                <dd>
                                    @if (focus.lesson.bundleId) {
                                        <mentor-icon name="check" />Подготовлено
                                    } @else if (focus.lesson.studentNotes.trim()) {
                                        Задания добавлены
                                    } @else {
                                        Готовятся
                                    }
                                </dd>
                            </div>
                            <div>
                                <dt>Направление</dt>
                                <dd>{{ d.student.direction || '—' }}</dd>
                            </div>
                            <div>
                                <dt>Всего занятий</dt>
                                <dd>{{ d.lessonCount }}</dd>
                            </div>
                            @if (stage(); as st) {
                                <div class="wide">
                                    <dt>Этап маршрута</dt>
                                    <dd>
                                        <a class="text-link" [routerLink]="studentBase() + '/roadmap'" [queryParams]="previewQuery()"
                                            >{{ st.position }} из {{ st.total }}</a
                                        ><small class="stage-title">{{ st.title }}</small>
                                    </dd>
                                </div>
                            }
                        </dl>
                        @if (d.student.archivedAt) {
                            <p class="callout mt-20" role="status">
                                Курс завершён: карточка в архиве с {{ d.student.archivedAt | date: 'dd.MM.yyyy' }}. Материалы и история открыты, новые работы не
                                принимаются.
                            </p>
                        } @else if (!focus.upcoming) {
                            <p class="callout mt-20">
                                {{
                                    focus.lesson.conductedAt
                                        ? 'Занятие проведено. Новое появится, когда наставник назначит дату.'
                                        : 'Дата занятия прошла. Факт проведения здесь не отмечен.'
                                }}
                            </p>
                        }
                        <p class="home-more mt-20">
                            <a class="text-link" [routerLink]="studentBase() + '/lessons'" [queryParams]="previewQuery()">Все занятия →</a>
                        </p>
                        @defer (on idle) {
                            <mentor-moves
                                class="mt-40"
                                [workspaceId]="workspaceId()!"
                                [studentId]="d.student.id"
                                [base]="studentBase()"
                                [learner]="true"
                                [preview]="preview()"
                                [size]="6"
                                heading="Последние ходы"
                            />
                        }
                    </section>
                    <aside class="home-side" aria-label="Что сделать сейчас">
                        <div>
                            @if (turn(); as t) {
                                <mentor-turn-clock
                                    class="home-clock"
                                    [turn]="t"
                                    [name]="d.student.name"
                                    [start]="focus.upcoming ? lessonStart(focus.lesson) : null"
                                />
                            }
                            @if (turn(); as t) {
                                <p class="turn mt-20">
                                    {{ headline(t).title }}<small>{{ headline(t).text }}</small>
                                </p>
                            } @else {
                                <p class="turn">
                                    Что сделать сейчас<small>{{
                                        focus.lesson.bundleId
                                            ? 'Материалы готовы: открой задания и реши упражнения в тренажёре.'
                                            : focus.lesson.studentNotes.trim()
                                              ? 'Задания добавлены, материалы ещё готовятся.'
                                              : 'Текст заданий и материалы пока не добавлены.'
                                    }}</small>
                                </p>
                            }
                            <div class="home-actions mt-20">
                                <a class="btn primary" [routerLink]="lessonLink('tasks')" [queryParams]="previewQuery()"
                                    ><mentor-icon name="file-text" />Открыть задания</a
                                ><a class="btn" [routerLink]="lessonLink('homework')" [queryParams]="previewQuery()"
                                    ><mentor-icon name="upload" />Домашняя работа</a
                                ><a class="btn" [routerLink]="reviewLink()" [queryParams]="previewQuery()"
                                    ><mentor-icon name="message" />Ревью
                                    @if (turn()?.state === 'needs_revision') {
                                        <span class="cnt">1</span>
                                    }
                                </a>
                            </div>
                        </div>
                        <ng-container *ngTemplateOutlet="goal" />
                    </aside>
                </div>
            } @else {
                <div class="page-head">
                    <div>
                        <p class="eyebrow">Кабинет ученика</p>
                        <h1>{{ d.student.name }}</h1>
                        <p class="subtitle">{{ d.student.direction || 'Индивидуальное обучение' }}</p>
                    </div>
                </div>
                <div class="home">
                    <section class="empty-state">
                        <h2>Занятий пока нет</h2>
                        <p>Здесь появятся даты занятий, задания и материалы.</p>
                    </section>
                    <aside class="home-side"><ng-container *ngTemplateOutlet="goal" /></aside>
                </div>
            }
            <ng-template #goal
                ><section class="goal-box" aria-labelledby="goal-title">
                    <div>
                        <h2 id="goal-title">Моя цель</h2>
                        <p class="goal">{{ d.student.goal || 'Цель обучения ещё предстоит определить' }}</p>
                    </div>
                    <dl class="facts">
                        <div>
                            <dt>Расписание</dt>
                            <dd [class.empty]="!d.student.schedule">{{ d.student.schedule || 'Расписание пока не задано' }}</dd>
                        </div>
                    </dl>
                    <div class="links">
                        <a [routerLink]="studentBase() + '/goal'" [queryParams]="previewQuery()">Моя цель</a
                        ><a [routerLink]="studentBase() + '/roadmap'" [queryParams]="previewQuery()">Маршрут обучения</a>
                    </div>
                </section></ng-template
            >
        } @else if (!error()) {
            <p class="loading" role="status">Загружаем кабинет…</p>
        }`,
})
export class DashboardComponent extends DomainPage {
    private readonly api = inject(StudentsApi);
    private readonly refresh = signal(0);
    readonly view = signal<Dashboard | null>(null);
    readonly error = signal('');
    readonly turn = signal<Turn | null>(null);
    private readonly homework = inject(HomeworkApi);
    private readonly roadmap = inject(RoadmapApi);
    readonly stage = signal<ReturnType<typeof stageProgress>>(null);
    constructor() {
        super();
        effect((onCleanup) => {
            this.session.generation();
            const w = this.workspaceId(),
                s = this.studentId(),
                preview = this.preview();
            this.refresh();
            this.view.set(null);
            this.error.set('');
            this.context.clear(this);
            if (!w) return;
            const resolve = s
                ? this.api.dashboard(w, s, preview)
                : this.api
                      .list(w, 0)
                      .pipe(
                          switchMap((page) =>
                              page.items.length === 1 ? this.api.dashboard(w, page.items[0].id) : throwError(() => new Error('Карточка ученика недоступна.'))
                          )
                      );
            this.turn.set(null);
            const sub = resolve
                .pipe(
                    switchMap((view) => {
                        this.view.set(view);
                        this.context.set(this, { student: view.student, base: this.studentBase(), preview, learner: true, page: '' });
                        return view.lessonCount ? this.homework.lessonTurns(w, view.student.id, preview, 1).pipe(catchError(() => of(null))) : of(null);
                    })
                )
                .subscribe({ next: (turns) => this.turn.set(turns ? turnOf(turns.items[0]) : null), error: (e) => this.error.set(this.message(e)) });
            onCleanup(() => sub.unsubscribe());
        });
    }
    // The roadmap cell is optional: a failed request simply leaves it out.
    private readonly stages = effect((onCleanup) => {
        this.session.generation();
        const w = this.workspaceId(),
            s = this.view()?.student.id,
            preview = this.preview();
        this.stage.set(null);
        if (!w || !s) return;
        const sub = this.roadmap
            .get(w, s, preview)
            .pipe(catchError(() => of(null)))
            .subscribe((view) => this.stage.set(view ? stageProgress(view.stages) : null));
        onCleanup(() => sub.unsubscribe());
    });
    reload() {
        this.refresh.update((v) => v + 1);
    }
    studentBase() {
        return (this.session.actor()?.role === 'TEACHER' ? '/teacher/students/' : '/learn/students/') + encodeURIComponent(this.view()!.student.id);
    }
    lessonLink(section: string) {
        return this.studentBase() + '/lessons/' + this.view()!.focus!.lesson.id + '/student/' + section;
    }
    headline(turn: Turn) {
        return turnHeadline(turn, 'student');
    }
    lessonStart(lesson: LessonView) {
        return `${lesson.date}T${lesson.time}:00+03:00`;
    }
    // A pending answer from the mentor may belong to an earlier lesson than the focused one.
    reviewLink() {
        const turn = this.turn();
        return turn?.lessonId && (turn.state === 'needs_revision' || turn.state === 'reviewed')
            ? this.studentBase() + '/lessons/' + turn.lessonId + '/student/review'
            : this.lessonLink('review');
    }
    relative(lesson: LessonView) {
        const days = Math.round((Date.parse(lesson.date + 'T00:00:00Z') - Date.parse(moscowToday() + 'T00:00:00Z')) / 86400000);
        if (!Number.isFinite(days)) return '';
        return days === 0 ? 'сегодня' : days === 1 ? 'завтра' : days === -1 ? 'вчера' : days > 1 && days < 7 ? 'через ' + days + ' дн.' : '';
    }
}

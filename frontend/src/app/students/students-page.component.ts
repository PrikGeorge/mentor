import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { SessionStore } from '../core/session.store';
import { Dashboard, StudentsApi, StudentView } from './students-api.service';
import { StudentFormComponent } from './student-form.component';
import { IconComponent } from '../core/icon.component';
import { PaginationComponent } from '../core/pagination.component';
import { HomeworkApi, StudentTurn } from '../homework/homework-api.service';
import { Turn, TurnClockComponent, turnOf, turnSection } from '../homework/turn-clock.component';
import { readResource } from '../core/read-resource';
import { ScheduleApi } from '../schedule/schedule-api.service';
import { reminderWindow, unmarkedLabel, unmarkedLessons } from '../schedule/reminder';
import { moscowDate } from '../schedule/schedule-dates';
import { errorMessage } from '../core/api-error';
@Component({ selector: 'mentor-students-page', imports: [RouterLink, DatePipe, StudentFormComponent, IconComponent, TurnClockComponent, PaginationComponent], template: `
  <div class="page-head"><div><h1>{{archive()?'Архив учеников':'Мои ученики'}}</h1><p class="subtitle">{{archive()?'Завершившие обучение: карточки, занятия и история сохранены, новые работы не принимаются.':'Выберите ученика, чтобы открыть его занятия, материалы и план обучения.'}}@if(total()){ {{archive()?'В архиве':'Учеников'}}: {{total()}}.}</p></div><div class="form-actions">@if(!archive()){<button class="btn primary" (click)="creating.set(true)"><mentor-icon name="plus"/>Добавить ученика</button>}<button class="btn text" type="button" (click)="archive.set(!archive());page.set(0)"><mentor-icon [name]="archive()?'arrow-left':'archive'"/>{{archive()?'К активным ученикам':'Архив'}}</button></div></div>
  @if(creating()&&session.actor()?.workspaceId){<div class="section-block"><mentor-student-form [workspaceId]="session.actor()!.workspaceId!" (saved)="created($event)" (cancel)="creating.set(false)"/></div>}
  @if(error()){<div class="shell-error"><p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()"><mentor-icon name="refresh"/>Повторить загрузку</button></div>}
  @if(loading()){<p class="loading" role="status">Загружаем учеников…</p>}
  @if(!archive()&&unmarked()){<p class="callout reminder-line"><mentor-icon name="calendar"/><span>{{unmarkedLabel(unmarked())}}.</span><a class="text-link" routerLink="/teacher/schedule">Отметить →</a></p>}
  @if(waiting().length){<section aria-labelledby="queue-title"><div class="sh"><div class="title-group"><h2 id="queue-title">Ход за вами</h2><span class="count">{{waitingLabel()}}, первой — та, что отправлена раньше</span></div></div>
    <ol class="queue">@for(row of waiting();track row.studentId){<li><span class="avatar" aria-hidden="true">{{initial(row.studentName)}}</span><div><h3>{{row.studentName}}</h3><p>{{direction(row.studentId)}}@if(row.awaitingReview>1){ · ещё работ на ревью: {{row.awaitingReview-1}}}</p></div>
      <div class="work"><b>{{row.lessonTitle}}</b><p>Занятие {{row.lessonDate|date:'dd.MM.yyyy'}} · {{row.filename}}</p>@if(row.comment){<q>{{row.comment}}</q>}</div>
      <mentor-turn-clock [turn]="clocks()[row.studentId]" viewer="teacher" [name]="row.studentName" [mini]="true"/>
      <a class="btn primary" [routerLink]="['/teacher/students',row.studentId,'lessons',row.lessonId,'teacher',turnSection(clocks()[row.studentId])]"><mentor-icon name="message"/>{{row.kind==='attempt'?'Открыть решение':'Открыть ревью'}}</a></li>}</ol></section>}
  <div class="sh"><div class="title-group"><h2>{{waiting().length?'Ход у учеников':'Ученики'}}</h2><span class="count">карточки учеников</span></div></div>
  <div class="students-grid">@for(s of students();track s.id){<a class="student-card" [routerLink]="['/teacher/students',s.id]"><div class="student-card-head"><span class="avatar" aria-hidden="true">{{initial(s.name)}}</span><div><h2>{{s.name}}</h2><p>{{s.direction||'Направление не указано'}}</p></div></div>
      <dl><div><dt>Цель</dt><dd>{{s.goal||'Цель обучения можно добавить в карточку'}}</dd></div>
        @if(summaries()[s.id];as summary){<div><dt>Занятий</dt><dd>{{summary.lessonCount}}</dd></div><div><dt>{{summary.focus?.upcoming===false?'Последнее по дате':'Ближайшее занятие'}}</dt><dd>@if(summary.focus;as focus){{{focus.lesson.date|date:'dd.MM.yyyy'}} · {{focus.lesson.time}} МСК}@else{не назначено}</dd></div>}
        @else{<div><dt>Занятия</dt><dd><span class="skeleton"><i></i></span></dd></div>}</dl>
      @if(clocks()[s.id];as turn){<mentor-turn-clock [turn]="turn" viewer="teacher" [name]="s.name" [mini]="true"/>}</a>}
    @empty{@if(!loading()){<div class="empty-state"><h2>Учеников пока нет</h2><p>Создайте отдельную карточку. Материалы других учеников сюда не переносятся.</p></div>}}
    <button class="student-card new-card" (click)="creating.set(true)"><span class="new-mark" aria-hidden="true"><mentor-icon name="plus"/></span><h2>Новый ученик</h2><p>Отдельная карточка, занятия и материалы</p></button></div>
  <mentor-pagination [page]="page()" [total]="total()" [disabled]="loading()" label="Страницы учеников" (pageChange)="page.set($event)"/>` })
export class StudentsPageComponent {
    readonly session = inject(SessionStore);
    private readonly api = inject(StudentsApi);
    private readonly homework = inject(HomeworkApi);
    private readonly router = inject(Router);
    private readonly refresh = signal(0);
    readonly page = signal(0);
    readonly total = signal(0);
    readonly students = signal<StudentView[]>([]);
    readonly summaries = signal<Record<string, Dashboard>>({});
    // One homework turn per student; the queue shows works awaiting review, oldest first as the server orders them.
    readonly queue = signal<StudentTurn[]>([]);
    readonly clocks = computed(() => Object.fromEntries(this.queue().map(row => [row.studentId, turnOf(row)])) as Record<string, Turn>);
    readonly waiting = computed(() => this.queue().filter(row => row.status === 'submitted'));
    readonly creating = signal(false);
    readonly loading = computed(() => {
        const primary = this.studentsResource.state(), turns = this.turnsResource.state();
        return primary.status === 'loading' || (primary.status === 'resolved' && primary.value.items.length > 0 && turns.status !== 'resolved' && turns.status !== 'error');
    });
    readonly error = signal('');
    // Archived cards live on a separate screen; the review queue belongs to the active ones only.
    readonly archive = signal(false);
    private readonly studentsParams = computed(() => {
        const actor = this.session.actor();
        return actor?.role === 'TEACHER' && actor.workspaceId
            ? { workspace: actor.workspaceId, page: this.page(), archive: this.archive(), refresh: this.refresh() }
            : undefined;
    });
    private readonly studentsResource = readResource({
        params: this.studentsParams,
        load: ({ workspace, page, archive }) => this.api.dashboards(workspace, page, archive ? 'true' : undefined),
    });
    private readonly turnsResource = readResource({
        params: () => {
            const primary = this.studentsResource.state();
            return primary.status === 'resolved' && primary.value.items.length ? primary.params : undefined;
        },
        load: ({ workspace }) => this.homework.studentTurns(workspace).pipe(catchError(() => of(null))),
    });
    // T16: past lessons of the last 14 days still waiting for the «Проведено» mark; a failed read just hides the line.
    private readonly schedule = inject(ScheduleApi);
    private readonly reminderResource = readResource({
        params: () => {
            const primary = this.studentsResource.state();
            return primary.status === 'resolved' && !primary.params.archive && primary.value.items.length
                ? { workspace: primary.params.workspace, refresh: primary.params.refresh, ...reminderWindow(moscowDate(Date.now())) } : undefined;
        },
        load: ({ workspace, from, to }) => this.schedule.get(workspace, from, to).pipe(catchError(() => of(null))),
    });
    readonly unmarked = computed(() => { const state = this.reminderResource.state(); return state.status === 'resolved' && state.value ? unmarkedLessons(state.value.items, Date.now()).length : 0; });
    readonly unmarkedLabel = unmarkedLabel;
    constructor() {
        effect(() => { this.session.generation(); this.studentsParams(); this.creating.set(false); });
        effect(() => {
            const state = this.studentsResource.state();
            untracked(() => {
                this.students.set(state.status === 'resolved' ? state.value.items.map(item => item.student) : []);
                this.summaries.set(state.status === 'resolved' ? Object.fromEntries(state.value.items.map(item => [item.student.id, item])) : {});
                if (state.status === 'resolved') this.total.set(state.value.total);
                if (state.status === 'idle') this.total.set(0);
                this.error.set(state.status === 'error'
                    ? errorMessage(state.error, 'Не удалось загрузить учеников.') : '');
            });
        });
        effect(() => {
            const state = this.turnsResource.state();
            this.queue.set(state.status === 'resolved' ? state.value?.items ?? [] : []);
        });
    }
    reload() { this.refresh.update(v => v + 1); }
    initial(name: string) { return name.trim().slice(0, 1).toUpperCase() || '·'; }
    direction(id: string) { return this.students().find(s => s.id === id)?.direction || 'Ученик'; }
    readonly turnSection = turnSection;
    waitingLabel() { const n = this.waiting().length, last = n % 10, tens = n % 100; return n + (last === 1 && tens !== 11 ? ' работа ждёт' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? ' работы ждут' : ' работ ждут') + ' ревью'; }
    created(student: StudentView) { this.creating.set(false); void this.router.navigate(['/teacher/students', student.id]); }
}

import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import { SessionStore } from '../core/session.store';
import { WorkspaceContext } from '../layout/workspace-context';
import { Dashboard, StudentsApi, StudentView } from './students-api.service';
import { StudentFormComponent } from './student-form.component';
@Component({ selector: 'mentor-students-page', imports: [RouterLink, StudentFormComponent], template: `
  <div class="page-head"><div><p class="eyebrow">КАБИНЕТ НАСТАВНИКА</p><h1>Мои ученики</h1><p class="subtitle">Выберите ученика, чтобы открыть его занятия, материалы и план обучения.</p></div><button class="btn primary" (click)="creating.set(true)">+ Добавить ученика</button></div>
  @if(creating()&&session.actor()?.workspaceId){<mentor-student-form [workspaceId]="session.actor()!.workspaceId!" (saved)="created($event)" (cancel)="creating.set(false)"/>}
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()">Повторить загрузку</button>}
  @if(loading()){<p role="status">Загружаем учеников…</p>}
  <div class="students-grid">@for(s of students();track s.id){<a class="panel panel-inner student-card" [routerLink]="['/teacher/students',s.id]"><span class="avatar">{{s.name.slice(0,1)}}</span><h2>{{s.name}}</h2><p>{{s.direction||'Направление не указано'}}</p><p>{{s.goal||'Цель обучения можно добавить в карточку'}}</p>@if(summaries()[s.id];as summary){<p class="small-muted">Занятий: {{summary.lessonCount}}</p>@if(summary.focus;as focus){<p>{{focus.upcoming?'Ближайшее занятие':'Последнее по дате'}}<br>{{focus.lesson.date}} · {{focus.lesson.time}} МСК</p>}@else{<p>Первое занятие ещё не добавлено</p>}}</a>}@empty{@if(!loading()){<div class="empty-state"><h2>Учеников пока нет</h2><p>Создайте отдельную карточку. Материалы других учеников сюда не переносятся.</p></div>}}<button class="panel panel-inner student-card" (click)="creating.set(true)"><h2>+ Новый ученик</h2><p>Отдельная карточка, занятия и материалы</p></button></div>
  <nav class="pagination" aria-label="Страницы учеников"><button class="btn" (click)="page.set(page()-1)" [disabled]="page()===0||loading()">Назад</button><span>Страница {{page()+1}}</span><button class="btn" (click)="page.set(page()+1)" [disabled]="(page()+1)*25>=total()||loading()">Далее</button></nav>` })
export class StudentsPageComponent {
    readonly session = inject(SessionStore);
    private readonly api = inject(StudentsApi);
    private readonly router = inject(Router);
    private readonly context = inject(WorkspaceContext);
    private readonly refresh = signal(0);
    readonly page = signal(0);
    readonly total = signal(0);
    readonly students = signal<StudentView[]>([]);
    readonly summaries = signal<Record<string, Dashboard>>({});
    readonly creating = signal(false);
    readonly loading = signal(false);
    readonly error = signal('');
    constructor() { effect(onCleanup => { this.session.generation(); const w = this.session.actor()?.workspaceId, page = this.page(); this.refresh(); this.students.set([]); this.summaries.set({}); this.creating.set(false); this.error.set(''); if (!w || this.session.actor()?.role !== 'TEACHER')
        return; this.loading.set(true); const sub = this.api.list(w, page).pipe(switchMap(view => { this.students.set(view.items); this.total.set(view.total); return view.items.length ? forkJoin(view.items.map(s => this.api.dashboard(w, s.id))) : of([]); })).subscribe({ next: summaries => { this.summaries.set(Object.fromEntries(summaries.map(s => [s.student.id, s]))); this.loading.set(false); }, error: e => { this.error.set(e.error?.message ?? 'Не удалось загрузить учеников.'); this.loading.set(false); } }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    created(student: StudentView) { this.creating.set(false); void this.router.navigate(['/teacher/students', student.id]); }
}

import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { StudentsApi, StudentView } from './students-api.service';
import { LessonsApi, LessonView } from '../lessons/lessons-api.service';
import { StudentFormComponent } from './student-form.component';
import { LessonFormComponent } from '../lessons/lesson-form.component';
import { AccountAccessComponent } from './account-access.component';
import { DomainPage } from './domain-page';
import { DashboardComponent } from '../student/dashboard.component';
import { MaterialViewComponent } from '../materials/material-view.component';
import { StudentNavigationComponent } from '../student/student-navigation.component';
import { IconComponent } from '../core/icon.component';
import { HomeworkApi, LessonTurn } from '../homework/homework-api.service';
import { Turn, TurnClockComponent, turnHeadline, turnOf, turnSection } from '../homework/turn-clock.component';
import { catchError, of } from 'rxjs';
import { RoadmapComponent } from '../roadmap/roadmap.component';
import { MovesComponent } from '../journal/moves.component';
import { lessonStatus } from '../lessons/lesson-status';
@Component({ selector: 'mentor-student-page', imports: [RouterLink, DatePipe, StudentFormComponent, LessonFormComponent, AccountAccessComponent, DashboardComponent, MaterialViewComponent, StudentNavigationComponent, IconComponent, TurnClockComponent, RoadmapComponent, MovesComponent], template: `
  @if(preview()&&!section()){<mentor-dashboard/>}@else{
  @if(error()){<div class="shell-error"><p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()"><mentor-icon name="refresh"/>Повторить загрузку</button></div>}
  @if(student();as s){
    @if(learner()){
      <div class="page-head"><div><h1>{{title()}}</h1>@if(section()==='lessons'){<p class="subtitle">Все занятия по дате, сначала новые. Открой занятие, чтобы увидеть задания и домашнюю работу.</p>}</div></div>
    }@else{
      <nav class="crumbs" aria-label="Путь"><a routerLink="/teacher/students">Мои ученики</a><span aria-hidden="true">›</span>@if(section()){<a [routerLink]="base()">{{s.name}}</a><span aria-hidden="true">›</span><span>{{title()}}</span>}@else{<span>{{s.name}}</span>}</nav>
      <div class="student-hero"><div class="who"><span class="avatar" aria-hidden="true">{{initial(s.name)}}</span><div><h1>{{s.name}}</h1><p>{{s.direction||'Направление не указано'}} · занимается с {{s.createdAt|date:'dd.MM.yyyy'}}</p></div></div>
        @if(editable()&&!section()){<div class="card-turn">@if(cardTurn();as turn){<mentor-turn-clock [turn]="turn" viewer="teacher" [name]="s.name"/>}<div class="actions">@if(cardTurn()?.state==='submitted'){<a class="btn primary" [routerLink]="base()+'/lessons/'+cardTurn()!.lessonId+'/teacher/'+turnSection(cardTurn()!)"><mentor-icon name="message"/>{{cardTurn()!.kind==='attempt'?'Открыть решение':'Открыть ревью'}}</a>}<a class="btn text" [routerLink]="base()" [queryParams]="{preview:'student'}">Экран ученика ↗</a><button class="btn" (click)="openStudentEditor('name')"><mentor-icon name="pencil"/>Изменить карточку</button>
          @if(archiving()){<span class="inline-confirm" role="group" aria-label="Подтверждение архивации"><span class="small-muted">{{s.archivedAt?'Вернуть карточку в активные?':'В архив? Ученик сохранит вход и чтение, но не сможет сдавать работы.'}}</span><button class="btn sm" [class.danger]="!s.archivedAt" type="button" (click)="setArchived(!s.archivedAt)" [disabled]="archiveBusy()">{{s.archivedAt?'Вернуть':'В архив'}}</button><button class="btn sm text" type="button" (click)="archiving.set(false)" [disabled]="archiveBusy()">Отмена</button></span>}@else{<button class="btn text" type="button" (click)="archiving.set(true)" [disabled]="archiveBusy()"><mentor-icon [name]="s.archivedAt?'rotate-ccw':'archive'"/>{{s.archivedAt?'Вернуть из архива':'В архив'}}</button>}</div></div>}</div>
      @if(s.archivedAt){<p class="callout mt-16" role="status">Карточка в архиве с {{s.archivedAt|date:'dd.MM.yyyy'}}. {{learner()?'Материалы и история открыты, новые работы не принимаются.':'Ученик читает материалы и историю, но не может сдавать работы; очередь ходов её не показывает.'}}</p>}
      @if(archiveError()){<p class="auth-error mt-16" role="alert">{{archiveError()}}</p>}
      @if(editable()&&editStudent()){<div class="section-block mt-28"><mentor-student-form #studentForm [workspaceId]="workspaceId()!" [student]="s" (saved)="savedStudent($event)" (cancel)="editStudent.set(false)"/></div>}
      <mentor-student-navigation [selection]="tabsContext()" level="student"/>
      <div class="mt-28"></div>
    }
    @if(section()==='materials'){<mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [detail]="detail()" [base]="base()" [preview]="preview()" [learner]="learner()"/>}
    @else if(profileSection()){
      @if(!learner()){<div class="sh section-block"><h2>{{title()}}</h2>@if(['profile','projects','career','journal','core','course'].includes(section())){<span class="vis private"><mentor-icon name="eye-off"/>Только вам</span>}@else{<span class="vis public"><mentor-icon name="eye"/>Видно ученику</span>}</div>}
      @if(section()==='goal'&&s.goal){<section class="goal-box section-block"><div><h2>{{s.goal}}</h2><p class="small-muted m-0">{{s.schedule||'Расписание пока не задано'}}</p></div></section>}
      @if(section()==='roadmap'){@defer{<mentor-roadmap class="section-block" [workspaceId]="workspaceId()!" [studentId]="s.id" [preview]="preview()" [editable]="editable()"/>}@placeholder{<p class="loading section-block" role="status">Загружаем маршрут…</p>}}
      @if(section()==='roadmap'&&s.studentRoadmap){<section class="section-block text-section"><div class="sh mb-16"><h2>Описание пути</h2></div><p class="plain-note">{{s.studentRoadmap}}</p></section>}
      <mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [base]="base()" [preview]="preview()" [learner]="learner()"/>}
    @else{
      <div [class.cols]="!section()&&!learner()">
      <div>
      @if(s.studentReview&&section()!=='review'&&!learner()){<a class="review-archive text-link" [routerLink]="base()+'/review'" [queryParams]="previewQuery()">Предыдущие отзывы без привязки к занятию →</a>}
      <section class="lesson-section" aria-labelledby="lessons-title">
        <div class="lessons-head"><div class="title-group"><h2 id="lessons-title">{{section()==='review'?'Ревью по занятиям':'Занятия'}}</h2><span class="count">Занятий: {{total()}} · по дате, сначала новые</span></div>
          @if(editable()&&section()!=='review'){<button class="btn sm" (click)="openLessonEditor()"><mentor-icon name="plus"/>Добавить занятие</button>}</div>
        @if(editable()&&createLesson()){<div class="mt-20"><mentor-lesson-form #lessonForm [workspaceId]="workspaceId()!" [studentId]="s.id" (saved)="createdLesson($event)" (cancel)="createLesson.set(false)"/></div>}
        @if(lessons().length){<div class="table-wrap"><table class="tbl lesson-table"><thead><tr><th scope="col" class="visually-hidden">№</th><th scope="col">Занятие</th><th scope="col">Дата и время</th><th scope="col">Статус</th>@if(turns()){<th scope="col">Чей ход</th>}<th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>
          @for(l of lessons();track l.id;let i=$index){<tr class="lesson-list-item">
            <td class="num" [class.mine]="turnFor(l)?.state==='submitted'"><span>{{l.number}}</span></td>
            <td><a class="row-title" [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{l.title}}</a></td>
            <td class="when">{{l.date|date:'dd.MM.yyyy'}}<small>{{l.time}} МСК · {{l.duration}} мин</small></td>
            <td>@if(status(l);as tag){<span class="tag" [class.on]="tag.on" [class.quiet]="tag.quiet"><mentor-icon [name]="tag.icon"/>{{tag.label}}</span>}</td>
            @if(turns()){<td class="turn-cell" [class.mine]="learner()&&turnFor(l)&&turnFor(l)!.state!=='submitted'">@if(turnFor(l);as turn){<b>{{headlineFor(turn).title}}</b><small>{{headlineFor(turn).text}}</small>}@else{<span class="small-muted">—</span>}</td>}
            <td class="act">@if(editable()&&turnFor(l)?.state==='submitted'){<a class="btn sm primary" [routerLink]="base()+'/lessons/'+l.id+'/teacher/'+turnSection(turnFor(l)!)">{{turnFor(l)!.kind==='attempt'?'Открыть решение':'Ревью'}}</a>}@else if(learner()&&turnFor(l)&&turnFor(l)!.state!=='submitted'&&turnFor(l)!.state!=='none'){<a class="btn sm primary" [routerLink]="base()+'/lessons/'+l.id+'/student/'+turnSection(turnFor(l)!)" [queryParams]="previewQuery()">{{turnFor(l)!.state==='needs_revision'?'Доработать':'Открыть отзыв'}}</a>}@else{<a class="btn sm" [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{section()==='review'?'Открыть ревью':learner()?'Открыть задания':'Открыть'}}</a>}
              @if(editable()){<div class="lesson-shortcuts mt-6"><a [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">{{l.bundleId?'Методичка':'Сценарий'}}</a><a [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a></div>}</td>
          </tr>}
        </tbody></table></div>}
        @else if(!loading()){<div class="empty-state mt-20"><h3>Занятий пока нет</h3><p>{{editable()?'Добавьте дату и тему. Материалы можно подготовить позже.':'Здесь появятся даты занятий, задания и материалы.'}}</p>@if(editable()&&section()!=='review'){<button class="btn" (click)="openLessonEditor()"><mentor-icon name="plus"/>Создать первое занятие</button>}</div>}
        @else{<p class="loading mt-20" role="status">Загружаем занятия…</p>}
        @if(total()>25){<nav class="pagination" aria-label="Страницы занятий"><button class="btn" (click)="changePage(page()-1)" [disabled]="page()===0||loading()"><mentor-icon name="chevron-left"/>Назад</button><span>Страница {{page()+1}} из {{pages()}}</span><button class="btn" (click)="changePage(page()+1)" [disabled]="(page()+1)*25>=total()||loading()">Далее<mentor-icon name="chevron-right"/></button></nav>}
      </section>
      @if(section()==='review'&&s.studentReview){<section class="section-block mt-40"><div class="sh mb-16"><h2>Предыдущий отзыв без привязки к занятию</h2></div><p class="plain-note">{{s.studentReview}}</p></section>}
      @if(!section()&&!learner()&&editable()){@defer(on idle){<mentor-moves class="section-block mt-40" [workspaceId]="workspaceId()!" [studentId]="s.id" [base]="base()" [name]="s.name" [size]="8"/>}}
      </div>
      @if(!section()&&!learner()){<aside class="side-stack" aria-label="Сведения об ученике">
        <section class="side-section student-overview"><div class="sh"><h2>Цель и расписание</h2><span class="vis public"><mentor-icon name="eye"/>Видно ученику</span></div>
          <dl class="facts"><div><dt>Цель</dt><dd [class.empty]="!s.goal">{{s.goal||'Цель пока не указана'}}</dd></div><div><dt>Расписание</dt><dd [class.empty]="!s.schedule">{{s.schedule||'Расписание пока не задано'}}</dd></div></dl>
          @if(editable()){<div class="actions"><button class="btn text" (click)="openStudentEditor('goal')"><mentor-icon name="pencil"/>{{s.goal&&s.schedule?'Изменить цель и расписание':'Указать цель и расписание'}}</button></div>}</section>
        @if(editable()){<mentor-account-access [workspaceId]="workspaceId()!" [studentId]="s.id" [compact]="true"/>
          <section class="notes-box mentor-notes" aria-labelledby="notes-title"><header><h2 id="notes-title">Заметки наставника</h2><span class="vis private"><mentor-icon name="eye-off"/>Только вам</span></header><div class="notes-body">
            @if(teacherNotes()){<p class="plain-note" [class.notes-preview]="longNotes()">{{teacherNotes()}}</p>@if(longNotes()){<details class="notes-details"><summary>Читать полностью</summary><p class="plain-note" tabindex="0" aria-label="Полные заметки наставника">{{teacherNotes()}}</p></details>}}
            @else{<p class="summary-empty">Наблюдения и важные детали об ученике. Видны только преподавателю.</p>}
            <div class="actions"><button class="btn text" (click)="openStudentEditor('notes')"><mentor-icon name="pencil"/>{{teacherNotes()?'Изменить заметки':'Добавить заметки'}}</button></div></div></section>
          <p class="visibility-legend"><span class="vis public"><mentor-icon name="eye"/>Видно ученику</span><span class="vis private"><mentor-icon name="eye-off"/>Только вам</span><span>Штриховка всегда значит: ученик этого не видит.</span></p>}
      </aside>}
      </div>
    }
    @if(section()==='review'){<div class="mt-40"><mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [base]="base()" [preview]="preview()" [learner]="learner()"/></div>}
  }@else if(!error()){<p class="loading" role="status">Загружаем карточку…</p>}}` })
export class StudentPageComponent extends DomainPage {
    readonly detail = computed(() => this.params().get('detail'));
    private readonly studentsApi = inject(StudentsApi);
    private readonly lessonsApi = inject(LessonsApi);
    private readonly router = inject(Router);
    private readonly injector = inject(Injector);
    private readonly studentForm = viewChild<unknown, ElementRef<HTMLElement>>('studentForm', { read: ElementRef });
    private readonly lessonForm = viewChild<unknown, ElementRef<HTMLElement>>('lessonForm', { read: ElementRef });
    private readonly refresh = signal(0);
    readonly student = signal<StudentView | null>(null);
    readonly lessons = signal<LessonView[]>([]);
    readonly total = signal(0);
    readonly page = signal(0);
    readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / 25)));
    readonly loading = signal(false);
    readonly error = signal('');
    readonly editStudent = signal(false);
    readonly createLesson = signal(false);
    private readonly homework = inject(HomeworkApi);
    // Latest submission per lesson of this card (teacher's own view only); null hides the turn column.
    readonly turns = signal<Map<string, LessonTurn> | null>(null);
    readonly cardTurn = computed<Turn | null>(() => {
        const turns = this.turns(); if (!turns) return null;
        const all = [...turns.values()], waiting = all.filter(turn => turn.status === 'submitted').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return turnOf(waiting[0] ?? all[0]);
    });
    readonly tabsContext = computed(() => { const s = this.student(); return s ? { student: s, base: this.base(), preview: false, learner: false, page: this.section() } : null; });
    constructor() {
        super();
        effect(onCleanup => {
            this.session.generation();
            const w = this.workspaceId(), s = this.studentId(), preview = this.preview(), section = this.section();
            this.refresh();
            this.student.set(null);
            this.error.set('');
            this.editStudent.set(false);
            this.createLesson.set(false);
            this.context.clear(this);
            if (!w || !s || (preview && !section))
                return;
            const sub = this.studentsApi.load(w, s, preview).subscribe({ next: view => { this.student.set(view); this.context.set(this, { student: view, base: this.base(), preview, learner: this.learner(), page: section }); }, error: e => this.error.set(this.message(e)) });
            onCleanup(() => sub.unsubscribe());
        });
        effect(onCleanup => {
            this.session.generation();
            const w = this.workspaceId(), s = this.studentId(), preview = this.preview(), page = this.page(), section = this.section();
            this.refresh();
            this.lessons.set([]);
            this.total.set(0);
            if (!w || !s || (preview && !section) || this.profileSection() || section === 'materials')
                return;
            this.loading.set(true);
            const sub = this.lessonsApi.list(w, s, page, preview).subscribe({ next: view => { this.lessons.set(view.items); this.total.set(view.total); this.loading.set(false); }, error: e => { this.error.set(this.message(e)); this.loading.set(false); } });
            onCleanup(() => sub.unsubscribe());
        });
        effect(onCleanup => {
            this.session.generation();
            const w = this.workspaceId(), s = this.studentId(), section = this.section(), preview = this.preview();
            this.refresh();
            this.turns.set(null);
            if (!w || !s || section)
                return;
            // The student sees the same latest exchanges in their own words; a preview asks for the student projection.
            const sub = this.homework.lessonTurns(w, s, preview).pipe(catchError(() => of(null))).subscribe(page => this.turns.set(page ? new Map(page.items.map(turn => [turn.lessonId, turn])) : null));
            onCleanup(() => sub.unsubscribe());
        });
    }
    readonly status = lessonStatus;
    // Archiving keeps the card and its history; the student still reads but cannot send new work.
    readonly archiving = signal(false); readonly archiveBusy = signal(false); readonly archiveError = signal('');
    setArchived(archived: boolean) {
        const s = this.student(); if (!this.editable() || this.archiveBusy() || !s) return; this.archiveBusy.set(true); this.archiveError.set('');
        this.studentsApi.save(this.workspaceId()!, s.id, { archived }, s.revision).subscribe({ next: view => { this.archiveBusy.set(false); this.archiving.set(false); this.savedStudent(view); }, error: e => { this.archiveBusy.set(false); this.archiving.set(false); this.archiveError.set(this.message(e)); } });
    }
    turnFor(lesson: LessonView): Turn | null { const turn = this.turns()?.get(lesson.id); return turn ? turnOf(turn) : null; }
    headlineFor(turn: Turn) { return turnHeadline(turn, this.learner() ? 'student' : 'teacher'); }
    readonly turnSection = turnSection;
    profileSection() { return ['goal', 'roadmap', 'profile', 'projects', 'career', 'journal', 'core', 'course'].includes(this.section()); }
    title() { return ({ goal: 'Моя цель', roadmap: 'Маршрут обучения', review: 'Предыдущие отзывы', lessons: 'Мои занятия', profile: 'Навыки и наблюдения', projects: 'Учебные проекты', career: 'Карьерный маршрут', journal: 'Журнал обучения', core: 'Базовые знания', course: 'Учебный курс', materials: this.learner() ? 'Материалы' : 'Материалы ученика' } as Record<string, string>)[this.section()] ?? this.student()?.name; }
    initial(name: string) { return name.trim().slice(0, 1).toUpperCase() || '·'; }
    teacherNotes() { const s = this.student(); return s && 'notes' in s ? s.notes : ''; }
    longNotes() { const notes = this.teacherNotes(); return notes.length > 240 || notes.split('\n').length > 6; }
    openStudentEditor(field: 'name' | 'goal' | 'notes') {
        if (!this.editable()) return;
        this.editStudent.set(true); this.createLesson.set(false);
        afterNextRender(() => { if (this.editable()) this.studentForm()?.nativeElement.querySelector<HTMLElement>(`[name="${field}"]`)?.focus(); }, { injector: this.injector });
    }
    openLessonEditor() {
        if (!this.editable()) return;
        this.createLesson.set(true); this.editStudent.set(false);
        afterNextRender(() => { if (this.editable()) this.lessonForm()?.nativeElement.querySelector<HTMLElement>('[name="title"]')?.focus(); }, { injector: this.injector });
    }
    reload() { this.refresh.update(v => v + 1); }
    changePage(page: number) { this.page.set(page); }
    savedStudent(view: StudentView) { this.student.set(view); this.context.set(this, { student: view, base: this.base(), preview: false, learner: false, page: this.section() }); this.editStudent.set(false); }
    createdLesson(view: LessonView) {
        if (!this.editable())
            return;
        this.createLesson.set(false);
        void this.router.navigate([this.base() + '/lessons/' + view.id]);
    }
    lessonLink(view: LessonView) { return this.base() + '/lessons/' + view.id + (this.section() === 'review' ? '/' + (this.learner() ? 'student' : 'teacher') + '/review' : this.learner() ? '/student/tasks' : ''); }
}

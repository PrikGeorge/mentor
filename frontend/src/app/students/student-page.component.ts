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
@Component({ selector: 'mentor-student-page', imports: [RouterLink, DatePipe, StudentFormComponent, LessonFormComponent, AccountAccessComponent, DashboardComponent, MaterialViewComponent], styleUrl: './student-page.component.scss', template: `
  @if(preview()&&!section()){<mentor-dashboard/>}@else{
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()">Повторить загрузку</button>}
  @if(student();as s){
    <div class="page-head"><div><p class="eyebrow">{{learner()?'МОЁ ОБУЧЕНИЕ':'КАРТОЧКА УЧЕНИКА'}}</p><h1>{{title()}}</h1><p class="subtitle">{{s.direction||'Индивидуальное обучение'}}</p></div>
      @if(editable()&&!section()){<div class="actions"><a class="btn" [routerLink]="base()" [queryParams]="{preview:'student'}">Кабинет ученика ↗</a><button class="btn" (click)="openStudentEditor('name')">Изменить карточку</button></div>}</div>
    @if(editable()&&editStudent()){<mentor-student-form #studentForm [workspaceId]="workspaceId()!" [student]="s" (saved)="savedStudent($event)" (cancel)="editStudent.set(false)"/>}
    @if(section()==='materials'){<mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [detail]="detail()" [base]="base()" [preview]="preview()" [learner]="learner()"/>}
    @else if(profileSection()){@if(section()==='goal'&&s.goal){<section class="panel panel-inner"><p class="eyebrow">МОЯ ЦЕЛЬ</p><h2>{{s.goal||'Цель обучения ещё предстоит определить'}}</h2><p>{{s.schedule||'Расписание пока не задано'}}</p></section>}
    @if(section()==='roadmap'&&s.studentRoadmap){<section class="panel panel-inner"><h2>Маршрут обучения</h2><p class="plain-note">{{s.studentRoadmap||'Маршрут ещё не составлен. Здесь появится план с учётом цели и текущего уровня.'}}</p></section>}
    <mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [base]="base()" [preview]="preview()" [learner]="learner()"/>}
    @else{
      @if(!section()){<div class="student-summary" [class.teacher-summary]="editable()">
        <section class="panel summary-card student-overview"><p class="eyebrow">ОБУЧЕНИЕ</p><h2>Цель и расписание</h2><div class="summary-content"><p class="goal-text">{{s.goal||'Цель пока не указана'}}</p><div class="schedule"><span class="summary-label">Расписание</span><p>{{s.schedule||'Расписание пока не задано'}}</p></div></div>
          @if(editable()){<button class="btn summary-action" (click)="openStudentEditor('goal')">{{s.goal&&s.schedule?'Изменить цель и расписание':'Указать цель и расписание'}}</button>}</section>
        @if(editable()){<mentor-account-access [workspaceId]="workspaceId()!" [studentId]="s.id" [compact]="true"/>
          <section class="panel summary-card mentor-notes"><p class="eyebrow">ТОЛЬКО ДЛЯ ВАС</p><h2>Заметки наставника</h2><div class="summary-content">
            @if(teacherNotes()){<p class="plain-note" [class.notes-preview]="teacherNotes().length>180||teacherNotes().split('\n').length>4">{{teacherNotes()}}</p>@if(teacherNotes().length>180||teacherNotes().split('\n').length>4){<details class="notes-details"><summary>Читать полностью</summary><p class="plain-note" tabindex="0" aria-label="Полные заметки наставника">{{teacherNotes()}}</p></details>}}
            @else{<p class="summary-empty">Наблюдения и важные детали об ученике. Видны только преподавателю.</p>}
          </div><button class="btn summary-action" (click)="openStudentEditor('notes')">{{teacherNotes()?'Изменить заметки':'Добавить заметки'}}</button></section>}
      </div>}
      @if(s.studentReview&&section()!=='review'){<a class="review-archive text-link" [routerLink]="base()+'/review'" [queryParams]="previewQuery()">Предыдущие отзывы без привязки к занятию →</a>}
      <section class="lesson-section"><div class="lesson-section-head"><div><div class="lesson-section-title"><h2>{{section()==='review'?'Ревью по занятиям':'Занятия'}}</h2><span class="pill neutral">Занятий: {{total()}}</span></div><p class="small-muted">По дате · сначала новые</p></div>
        @if(editable()&&section()!=='review'){<button class="btn primary" (click)="openLessonEditor()">+ Добавить занятие</button>}</div>
        @if(editable()&&createLesson()){<mentor-lesson-form #lessonForm [workspaceId]="workspaceId()!" [studentId]="s.id" (saved)="createdLesson($event)" (cancel)="createLesson.set(false)"/>}
        <div class="lesson-grid">@for(l of lessons();track l.id){<article class="lesson-list-item panel lesson-card"><div class="lesson-card-meta"><span class="lesson-date">{{l.date|date:'dd.MM.yyyy'}}</span><span class="pill neutral">{{l.status==='prepared'?'Подготовлено':'Запланировано'}}</span></div>
          <p class="lesson-datetime">{{l.time}} МСК · {{l.duration}} мин</p><h3><a [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{l.title}}</a></h3>
          <div class="lesson-card-actions"><a class="btn" [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{section()==='review'?'Открыть ревью':learner()?'Открыть задания':'Все материалы →'}}</a>
            @if(editable()){<div class="lesson-shortcuts"><a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">{{l.bundleId?'Методичка':'Сценарий'}}</a><a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a></div>}</div></article>}
        @empty{<div class="panel lesson-empty"><h3>Занятий пока нет</h3><p>{{editable()?'Добавьте дату и тему. Материалы можно подготовить позже.':'Здесь появятся даты занятий, задания и материалы.'}}</p>@if(editable()&&section()!=='review'){<button class="btn" (click)="openLessonEditor()">Создать первое занятие</button>}</div>}</div>
        <nav class="pagination" aria-label="Страницы занятий"><button class="btn" (click)="changePage(page()-1)" [disabled]="page()===0||loading()">Назад</button><span>Страница {{page()+1}}</span><button class="btn" (click)="changePage(page()+1)" [disabled]="(page()+1)*25>=total()||loading()">Далее</button></nav>
      </section>
      @if(section()==='review'&&s.studentReview){<section class="panel panel-inner"><h2>Предыдущий отзыв без привязки к занятию</h2><p class="plain-note">{{s.studentReview}}</p></section>}
    }
    @if(section()==='review'){<mentor-material-view [workspaceId]="workspaceId()!" [studentId]="s.id" [section]="section()" [base]="base()" [preview]="preview()" [learner]="learner()"/>}
  }@else if(!error()){<p role="status">Загружаем карточку…</p>}}` })
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
    readonly loading = signal(false);
    readonly error = signal('');
    readonly editStudent = signal(false);
    readonly createLesson = signal(false);
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
    }
    profileSection() { return ['goal', 'roadmap', 'profile', 'projects', 'career', 'journal', 'core', 'course'].includes(this.section()); }
    title() { return ({ goal: 'Моя цель', roadmap: 'Маршрут обучения', review: 'Предыдущие отзывы', lessons: 'Мои занятия', profile: 'Навыки и наблюдения', projects: 'Учебные проекты', career: 'Карьерный маршрут', journal: 'Журнал обучения', core: 'Базовые знания', course: 'Учебный курс' } as Record<string, string>)[this.section()] ?? this.student()?.name; }
    teacherNotes() { const s = this.student(); return s && 'notes' in s ? s.notes : ''; }
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

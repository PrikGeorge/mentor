import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { StudentsApi, StudentView } from './students-api.service';
import { LessonsApi, LessonView } from '../lessons/lessons-api.service';
import { StudentFormComponent } from './student-form.component';
import { LessonFormComponent } from '../lessons/lesson-form.component';
import { AccountAccessComponent } from './account-access.component';
import { DomainPage } from './domain-page';
import { DashboardComponent } from '../student/dashboard.component';
@Component({ selector: 'mentor-student-page', imports: [RouterLink, DatePipe, StudentFormComponent, LessonFormComponent, AccountAccessComponent, DashboardComponent], template: `
  @if(preview()&&!section()){<mentor-dashboard/>}@else{
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()">Повторить загрузку</button>}
  @if(student();as s){
    <div class="page-head"><div><p class="eyebrow">{{learner()?'МОЁ ОБУЧЕНИЕ':'КАРТОЧКА УЧЕНИКА'}}</p><h1>{{title()}}</h1><p class="subtitle">{{s.direction||'Индивидуальное обучение'}}</p></div>
      @if(editable()&&!section()){<div class="actions"><a class="btn" [routerLink]="base()" [queryParams]="{preview:'student'}">Кабинет ученика ↗</a><button class="btn" (click)="editStudent.set(true);createLesson.set(false)">Изменить карточку</button><button class="btn primary" (click)="createLesson.set(true);editStudent.set(false)">+ Добавить занятие</button></div>}</div>
    @if(editable()&&editStudent()){<mentor-student-form [workspaceId]="workspaceId()!" [student]="s" (saved)="savedStudent($event)" (cancel)="editStudent.set(false)"/>}
    @if(editable()&&createLesson()){<mentor-lesson-form [workspaceId]="workspaceId()!" [studentId]="s.id" (saved)="createdLesson($event)" (cancel)="createLesson.set(false)"/>}
    @if(section()==='goal'){<section class="panel panel-inner"><p class="eyebrow">МОЯ ЦЕЛЬ</p><h2>{{s.goal||'Цель обучения ещё предстоит определить'}}</h2><p>{{s.schedule||'Расписание пока не задано'}}</p></section>}
    @else if(section()==='roadmap'){<section class="panel panel-inner"><h2>Маршрут обучения</h2><p class="plain-note">{{s.studentRoadmap||'Маршрут ещё не составлен. Здесь появится план с учётом цели и текущего уровня.'}}</p></section>}
    @else{
      @if(!section()){<section class="panel panel-inner student-overview"><h2>{{s.goal||'Цель пока не указана'}}</h2><p>{{s.schedule||'Расписание пока не задано'}}</p><span class="pill neutral">Занятий: {{total()}}</span></section>
        @if(editable()){<mentor-account-access [workspaceId]="workspaceId()!" [studentId]="s.id"/>@if(teacherNotes()){<section class="panel panel-inner"><h2>Заметки наставника</h2><p class="plain-note">{{teacherNotes()}}</p></section>}}}
      @if(s.studentReview&&section()!=='review'){<p class="callout"><a class="text-link" [routerLink]="base()+'/review'" [queryParams]="previewQuery()">Предыдущие отзывы без привязки к занятию →</a></p>}
      <section class="panel panel-inner"><h2>{{section()==='review'?'Ревью по занятиям':'Занятия'}}</h2><p class="small-muted">По дате · сначала новые</p>
        @for(l of lessons();track l.id){<article class="lesson-list-item"><div><p class="lesson-datetime">{{l.date|date:'dd.MM.yyyy'}} · {{l.time}} МСК · {{l.duration}} мин</p><h3><a [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{l.title}}</a></h3><div class="actions"><a class="btn" [routerLink]="lessonLink(l)" [queryParams]="previewQuery()">{{section()==='review'?'Открыть ревью':learner()?'Открыть задания':'Все материалы →'}}</a>@if(editable()){<a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">{{l.bundleId?'Методичка':'Сценарий'}}</a><a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a>}</div></div><span class="pill neutral">{{l.status==='prepared'?'Подготовлено':'Запланировано'}}</span></article>}
        @empty{<div class="empty-state"><h3>Занятий пока нет</h3><p>Здесь появятся даты занятий, задания и материалы.</p></div>}
        <nav class="pagination" aria-label="Страницы занятий"><button class="btn" (click)="changePage(page()-1)" [disabled]="page()===0||loading()">Назад</button><span>Страница {{page()+1}}</span><button class="btn" (click)="changePage(page()+1)" [disabled]="(page()+1)*25>=total()||loading()">Далее</button></nav>
      </section>
      @if(section()==='review'&&s.studentReview){<section class="panel panel-inner"><h2>Предыдущий отзыв без привязки к занятию</h2><p class="plain-note">{{s.studentReview}}</p></section>}
    }
  }@else if(!error()){<p role="status">Загружаем карточку…</p>}}` })
export class StudentPageComponent extends DomainPage {
    private readonly studentsApi = inject(StudentsApi);
    private readonly lessonsApi = inject(LessonsApi);
    private readonly router = inject(Router);
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
        effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), preview = this.preview(), section = this.section(); this.refresh(); this.student.set(null); this.error.set(''); this.editStudent.set(false); this.createLesson.set(false); this.context.clear(this); if (!w || !s || (preview && !section))
            return; const sub = this.studentsApi.load(w, s, preview).subscribe({ next: view => { this.student.set(view); this.context.set(this, { student: view, base: this.base(), preview, learner: this.learner(), page: section }); }, error: e => this.error.set(this.message(e)) }); onCleanup(() => sub.unsubscribe()); });
        effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), preview = this.preview(), page = this.page(), section = this.section(); this.refresh(); this.lessons.set([]); this.total.set(0); if (!w || !s || (preview && !section) || ['goal', 'roadmap'].includes(section))
            return; this.loading.set(true); const sub = this.lessonsApi.list(w, s, page, preview).subscribe({ next: view => { this.lessons.set(view.items); this.total.set(view.total); this.loading.set(false); }, error: e => { this.error.set(this.message(e)); this.loading.set(false); } }); onCleanup(() => sub.unsubscribe()); });
    }
    title() { const section = this.section(); return section === 'goal' ? 'Моя цель' : section === 'roadmap' ? 'Маршрут обучения' : section === 'review' ? 'Предыдущие отзывы' : section === 'lessons' ? 'Мои занятия' : this.student()?.name; }
    teacherNotes() { const s = this.student(); return s && 'notes' in s ? s.notes : ''; }
    reload() { this.refresh.update(v => v + 1); }
    changePage(page: number) { this.page.set(page); }
    savedStudent(view: StudentView) { this.student.set(view); this.context.set(this, { student: view, base: this.base(), preview: false, learner: false, page: this.section() }); this.editStudent.set(false); }
    createdLesson(view: LessonView) { if (!this.editable())
        return; this.createLesson.set(false); void this.router.navigate([this.base() + '/lessons/' + view.id]); }
    lessonLink(view: LessonView) { return this.base() + '/lessons/' + view.id + (this.section() === 'review' ? '/' + (this.learner() ? 'student' : 'teacher') + '/review' : this.learner() ? '/student/tasks' : ''); }
}

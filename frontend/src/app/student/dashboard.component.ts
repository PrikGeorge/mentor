import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { switchMap, throwError } from 'rxjs';
import { Dashboard, StudentsApi } from '../students/students-api.service';
import { DomainPage } from '../students/domain-page';
@Component({ selector: 'mentor-dashboard', imports: [RouterLink, DatePipe], template: `
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()">Повторить загрузку</button>}
  @if(view();as d){<div class="page-head"><div><p class="eyebrow">КАБИНЕТ УЧЕНИКА</p><h1>{{d.student.name}}</h1><p class="subtitle">Открой задания к занятию или вернись к домашней работе.</p></div></div>
    @if(d.focus;as focus){<article class="panel panel-inner learner-lesson"><p class="eyebrow">{{focus.upcoming?'БЛИЖАЙШЕЕ ЗАНЯТИЕ':'ПОСЛЕДНЕЕ ЗАНЯТИЕ'}}</p><p>{{focus.lesson.date|date:'dd.MM.yyyy'}} · {{focus.lesson.time}} МСК · {{focus.lesson.duration}} мин</p><h2>{{focus.lesson.title}}</h2>@if(!focus.upcoming){<p>Дата занятия прошла. Факт проведения здесь не отмечен.</p>}<p>{{focus.lesson.bundleId?'Материалы готовы':focus.lesson.studentNotes.trim()?'Задания добавлены · материалы готовятся':'Текст заданий и материалы не добавлены'}}</p><div class="actions"><a class="btn primary" [routerLink]="lessonLink('tasks')" [queryParams]="previewQuery()">Открыть задания</a><a class="btn" [routerLink]="lessonLink('homework')" [queryParams]="previewQuery()">Домашняя работа</a><a class="btn" [routerLink]="lessonLink('review')" [queryParams]="previewQuery()">Ревью</a></div></article>}
    @else{<section class="panel panel-inner empty-state"><h2>Занятий пока нет</h2><p>Здесь появятся даты занятий, задания и материалы.</p></section>}
    <p><a class="text-link" [routerLink]="studentBase()+'/lessons'" [queryParams]="previewQuery()">Все занятия →</a> · {{d.lessonCount}}</p><section class="panel panel-inner"><p class="eyebrow">МОЯ ЦЕЛЬ</p><h2>{{d.student.goal||'Цель обучения ещё предстоит определить'}}</h2><p>{{d.student.direction}} · {{d.student.schedule}}</p><div class="actions"><a [routerLink]="studentBase()+'/goal'" [queryParams]="previewQuery()">Моя цель</a><a [routerLink]="studentBase()+'/roadmap'" [queryParams]="previewQuery()">Маршрут обучения</a></div></section>
  }@else if(!error()){<p role="status">Загружаем кабинет…</p>}` })
export class DashboardComponent extends DomainPage {
    private readonly api = inject(StudentsApi);
    private readonly refresh = signal(0);
    readonly view = signal<Dashboard | null>(null);
    readonly error = signal('');
    constructor() { super(); effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), preview = this.preview(); this.refresh(); this.view.set(null); this.error.set(''); this.context.clear(this); if (!w)
        return; const resolve = s ? this.api.dashboard(w, s, preview) : this.api.list(w, 0).pipe(switchMap(page => page.items.length === 1 ? this.api.dashboard(w, page.items[0].id) : throwError(() => new Error('Карточка ученика недоступна.')))); const sub = resolve.subscribe({ next: view => { this.view.set(view); this.context.set(this, { student: view.student, base: this.studentBase(), preview, learner: true, page: '' }); }, error: e => this.error.set(this.message(e)) }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    studentBase() { return (this.session.actor()?.role === 'TEACHER' ? '/teacher/students/' : '/learn/students/') + encodeURIComponent(this.view()!.student.id); }
    lessonLink(section: string) { return this.studentBase() + '/lessons/' + this.view()!.focus!.lesson.id + '/student/' + section; }
}

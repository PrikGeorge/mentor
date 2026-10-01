import { Component, input, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import type { WorkspaceSelection } from '../layout/workspace-context';
@Component({ selector: 'mentor-student-navigation', imports: [RouterLink, RouterLinkActive], template: `
  @if (selection(); as context) {
    @if (!context.learner) { <div class="selected-student"><strong>{{context.student.name}}</strong><small>{{context.student.direction}}</small></div> }
    <p class="nav-label">{{context.learner?'МОЁ ОБУЧЕНИЕ':'КАРТОЧКА УЧЕНИКА'}}</p>
    <nav [attr.aria-label]="context.learner?'Кабинет ученика':'Карточка ученика'">
      <a [routerLink]="context.base" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" [ariaCurrentWhenActive]="current(context.base)?'page':undefined">{{context.learner?'Главная':'Занятия'}}</a>
      @if(context.learner) {<a [routerLink]="context.base+'/lessons'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/lessons')?'page':undefined">Занятия</a><a [routerLink]="context.base+'/goal'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/goal')?'page':undefined">Моя цель</a>}
      @if(!context.learner){<a [routerLink]="context.base+'/profile'" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/profile')?'page':undefined">Навыки и наблюдения</a><a [routerLink]="context.base+'/projects'" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/projects')?'page':undefined">Учебные проекты</a>}
      <a [routerLink]="context.base+'/roadmap'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/roadmap')?'page':undefined">Маршрут обучения</a>
      @if(!context.lesson){<a [routerLink]="context.base+'/materials'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/materials')?'page':undefined">Материалы</a>}
    </nav>
    @if(context.lesson;as lesson){<p class="nav-label">ЗАНЯТИЕ · {{lesson.date}}</p><nav aria-label="Разделы занятия">
      @for(section of context.learner?studentSections:teacherSections;track section[0]) {<a [routerLink]="context.base+'/lessons/'+lesson.id+'/'+(context.learner?'student':'teacher')+'/'+section[0]" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [ariaCurrentWhenActive]="current(context.base+'/lessons/'+lesson.id+'/'+(context.learner?'student':'teacher')+'/'+section[0])?'page':undefined">{{section[1]}}</a>}
    </nav>}
  }` })
export class StudentNavigationComponent {
    private readonly router = inject(Router);
    private readonly navigation = toSignal(this.router.events.pipe(filter(event => event instanceof NavigationEnd)));
    current(path: string) { this.navigation(); return this.router.isActive(this.router.createUrlTree([path]), { paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }); }
    readonly selection = input<WorkspaceSelection | null>(null);
    readonly studentSections = [['tasks', 'Задания'], ['practice', 'Тренажёр'], ['materials', 'Материалы'], ['homework', 'Домашняя работа'], ['review', 'Ревью']];
    readonly teacherSections = [['plan', 'План'], ['guide', 'Сценарий преподавателя'], ['practice', 'Тренажёр'], ['review', 'Ревью'], ['answers', 'Эталоны'], ['materials', 'Материалы']];
}

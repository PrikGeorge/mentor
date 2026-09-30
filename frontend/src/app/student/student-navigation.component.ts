import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { WorkspaceSelection } from '../layout/workspace-context';
@Component({ selector: 'mentor-student-navigation', imports: [RouterLink, RouterLinkActive], template: `
  @if (selection(); as context) {
    <div class="selected-student"><strong>{{context.student.name}}</strong><small>{{context.student.direction}}</small></div>
    <p class="nav-label">{{context.learner?'МОЁ ОБУЧЕНИЕ':'КАРТОЧКА УЧЕНИКА'}}</p>
    <nav [attr.aria-label]="context.learner?'Кабинет ученика':'Карточка ученика'">
      <a [routerLink]="context.base" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" ariaCurrentWhenActive="page">{{context.learner?'Главная':'Занятия'}}</a>
      @if(context.learner) {<a [routerLink]="context.base+'/lessons'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" ariaCurrentWhenActive="page">Занятия</a><a [routerLink]="context.base+'/goal'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" ariaCurrentWhenActive="page">Моя цель</a>}
      <a [routerLink]="context.base+'/roadmap'" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" ariaCurrentWhenActive="page">Маршрут обучения</a>
    </nav>
    @if(context.lesson;as lesson){<p class="nav-label">ЗАНЯТИЕ · {{lesson.date}}</p><nav aria-label="Разделы занятия">
      @for(section of context.learner?studentSections:teacherSections;track section[0]) {<a [routerLink]="context.base+'/lessons/'+lesson.id+'/'+(context.learner?'student':'teacher')+'/'+section[0]" [queryParams]="context.preview?{preview:'student'}:{}" routerLinkActive="active" ariaCurrentWhenActive="page">{{section[1]}}</a>}
    </nav>}
  }` })
export class StudentNavigationComponent {
    readonly selection = input<WorkspaceSelection | null>(null);
    readonly studentSections = [['tasks', 'Задания'], ['practice', 'Тренажёр'], ['materials', 'Материалы'], ['homework', 'Домашняя работа'], ['review', 'Ревью']];
    readonly teacherSections = [['plan', 'План'], ['guide', 'Сценарий преподавателя'], ['practice', 'Тренажёр'], ['review', 'Ревью'], ['answers', 'Эталоны'], ['materials', 'Материалы']];
}

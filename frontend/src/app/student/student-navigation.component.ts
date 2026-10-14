import { Component, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { WorkspaceSelection } from '../layout/workspace-context';
type Tab = { path: string; label: string; private?: boolean; exact?: boolean };
// Tabs of the selected student card (teacher) or of the open lesson (both roles).
@Component({ selector: 'mentor-student-navigation', imports: [RouterLink, RouterLinkActive], template: `
  @if (selection(); as context) { @if (tabs().length) {
    <nav class="tabs" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.path) {
        <a [routerLink]="tab.path" [queryParams]="context.preview ? { preview: 'student' } : {}" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: tab.exact ?? true }" ariaCurrentWhenActive="page">@if (tab.private) {<span class="hm" aria-hidden="true"></span>}{{ tab.label }}@if (tab.private) {<span class="visually-hidden"> · только вам</span>}</a>
      }
    </nav>
  } }` })
export class StudentNavigationComponent {
    readonly selection = input<WorkspaceSelection | null>(null);
    readonly level = input<'student' | 'lesson'>('student');
    readonly label = computed(() => this.level() === 'lesson' ? 'Разделы занятия' : this.selection()?.learner ? 'Кабинет ученика' : 'Карточка ученика');
    readonly tabs = computed<Tab[]>(() => {
        const context = this.selection();
        if (!context) return [];
        const lesson = context.lesson;
        if (this.level() === 'lesson' && lesson) {
            const root = context.base + '/lessons/' + lesson.id;
            if (context.learner) return [['tasks', 'Задания'], ['practice', 'Тренажёр'], ['materials', 'Материалы'], ['homework', 'Домашняя работа'], ['review', 'Ревью']].map(([path, label]) => ({ path: root + '/student/' + path, label, exact: path !== 'practice' && path !== 'materials' }));
            const sections: Tab[] = [{ path: root, label: 'Подготовка' }];
            if (lesson.bundleId) sections.push({ path: root + '/teacher/plan', label: 'План' });
            sections.push({ path: root + '/teacher/guide', label: 'Сценарий преподавателя', private: true }, { path: root + '/teacher/practice', label: 'Тренажёр', exact: false }, { path: root + '/teacher/review', label: 'Ревью' }, { path: root + '/teacher/answers', label: 'Эталоны', private: true }, { path: root + '/teacher/materials', label: 'Материалы', exact: false });
            return sections;
        }
        if (context.learner) return [];
        return [
            { path: context.base, label: 'Занятия' },
            { path: context.base + '/profile', label: 'Навыки и наблюдения', private: true },
            { path: context.base + '/projects', label: 'Учебные проекты', private: true },
            { path: context.base + '/roadmap', label: 'Маршрут обучения' },
            { path: context.base + '/materials', label: 'Материалы ученика', exact: false },
            { path: context.base + '/review', label: 'Предыдущие отзывы' },
        ];
    });
}

import { Component, DestroyRef, ElementRef, afterEveryRender, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Motion, motionEase, motionMs } from '../core/motion';
import { SessionStore } from '../core/session.store';
import type { WorkspaceSelection } from '../layout/workspace-context';
type Tab = { path: string; label: string; private?: boolean; exact?: boolean };
const reveal = (link: HTMLElement) => {
    const bar = link.parentElement;
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    const left = link.offsetLeft - 16;
    const right = link.offsetLeft + link.offsetWidth + 16;
    if (left < bar.scrollLeft) bar.scrollLeft = left;
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
};
// The start of the tab fill, kept from NavigationStart until the next bar renders (one bar on screen at a time).
const HANDOFF_MS = 1500;
let handoff: { rect: DOMRect; href: string | null; key: string; at: number; ended: boolean } | null = null;
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
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly motion = inject(Motion);
    private readonly session = inject(SessionStore);
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
            if (lesson.bundleId) sections.push({ path: root + '/teacher/plan', label: 'План', private: true });
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
            { path: context.base + '/review', label: 'Ревью' },
        ];
    });

    // UX-28 M4: the dark fill of the active lesson tab slides from the tab that was active. The lesson screen reloads the
    // lesson on every section change and the bar is created anew, so the start is handed over between instances by key.
    constructor() {
        let running: Animation[] = [];
        inject(DestroyRef).onDestroy(() => running.forEach((animation) => animation.cancel()));
        inject(Router)
            .events.pipe(takeUntilDestroyed())
            .subscribe((event) => {
                if (this.level() !== 'lesson') return;
                if (event instanceof NavigationStart) {
                    const link = this.activeLink();
                    handoff = link ? { rect: link.getBoundingClientRect(), href: link.getAttribute('href'), key: this.bindingKey(), at: performance.now(), ended: false } : null;
                } else if (event instanceof NavigationEnd && handoff) handoff.ended = true;
                else if (event instanceof NavigationCancel || event instanceof NavigationError) handoff = null;
            });
        let shown: HTMLElement | null = null;
        afterEveryRender(() => {
            // A new bar starts scrolled to its beginning: bring the active tab into the row (horizontally only).
            const active = this.activeLink();
            if (active && active !== shown) {
                shown = active;
                reveal(active);
            }
            const start = handoff;
            if (!start?.ended || this.level() !== 'lesson') return;
            if (start.key !== this.bindingKey() || performance.now() - start.at > HANDOFF_MS) {
                handoff = null;
                return;
            }
            const link = this.activeLink();
            // Still the old tab (the class moves a little later, or only the query changed): wait, the window is short.
            if (!link || link.getAttribute('href') === start.href) return;
            handoff = null;
            running.forEach((animation) => animation.cancel());
            running = this.slide(start.rect, link);
        });
    }

    private activeLink() {
        return this.host.nativeElement.querySelector<HTMLElement>('.tabs a.active');
    }
    private bindingKey() {
        const context = this.selection();
        return [this.session.generation(), this.level(), context?.base, context?.lesson?.id].join('|');
    }
    private slide(from: DOMRect, link: HTMLElement): Animation[] {
        const rect = link.getBoundingClientRect();
        if (!rect.width) return [];
        const move = motionMs('move');
        const shift = `translateX(${from.left - rect.left}px) scaleX(${from.width / rect.width})`;
        const fill = this.motion.animate(link, [{ transform: shift }, { transform: 'none' }], { duration: move, easing: motionEase('move'), pseudoElement: '::before' });
        // The new label keeps the colour of a quiet tab until the fill is half-way: the colour changes with a click.
        const quiet = this.host.nativeElement.querySelector<HTMLElement>('.tabs a:not(.active)');
        const color = quiet ? getComputedStyle(quiet).color : '';
        const label = color ? this.motion.animate(link, [{ color }, { color }], { duration: move / 2 }) : null;
        return [fill, label].filter((animation): animation is Animation => !!animation);
    }
}

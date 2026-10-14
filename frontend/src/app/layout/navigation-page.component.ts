import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
@Component({
  selector: 'mentor-navigation-page', imports: [RouterLink],
  template: `@if (missing) { <section class="not-found"><p class="code" aria-hidden="true">404</p><div class="board" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><h1>Страница не найдена</h1><p class="subtitle">Проверьте ссылку или вернитесь в свой кабинет.</p><a class="btn primary mt-20" routerLink="/">В кабинет</a></section> }
    @else { <p class="eyebrow">Кабинет наставника</p><h1>{{ teacher ? 'Мои ученики' : 'Мои занятия' }}</h1><p class="subtitle">{{ teacher ? 'Ученики и занятия вашего пространства.' : 'Ваши занятия и материалы.' }}</p> }`,
})
export class NavigationPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly missing = !!this.route.snapshot.data['missing'];
  readonly teacher = this.route.snapshot.pathFromRoot.some(part => part.routeConfig?.path === 'teacher/students');
}

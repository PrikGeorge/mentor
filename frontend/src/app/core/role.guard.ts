import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Actor, SessionStore } from './session.store';
import { safeReturnUrl } from './session.interceptor';
import { LegacyRouteAdapter } from './legacy-route.adapter';

export function requireRole(role?: Actor['role']): CanActivateFn {
  return (_route, state) => {
    const session = inject(SessionStore);
    const router = inject(Router);
    const check = (): true | UrlTree => {
      const actor = session.actor();
      if (!actor) return router.createUrlTree(['/login'], { queryParams: { returnUrl: safeReturnUrl(state.url) ?? '/' } });
      if (role && (actor.role !== role || (role !== 'ADMIN' && !actor.workspaceId))) return router.createUrlTree(['/not-found']);
      return true;
    };
    return session.loaded() ? check() : session.load().pipe(map(check), catchError(() => of(router.createUrlTree(['/login'], { queryParams: { returnUrl: safeReturnUrl(state.url) ?? '/' } }))));
  };
}

export const homeGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const legacy = inject(LegacyRouteAdapter);
  const check = (): UrlTree => {
    const actor = session.actor();
    if (!actor) return router.createUrlTree(['/login'], { queryParams: state.url === '/' ? {} : { returnUrl: safeReturnUrl(state.url) ?? '/' } });
    const adapted = legacy.resolve(new URL(state.url, 'http://mentor.local'), actor);
    return adapted ?? router.createUrlTree([actor.role === 'ADMIN' ? '/admin/teachers' : actor.role === 'TEACHER' ? '/teacher/students' : '/learn']);
  };
  return session.loaded() ? check() : session.load().pipe(map(check), catchError(() => of(router.createUrlTree(['/login']))));
};

import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideRouter, RouterFeatures, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { SessionStore } from './core/session.store';
import { sessionInterceptor } from './core/session.interceptor';
import { prefersReducedMotion } from './core/motion';
import { RouteMotion } from './core/route-motion';
// UX-28 M3: with reduced motion at start-up the router never starts a view transition at all.
const routerFeatures: RouterFeatures[] = [withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })];
if (!prefersReducedMotion()) routerFeatures.push(withViewTransitions({
  skipInitialTransition: true,
  onViewTransitionCreated: ({ transition, from, to }) => { if (!inject(RouteMotion).allow(from, to)) transition.skipTransition(); },
}));
export const appConfig: ApplicationConfig = { providers: [
  provideRouter(routes, ...routerFeatures),
  provideHttpClient(withXhr(), withInterceptors([sessionInterceptor])),
  provideAppInitializer(() => { inject(RouteMotion); }),
  provideAppInitializer(() => firstValueFrom(inject(SessionStore).load()).catch(() => undefined)),
] };

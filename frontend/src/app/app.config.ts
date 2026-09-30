import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { SessionStore } from './core/session.store';
import { sessionInterceptor } from './core/session.interceptor';
export const appConfig: ApplicationConfig = { providers: [
  provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
  provideHttpClient(withInterceptors([sessionInterceptor])),
  provideAppInitializer(() => firstValueFrom(inject(SessionStore).load()).catch(() => undefined)),
] };

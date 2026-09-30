import { Routes } from '@angular/router';
import { AuthPageComponent } from './auth/auth-page.component';
import { TeachersPageComponent } from './admin/teachers-page.component';
import { NavigationPageComponent } from './layout/navigation-page.component';
import { homeGuard, requireRole } from './core/role.guard';
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: NavigationPageComponent, canActivate: [homeGuard] },
  { path: 'login', component: AuthPageComponent },
  { path: 'register', component: AuthPageComponent, data: { mode: 'register' } },
  { path: 'reset-password', component: AuthPageComponent, data: { mode: 'reset' } },
  { path: 'account/password', component: AuthPageComponent, data: { mode: 'password' }, canActivate: [requireRole()] },
  { path: 'admin/teachers', component: TeachersPageComponent, canActivate: [requireRole('ADMIN')] },
  { path: 'teacher/students', canActivate: [requireRole('TEACHER')], children: [{ path: '**', component: NavigationPageComponent }] },
  { path: 'learn', canActivate: [requireRole('STUDENT')], children: [{ path: '**', component: NavigationPageComponent }] },
  { path: 'not-found', component: NavigationPageComponent, data: { missing: true } },
  { path: '**', component: NavigationPageComponent, data: { missing: true } },
];

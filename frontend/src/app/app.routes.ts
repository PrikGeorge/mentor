import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { PracticeExit } from './core/practice-exit.service';
import { AuthPageComponent } from './auth/auth-page.component';
import { NavigationPageComponent } from './layout/navigation-page.component';
import { homeGuard, requireRole } from './core/role.guard';
// Every signed-in screen is its own lazy chunk; only the sign-in page and the shell stay in the initial bundle (FE-01).
const studentsPage = () => import('./students/students-page.component').then(module => module.StudentsPageComponent);
const studentPage = () => import('./students/student-page.component').then(module => module.StudentPageComponent);
const dashboardPage = () => import('./student/dashboard.component').then(module => module.DashboardComponent);
const teachersPage = () => import('./admin/teachers-page.component').then(module => module.TeachersPageComponent);
const schedulePage = () => import('./schedule/schedule-page.component').then(module => module.SchedulePageComponent);
const lessonRoutes: Routes = [
    ...[':studentId/lessons/:lessonId/:audience/practice/:detail', ':studentId/lessons/:lessonId/:audience/practice'].map(path => ({ path, loadComponent: () => import('./practice/practice-page.component').then(module => module.PracticePageComponent), canDeactivate: [() => inject(PracticeExit).ask()] })),
    { path: ':studentId/lessons/:lessonId/:audience/:section/:detail', loadComponent: () => import('./lessons/lesson-page.component').then(module => module.LessonPageComponent) },
    { path: ':studentId/lessons/:lessonId/:audience/:section', loadComponent: () => import('./lessons/lesson-page.component').then(module => module.LessonPageComponent) },
    { path: ':studentId/lessons/:lessonId', loadComponent: () => import('./lessons/lesson-page.component').then(module => module.LessonPageComponent) },
];
const profileRoutes: Routes = [{ path: ':studentId/materials/:detail', loadComponent: studentPage, data: { section: 'materials' } }, ...['lessons', 'goal', 'roadmap', 'review', 'profile', 'projects', 'career', 'journal', 'core', 'course', 'materials'].map(section => ({ path: ':studentId/' + section, loadComponent: studentPage, data: { section } }))];
export const routes: Routes = [
    { path: '', pathMatch: 'full', component: NavigationPageComponent, canActivate: [homeGuard] },
    { path: 'login', component: AuthPageComponent },
    { path: 'register', component: AuthPageComponent, data: { mode: 'register' } },
    { path: 'reset-password', component: AuthPageComponent, data: { mode: 'reset' } },
    { path: 'account/password', component: AuthPageComponent, data: { mode: 'password' }, canActivate: [requireRole()] },
    { path: 'admin/teachers', loadComponent: teachersPage, canActivate: [requireRole('ADMIN')] },
    { path: 'teacher/schedule', loadComponent: schedulePage, canActivate: [requireRole('TEACHER')] },
    { path: 'teacher/students', canActivate: [requireRole('TEACHER')], children: [{ path: '', pathMatch: 'full', loadComponent: studentsPage }, ...lessonRoutes, ...profileRoutes, { path: ':studentId', loadComponent: studentPage }] },
    { path: 'learn', canActivate: [requireRole('STUDENT')], children: [{ path: '', pathMatch: 'full', loadComponent: dashboardPage }, { path: 'students', children: [{ path: '', pathMatch: 'full', redirectTo: '/learn' }, ...lessonRoutes, ...profileRoutes, { path: ':studentId', loadComponent: dashboardPage }] }] },
    { path: 'not-found', component: NavigationPageComponent, data: { missing: true } },
    { path: '**', component: NavigationPageComponent, data: { missing: true } },
];

import { Routes } from '@angular/router';
import {inject} from '@angular/core';
import {PracticeExit} from './core/practice-exit.service';
import { AuthPageComponent } from './auth/auth-page.component';
import { TeachersPageComponent } from './admin/teachers-page.component';
import { NavigationPageComponent } from './layout/navigation-page.component';
import { homeGuard, requireRole } from './core/role.guard';
import { StudentsPageComponent } from './students/students-page.component';
import { StudentPageComponent } from './students/student-page.component';
import { DashboardComponent } from './student/dashboard.component';
const lessonRoutes: Routes = [
    ...[':studentId/lessons/:lessonId/:audience/practice/:detail',':studentId/lessons/:lessonId/:audience/practice'].map(path=>({path,loadComponent:()=>import('./practice/practice-page.component').then(module=>module.PracticePageComponent),canDeactivate:[()=>inject(PracticeExit).ask()]})),
    { path: ':studentId/lessons/:lessonId/:audience/:section/:detail', loadComponent:()=>import('./lessons/lesson-page.component').then(module=>module.LessonPageComponent) },
    { path: ':studentId/lessons/:lessonId/:audience/:section', loadComponent:()=>import('./lessons/lesson-page.component').then(module=>module.LessonPageComponent) },
    { path: ':studentId/lessons/:lessonId', loadComponent:()=>import('./lessons/lesson-page.component').then(module=>module.LessonPageComponent) },
];
const profileRoutes: Routes = [{ path: ':studentId/materials/:detail', component: StudentPageComponent, data: { section: 'materials' } }, ...['lessons', 'goal', 'roadmap', 'review', 'profile', 'projects', 'career', 'journal', 'materials'].map(section => ({ path: ':studentId/' + section, component: StudentPageComponent, data: { section } }))];
export const routes: Routes = [
    { path: '', pathMatch: 'full', component: NavigationPageComponent, canActivate: [homeGuard] },
    { path: 'login', component: AuthPageComponent },
    { path: 'register', component: AuthPageComponent, data: { mode: 'register' } },
    { path: 'reset-password', component: AuthPageComponent, data: { mode: 'reset' } },
    { path: 'account/password', component: AuthPageComponent, data: { mode: 'password' }, canActivate: [requireRole()] },
    { path: 'admin/teachers', component: TeachersPageComponent, canActivate: [requireRole('ADMIN')] },
    { path: 'teacher/students', canActivate: [requireRole('TEACHER')], children: [{ path: '', pathMatch: 'full', component: StudentsPageComponent }, ...lessonRoutes, ...profileRoutes, { path: ':studentId', component: StudentPageComponent }] },
    { path: 'learn', canActivate: [requireRole('STUDENT')], children: [{ path: '', pathMatch: 'full', component: DashboardComponent }, { path: 'students', children: [{ path: '', pathMatch: 'full', redirectTo: '/learn' }, ...lessonRoutes, ...profileRoutes, { path: ':studentId', component: DashboardComponent }] }] },
    { path: 'not-found', component: NavigationPageComponent, data: { missing: true } },
    { path: '**', component: NavigationPageComponent, data: { missing: true } },
];

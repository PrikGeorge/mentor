import { Routes } from '@angular/router';
import { AuthPageComponent } from './auth/auth-page.component';
import { TeachersPageComponent } from './admin/teachers-page.component';
import { NavigationPageComponent } from './layout/navigation-page.component';
import { homeGuard, requireRole } from './core/role.guard';
import { StudentsPageComponent } from './students/students-page.component';
import { StudentPageComponent } from './students/student-page.component';
import { LessonPageComponent } from './lessons/lesson-page.component';
import { DashboardComponent } from './student/dashboard.component';
const lessonRoutes: Routes = [
    { path: ':studentId/lessons/:lessonId/:audience/:section/:detail', component: LessonPageComponent },
    { path: ':studentId/lessons/:lessonId/:audience/:section', component: LessonPageComponent },
    { path: ':studentId/lessons/:lessonId', component: LessonPageComponent },
];
const profileRoutes: Routes = ['lessons', 'goal', 'roadmap', 'review', 'profile', 'projects', 'career', 'journal'].map(section => ({ path: ':studentId/' + section, component: StudentPageComponent, data: { section } }));
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

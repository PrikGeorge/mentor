import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ShellComponent } from '../layout/shell.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { routes } from '../app.routes';
import type { components } from '../api/schema';
export const student: components['schemas']['TeacherStudentView'] = { id: 's1', workspaceId: 'w1', userId: null, revision: 1, createdAt: '2026-10-01T10:00:00Z', name: 'Тестовая Анна', direction: 'Java', goal: 'Первая работа', schedule: 'Четверг', notes: 'Частные заметки', studentRoadmap: 'Индивидуальный маршрут', studentReview: 'Архивный отзыв' };
export const publicStudent: components['schemas']['PublicStudentView'] = (({ notes, ...rest }) => rest)(student);
export const lesson: components['schemas']['TeacherLessonView'] = { id: 'l1', workspaceId: 'w1', studentId: 's1', title: 'Коллекции', date: '2026-10-02', time: '12:00', timeZone: 'Europe/Moscow', duration: 60, status: 'planned', bundleId: null, revision: 1, createdAt: '2026-10-01T10:00:00Z', number: 1, teacherNotes: 'Частный сценарий', studentNotes: 'Задания Анны', reviewNotes: 'Отзыв этого занятия' };
export const publicLesson: components['schemas']['PublicLessonView'] = (({ teacherNotes, ...rest }) => rest)(lesson);
export const base = '/api/v1/workspaces/w1/students/s1';
export function configure() { TestBed.configureTestingModule({ imports: [ShellComponent], providers: [provideRouter(routes), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }); }
export async function open(path: string, role: 'TEACHER' | 'STUDENT' = 'TEACHER') {
    const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore);
    session.load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic-' + role, workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl(path);
    fixture.detectChanges();
    return { fixture, http, session, router: TestBed.inject(Router), element: fixture.nativeElement as HTMLElement };
}
export function page(items: unknown[], total = items.length) { return { items, page: 0, size: 25, total }; }
// Answers the homework-turn reads a card or dashboard issues alongside its main data; cancelled reads are left alone.
export function flushTurns(http: HttpTestingController, items: unknown[] = []) { http.match(request => request.url.endsWith('/homework/turns')).forEach(request => { if (!request.cancelled) request.flush({ items, page: 0, size: request.request.params.get('size') ? Number(request.request.params.get('size')) : 25, total: items.length }); }); flushJournal(http); }
// Side panels of a card (roadmap stages, moves journal, code comments) answer empty unless a test cares about them.
export function flushJournal(http: HttpTestingController) {
    http.match(request => request.url.endsWith('/roadmap') && request.method === 'GET').forEach(request => { if (!request.cancelled) request.flush({ stages: [], revision: 0 }); });
    http.match(request => request.url.endsWith('/moves')).forEach(request => { if (!request.cancelled) request.flush({ items: [], page: 0, size: Number(request.request.params.get('size') ?? 10), total: 0 }); });
    http.match(request => request.url.endsWith('/code-comments') && request.method === 'GET').forEach(request => { if (!request.cancelled) request.flush({ items: [] }); });
}
export function click(element: HTMLElement, text: string) { const button = Array.from(element.querySelectorAll('button')).find(button => button.textContent?.trim() === text); expect(button, `button ${text}`).toBeTruthy(); button!.click(); }
export function fill(element: HTMLElement, name: string, value: string) { const input = element.querySelector<HTMLInputElement>(`[name="${name}"]`)!; expect(input).toBeTruthy(); input.value = value; input.dispatchEvent(new Event('input')); }

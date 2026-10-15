import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type StudentView = components['schemas']['StudentView'];
export type StudentInput = components['schemas']['StudentInput'];
export type StudentUpdateInput = components['schemas']['StudentUpdateInput'];
export type StudentPage = components['schemas']['StudentPage'];
export type StudentAccessView = components['schemas']['StudentAccessView'];
export type Dashboard = components['schemas']['Dashboard'];
const students = '/workspaces/{workspaceId}/students' as const;
const student = '/workspaces/{workspaceId}/students/{studentId}' as const;
@Injectable({ providedIn: 'root' })
export class StudentsApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    // archived: undefined lists active cards (the server default), 'true' only archived ones, 'all' both.
    list(workspaceId: string, page = 0, preview = false, archived?: 'true' | 'all'): Observable<StudentPage> { return this.session.scope(this.api.get(students, { pathParams: { workspaceId }, query: { page, size: 25, ...(preview ? { audience: 'student' } : {}), ...(archived ? { archived } : {}) } })); }
    // The list screen's cards with lesson counts and focus lessons in one request (no per-card dashboard calls).
    dashboards(workspaceId: string, page = 0, archived?: 'true' | 'all'): Observable<components['schemas']['DashboardPage']> { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/dashboards', { pathParams: { workspaceId }, query: { page, size: 25, ...(archived ? { archived } : {}) } })); }
    load(workspaceId: string, studentId: string, preview = false): Observable<StudentView> { return this.session.scope(this.api.get(student, { pathParams: { workspaceId, studentId }, query: preview ? { audience: 'student' } : {} })); }
    save(workspaceId: string, studentId: string | null, input: StudentInput | Omit<StudentUpdateInput, 'revision'>, revision?: number): Observable<StudentView> {
        if (this.session.actor()?.role !== 'TEACHER')
            return throwError(() => new Error('Изменение доступно преподавателю.'));
        return this.session.scope(studentId ? this.api.patch(student, { ...input, revision: revision! }, { pathParams: { workspaceId, studentId } }) : this.api.post(students, input as StudentInput, { pathParams: { workspaceId } }));
    }
    access(workspaceId: string, studentId: string) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/access', { pathParams: { workspaceId, studentId } })); }
    changeAccess(workspaceId: string, studentId: string, disabled: boolean) { return this.session.scope(this.api.patch('/workspaces/{workspaceId}/students/{studentId}/access', { disabled }, { pathParams: { workspaceId, studentId } })); }
    invite(workspaceId: string, studentId: string) { return this.session.scope(this.api.post('/workspaces/{workspaceId}/students/{studentId}/invitations', {}, { pathParams: { workspaceId, studentId } })); }
    revoke(workspaceId: string, studentId: string, id: string) { return this.session.scope(this.api.delete('/workspaces/{workspaceId}/students/{studentId}/invitations/{id}', { pathParams: { workspaceId, studentId, id } })); }
    reset(workspaceId: string, studentId: string, currentPassword: string) { return this.session.scope(this.api.post('/workspaces/{workspaceId}/students/{studentId}/password-reset', { currentPassword }, { pathParams: { workspaceId, studentId } })); }
    dashboard(workspaceId: string, studentId: string, preview = false): Observable<Dashboard> { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/dashboard', { pathParams: { workspaceId, studentId }, query: preview ? { audience: 'student' } : {} })); }
}

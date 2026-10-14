import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, expand, map, reduce } from 'rxjs';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type MaterialSummary = components['schemas']['MaterialSummary'];
export type MaterialView = components['schemas']['MaterialView'];
export type MaterialSection = components['schemas']['MaterialSection'];
@Injectable({ providedIn: 'root' })
export class MaterialsApi {
    private readonly api = inject(PlatformApi); private readonly session = inject(SessionStore); private readonly http = inject(HttpClient);
    list(workspaceId: string, studentId: string, lessonId: string | null, page = 0, preview = false) {
        const query = { page, size: 25, ...(preview ? { audience: 'student' } : {}) };
        return this.session.scope(lessonId ? this.api.get('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/materials', { pathParams: { workspaceId, studentId, lessonId }, query }) : this.api.get('/workspaces/{workspaceId}/students/{studentId}/materials', { pathParams: { workspaceId, studentId }, query }));
    }
    catalog(workspace: string, student: string, lesson: string | null, preview = false) {
        // Logical legacy selectors and embedded source references may be beyond page1.
        return this.list(workspace, student, lesson, 0, preview).pipe(expand(page => page.items.length && (page.page + 1) * page.size < page.total ? this.list(workspace, student, lesson, page.page + 1, preview) : EMPTY), map(page => page.items), reduce((items, page) => [...items, ...page], [] as MaterialSummary[]));
    }
    load(workspaceId: string, materialId: string, preview = false) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/materials/{materialId}', { pathParams: { workspaceId, materialId }, query: preview ? { audience: 'student' } : {} })); }
    file(workspaceId: string, materialId: string, preview = false) { return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/materials/${encodeURIComponent(materialId)}/file${preview ? '?audience=student' : ''}`; }
    // Teacher authoring: one multipart form for a Markdown document or a downloadable file, bound to a lesson or to the card.
    create(workspaceId: string, studentId: string, lessonId: string | null, form: FormData) {
        const e = encodeURIComponent, path = lessonId ? `/workspaces/${e(workspaceId)}/students/${e(studentId)}/lessons/${e(lessonId)}/materials` : `/workspaces/${e(workspaceId)}/students/${e(studentId)}/materials`;
        return this.session.scope(this.http.post<MaterialSummary>('/api/v1' + path, form));
    }
    remove(workspaceId: string, materialId: string) { return this.session.scope(this.http.delete<void>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/materials/${encodeURIComponent(materialId)}`)); }
}

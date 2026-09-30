import { inject, Injectable } from '@angular/core';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type LessonView = components['schemas']['LessonView'];
export type LessonCreateInput = components['schemas']['LessonCreateInput'];
export type LessonMetadataInput = components['schemas']['LessonMetadataInput'];
export type LessonText = components['schemas']['LessonText'];
export type TextKind = components['schemas']['TextKind'];
const list = '/workspaces/{workspaceId}/students/{studentId}/lessons' as const;
const lesson = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}' as const;
const text = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/texts/{kind}' as const;
@Injectable({ providedIn: 'root' })
export class LessonsApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    list(workspaceId: string, studentId: string, page = 0, preview = false) { return this.session.scope(this.api.get(list, { pathParams: { workspaceId, studentId }, query: { page, size: 25, ...(preview ? { audience: 'student' } : {}) } })); }
    create(workspaceId: string, studentId: string, input: LessonCreateInput) { return this.session.scope(this.api.post(list, input, { pathParams: { workspaceId, studentId } })); }
    load(workspaceId: string, studentId: string, lessonId: string, preview = false) { return this.session.scope(this.api.get(lesson, { pathParams: { workspaceId, studentId, lessonId }, query: preview ? { audience: 'student' } : {} })); }
    save(workspaceId: string, studentId: string, lessonId: string, input: LessonMetadataInput) { return this.session.scope(this.api.patch(lesson, input, { pathParams: { workspaceId, studentId, lessonId } })); }
    text(workspaceId: string, studentId: string, lessonId: string, kind: TextKind, preview = false) { return this.session.scope(this.api.get(text, { pathParams: { workspaceId, studentId, lessonId, kind }, query: preview ? { audience: 'student' } : {} })); }
    saveText(workspaceId: string, studentId: string, lessonId: string, kind: TextKind, input: components['schemas']['LessonTextInput']) { return this.session.scope(this.api.put(text, input, { pathParams: { workspaceId, studentId, lessonId, kind } })); }
}

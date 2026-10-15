import { inject, Injectable } from '@angular/core';
import { defer, throwError } from 'rxjs';
import type { components, paths } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type ExerciseRevision = components['schemas']['ExerciseRevision'];
export type SourceFiles = components['schemas']['SourceFiles'];
export type Attempt = components['schemas']['Attempt'];
export type Draft = components['schemas']['Draft'];
export type PublicExercise = components['schemas']['PublicExercise'];
export type LessonPracticeView = components['schemas']['LessonPracticeView'];
export type AttemptInput = components['schemas']['AttemptEnqueue'];
export type AttemptIntent = {
    request: AttemptInput;
    key: string;
    attemptId?: string;
};
export type Mode = components['schemas']['Mode'];
export type HistoryEntry = components['schemas']['PracticeHistoryEntry'];
const root = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice' satisfies keyof paths;
const exercise = `${root}/exercises/{exerciseId}` as const;
@Injectable({ providedIn: 'root' })
export class PracticeApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    private params(lesson: LessonRef, id?: string) { return { workspaceId: lesson.workspaceId, studentId: lesson.studentId, lessonId: lesson.id, ...(id ? { exerciseId: id } : {}) }; }
    private options(lesson: LessonRef, id?: string, preview = false) { return { pathParams: this.params(lesson, id), query: preview ? { audience: 'student' } : undefined }; }
    catalog(workspaceId: string, preview = false, page = 0) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/exercises', { pathParams: { workspaceId }, query: { page, size: 100, ...(preview ? { audience: 'student' } : {}) } })); }
    // Executor availability for explaining a long queue; aggregates only.
    worker(workspaceId: string) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/practice/worker', { pathParams: { workspaceId } })); }
    practice(lesson: LessonRef, preview = false) { return this.session.scope(this.api.get(root, this.options(lesson, undefined, preview))); }
    assignments(lesson: LessonRef, input: components['schemas']['AssignmentsPut']) { return this.session.scope(this.api.put('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice/assignments', input, this.options(lesson))); }
    draft(lesson: LessonRef, id: string, preview = false) { return this.session.scope(this.api.get(`${exercise}/draft`, this.options(lesson, id, preview))); }
    saveDraft(lesson: LessonRef, id: string, input: components['schemas']['DraftPut']) { return this.session.scope(defer(() => this.student(lesson) ? this.api.put(`${exercise}/draft`, input, this.options(lesson, id)) : throwError(() => new Error('Только ученик может сохранять код.')))); }
    history(lesson: LessonRef, preview = false, page = 0) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice/history', { pathParams: this.params(lesson), query: { page, size: 100, ...(preview ? { audience: 'student' } : {}) } })); }
    archives(lesson: LessonRef, id: string, preview = false, page = 0) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice/draft-archives', { pathParams: this.params(lesson), query: { exerciseId: id, page, size: 25, ...(preview ? { audience: 'student' } : {}) } })); }
    archive(lesson: LessonRef, id: string, preview = false) { return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice/draft-archives/{archiveId}', { pathParams: { ...this.params(lesson), archiveId: id }, query: preview ? { audience: 'student' } : undefined })); }
    attempts(lesson: LessonRef, id: string, preview = false, page = 0) { return this.session.scope(this.api.get(`${exercise}/attempts`, { ...this.options(lesson, id, preview), query: { page, size: 25, ...(preview ? { audience: 'student' } : {}) } })); }
    detail(lesson: LessonRef, id: string, attemptId: string, preview = false) { return this.session.scope(this.api.get(`${exercise}/attempts/{attemptId}`, { pathParams: { ...this.params(lesson, id), attemptId }, query: preview ? { audience: 'student' } : undefined })); }
    enqueue(lesson: LessonRef, id: string, files: SourceFiles, exerciseRevision: ExerciseRevision, mode: Mode, key: string) { const input = { files, exerciseRevision, mode } satisfies AttemptInput; return this.session.scope(defer(() => this.student(lesson) ? this.api.post(`${exercise}/attempts`, input, { ...this.options(lesson, id), headers: { 'Idempotency-Key': key } }) : throwError(() => new Error('Только ученик может запустить решение.')))); }
    private student(lesson: LessonRef) { return this.session.actor()?.role === 'STUDENT' && this.session.actor()?.workspaceId === lesson.workspaceId; }
}
export function revisionKey(revision: ExerciseRevision) { return typeof revision === 'number' ? 'n:' + revision : 's:' + revision; }
export function filesError(files: SourceFiles, declared?: string[]): string | null { const names = Object.keys(files); if (!names.length || names.length > 16 || declared && (names.length !== declared.length || declared.some(name => !Object.hasOwn(files, name))))
    return 'Нужны все объявленные файлы упражнения.'; let total = 0; for (const [name, text] of Object.entries(files)) {
    if (!/^(?:[A-Za-z_$][A-Za-z0-9_$]*\/)*[A-Za-z_$][A-Za-z0-9_$]*\.java$/.test(name) || typeof text !== 'string' || text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text))
        return 'Некорректное имя или содержимое Java-файла.';
    const bytes = new TextEncoder().encode(text).length;
    total += bytes;
    if (bytes > 131072)
        return 'Каждый файл должен быть не больше 128 КиБ UTF-8.';
} return total > 262144 ? 'Исходники должны быть не больше 256 КиБ UTF-8.' : null; }

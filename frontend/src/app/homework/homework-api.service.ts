import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpResponse } from '@angular/common/http';
import { defer, EMPTY, filter, map, Observable, of, switchMap, throwError } from 'rxjs';
import type { components, paths } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type Submission = components['schemas']['Submission'];
export type ReviewStatus = components['schemas']['HomeworkReviewInput']['status'];
const historyPath = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/homework' satisfies keyof paths;
@Injectable({ providedIn: 'root' })
export class HomeworkApi {
    private readonly http = inject(HttpClient);
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    private params(lesson: LessonRef) { return { workspaceId: lesson.workspaceId, studentId: lesson.studentId, lessonId: lesson.id }; }
    private url(lesson: LessonRef) { return '/api/v1' + historyPath.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(this.params(lesson)[key as keyof ReturnType<HomeworkApi['params']>])); }
    list(lesson: LessonRef, page = 0) { return this.session.scope(this.api.get(historyPath, { pathParams: this.params(lesson), query: { page, size: 25 } })); }
    upload(lesson: LessonRef, file: File, comment: string, repositoryUrl: string, contextValid: () => boolean = () => true): Observable<HttpEvent<Submission>> {
        return defer(() => {
            if (this.session.actor()?.role !== 'STUDENT' || this.session.actor()?.workspaceId !== lesson.workspaceId) return throwError(() => new Error('Сдать работу может только ученик этого занятия.'));
            const invalid = validateHomework(file, comment, repositoryUrl);
            if (invalid) return throwError(() => new Error(invalid));
            const stamp = this.session.generation();
            const signature = /\.zip$/i.test(file.name) ? this.zipSignature(file) : of(true);
            return this.session.scope(signature.pipe(switchMap(valid => {
                if (!contextValid() || stamp !== this.session.generation()) return EMPTY;
                if (!valid) return throwError(() => new Error('Файл не содержит допустимую сигнатуру ZIP.'));
                const form = new FormData(); form.append('file', file, file.name); form.append('comment', comment.trim()); form.append('repositoryUrl', repositoryUrl.trim());
                // The browser supplies the multipart boundary; global interceptors retain actor/CSRF protection.
                return this.http.post<Submission>(this.url(lesson), form, { observe: 'events', reportProgress: true });
            })), stamp);
        });
    }
    submit(lesson: LessonRef, file: File, comment: string, repositoryUrl: string): Observable<Submission> {
        return this.upload(lesson, file, comment, repositoryUrl).pipe(filter((event): event is HttpResponse<Submission> => event instanceof HttpResponse && event.status === 201), map(response => response.body!));
    }
    review(lesson: LessonRef, id: string, revision: number, status: ReviewStatus, feedback: string): Observable<Submission> {
        return this.session.scope(this.api.patch('/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/homework/{submissionId}/review', { revision, status, feedback }, { pathParams: { ...this.params(lesson), submissionId: id } }));
    }
    download(lesson: LessonRef, id: string): Observable<Blob> { return this.session.scope(this.http.get(this.url(lesson) + '/' + encodeURIComponent(id) + '/file', { responseType: 'blob' })); }
    private zipSignature(file: File) {
        return new Observable<boolean>(subscriber => {
            const reader = new FileReader();
            reader.onload = () => { const b = new Uint8Array(reader.result as ArrayBuffer); subscriber.next(b.length === 4 && b[0] === 80 && b[1] === 75 && (b[2] === 3 && b[3] === 4 || b[2] === 5 && b[3] === 6 || b[2] === 7 && b[3] === 8)); subscriber.complete(); };
            reader.onerror = () => subscriber.error(new Error('Не удалось прочитать файл. Выберите его ещё раз.'));
            reader.readAsArrayBuffer(file.slice(0, 4));
            return () => { reader.onload = null; reader.onerror = null; if (reader.readyState === FileReader.LOADING) reader.abort(); };
        });
    }
}
export function validateHomework(file: File | null, comment: string, repositoryUrl: string): string | null {
    if (!file) return 'Выберите файл работы.';
    if (!file.size || file.size > 20971520) return 'Файл должен быть непустым и не больше 20 МиБ.';
    const name = file.name;
    if (!name || name.length > 180 || /[\u0000-\u001f\u007f\\/<>:"|?*]/.test(name) || /^\.|[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) return 'Недопустимое имя файла.';
    if (!/\.(zip|java|txt|md|pdf)$/i.test(name)) return 'Допустимы ZIP, Java, TXT, Markdown или PDF.';
    if (comment.length > 10000) return 'Комментарий должен быть не больше 10 000 символов.';
    if (repositoryUrl.length > 2000) return 'Адрес репозитория должен быть не больше 2 000 символов.';
    const url = repositoryUrl.trim();
    if (url) try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return 'Укажите HTTPS-адрес репозитория без логина и пароля.'; } catch { return 'Укажите корректный HTTPS-адрес репозитория.'; }
    return null;
}


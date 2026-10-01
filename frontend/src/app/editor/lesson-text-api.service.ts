import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../api/schema';
import { LessonsApi } from '../lessons/lessons-api.service';
export type LessonRef = Pick<components['schemas']['TeacherLessonView'], 'workspaceId' | 'studentId' | 'id'>;
export type TextKind = components['schemas']['TextKind'];
export type LessonText = components['schemas']['LessonText'];
@Injectable({ providedIn: 'root' })
export class LessonTextApi {
    private readonly api = inject(LessonsApi);
    save(lesson: LessonRef, kind: TextKind, markdown: string, revision: number): Observable<LessonText> {
        return this.api.saveText(lesson.workspaceId, lesson.studentId, lesson.id, kind, { markdown, revision });
    }
}

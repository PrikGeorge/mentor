import { inject, Injectable } from '@angular/core';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type Schedule = components['schemas']['Schedule'];
export type ScheduleItem = components['schemas']['ScheduleItem'];
export type StudentSchedule = components['schemas']['StudentSchedule'];
export type LessonSummary = components['schemas']['LessonSummary'];
@Injectable({ providedIn: 'root' })
export class ScheduleApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    // Lessons of every active card in an inclusive Moscow date window of one to 31 days.
    get(workspaceId: string, from: string, to: string) {
        return this.session.scope(this.api.get('/workspaces/{workspaceId}/schedule', { pathParams: { workspaceId }, query: { from, to } }));
    }
    // T23: one card's lessons in the same kind of window, for the student's calendar and the teacher's preview of it.
    student(workspaceId: string, studentId: string, from: string, to: string) {
        return this.session.scope(
            this.api.get('/workspaces/{workspaceId}/students/{studentId}/schedule', { pathParams: { workspaceId, studentId }, query: { from, to } })
        );
    }
}

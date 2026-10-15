import { inject, Injectable } from '@angular/core';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type Schedule = components['schemas']['Schedule'];
export type ScheduleItem = components['schemas']['ScheduleItem'];
@Injectable({ providedIn: 'root' })
export class ScheduleApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    // Lessons of every active card in an inclusive Moscow date window of one to 31 days.
    get(workspaceId: string, from: string, to: string) {
        return this.session.scope(this.api.get('/workspaces/{workspaceId}/schedule', { pathParams: { workspaceId }, query: { from, to } }));
    }
}

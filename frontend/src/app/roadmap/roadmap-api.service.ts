import { inject, Injectable } from '@angular/core';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
export type Roadmap = components['schemas']['Roadmap'];
export type RoadmapStage = components['schemas']['RoadmapStage'];
export type RoadmapStageInput = components['schemas']['RoadmapStageInput'];
const path = '/workspaces/{workspaceId}/students/{studentId}/roadmap';
@Injectable({ providedIn: 'root' })
export class RoadmapApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    get(workspaceId: string, studentId: string, preview = false) { return this.session.scope(this.api.get(path, { pathParams: { workspaceId, studentId }, query: preview ? { audience: 'student' } : {} })); }
    replace(workspaceId: string, studentId: string, stages: RoadmapStageInput[], revision: number) { return this.session.scope(this.api.put(path, { stages, revision }, { pathParams: { workspaceId, studentId } })); }
}
// "3 из 8": the current stage, or the last finished one when nothing is current.
export function stageProgress(stages: RoadmapStage[]): { position: number; total: number; title: string } | null {
    if (!stages.length) return null;
    let index = stages.findIndex(stage => stage.state === 'current');
    if (index < 0) index = stages.map(stage => stage.state).lastIndexOf('done');
    return index < 0 ? null : { position: index + 1, total: stages.length, title: stages[index].title };
}

import { computed, inject, Injectable, signal, untracked } from '@angular/core';
import { SessionStore } from '../core/session.store';
import type { StudentView } from '../students/students-api.service';
import type { LessonView } from '../lessons/lessons-api.service';
export interface WorkspaceSelection {
    student: StudentView;
    lesson?: LessonView;
    base: string;
    preview: boolean;
    page: string;
    learner: boolean;
}
@Injectable({ providedIn: 'root' })
export class WorkspaceContext {
    private readonly session = inject(SessionStore);
    private readonly selection = signal<{
        generation: number;
        owner: object;
        value: WorkspaceSelection;
    } | null>(null);
    readonly current = computed(() => this.selection()?.generation === this.session.generation() ? this.selection()!.value : null);
    set(owner: object, value: WorkspaceSelection) { this.selection.set({ generation: this.session.generation(), owner, value }); }
    clear(owner: object) { if (untracked(this.selection)?.owner === owner)
        this.selection.set(null); }
}

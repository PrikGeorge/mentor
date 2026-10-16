import { computed, DestroyRef, Directive, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { WorkspaceContext } from '../layout/workspace-context';
import { errorMessage } from '../core/api-error';
// Shared route/identity context. Domain DTOs remain aliases of the generated schema.
@Directive()
export abstract class DomainPage {
    protected readonly session = inject(SessionStore);
    protected readonly scope = createBoundScope();
    protected readonly route = inject(ActivatedRoute);
    protected readonly destroyRef = inject(DestroyRef);
    protected readonly context = inject(WorkspaceContext);
    protected readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
    protected readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
    readonly workspaceId = computed(() => this.session.actor()?.workspaceId ?? null);
    readonly studentId = computed(() => this.params().get('studentId'));
    readonly lessonId = computed(() => this.params().get('lessonId'));
    protected readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
    readonly section = computed(() => this.params().get('section') ?? this.data()['section'] ?? '');
    readonly preview = computed(() => this.session.actor()?.role === 'TEACHER' && (this.query().get('preview') === 'student' || this.params().get('audience') === 'student'));
    readonly learner = computed(() => this.session.actor()?.role === 'STUDENT' || this.preview());
    readonly editable = computed(() => this.scope.current() && this.session.actor()?.role === 'TEACHER' && !this.preview());
    readonly base = computed(() => `${this.session.actor()?.role === 'STUDENT' ? '/learn/students' : '/teacher/students'}/${encodeURIComponent(this.studentId() ?? '')}`);
    readonly previewQuery = computed(() => this.preview() ? { preview: 'student' } : {});
    constructor() { this.destroyRef.onDestroy(() => this.context.clear(this)); }
    protected message(error: unknown): string { return errorMessage(error, 'Не удалось загрузить или сохранить данные.'); }
}

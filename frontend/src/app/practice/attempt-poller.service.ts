import { inject, Injectable } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { PracticeApi, Attempt } from './practice-api.service';
import { SessionStore } from '../core/session.store';
@Injectable({ providedIn: 'root' })
export class AttemptPoller {
    private readonly api = inject(PracticeApi);
    private readonly session = inject(SessionStore);
    watch(lesson: LessonRef, exercise: string, id: string, preview = false): Observable<Attempt> { const owner = this.session.generation(); return this.session.scope(new Observable<Attempt>(subscriber => { let timer: ReturnType<typeof setTimeout> | undefined, request: Subscription | undefined, failures = 0; const poll = () => { if (subscriber.closed || owner !== this.session.generation())
        return; request = this.api.detail(lesson, exercise, id, preview).subscribe({ next: attempt => { failures = 0; subscriber.next(attempt); if (['completed', 'failed'].includes(attempt.jobState))
            subscriber.complete();
        else
            timer = setTimeout(poll, 2000); }, error: error => { if (error.status === 0 || error.status >= 500) {
            timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** Math.min(++failures, 4)));
        }
        else
            subscriber.error(error); } }); }; poll(); return () => { clearTimeout(timer); request?.unsubscribe(); }; }), owner); }
}

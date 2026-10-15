import { Component, Injectable, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { components } from '../api/schema';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
import { GradeComponent } from '../homework/grade.component';

export type Move = components['schemas']['Move'];
@Injectable({ providedIn: 'root' })
export class MovesApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    list(workspaceId: string, studentId: string, size: number, lessonId: string | null = null, preview = false) {
        return this.session.scope(this.api.get('/workspaces/{workspaceId}/students/{studentId}/moves', { pathParams: { workspaceId, studentId }, query: { page: 0, size, ...(lessonId ? { lessonId } : {}), ...(preview ? { audience: 'student' } : {}) } }));
    }
}
const ATTEMPT: Record<string, string> = { accepted: 'все проверки пройдены', wrong_answer: 'есть неверный ответ', compile_error: 'ошибка компиляции', runtime_error: 'ошибка выполнения', time_limit: 'превышено время', error: 'проверка недоступна', unavailable: 'проверка недоступна', queued: 'в очереди', running: 'выполняется', failed: 'проверка недоступна' };
// What happened, in the words of the move's author.
export function moveAction(move: Move): string {
    switch (move.kind) {
        case 'homework': return (move.ordinal ?? 1) > 1 ? 'сдана версия ' + move.ordinal : 'сдана работа';
        case 'review': return move.status === 'needs_revision' ? 'нужна доработка' : move.status === 'reviewed' ? 'работа принята' : 'отзыв';
        case 'attempt': return (move.detail === 'run' ? 'примеры в тренажёре' : 'проверка в тренажёре') + (move.total ? ' · тесты ' + move.passed + ' из ' + move.total : move.status ? ' · ' + (ATTEMPT[move.status] ?? move.status) : '');
        default: return 'занятие проведено';
    }
}

let next = 0;
@Component({ selector: 'mentor-moves', imports: [DatePipe, RouterLink, GradeComponent], template: `
<section class="moves-block" [attr.aria-labelledby]="id">
  <div class="sh"><div class="title-group"><h2 [id]="id">{{heading()}}</h2>@if(total()){<span class="count">{{countLabel()}}</span>}</div></div>
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
  @if(items().length){<ol class="moves">@for(move of items();track move.kind+move.refId+move.at){<li [class.teacher]="move.side==='teacher'">
    <span class="piece" aria-hidden="true"></span>
    <time [attr.datetime]="move.at">{{move.at|date:'dd.MM.yyyy, HH:mm':'+0300'}}</time>
    <div class="what"><p><b>{{who(move)}}</b> · {{action(move)}}@if(move.grade){ <mentor-grade [grade]="move.grade"/>}</p>
      @if(move.subject){<p class="subject">{{move.subject}}</p>}
      @if(move.detail&&move.kind!=='attempt'){<q>{{move.detail}}</q>}
      @if(!lessonId()){<a class="text-link" [routerLink]="link(move)" [queryParams]="preview()?{preview:'student'}:{}">{{move.lessonTitle}}</a>}</div>
  </li>}</ol>
  @if(hasMore()){<button class="btn sm mt-16" type="button" (click)="more()">Показать ещё</button>}}
  @else if(loaded()&&!error()){<p class="small-muted m-0">{{learner()?'Ходов пока нет: здесь появятся сданные работы, попытки в тренажёре и отзывы наставника.':'Ходов пока нет: здесь появятся работы ученика, попытки в тренажёре и ваши отзывы.'}}</p>}
  @else if(!error()){<p class="loading" role="status">Загружаем ходы…</p>}
</section>` })
export class MovesComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly base = input.required<string>();
    readonly name = input('');
    readonly learner = input(false);
    readonly preview = input(false);
    readonly lessonId = input<string | null>(null);
    readonly size = input(10);
    readonly heading = input('Ходы');
    readonly id = 'moves-title-' + (++next);
    private readonly api = inject(MovesApi);
    private readonly session = inject(SessionStore);
    private readonly extra = signal(0);
    readonly limit = computed(() => Math.min(100, this.size() + this.extra()));
    readonly items = signal<Move[]>([]);
    readonly total = signal(0);
    readonly loaded = signal(false);
    readonly error = signal('');
    readonly action = moveAction;
    readonly hasMore = computed(() => this.items().length < this.total() && this.limit() < 100);
    readonly countLabel = computed(() => this.items().length < this.total() ? 'последние ' + this.items().length + ' из ' + this.total() : 'всего ' + this.total());
    constructor() {
        effect(onCleanup => {
            this.session.generation(); const w = this.workspaceId(), s = this.studentId(), lesson = this.lessonId(), preview = this.preview(), size = this.limit();
            this.error.set('');
            const sub = this.api.list(w, s, size, lesson, preview).subscribe({ next: page => { this.items.set(page.items); this.total.set(page.total); this.loaded.set(true); }, error: () => { this.loaded.set(true); this.error.set('Не удалось загрузить ходы.'); } });
            onCleanup(() => sub.unsubscribe());
        });
    }
    more() { this.extra.update(v => v + 20); }
    // The learner and the teacher preview see "Ты"; the teacher sees the student's name and "Вы".
    who(move: Move) { const pupil = this.learner() || this.preview(); return move.side === 'student' ? (pupil ? 'Ты' : this.name() || 'Ученик') : pupil ? 'Наставник' : 'Вы'; }
    link(move: Move) {
        const root = this.base() + '/lessons/' + move.lessonId;
        if (this.learner() || this.preview()) return root + '/student/' + ({ homework: 'homework', review: 'review', attempt: 'practice', conducted: 'tasks' } as Record<string, string>)[move.kind];
        return move.kind === 'attempt' ? root + '/teacher/practice' : move.kind === 'conducted' ? root : root + '/teacher/review';
    }
}

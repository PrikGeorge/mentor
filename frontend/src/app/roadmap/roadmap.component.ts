import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionStore } from '../core/session.store';
import { IconComponent } from '../core/icon.component';
import { Roadmap, RoadmapApi, RoadmapStage, RoadmapStageInput, stageProgress } from './roadmap-api.service';

type State = RoadmapStage['state'];
@Component({ selector: 'mentor-roadmap', imports: [IconComponent], template: `
<section class="roadmap" aria-labelledby="roadmap-title">
  <div class="sh"><div class="title-group"><h2 id="roadmap-title">Этапы маршрута</h2>@if(progress();as p){<span class="count">этап {{p.position}} из {{p.total}}</span>}</div>
    @if(canEdit()&&!draft()&&view()){<button class="btn sm edit-stages" type="button" (click)="edit()"><mentor-icon name="pencil"/>{{view()!.stages.length?'Изменить этапы':'Наметить этапы'}}</button>}</div>
  @if(error()){<div class="shell-error"><p class="auth-error" role="alert">{{error()}}</p>@if(stale()){<button class="btn sm" type="button" (click)="reload()"><mentor-icon name="refresh"/>Загрузить актуальный маршрут</button>}</div>}
  @if(draft();as rows){
    <form class="stage-editor" (submit)="save($event)" [attr.aria-busy]="busy()">
      <ol>@for(row of rows;track $index;let i=$index){<li>
        <span class="n" aria-hidden="true">{{i+1}}</span>
        <label class="auth-field">Этап {{i+1}}<input [value]="row.title" (input)="set(i,'title',$event)" maxlength="200" required></label>
        <label class="auth-field">Пометка<input [value]="row.note??''" (input)="set(i,'note',$event)" maxlength="120" placeholder="Например: март 2027"></label>
        <label class="auth-field">Статус<select [value]="row.state" (change)="set(i,'state',$event)"><option value="done">Пройден</option><option value="current">Сейчас</option><option value="ahead">Впереди</option></select></label>
        <div class="row-tools"><button class="btn sm icon-only" type="button" (click)="move(i,-1)" [disabled]="i===0||busy()" [attr.aria-label]="'Поднять этап '+(i+1)"><mentor-icon name="chevron-up"/></button><button class="btn sm icon-only" type="button" (click)="move(i,1)" [disabled]="i===rows.length-1||busy()" [attr.aria-label]="'Опустить этап '+(i+1)"><mentor-icon name="chevron-down"/></button><button class="btn sm icon-only danger" type="button" (click)="remove(i)" [disabled]="busy()" [attr.aria-label]="'Убрать этап '+(i+1)"><mentor-icon name="x"/></button></div>
      </li>}</ol>
      <div class="form-actions"><button class="btn sm" type="button" (click)="add()" [disabled]="rows.length>=30||busy()"><mentor-icon name="plus"/>Добавить этап</button><span class="spacer"></span><button class="btn" type="button" (click)="cancel()" [disabled]="busy()">Отмена</button><button class="btn primary" type="submit" [disabled]="busy()"><mentor-icon [name]="busy()?'loader':'save'" [class.spin]="busy()"/>Сохранить маршрут</button></div>
    </form>
  } @else if(view();as v){
    @if(v.stages.length){<ol class="stages">@for(stage of v.stages;track $index;let i=$index){<li [class]="stage.state" [attr.aria-current]="stage.state==='current'?'step':null"><span class="mark" aria-hidden="true">@if(stage.state==='done'){<mentor-icon name="check"/>}@else{<span>{{i+1}}</span>}</span><span class="title">{{stage.title}}</span><span class="lead" aria-hidden="true"></span><span class="state">{{label(stage)}}</span></li>}</ol>}
    @else{<div class="empty-state"><h3>Этапы ещё не намечены</h3><p>{{canEdit()?'Разбейте путь к цели на этапы — ученик увидит их у себя и будет знать, где он сейчас.':'Наставник наметит этапы пути к твоей цели.'}}</p></div>}
  } @else if(!error()){<p class="loading" role="status">Загружаем маршрут…</p>}
</section>` })
export class RoadmapComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly preview = input(false);
    readonly editable = input(false);
    private readonly api = inject(RoadmapApi);
    private readonly session = inject(SessionStore);
    private readonly owner = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    private readonly refresh = signal(0);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    readonly view = signal<Roadmap | null>(null);
    readonly draft = signal<RoadmapStageInput[] | null>(null);
    readonly error = signal('');
    readonly stale = signal(false);
    readonly busy = signal(false);
    readonly progress = computed(() => stageProgress(this.view()?.stages ?? []));
    readonly canEdit = computed(() => this.editable() && !this.preview() && this.owner === this.session.generation() && this.session.actor()?.role === 'TEACHER');
    constructor() {
        effect(onCleanup => {
            this.session.generation(); const w = this.workspaceId(), s = this.studentId(), preview = this.preview(); this.refresh();
            this.view.set(null); this.draft.set(null); this.error.set(''); this.stale.set(false);
            const sub = this.api.get(w, s, preview).subscribe({ next: view => this.view.set(view), error: e => this.error.set(e.error?.message ?? 'Не удалось загрузить маршрут.') });
            onCleanup(() => sub.unsubscribe());
        });
    }
    label(stage: RoadmapStage) { const word = stage.state === 'done' ? 'пройдено' : stage.state === 'current' ? 'сейчас' : ''; return [word, stage.note].filter(Boolean).join(', ') || 'впереди'; }
    reload() { this.refresh.update(v => v + 1); }
    edit() { if (!this.canEdit()) return; this.draft.set((this.view()?.stages ?? []).map(stage => ({ ...stage }))); this.focus('.stage-editor input, .stage-editor button'); }
    cancel() { this.draft.set(null); this.error.set(''); this.focus('.edit-stages'); }
    // A closed form must not drop keyboard focus onto the page body.
    private focus(selector: string) { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector }); }
    add() { this.draft.update(rows => rows && rows.length < 30 ? [...rows, { title: '', note: '', state: 'ahead' }] : rows); }
    remove(index: number) { this.draft.update(rows => rows ? rows.filter((_, i) => i !== index) : rows); }
    move(index: number, step: number) { this.draft.update(rows => { if (!rows) return rows; const next = [...rows], target = index + step; if (target < 0 || target >= next.length) return rows; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
    // Only one stage can be current: earlier ones become passed, later ones stay ahead.
    set(index: number, field: 'title' | 'note' | 'state', event: Event) {
        const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
        this.draft.update(rows => rows ? rows.map((row, i) => i === index ? { ...row, [field]: value } : field === 'state' && value === 'current' && row.state === 'current' ? { ...row, state: (i < index ? 'done' : 'ahead') as State } : row) : rows);
    }
    save(event: Event) {
        event.preventDefault(); const rows = this.draft(), view = this.view();
        if (!rows || !view || !this.canEdit() || this.busy()) return;
        if (rows.some(row => !row.title.trim())) { this.error.set('У каждого этапа должно быть название.'); return; }
        this.busy.set(true); this.error.set(''); this.stale.set(false);
        this.api.replace(this.workspaceId(), this.studentId(), rows.map(row => ({ title: row.title.trim(), note: (row.note ?? '').trim(), state: row.state })), view.revision).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: saved => { this.busy.set(false); this.view.set(saved); this.draft.set(null); this.focus('.edit-stages'); },
            error: e => { this.busy.set(false); this.stale.set(e.status === 409); this.error.set(e.status === 409 ? 'Маршрут уже изменили в другой вкладке. Ваши правки остались в форме — загрузите актуальный маршрут и повторите.' : e.error?.message ?? 'Не удалось сохранить маршрут.'); },
        });
    }
}

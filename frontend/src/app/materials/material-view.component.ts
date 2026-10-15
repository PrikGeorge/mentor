import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMPTY, forkJoin, map, of, switchMap } from 'rxjs';
import type { components } from '../api/schema';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { MaterialsApi, MaterialView, MaterialSummary } from './materials-api.service';
import { DocumentNavigationComponent } from './document-navigation.component';
import { LegacyHtmlComponent } from './legacy-blocks.component';
import { MaterialFormComponent } from './material-form.component';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { FileSizePipe } from '../core/file-size.pipe';
@Component({ selector: 'mentor-material-view', imports: [RouterLink, DocumentNavigationComponent, LegacyHtmlComponent, MaterialFormComponent, IconComponent, ErrorBannerComponent, FileSizePipe], template: `
@if(error()){<mentor-error-banner [message]="error()" retryLabel="Повторить загрузку" (retry)="refresh.update(increment)"/>}
@if(loading()){<p class="loading" role="status">Загружаем материалы…</p>}
@if(selected();as material){
  <section class="material-document"><p class="eyebrow">@if(material.audience==='teacher'){<span class="vis private"><mentor-icon name="eye-off"/>Только вам</span>}@else{Учебный материал}</p><h2>{{displayTitle(material)}}</h2>
  @switch(material.kind){
    @case('doc'){<div class="doc-layout"><div class="doc-main"><mentor-legacy-html [html]="material.document.intro" [base]="base()" [preview]="preview()" [targets]="targets()"/>
      @for(section of material.document.sections;track section.id){<section class="doc-section" [id]="section.id"><h3 tabindex="-1">{{section.title}}</h3>
      @for(part of studentParts(section.studentParts);track part){<a class="text-link" [routerLink]="base()+'/student/tasks'" [queryParams]="base().startsWith('/teacher')?{preview:'student'}:{}" [fragment]="'section-'+(part-1)">Открыть часть {{part}} ученика →</a>}
      <mentor-legacy-html [html]="section.html" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/></section>}
      @if(!material.document.sections.length){<mentor-legacy-html [html]="material.document.html" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/>}
      @if(!publicView()&&profileFacts()){<section class="profile-facts"><h3>Наблюдения наставника</h3><mentor-legacy-html [html]="profileFacts()" [base]="base()" [targets]="targets()"/></section>}
      <details class="raw-material-source"><summary>Исходный Markdown · только для чтения</summary><pre><code>{{material.document.raw}}</code></pre></details>
      </div><mentor-document-navigation [sections]="material.document.sections"/></div>}
    @case('code'){@if(!publicView()||!material.code.teacher){<p class="callout">Исходная заготовка · только для чтения. Сохранённое решение открывается в тренажёре.</p><pre class="code-view"><code>{{material.code.text}}</code></pre><a class="btn" [href]="api.file(workspaceId(),material.code.materialId,preview())" download><mentor-icon name="download"/>Скачать {{material.filename}}</a>}@else{<p>Исходная заготовка недоступна.</p>}}
    @case('download'){<p>Файл <code>{{material.filename}}</code> · {{material.blob.size|fileSize}}</p><a class="btn" [href]="api.file(workspaceId(),material.id,preview())" download><mentor-icon name="download"/>Скачать комплект</a>}
    @case('view'){
      @if(material.viewData.goalHtml){<section>@if(displayTitle(material)!=='Цель обучения'){<h3>Цель обучения</h3>}<mentor-legacy-html [html]="material.viewData.goalHtml||''" [base]="base()" [preview]="preview()" [targets]="targets()"/></section>}
            @if(!publicView()){
        @if(material.viewData.profileFacts){<section><h3>Навыки и наблюдения</h3><mentor-legacy-html [html]="material.viewData.profileFacts||''" [base]="base()" [targets]="targets()"/></section>}
        @if(material.viewData.lessonHtml){<section><h3>Сценарий занятия</h3><mentor-legacy-html [html]="material.viewData.lessonHtml||''" [base]="base()" [targets]="targets()"/></section>}
        @if(material.viewData.reviewHtml){<section><h3>Ревью занятия</h3><mentor-legacy-html [html]="material.viewData.reviewHtml||''" [base]="base()" [targets]="targets()"/></section>}
      }
      @for(descriptor of descriptors(material);track descriptor.key){<article class="resource-card"><p class="eyebrow">{{descriptor.values[0]}}</p><h3>{{resourceMaterial(descriptor.key)?displayTitle(resourceMaterial(descriptor.key)!):descriptor.key}}</h3><p>{{descriptor.values[1]}}</p>@if(resourceMaterial(descriptor.key);as linked){<a class="text-link" [routerLink]="routeFor(linked)" [queryParams]="preview()?{preview:'student'}:{}">Открыть →</a>}</article>}
      @for(resource of material.viewData.resources||[];track $index){@if(resourceMaterial(resource[0]);as linked){<article class="resource-card"><p class="eyebrow">{{resource[1]}}</p><h3>{{resource[2]}}</h3><p>{{resource[3]}}</p><a class="text-link" [routerLink]="routeFor(linked)" [fragment]="resource[0]==='answers'?'material-answers':undefined" [queryParams]="preview()?{preview:'student'}:{}">Открыть →</a></article>}}
            @if(!publicView()){@if(material.viewData.answersCards?.length){<section id="material-answers"><h3>Эталоны и подсказки</h3>@for(card of material.viewData.answersCards||[];track $index){<article class="resource-card"><p class="eyebrow">JAVA / ЭТАЛОН</p><h4>{{card[1]}}</h4><p>{{card[2]}}</p>@if(answerMaterial(card[0]);as linked){<a class="text-link" [routerLink]="routeFor(linked)">Посмотреть код →</a>}</article>}</section>}}
    }
  }
  @if(downloads().length){<div class="doc-tools">@for(download of downloads();track download.id){<a class="btn" [href]="api.file(workspaceId(),download.id,preview())" download><mentor-icon name="download"/>{{download.title||download.filename}}</a>}</div>}
  </section>
}@else if(!loading()&&!error()){
  @if(section()==='materials'&&!detail()&&editable()){@defer (on immediate) {<mentor-material-form class="mb-16" [workspaceId]="workspaceId()" [studentId]="studentId()" [lessonId]="lessonId()" (saved)="changedMaterials()"/>} @placeholder {<p class="loading" role="status">Загружаем форму материалов…</p>}}
  @if(removeError()){<mentor-error-banner [message]="removeError()"/>}
  @if(section()==='materials'&&!detail()&&groups().length){<div class="material-groups">@for(group of groups();track group.audience){<section class="material-group" [class.private]="group.audience==='teacher'" [attr.aria-label]="group.title"><header class="sh"><h2>{{group.title}}</h2><p class="small-muted">{{group.hint}}</p></header>
    @for(part of group.parts;track part.title){<h3 class="material-part">{{part.title}}</h3><ul class="material-list">@for(item of part.items;track item.id){<li class="material-item">@if(item.kind==='download'){<a class="material-row" [href]="api.file(workspaceId(),item.id,preview())" download><span class="material-kind">ZIP</span><span class="material-text"><strong>{{displayTitle(item)}}</strong><small>{{item.filename}}</small></span><span class="material-go" aria-hidden="true"><mentor-icon name="download"/></span></a>}@else{<a class="material-row" [routerLink]="routeFor(item)" [queryParams]="preview()?{preview:'student'}:{}"><span class="material-kind">{{kindLabel(item)}}</span><span class="material-text"><strong>{{displayTitle(item)}}</strong>@if(roleLabel(item);as role){<small>{{role}}</small>}@else if(item.kind==='code'&&item.title!==item.filename){<small>{{item.filename}}</small>}</span><span class="material-go" aria-hidden="true"><mentor-icon name="chevron-right"/></span></a>}
      @if(editable()){@if(pendingRemoval()===item.id){<span class="material-confirm" role="group" aria-label="Подтверждение удаления" tabindex="-1"><span class="small-muted">Удалить?</span><button class="btn sm danger" type="button" (click)="remove(item)" [disabled]="removing()">Удалить</button><button class="btn sm text" type="button" (click)="cancelRemoval(item)" [disabled]="removing()">Отмена</button></span>}@else{<button class="btn sm text material-remove" type="button" [attr.data-remove]="item.id" (click)="askRemoval(item)" [attr.aria-label]="'Удалить '+displayTitle(item)" [disabled]="removing()"><mentor-icon name="trash-2"/></button>}}</li>}</ul>}
  </section>}</div>}
  @else if(!(section()==='materials'&&!detail()&&editable())){<div class="empty-state"><h3>Материалы пока не добавлены</h3><p>Здесь появятся документы, код и файлы к занятиям.</p></div>}
  @else{<p class="small-muted">Материалов пока нет. Добавьте первый документ или файл выше.</p>}
}` })
export class MaterialViewComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly lessonId = input<string | null>(null);
    readonly section = input('materials');
    readonly detail = input<string | null>(null);
    readonly base = input.required<string>();
    readonly preview = input(false);
    readonly learner = input(false);
    // The owning teacher adds and removes materials in the listing; every change is reported so the lesson can refresh its status.
    readonly editable = input(false);
    readonly changed = output<void>();
    readonly pendingRemoval = signal<string | null>(null); readonly removing = signal(false); readonly removeError = signal('');
    readonly api = inject(MaterialsApi);
    private readonly session = inject(SessionStore);
    private readonly scope = createBoundScope(() => [this.workspaceId(), this.studentId(), this.lessonId(), this.section(), this.detail(), this.preview(), this.learner(), this.base()]);
    readonly items = signal<MaterialSummary[]>([]);
    readonly selected = signal<MaterialView | null>(null);
    readonly downloads = signal<MaterialSummary[]>([]);
    readonly error = signal('');
    readonly loading = signal(false);
    readonly refresh = signal(0);
    readonly increment = (value: number) => value + 1;
    readonly profileFacts = signal('');
    readonly code = signal<Record<string, components['schemas']['MaterialCode']>>({});
    private readonly studentIds = signal<Set<string>>(new Set());
    constructor() {
        effect(onCleanup => {
            this.session.generation(); const workspace = this.workspaceId(), student = this.studentId(), lesson = this.lessonId(), section = this.section(), detail = this.detail(), preview = this.preview();
            this.refresh();
            this.scope.bind(); const current = this.scope.capture();
            this.selected.set(null);
            this.items.set([]);
            this.downloads.set([]);
            this.code.set({});
            this.profileFacts.set('');
            this.studentIds.set(new Set());
            this.error.set('');
            this.loading.set(false);
            this.pendingRemoval.set(null); this.removing.set(false); this.removeError.set('');
            if (!this.scope.current() || this.session.actor()?.workspaceId !== workspace)
                return;
            this.loading.set(true);
            const listing = section === 'materials' && !detail;
            const catalog = this.scope.track(this.api.catalog(workspace, student, lesson, preview));
            const source = listing ? catalog.pipe(switchMap(items => { this.items.set(items.filter(item => this.inScope(item))); return of(null); })) :catalog.pipe(switchMap(items => {
                if (!current())
                    return EMPTY;
                const scoped = items.filter(item => this.inScope(item));
                this.items.set(scoped);
                this.downloads.set(scoped.filter(item => item.kind === 'download'));
                const keys = detail ? [detail] : section === 'roadmap' ? [this.publicView() ? 'student-roadmap' : 'roadmap'] : section === 'tasks' ? ['student'] : section === 'plan' ? ['lesson'] : section === 'review' ? ['review', 'student-review'] : [section];
                const summary = keys.map(key => this.resourceMaterial(key)).find(Boolean);
                if (summary)
                    return this.api.load(workspace, summary.id, preview);
                if (detail)
                    return of(null);
                const field = section === 'goal' ? 'goalHtml' : section === 'plan' ? 'lessonHtml' : section === 'review' ? 'reviewHtml' : section === 'answers' ? 'answersCards' : null;
                const views = field ? scoped.filter(item => item.kind === 'view' && (field === 'goalHtml' ? item.audience === 'student' : !this.publicView() && item.audience === 'teacher')) : [];
                return views.length ? forkJoin(views.map(item => this.api.load(workspace, item.id, preview))).pipe(map(loaded => loaded.find(item => item.kind === 'view' && !!item.viewData[field as keyof components['schemas']['MaterialViewData']]) ?? null)) : of(null);
            }));
            const sub = this.scope.track(source.pipe(switchMap(material => {
                if (!current())
                    return EMPTY;
                this.selected.set(material && this.inScope(material) ? material : null);
                this.loading.set(false);
                if (material?.kind !== 'doc')
                    return of(null);
                const html = material.document.html + material.document.intro + material.document.sections.map(section => section.html).join('');
                const names = new Set(Array.from(html.matchAll(/<!--\s*task-code:(\w+):(prediction|practice)\s*-->/g), match => match[1]));
                const records = this.items().filter(item => item.kind === 'code' && item.contentKey && names.has(item.contentKey));
                const studentDoc = this.items().find(item => item.kind === 'doc' && item.contentKey === 'student');
                const needsParts = material.document.sections.some(section => section.studentParts?.some(part => part > 0));
                const requests = records.map(item => this.api.load(workspace, item.id, preview));
                if (studentDoc && needsParts)
                    requests.push(this.api.load(workspace, studentDoc.id, true));
                if (material.contentKey === 'profile' && !this.publicView())
                    requests.push(...this.items().filter(item => item.kind === 'view' && item.audience === 'teacher' && this.inScope(item)).map(item => this.api.load(workspace, item.id, preview)));
                return requests.length ? forkJoin(requests) : of([] as MaterialView[]);
            }))).subscribe({ next: related => {
                    if (!related)
                        return;
                    const code: Record<string, components['schemas']['MaterialCode']> = {};
                    for (const item of related) {
                        if (item.kind === 'view' && this.inScope(item) && !this.publicView() && item.viewData.profileFacts)
                            this.profileFacts.set(item.viewData.profileFacts);
                        if (item.kind === 'code' && item.contentKey && (!this.learner() || !item.code.teacher))
                            code[item.contentKey] = item.code;
                        if (item.kind === 'doc' && item.contentKey === 'student')
                            this.studentIds.set(new Set(item.document.sections.map(section => section.id)));
                    }
                    this.code.set(code);
                }, error: error => {
                    this.loading.set(false);
                    this.error.set(error.error?.message ?? 'Не удалось загрузить материалы.');
                } });
            onCleanup(() => sub.unsubscribe());
        });
    }
    studentParts(parts?: number[]) { return parts?.filter(part => Number.isInteger(part) && part > 0 && this.studentIds().has('section-' + (part - 1))) ?? []; }
    publicView() { return this.learner() || this.preview() || this.session.actor()?.role === 'STUDENT'; }
    private inScope(item: MaterialSummary) { return item.workspaceId === this.workspaceId() && item.studentId === this.studentId() && item.lessonId === this.lessonId() && (!this.publicView() || item.audience === 'student'); }
    resourceMaterial(key: string) {
        const items = this.items().filter(item => this.inScope(item)), exact = items.find(item => item.id === key);
        if (exact)
            return exact;
        const logical = items.filter(item => item.contentKey === key);
        if (logical.length === 1)
            return logical[0];
        const selected = this.selected();
        return key === 'answers' && !this.publicView() && selected?.kind === 'view' && selected.viewData.answersCards?.length ? selected : undefined;
    }
    answerMaterial(key: string) { const item = this.resourceMaterial(key); return item?.kind === 'code' && item.audience === 'teacher' && !this.publicView() ? item : undefined; }
    descriptors(material: MaterialView) { return material.kind === 'view' ? Object.entries(material.viewData.descriptors ?? {}).map(([key, values]) => ({ key, values })) : []; }
    displayTitle(material: MaterialSummary) { return material.kind === 'view' ? material.lessonId ? material.audience === 'teacher' ? 'План и ревью занятия' : 'Материалы занятия' : material.audience === 'teacher' ? 'Наблюдения наставника' : 'Цель обучения' : material.title || material.filename; }
    readonly targets = computed(() => Object.fromEntries(this.items().filter(item => this.inScope(item) && item.contentKey && this.resourceMaterial(item.contentKey)?.id === item.id).map(item => [item.contentKey!, this.routeFor(item)])));
    readonly groups = computed(() => {
        const items = this.items().filter(item => this.inScope(item));
        return (['student', 'teacher'] as const).map(audience => {
            const own = items.filter(item => item.audience === audience);
            // A code file already offers its own download, so the twin download entry is noise.
            const code = new Set(own.filter(item => item.kind === 'code').map(item => item.filename));
            const parts = [
                { title: 'Документы', items: own.filter(item => item.kind === 'doc' || item.kind === 'view').sort((a, b) => rank(a) - rank(b) || this.displayTitle(a).localeCompare(this.displayTitle(b), 'ru')) },
                { title: 'Код', items: own.filter(item => item.kind === 'code').sort((a, b) => a.filename.localeCompare(b.filename)) },
                { title: 'Архивы и файлы', items: own.filter(item => item.kind === 'download' && !code.has(item.filename)) }
            ].filter(part => part.items.length);
            return { audience, title: audience === 'student' ? 'Видно ученику' : 'Только вам', hint: audience === 'student' ? 'То, что ученик видит в своём кабинете.' : 'Сценарий преподавателя и эталоны. Ученику не видны.', parts };
        }).filter(group => group.parts.length);
    });
    changedMaterials() { this.pendingRemoval.set(null); this.removeError.set(''); this.refresh.update(this.increment); this.changed.emit(); }
    // Removing is a two-step action; keyboard focus moves onto the confirmation and back to the trash button on cancel.
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    askRemoval(item: MaterialSummary) { if (!this.scope.active() || !this.inScope(item)) return; this.pendingRemoval.set(item.id); this.focus('.material-confirm'); }
    cancelRemoval(item: MaterialSummary) { this.pendingRemoval.set(null); this.focus(`[data-remove="${CSS.escape(item.id)}"]`); }
    private focus(selector: string) { const current = this.scope.capture(); afterNextRender(() => { if (current()) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); }, { injector: this.injector }); }
    remove(item: MaterialSummary) {
        if (!this.editable() || this.publicView() || this.removing() || !this.scope.active() || !this.inScope(item) || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; this.removing.set(true); this.removeError.set('');
        this.scope.track(this.api.remove(this.workspaceId(), item.id)).subscribe({ next: () => { this.removing.set(false); this.changedMaterials(); }, error: error => { this.removing.set(false); this.removeError.set(error.error?.message ?? 'Не удалось удалить материал.'); } });
    }
    kindLabel(item: MaterialSummary) { return item.kind === 'code' ? 'JAVA' : item.kind === 'view' ? 'СВОДКА' : 'MD'; }
    roleLabel(item: MaterialSummary) { return item.contentKey ? ROLES[item.contentKey] ?? '' : ''; }
    routeFor(item: MaterialSummary) { return this.lessonId() ? `${this.base()}/${this.learner() ? 'student' : 'teacher'}/materials/${encodeURIComponent(item.id)}` : `${this.base()}/materials/${encodeURIComponent(item.id)}`; }
}
const ROLES: Record<string, string> = { student: 'Задания на занятие', homework: 'Домашняя работа', 'student-materials': 'Материалы занятия', review: 'Ревью домашней работы', 'student-review': 'Ревью домашней работы', 'student-roadmap': 'Маршрут обучения', lesson: 'Сценарий преподавателя', guide: 'Подробный сценарий', source: 'Описание комплекта', roadmap: 'Маршрут обучения', profile: 'Профиль ученика' };
const ORDER = ['student', 'homework', 'student-materials', 'review', 'student-review', 'student-roadmap', 'lesson', 'guide', 'source', 'roadmap', 'profile'];
function rank(item: MaterialSummary) { const index = item.contentKey ? ORDER.indexOf(item.contentKey) : -1; return index < 0 ? ORDER.length : index; }

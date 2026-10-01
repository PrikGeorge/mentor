import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMPTY, forkJoin, map, of, switchMap } from 'rxjs';
import type { components } from '../api/schema';
import { SessionStore } from '../core/session.store';
import { MaterialsApi, MaterialView, MaterialSummary } from './materials-api.service';
import { DocumentNavigationComponent } from './document-navigation.component';
import { LegacyHtmlComponent } from './legacy-blocks.component';
@Component({ selector: 'mentor-material-view', imports: [RouterLink, DocumentNavigationComponent, LegacyHtmlComponent], template: `
@if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" type="button" (click)="refresh.update(increment)">Повторить загрузку</button>}
@if(loading()){<p role="status">Загружаем материалы…</p>}
@if(selected();as material){
  <section class="material-document panel panel-inner"><p class="eyebrow">{{material.audience==='teacher'?'ТОЛЬКО ДЛЯ ПРЕПОДАВАТЕЛЯ':'УЧЕБНЫЙ МАТЕРИАЛ'}}</p><h2>{{displayTitle(material)}}</h2>
  @switch(material.kind){
    @case('doc'){<div class="doc-layout"><div class="doc-main"><mentor-legacy-html [html]="material.document.intro" [base]="base()" [preview]="preview()" [targets]="targets()"/>
      @for(section of material.document.sections;track section.id){<section class="doc-section" [id]="section.id"><h3 tabindex="-1">{{section.title}}</h3>
      @for(part of studentParts(section.studentParts);track part){<a class="text-link" [routerLink]="base()+'/student/tasks'" [queryParams]="base().startsWith('/teacher')?{preview:'student'}:{}" [fragment]="'section-'+(part-1)">Открыть часть {{part}} ученика →</a>}
      <mentor-legacy-html [html]="section.html" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/></section>}
      @if(!material.document.sections.length){<mentor-legacy-html [html]="material.document.html" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/>}
      @if(!publicView()&&profileFacts()){<section class="profile-facts"><h3>Наблюдения наставника</h3><mentor-legacy-html [html]="profileFacts()" [base]="base()" [targets]="targets()"/></section>}
      <details class="raw-material-source"><summary>Исходный Markdown · только для чтения</summary><pre><code>{{material.document.raw}}</code></pre></details>
      </div><mentor-document-navigation [sections]="material.document.sections"/></div>}
    @case('code'){@if(!publicView()||!material.code.teacher){<p class="callout">Исходная заготовка · Только для чтения. Сохранённое решение открывается в тренажёре.</p><pre class="code-view"><code>{{material.code.text}}</code></pre><a class="btn" [href]="api.file(workspaceId(),material.code.materialId,preview())" download>↓ Скачать {{material.filename}}</a>}@else{<p>Исходная заготовка недоступна.</p>}}
    @case('download'){<p>Файл {{material.filename}} · {{material.blob.size}} байт</p><a class="btn" [href]="api.file(workspaceId(),material.id,preview())" download>↓ Скачать комплект</a>}
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
  @if(downloads().length){<div class="doc-tools">@for(download of downloads();track download.id){<a class="btn" [href]="api.file(workspaceId(),download.id,preview())" download>↓ {{download.title||download.filename}}</a>}</div>}
  </section>
}@else if(!loading()&&!error()){
  @if(section()==='materials'&&!detail()&&items().length){<div class="resource-grid">@for(item of items();track item.id){<article class="panel panel-inner"><p class="eyebrow">{{item.audience==='teacher'?'ДЛЯ ПРЕПОДАВАТЕЛЯ':'МАТЕРИАЛ'}}</p><h3>{{displayTitle(item)}}</h3><a class="btn" [routerLink]="routeFor(item)" [queryParams]="preview()?{preview:'student'}:{}">Открыть →</a></article>}</div>}
  @else{<p class="empty-state">Материалы пока не добавлены.</p>}
  @if(section()==='materials'&&!detail()){<nav class="pagination" aria-label="Страницы материалов"><button class="btn" type="button" [disabled]="page()===0" (click)="page.set(page()-1)">Назад</button><span>Страница {{page()+1}}</span><button class="btn" type="button" [disabled]="(page()+1)*25>=total()" (click)="page.set(page()+1)">Далее</button></nav>}
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
    readonly api = inject(MaterialsApi);
    private readonly session = inject(SessionStore);
    private readonly owner = this.session.generation();
    private readonly destroyRef = inject(DestroyRef);
    readonly items = signal<MaterialSummary[]>([]);
    readonly selected = signal<MaterialView | null>(null);
    readonly downloads = signal<MaterialSummary[]>([]);
    readonly page = signal(0);
    readonly total = signal(0);
    readonly error = signal('');
    readonly loading = signal(false);
    readonly refresh = signal(0);
    readonly increment = (value: number) => value + 1;
    readonly profileFacts = signal('');
    readonly code = signal<Record<string, components['schemas']['MaterialCode']>>({});
    private readonly studentIds = signal<Set<string>>(new Set());
    private alive = true;
    constructor() {
        this.destroyRef.onDestroy(() => this.alive = false);
        effect(onCleanup => {
            const generation = this.session.generation(), workspace = this.workspaceId(), student = this.studentId(), lesson = this.lessonId(), section = this.section(), detail = this.detail(), preview = this.preview(), page = this.page();
            this.refresh();
            this.selected.set(null);
            this.items.set([]);
            this.downloads.set([]);
            this.code.set({});
            this.profileFacts.set('');
            this.studentIds.set(new Set());
            this.error.set('');
            this.loading.set(false);
            if (generation !== this.owner || this.session.actor()?.workspaceId !== workspace)
                return;
            this.loading.set(true);
            const listing = section === 'materials' && !detail;
            const source = listing ? this.api.list(workspace, student, lesson, page, preview).pipe(switchMap(result => { this.items.set(result.items.filter(item => this.inScope(item))); this.total.set(result.total); return of(null); })) : this.api.catalog(workspace, student, lesson, preview).pipe(switchMap(items => {
                if (!this.alive || generation !== this.session.generation())
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
            const sub = source.pipe(switchMap(material => {
                if (!this.alive || generation !== this.session.generation())
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
            })).subscribe({ next: related => {
                    if (!related || !this.alive || generation !== this.session.generation())
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
                    if (this.alive && generation === this.session.generation()) {
                        this.loading.set(false);
                        this.error.set(error.error?.message ?? 'Не удалось загрузить материалы.');
                    }
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
    routeFor(item: MaterialSummary) { return this.lessonId() ? `${this.base()}/${this.learner() ? 'student' : 'teacher'}/materials/${encodeURIComponent(item.id)}` : `${this.base()}/materials/${encodeURIComponent(item.id)}`; }
}

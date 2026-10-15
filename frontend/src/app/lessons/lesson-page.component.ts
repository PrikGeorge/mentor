import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, merge, skip, takeUntil } from 'rxjs';
import { DomainPage } from '../students/domain-page';
import { StudentsApi, StudentView } from '../students/students-api.service';
import { LessonsApi, LessonView, LessonText, TextKind } from './lessons-api.service';
import { LessonFormComponent } from './lesson-form.component';
import { MarkdownEditorComponent } from '../editor/markdown-editor.component';
import { MarkdownRenderer } from '../editor/markdown-renderer.service';
import { MaterialViewComponent } from '../materials/material-view.component';
import { HomeworkPageComponent } from '../homework/homework-page.component';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { readResource } from '../core/read-resource';
import { lessonEnded } from './lesson-status';
@Component({ selector: 'mentor-lesson-page', imports: [RouterLink, LessonFormComponent, MarkdownEditorComponent, MaterialViewComponent, HomeworkPageComponent, IconComponent, ErrorBannerComponent], template: `
  @if(error()){<mentor-error-banner [message]="error()" retryLabel="Повторить загрузку" (retry)="reload()"/>}
  @if(lesson();as l){
    @if(editable()&&!editingText()){<div class="lesson-page-actions"><button class="btn sm" (click)="editingMetadata.set(true);copying.set(false);closeText()"><mentor-icon name="pencil"/>Изменить занятие</button><button class="btn sm" (click)="copying.set(true);editingMetadata.set(false);closeText()"><mentor-icon name="copy"/>Создать на основе</button><button class="btn sm" [class.primary]="!l.conductedAt&&isPast(l)" (click)="markConducted(!l.conductedAt)" [disabled]="busy()"><mentor-icon [name]="l.conductedAt?'rotate-ccw':'check-check'"/>{{l.conductedAt?'Снять отметку «Проведено»':'Отметить проведённым'}}</button>@if(!l.conductedAt&&ended(l)){<span class="small-muted conducted-hint">Занятие прошло — отметьте, если оно состоялось.</span>}<a class="btn sm text" [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a>
      @if(deleting()){<span class="inline-confirm" role="group" aria-label="Подтверждение удаления занятия" tabindex="-1"><span class="small-muted">Удалить занятие «{{l.title}}»? Только без работ и материалов.</span><button class="btn sm danger" type="button" (click)="deleteLesson()" [disabled]="busy()">Удалить</button><button class="btn sm text" type="button" (click)="deleting.set(false);focus('.delete-lesson')" [disabled]="busy()">Отмена</button></span>}@else{<button class="btn sm text delete-lesson" type="button" (click)="deleting.set(true);focus('.inline-confirm')" [disabled]="busy()"><mentor-icon name="trash-2"/>Удалить занятие</button>}</div>}
    @if(copiedFrom();as number){<p class="success-banner" role="status">Занятие создано на основе № {{number}}. Добавьте материалы, когда будут готовы.</p>}
    @if(editable()&&editingMetadata()){<div class="section-block"><mentor-lesson-form [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lesson]="l" (saved)="savedMetadata($event)" (cancel)="editingMetadata.set(false)"/></div>}
    @if(editable()&&copying()){<div class="section-block"><mentor-lesson-form [workspaceId]="workspaceId()!" [studentId]="studentId()!" [source]="l" (saved)="createdCopy($event, l.number)" (cancel)="copying.set(false)"/></div>}
    @if(editable()&&editingText();as text){<section class="section-block"><mentor-markdown-editor [lesson]="l" [kind]="text.kind" [revision]="text.revision" [value]="text.markdown" (saved)="savedText($event)" (cancelled)="closeText()"/></section>}
    @if(!section()){
      <section class="lesson-preparation section-block" aria-labelledby="prep-title"><div class="sh"><h2 id="prep-title">Подготовка занятия</h2><small>Добавляйте материалы по мере готовности. Дата и время уже сохранены.</small></div>
        <ol class="prep">
          @if(editable()){<li><span class="n" [class.done]="!!teacherNotes()" [class.priv]="!teacherNotes()">@if(teacherNotes()){<mentor-icon name="check"/><span class="visually-hidden">Готово</span>}@else{<span>1</span>}</span><div><h3>Сценарий преподавателя <span class="vis private"><mentor-icon name="eye-off"/>Только вам</span></h3><p>План, вопросы и подсказки для ведения занятия.</p><p class="fact">{{teacherNotes()?'Сценарий добавлен':'Пока не добавлен'}}</p></div>
            <div class="go"><button class="btn sm" [class.primary]="!teacherNotes()" (click)="openText('teacherNotes')" [disabled]="busy()"><mentor-icon [name]="teacherNotes()?'pencil':'plus'"/>{{teacherNotes()?'Изменить сценарий':'Добавить сценарий'}}</button>@if(teacherNotes()){<a class="btn sm text" [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">Открыть сценарий</a>}</div></li>}
          <li><span class="n" [class.done]="!!l.studentNotes">@if(l.studentNotes){<mentor-icon name="check"/><span class="visually-hidden">Готово</span>}@else{<span>2</span>}</span><div><h3>Задания ученика <span class="vis public"><mentor-icon name="eye"/>Видно ученику</span></h3><p>Условия задач, инструкции и учебные материалы.</p><p class="fact">{{l.studentNotes?'Задания добавлены':'Пока не добавлены'}}</p></div>
            <div class="go">@if(editable()){<button class="btn sm" [class.primary]="!l.studentNotes&&!!teacherNotes()" (click)="openText('studentNotes')" [disabled]="busy()"><mentor-icon [name]="l.studentNotes?'pencil':'plus'"/>{{l.studentNotes?'Изменить задания':'Добавить задания'}}</button>}</div></li>
          <li><span class="n"><span>3</span></span><div><h3>Тренажёр</h3><p>Упражнения занятия и автоматическая проверка кода.</p></div>
            <div class="go"><a class="btn sm" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/practice'" [queryParams]="previewQuery()">Открыть тренажёр<mentor-icon name="arrow-right"/></a></div></li>
          <li><span class="n" [class.done]="l.status==='prepared'">@if(l.status==='prepared'){<mentor-icon name="check"/><span class="visually-hidden">Готово</span>}@else{<span>4</span>}</span><div><h3>Материалы и комплект</h3><p>Документы, код и файлы к занятию. Первый материал переводит занятие в «Подготовлено».</p><p class="fact">{{l.status==='prepared'?'Подготовлено: ученик видит материалы с пометкой «Видно ученику»':'Запланировано: материалы скрыты от ученика'}}</p></div>
            <div class="go"><a class="btn sm" [class.primary]="editable()&&l.status!=='prepared'" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/materials'" [queryParams]="previewQuery()">{{editable()?'Добавить материалы':'Открыть материалы'}}<mentor-icon name="arrow-right"/></a>@if(editable()){<button class="btn sm text" type="button" (click)="setStatus(l.status==='prepared'?'planned':'prepared')" [disabled]="busy()"><mentor-icon [name]="l.status==='prepared'?'eye-off':'eye'"/>{{l.status==='prepared'?'Скрыть от ученика':'Опубликовать ученику'}}</button>}</div></li>
        </ol>
        <p class="prep-foot"><a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/review'" [queryParams]="previewQuery()">Ревью занятия →</a></p></section>
    }@else if(l.bundleId && l.status==='prepared' && section()!=='practice'){
      @if(['guide','plan','tasks','review'].includes(section())&&(currentText()||editable())){<section class="section-block text-section"><div class="sh mb-16"><div class="title-group"><h2>{{additionTitle()}}</h2></div>@if(visibility();as v){<span class="vis" [class.private]="v==='private'" [class.public]="v==='public'"><mentor-icon [name]="v==='private'?'eye-off':'eye'"/>{{v==='private'?'Только вам':'Видно ученику'}}</span>}</div>
        @if(currentText()){<div class="markdown-body lesson-source" [innerHTML]="currentHtml()"></div>}@else{<p class="small-muted">Дополнений пока нет.</p>}
        @if(editable()){<div class="actions"><button class="btn sm" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon [name]="currentText()?'pencil':'plus'"/>{{currentText()?'Изменить дополнения':'Добавить '+additionTitle().toLowerCase()}}</button></div>}</section>}
      <mentor-material-view [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lessonId]="l.id" [section]="section()" [detail]="detail()" [base]="base()+'/lessons/'+l.id" [preview]="preview()" [learner]="learner()" [editable]="editable()" (changed)="reload()"/>}
    @else if(['guide','plan','tasks','review'].includes(section())){
      <section class="section-block text-section"><div class="sh mb-16"><div class="title-group"><h2>{{section()==='review'?'Ревью занятия':learner()?'Задания на занятие':'Сценарий преподавателя'}}</h2></div>@if(visibility();as v){<span class="vis" [class.private]="v==='private'" [class.public]="v==='public'"><mentor-icon [name]="v==='private'?'eye-off':'eye'"/>{{v==='private'?'Только вам':'Видно ученику'}}</span>}</div>
        @if(section()==='review'){<p class="subtitle mb-16">Ревью относится к этому занятию и его домашней работе.</p>}
        @if(currentText()){<div class="markdown-body lesson-source" [innerHTML]="currentHtml()"></div>
          @if(editable()){<div class="actions"><button class="btn sm" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon name="pencil"/>{{section()==='review'?'Изменить отзыв':learner()?'Изменить задания':'Изменить сценарий'}}</button></div>}}
        @else{<div class="empty-state" [class.private]="visibility()==='private'"><h3>{{section()==='review'?'Ревью пока нет':learner()?'Заданий пока нет':'Сценария пока нет'}}</h3><p>{{emptyText()}}</p>@if(editable()){<button class="btn primary" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon name="plus"/>{{section()==='review'?'Добавить ревью':learner()?'Добавить задания':'Добавить сценарий'}}</button>}</div>}</section>
    }@else if(section()==='materials'||section()==='code'||section()==='answers'){<mentor-material-view [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lessonId]="l.id" [section]="section()" [detail]="detail()" [base]="base()+'/lessons/'+l.id" [preview]="preview()" [learner]="learner()" [editable]="editable()" (changed)="reload()"/>}@else if(section()!=='homework'){<section class="empty-state"><h2>{{sectionLabels[section()]||'Материалы'}}</h2><p>Для этого занятия материалы появятся отдельно от материалов других учеников.</p></section>}
    @if(section()==='homework'||section()==='review'){<mentor-homework-page [lesson]="l" [due]="l.homeworkDue ?? null" [preview]="preview()" [mode]="section()==='review'?'review':'homework'" [studentName]="student()?.name??''"/>}
    @if(busy()){<p class="loading" role="status">Сохраняем или загружаем текст…</p>}@if(textError()&&!editingText()){<mentor-error-banner [message]="textError()"/>}
  }@else if(!error()){<p class="loading" role="status">Загружаем занятие…</p>}` })
export class LessonPageComponent extends DomainPage {
    readonly renderer = inject(MarkdownRenderer);
    readonly detail = computed(() => this.params().get('detail'));
    private readonly students = inject(StudentsApi);
    private readonly api = inject(LessonsApi);
    private readonly refresh = signal(0);
    private readonly routeChanges = merge(this.route.paramMap.pipe(skip(1)), this.route.queryParamMap.pipe(skip(1)));
    readonly student = signal<StudentView | null>(null);
    readonly lesson = signal<LessonView | null>(null);
    readonly error = signal('');
    readonly textError = signal('');
    readonly busy = signal(false);
    readonly editingMetadata = signal(false);
    readonly copying = signal(false);
    readonly copiedFrom = signal<number | null>(null);
    private readonly location = inject(Location);
    readonly editingText = signal<LessonText | null>(null);
    readonly textLabels = { teacherNotes: 'Сценарий занятия', studentNotes: 'Задания ученика', reviewNotes: 'Ревью занятия' };
    readonly sectionLabels: Record<string, string> = { practice: 'Тренажёр', homework: 'Домашняя работа', materials: 'Материалы', answers: 'Эталоны', code: 'Учебный код' };
    private readonly pageParams = computed(() => {
        const workspace = this.workspaceId(), student = this.studentId(), lesson = this.lessonId();
        return workspace && student && lesson
            ? { workspace, student, lesson, preview: this.preview(), section: this.section(), base: this.base(), learner: this.learner(), refresh: this.refresh() }
            : undefined;
    });
    private readonly pageResource = readResource({
        scope: this.scope,
        params: this.pageParams,
        load: ({ workspace, student, lesson, preview }) => forkJoin({
            student: this.students.load(workspace, student, preview),
            lesson: this.api.load(workspace, student, lesson, preview),
        }),
    });
    constructor() {
        super();
        effect(() => {
            this.scope.current(); this.pageParams();
            untracked(() => { this.closeText(); this.editingMetadata.set(false); this.copying.set(false); this.busy.set(false); });
        });
        effect(() => {
            const state = this.pageResource.state();
            untracked(() => {
                this.lesson.set(state.status === 'resolved' ? state.value.lesson : null);
                // T05: the router keeps the copy notice in history state, bound to the new lesson so it never shows elsewhere.
                const notice = this.location.getState() as { copiedFrom?: number; copiedLesson?: string } | null;
                this.copiedFrom.set(state.status === 'resolved' && notice?.copiedLesson === state.value.lesson.id && typeof notice.copiedFrom === 'number' ? notice.copiedFrom : null);
                this.student.set(state.status === 'resolved' ? state.value.student : null);
                this.error.set(state.status === 'error' ? this.message(state.error) : '');
                if (state.status === 'resolved') {
                    const { base, preview, learner, section } = state.params;
                    this.context.set(this, { student: state.value.student, lesson: state.value.lesson, base, preview, learner, page: section });
                } else this.context.clear(this);
            });
        });
    }
    reload() { this.refresh.update(v => v + 1); }
    // FE-08/FE-09: the template reads these as signals; Markdown is rendered once per text change, not on every check.
    readonly teacherNotes = computed(() => { const l = this.lesson(); return l && 'teacherNotes' in l ? l.teacherNotes : ''; });
    readonly currentKind = computed<TextKind>(() => this.section() === 'review' ? 'reviewNotes' : this.learner() ? 'studentNotes' : 'teacherNotes');
    readonly currentText = computed(() => this.currentKind() === 'teacherNotes' ? this.teacherNotes() : this.lesson()?.[this.currentKind() as 'studentNotes' | 'reviewNotes']);
    readonly currentHtml = computed(() => { const text = this.currentText(); return text ? this.renderer.render(text) : ''; });
    readonly additionTitle = computed(() => this.section() === 'review' ? 'Дополнения к ревью' : this.learner() ? 'Дополнения к заданиям' : 'Дополнения к сценарию');
    readonly visibility = computed<'private' | 'public' | null>(() => { const section = this.section(); return section === 'guide' || section === 'plan' || section === 'answers' ? 'private' : section === 'tasks' || section === 'review' ? 'public' : null; });
    readonly emptyText = computed(() => this.section() === 'review' ? 'Общее ревью пока не добавлено: здесь появятся итоги занятия и следующие шаги.' : this.learner() ? 'Задания и материалы этого занятия ещё не добавлены.' : 'Сценарий этого занятия ещё не добавлен. Опишите ход занятия, вопросы и подсказки — ученик этот текст не увидит.');
    closeText() { this.editingText.set(null); this.textError.set(''); }
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    // Keyboard focus follows the confirmation block: onto it when it opens, back to the trigger when it closes.
    focus(selector: string) { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector }); }
    isPast(lesson: LessonView) { return Date.parse(`${lesson.date}T${lesson.time}:00+03:00`) < Date.now(); }
    // T16: after the lesson has ended without the mark, the teacher sees a gentle reminder next to the button.
    ended(lesson: LessonView) { return lessonEnded(lesson); }
    // The teacher's explicit mark; the metadata revision guards it like any other lesson change.
    markConducted(conducted: boolean) { const l = this.lesson(); if (!this.editable() || this.busy() || !l)
        return; this.busy.set(true); this.textError.set(''); this.api.save(this.workspaceId()!, this.studentId()!, l.id, { revision: l.revision, conducted }).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: lesson => { this.busy.set(false); this.savedMetadata(lesson); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    readonly deleting = signal(false);
    private readonly router = inject(Router);
    // Only an empty lesson goes; the server keeps anything with works, materials or drafts and says so.
    deleteLesson() { const l = this.lesson(); if (!this.editable() || this.busy() || !l)
        return; this.busy.set(true); this.textError.set(''); this.api.remove(this.workspaceId()!, this.studentId()!, l.id).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: () => { this.busy.set(false); this.deleting.set(false); void this.router.navigateByUrl(this.base()); }, error: e => { this.busy.set(false); this.deleting.set(false); this.textError.set(e?.status === 409 ? 'Занятие нельзя удалить: в нём есть работы, материалы или черновики. Удалите их или оставьте занятие как историю.' : this.message(e)); } }); }
    // prepared publishes the lesson's materials to the student; planned hides them again. The bundle survives either way.
    setStatus(status: 'planned' | 'prepared') { const l = this.lesson(); if (!this.editable() || this.busy() || !l)
        return; this.busy.set(true); this.textError.set(''); this.api.save(this.workspaceId()!, this.studentId()!, l.id, { revision: l.revision, status }).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: lesson => { this.busy.set(false); this.savedMetadata(lesson); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    openText(kind: TextKind) { if (!this.editable() || this.busy())
        return; this.busy.set(true); this.textError.set(''); this.editingMetadata.set(false); this.api.text(this.workspaceId()!, this.studentId()!, this.lessonId()!, kind).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: text => { this.editingText.set(text); this.busy.set(false); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    savedText(saved: LessonText) { if (!this.editable()) return; this.lesson.update(lesson => lesson ? { ...lesson, [saved.kind]: saved.markdown } : null); this.closeText(); }
    // The copy may belong to another card; its own page opens with a one-time notice.
    createdCopy(lesson: LessonView, number: number) { if (!this.editable()) return; this.copying.set(false); void this.router.navigate(['/teacher/students', lesson.studentId, 'lessons', lesson.id], { state: { copiedFrom: number, copiedLesson: lesson.id } }); }
    savedMetadata(lesson: LessonView) { if (!this.editable())
        return; this.lesson.set(lesson); this.editingMetadata.set(false); this.context.set(this, { student: this.student()!, lesson, base: this.base(), preview: false, learner: false, page: this.section() }); }
}

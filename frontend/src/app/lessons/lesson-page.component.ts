import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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
@Component({ selector: 'mentor-lesson-page', imports: [RouterLink, LessonFormComponent, MarkdownEditorComponent, MaterialViewComponent, HomeworkPageComponent, IconComponent], template: `
  @if(error()){<div class="shell-error"><p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()"><mentor-icon name="refresh"/>Повторить загрузку</button></div>}
  @if(lesson();as l){
    @if(editable()&&!editingText()){<div class="lesson-page-actions"><button class="btn sm" (click)="editingMetadata.set(true);closeText()"><mentor-icon name="pencil"/>Изменить занятие</button><button class="btn sm" [class.primary]="!l.conductedAt&&isPast(l)" (click)="markConducted(!l.conductedAt)" [disabled]="busy()"><mentor-icon [name]="l.conductedAt?'rotate-ccw':'check-check'"/>{{l.conductedAt?'Снять отметку «Проведено»':'Отметить проведённым'}}</button><a class="btn sm text" [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a></div>}
    @if(editable()&&editingMetadata()){<div class="section-block"><mentor-lesson-form [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lesson]="l" (saved)="savedMetadata($event)" (cancel)="editingMetadata.set(false)"/></div>}
    @if(editable()&&editingText();as text){<section class="section-block"><mentor-markdown-editor [lesson]="l" [kind]="text.kind" [revision]="text.revision" [value]="text.markdown" (saved)="savedText($event)" (cancelled)="closeText()"/></section>}
    @if(!section()){
      <section class="lesson-preparation section-block" aria-labelledby="prep-title"><div class="prep-head"><h2 id="prep-title">Подготовка занятия</h2><span class="small-muted">Добавляйте материалы по мере готовности. Дата и время уже сохранены.</span></div>
        <ol class="prep">
          @if(editable()){<li><span class="n" [class.done]="!!teacherNotes()" [class.priv]="!teacherNotes()">@if(teacherNotes()){<mentor-icon name="check"/><span class="visually-hidden">Готово</span>}@else{<span>1</span>}</span><div><h3>Сценарий преподавателя <span class="vis private"><mentor-icon name="eye-off"/>Только вам</span></h3><p>План, вопросы и подсказки для ведения занятия.</p><p class="fact">{{teacherNotes()?'Сценарий добавлен':'Пока не добавлен'}}</p></div>
            <div class="go"><button class="btn sm" [class.primary]="!teacherNotes()" (click)="openText('teacherNotes')" [disabled]="busy()"><mentor-icon [name]="teacherNotes()?'pencil':'plus'"/>{{teacherNotes()?'Изменить сценарий':'Добавить сценарий'}}</button>@if(teacherNotes()){<a class="btn sm text" [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">Открыть сценарий</a>}</div></li>}
          <li><span class="n" [class.done]="!!l.studentNotes">@if(l.studentNotes){<mentor-icon name="check"/><span class="visually-hidden">Готово</span>}@else{<span>2</span>}</span><div><h3>Задания ученика <span class="vis public"><mentor-icon name="eye"/>Видно ученику</span></h3><p>Условия задач, инструкции и учебные материалы.</p><p class="fact">{{l.studentNotes?'Задания добавлены':'Пока не добавлены'}}</p></div>
            <div class="go">@if(editable()){<button class="btn sm" [class.primary]="!l.studentNotes&&!!teacherNotes()" (click)="openText('studentNotes')" [disabled]="busy()"><mentor-icon [name]="l.studentNotes?'pencil':'plus'"/>{{l.studentNotes?'Изменить задания':'Добавить задания'}}</button>}</div></li>
          <li><span class="n"><span>3</span></span><div><h3>Тренажёр</h3><p>Задачи занятия и автоматическая проверка кода.</p></div>
            <div class="go"><a class="btn sm" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/practice'" [queryParams]="previewQuery()">Открыть тренажёр<mentor-icon name="arrow-right"/></a></div></li>
        </ol>
        <p class="prep-foot"><a class="text-link" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/review'" [queryParams]="previewQuery()">Ревью занятия →</a></p></section>
    }@else if(l.bundleId && l.status==='prepared' && section()!=='practice'){
      @if(['guide','plan','tasks','review'].includes(section())&&(currentText()||editable())){<section class="section-block text-section"><div class="sh mb-16"><div class="title-group"><h2>{{additionTitle()}}</h2></div>@if(visibility();as v){<span class="vis" [class.private]="v==='private'" [class.public]="v==='public'"><mentor-icon [name]="v==='private'?'eye-off':'eye'"/>{{v==='private'?'Только вам':'Видно ученику'}}</span>}</div>
        @if(currentText()){<div class="markdown-body lesson-source" [innerHTML]="renderer.render(currentText()!)"></div>}@else{<p class="small-muted">Дополнений пока нет.</p>}
        @if(editable()){<div class="actions"><button class="btn sm" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon [name]="currentText()?'pencil':'plus'"/>{{currentText()?'Изменить дополнения':'Добавить '+additionTitle().toLowerCase()}}</button></div>}</section>}
      <mentor-material-view [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lessonId]="l.id" [section]="section()" [detail]="detail()" [base]="base()+'/lessons/'+l.id" [preview]="preview()" [learner]="learner()"/>}
    @else if(['guide','plan','tasks','review'].includes(section())){
      <section class="section-block text-section"><div class="sh mb-16"><div class="title-group"><h2>{{section()==='review'?'Ревью занятия':learner()?'Задания на занятие':'Сценарий преподавателя'}}</h2></div>@if(visibility();as v){<span class="vis" [class.private]="v==='private'" [class.public]="v==='public'"><mentor-icon [name]="v==='private'?'eye-off':'eye'"/>{{v==='private'?'Только вам':'Видно ученику'}}</span>}</div>
        @if(section()==='review'){<p class="subtitle mb-16">Отзывы относятся к этому занятию и его домашней работе.</p>}
        @if(currentText()){<div class="markdown-body lesson-source" [innerHTML]="renderer.render(currentText()!)"></div>
          @if(editable()){<div class="actions"><button class="btn sm" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon name="pencil"/>{{section()==='review'?'Изменить отзыв':learner()?'Изменить задания':'Изменить сценарий'}}</button></div>}}
        @else{<div class="empty-state" [class.private]="visibility()==='private'"><h3>{{section()==='review'?'Отзыва пока нет':learner()?'Заданий пока нет':'Сценария пока нет'}}</h3><p>{{emptyText()}}</p>@if(editable()){<button class="btn primary" (click)="openText(currentKind())" [disabled]="busy()"><mentor-icon name="plus"/>{{section()==='review'?'Добавить отзыв':learner()?'Добавить задания':'Добавить сценарий'}}</button>}</div>}</section>
    }@else if(section()==='materials'||section()==='code'||section()==='answers'){<mentor-material-view [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lessonId]="l.id" [section]="section()" [detail]="detail()" [base]="base()+'/lessons/'+l.id" [preview]="preview()" [learner]="learner()"/>}@else if(section()!=='homework'){<section class="empty-state"><h2>{{sectionLabels[section()]||'Материалы'}}</h2><p>Для этого занятия материалы появятся отдельно от материалов других учеников.</p></section>}
    @if(section()==='homework'||section()==='review'){<mentor-homework-page [lesson]="l" [preview]="preview()" [mode]="section()==='review'?'review':'homework'" [studentName]="student()?.name??''"/>}
    @if(busy()){<p class="loading" role="status">Сохраняем или загружаем текст…</p>}@if(textError()&&!editingText()){<p class="auth-error" role="alert">{{textError()}}</p>}
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
    readonly editingText = signal<LessonText | null>(null);
    readonly textLabels = { teacherNotes: 'Сценарий занятия', studentNotes: 'Задания ученика', reviewNotes: 'Ревью занятия' };
    readonly sectionLabels: Record<string, string> = { practice: 'Тренажёр', homework: 'Домашняя работа', materials: 'Материалы', answers: 'Эталоны', code: 'Учебный код' };
    constructor() { super(); effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), l = this.lessonId(), preview = this.preview(), section = this.section(); this.refresh(); this.lesson.set(null); this.student.set(null); this.error.set(''); this.textError.set(''); this.closeText(); this.editingMetadata.set(false); this.busy.set(false); this.context.clear(this); if (!w || !s || !l)
        return; const sub = forkJoin({ student: this.students.load(w, s, preview), lesson: this.api.load(w, s, l, preview) }).subscribe({ next: view => { this.student.set(view.student); this.lesson.set(view.lesson); this.context.set(this, { student: view.student, lesson: view.lesson, base: this.base(), preview, learner: this.learner(), page: section }); }, error: e => this.error.set(this.message(e)) }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    teacherNotes() { const l = this.lesson(); return l && 'teacherNotes' in l ? l.teacherNotes : ''; }
    currentKind(): TextKind { return this.section() === 'review' ? 'reviewNotes' : this.learner() ? 'studentNotes' : 'teacherNotes'; }
    currentText() { return this.currentKind() === 'teacherNotes' ? this.teacherNotes() : this.lesson()?.[this.currentKind() as 'studentNotes' | 'reviewNotes']; }
    additionTitle() { return this.section() === 'review' ? 'Дополнения к ревью' : this.learner() ? 'Дополнения к заданиям' : 'Дополнения к сценарию'; }
    visibility(): 'private' | 'public' | null { const section = this.section(); return section === 'guide' || section === 'plan' || section === 'answers' ? 'private' : section === 'tasks' || section === 'review' ? 'public' : null; }
    emptyText() { return this.section() === 'review' ? 'Общий отзыв пока не добавлен. Преподаватель оставит здесь итоги занятия и следующие шаги.' : this.learner() ? 'Задания и материалы этого занятия ещё не добавлены.' : 'Сценарий этого занятия ещё не добавлен. Опишите ход занятия, вопросы и подсказки — ученик этот текст не увидит.'; }
    closeText() { this.editingText.set(null); this.textError.set(''); }
    isPast(lesson: LessonView) { return Date.parse(`${lesson.date}T${lesson.time}:00+03:00`) < Date.now(); }
    // The teacher's explicit mark; the metadata revision guards it like any other lesson change.
    markConducted(conducted: boolean) { const l = this.lesson(); if (!this.editable() || this.busy() || !l)
        return; this.busy.set(true); this.textError.set(''); this.api.save(this.workspaceId()!, this.studentId()!, l.id, { revision: l.revision, conducted }).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: lesson => { this.busy.set(false); this.savedMetadata(lesson); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    openText(kind: TextKind) { if (!this.editable() || this.busy())
        return; this.busy.set(true); this.textError.set(''); this.editingMetadata.set(false); this.api.text(this.workspaceId()!, this.studentId()!, this.lessonId()!, kind).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: text => { this.editingText.set(text); this.busy.set(false); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    savedText(saved: LessonText) { if (!this.editable()) return; this.lesson.update(lesson => lesson ? { ...lesson, [saved.kind]: saved.markdown } : null); this.closeText(); }
    savedMetadata(lesson: LessonView) { if (!this.editable())
        return; this.lesson.set(lesson); this.editingMetadata.set(false); this.context.set(this, { student: this.student()!, lesson, base: this.base(), preview: false, learner: false, page: this.section() }); }
}

import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, merge, skip, takeUntil } from 'rxjs';
import { DomainPage } from '../students/domain-page';
import { StudentsApi, StudentView } from '../students/students-api.service';
import { LessonsApi, LessonView, LessonText, TextKind } from './lessons-api.service';
import { LessonFormComponent } from './lesson-form.component';
@Component({ selector: 'mentor-lesson-page', imports: [RouterLink, ReactiveFormsModule, LessonFormComponent], template: `
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p><button class="btn" (click)="reload()">Повторить загрузку</button>}
  @if(lesson();as l){
    <div class="lesson-page-actions"><a class="text-link" [routerLink]="base()+'/lessons'" [queryParams]="previewQuery()">← Все занятия</a>@if(editable()){<button class="btn" (click)="editingMetadata.set(true);closeText()">Изменить занятие</button><a class="btn" [routerLink]="base()+'/lessons/'+l.id+'/student/tasks'" [queryParams]="{preview:'student'}">Экран ученика ↗</a>}<span class="pill neutral">{{l.status==='prepared'?'Подготовлено':'Запланировано'}}</span></div>
    @if(editable()&&editingMetadata()){<mentor-lesson-form [workspaceId]="workspaceId()!" [studentId]="studentId()!" [lesson]="l" (saved)="savedMetadata($event)" (cancel)="editingMetadata.set(false)"/>}
    @if(editable()&&editingText();as text){<section class="panel panel-inner editor"><h2>{{textLabels[text.kind]}}</h2><form (submit)="saveText($event)"><label class="auth-field">{{text.kind==='teacherNotes'?'План, вопросы и подсказки':text.kind==='reviewNotes'?'Отзыв и следующие шаги':'Задания и учебные материалы'}}<textarea name="markdown" [formControl]="markdown" maxlength="200000" rows="12"></textarea></label><p class="small-muted">{{text.kind==='teacherNotes'?'Только для преподавателя. Ученик этот текст не видит.':'Ученик увидит текст в этом занятии.'}}</p>@if(textError()){<p class="auth-error" role="alert">{{textError()}}</p>}<div class="actions"><button type="submit" class="btn primary" [disabled]="busy()">Сохранить</button><button class="btn" type="button" (click)="closeText()" [disabled]="busy()">Отмена</button></div></form></section>}
    @if(!section()){
      <section class="lesson-preparation panel panel-inner"><h2>Подготовка занятия</h2><p class="subtitle">Добавляйте материалы по мере готовности. Дата и время уже сохранены.</p><div class="preparation-grid">
        @if(editable()){<article><p class="eyebrow">01 · ТОЛЬКО ДЛЯ ВАС</p><h3>Сценарий преподавателя</h3><p>План, вопросы и подсказки для ведения занятия.</p><p>{{teacherNotes()?'Сценарий добавлен':'Пока не добавлен'}}</p><button class="btn" (click)="openText('teacherNotes')" [disabled]="busy()">{{teacherNotes()?'Изменить сценарий':'Добавить сценарий'}}</button><p><a [routerLink]="base()+'/lessons/'+l.id+'/teacher/guide'">Открыть сценарий →</a></p></article>}
        <article><p class="eyebrow">02 · ВИДНО УЧЕНИКУ</p><h3>Задания ученика</h3><p>Условия задач, инструкции и учебные материалы.</p><p>{{l.studentNotes?'Задания добавлены':'Пока не добавлены'}}</p>@if(editable()){<button class="btn" (click)="openText('studentNotes')" [disabled]="busy()">{{l.studentNotes?'Изменить задания':'Добавить задания'}}</button>}</article>
        <article><p class="eyebrow">03 · ПРАКТИКА</p><h3>Тренажёр</h3><p>Задачи занятия и автоматическая проверка кода.</p><a class="btn" [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/practice'" [queryParams]="previewQuery()">Открыть тренажёр →</a></article></div><p><a [routerLink]="base()+'/lessons/'+l.id+'/'+(learner()?'student':'teacher')+'/review'" [queryParams]="previewQuery()">Ревью занятия →</a></p></section>
    }@else if(['guide','plan','tasks','review'].includes(section())){
      <section class="panel panel-inner"><h2>{{section()==='review'?'Ревью занятия':learner()?'Задания на занятие':'Сценарий преподавателя'}}</h2>@if(section()==='review'){<p class="subtitle">Отзывы относятся к этому занятию и его домашней работе.</p>}
        <div class="plain-note lesson-source">{{currentText()||emptyText()}}</div>@if(editable()){<button class="btn" (click)="openText(currentKind())" [disabled]="busy()">{{section()==='review'?'Изменить отзыв':learner()?'Изменить задания':'Изменить сценарий'}}</button>}</section>
    }@else{<section class="panel panel-inner"><h2>{{sectionLabels[section()]||'Материалы'}}</h2><p>Для этого занятия материалы появятся отдельно от материалов других учеников.</p></section>}
    @if(busy()){<p role="status">Сохраняем или загружаем текст…</p>}@if(textError()&&!editingText()){<p class="auth-error" role="alert">{{textError()}}</p>}
  }@else if(!error()){<p role="status">Загружаем занятие…</p>}` })
export class LessonPageComponent extends DomainPage {
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
    readonly markdown = new FormControl('', { nonNullable: true, validators: Validators.maxLength(200000) });
    readonly textLabels = { teacherNotes: 'Сценарий занятия', studentNotes: 'Задания ученика', reviewNotes: 'Ревью занятия' };
    readonly sectionLabels: Record<string, string> = { practice: 'Тренажёр', homework: 'Домашняя работа', materials: 'Материалы', answers: 'Эталоны', code: 'Учебный код' };
    constructor() { super(); effect(onCleanup => { this.session.generation(); const w = this.workspaceId(), s = this.studentId(), l = this.lessonId(), preview = this.preview(), section = this.section(); this.refresh(); this.lesson.set(null); this.student.set(null); this.error.set(''); this.textError.set(''); this.closeText(); this.editingMetadata.set(false); this.busy.set(false); this.context.clear(this); if (!w || !s || !l)
        return; const sub = forkJoin({ student: this.students.load(w, s, preview), lesson: this.api.load(w, s, l, preview) }).subscribe({ next: view => { this.student.set(view.student); this.lesson.set(view.lesson); this.context.set(this, { student: view.student, lesson: view.lesson, base: this.base(), preview, learner: this.learner(), page: section }); }, error: e => this.error.set(this.message(e)) }); onCleanup(() => sub.unsubscribe()); }); }
    reload() { this.refresh.update(v => v + 1); }
    teacherNotes() { const l = this.lesson(); return l && 'teacherNotes' in l ? l.teacherNotes : ''; }
    currentKind(): TextKind { return this.section() === 'review' ? 'reviewNotes' : this.learner() ? 'studentNotes' : 'teacherNotes'; }
    currentText() { return this.currentKind() === 'teacherNotes' ? this.teacherNotes() : this.lesson()?.[this.currentKind() as 'studentNotes' | 'reviewNotes']; }
    emptyText() { return this.section() === 'review' ? 'Общий отзыв пока не добавлен. Преподаватель оставит здесь итоги занятия и следующие шаги.' : this.learner() ? 'Задания и материалы этого занятия ещё не добавлены.' : 'Сценарий этого занятия ещё не добавлен.'; }
    closeText() { this.editingText.set(null); this.markdown.reset(); this.textError.set(''); }
    openText(kind: TextKind) { if (!this.editable() || this.busy())
        return; this.busy.set(true); this.textError.set(''); this.editingMetadata.set(false); this.api.text(this.workspaceId()!, this.studentId()!, this.lessonId()!, kind).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: text => { this.markdown.setValue(text.markdown); this.editingText.set(text); this.busy.set(false); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    saveText(event: Event) { event.preventDefault(); const text = this.editingText(); if (!this.editable() || !text || this.busy() || this.markdown.invalid)
        return; this.busy.set(true); this.textError.set(''); this.api.saveText(this.workspaceId()!, this.studentId()!, this.lessonId()!, text.kind, { markdown: this.markdown.value, revision: text.revision }).pipe(takeUntil(this.routeChanges), takeUntilDestroyed(this.destroyRef)).subscribe({ next: saved => { this.lesson.update(l => l ? { ...l, [saved.kind]: saved.markdown } : null); this.busy.set(false); this.closeText(); }, error: e => { this.busy.set(false); this.textError.set(this.message(e)); } }); }
    savedMetadata(lesson: LessonView) { if (!this.editable())
        return; this.lesson.set(lesson); this.editingMetadata.set(false); this.context.set(this, { student: this.student()!, lesson, base: this.base(), preview: false, learner: false, page: this.section() }); }
}

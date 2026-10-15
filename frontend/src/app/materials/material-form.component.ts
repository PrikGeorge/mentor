import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MaterialsApi, MaterialSummary } from './materials-api.service';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { errorMessage } from '../core/api-error';
import { focusAfterRender } from '../core/focus';
type Kind = 'doc' | 'download';
type FieldErrors = { title?: string; markdown?: string; file?: string };
type Audience = 'student' | 'teacher';
// The roles the screens understand; the key is stored as contentKey and decides where a document opens.
const ROLES: { key: string; label: string; audience: Audience; lesson: boolean }[] = [
    { key: 'student', label: 'Задания на занятие', audience: 'student', lesson: true },
    { key: 'homework', label: 'Домашняя работа', audience: 'student', lesson: true },
    { key: 'student-materials', label: 'Материалы занятия', audience: 'student', lesson: true },
    { key: 'review', label: 'Ревью домашней работы', audience: 'student', lesson: true },
    { key: 'student-roadmap', label: 'Маршрут обучения', audience: 'student', lesson: false },
    { key: 'lesson', label: 'Сценарий преподавателя', audience: 'teacher', lesson: true },
    { key: 'guide', label: 'Подробный сценарий', audience: 'teacher', lesson: true },
    { key: 'answers', label: 'Эталоны', audience: 'teacher', lesson: true },
    { key: 'source', label: 'Описание комплекта', audience: 'teacher', lesson: true },
    { key: 'roadmap', label: 'Маршрут (для наставника)', audience: 'teacher', lesson: false },
    { key: 'profile', label: 'Профиль ученика', audience: 'teacher', lesson: false },
];
@Component({ selector: 'mentor-material-form', imports: [IconComponent, ErrorBannerComponent], template: `
<section class="material-form box" aria-labelledby="material-form-title">
  <div class="sh"><h3 id="material-form-title">Добавить материал</h3><span class="vis" [class.private]="audience()==='teacher'" [class.public]="audience()==='student'"><mentor-icon [name]="audience()==='teacher'?'eye-off':'eye'"/>{{audience()==='teacher'?'Только вам':'Видно ученику'}}</span></div>
  @if(lessonId()){<p class="small-muted">Первый материал переводит занятие в «Подготовлено»: ученик увидит всё, что помечено «Видно ученику».</p>}
  <form (submit)="save($event)" novalidate [attr.aria-busy]="busy()">
    <div class="form-grid">
      <label class="field">Тип<select name="kind" [value]="kind()" (change)="setKind($any($event.target).value)" [disabled]="busy()"><option value="doc">Документ (Markdown)</option><option value="download">Файл</option></select></label>
      <label class="field">Кому<select name="audience" [value]="audience()" (change)="setAudience($any($event.target).value)" [disabled]="busy()"><option value="student">Видно ученику</option><option value="teacher">Только вам</option></select></label>
      <label class="field">Роль<select name="contentKey" [value]="contentKey()" (change)="contentKey.set($any($event.target).value)" [disabled]="busy()"><option value="">Без роли</option>@for(role of roles();track role.key){<option [value]="role.key">{{role.label}}</option>}</select></label>
    </div>
    <label class="field">Заголовок <span class="label-note">· необязательно</span><input name="title" maxlength="200" autocomplete="off" [value]="title()" (input)="title.set($any($event.target).value);fieldErrors.set({})" [readOnly]="busy()" [attr.aria-invalid]="fieldErrors().title?true:null" [attr.aria-describedby]="fieldErrors().title?'material-title-error':null">@if(fieldErrors().title;as text){<small class="error" id="material-title-error">{{text}}</small>}</label>
    @if(kind()==='doc'){<label class="field">Текст в Markdown<textarea name="markdown" rows="12" [value]="markdown()" (input)="markdown.set($any($event.target).value);fieldErrors.set({})" [readOnly]="busy()" [attr.aria-invalid]="fieldErrors().markdown?true:null" [attr.aria-describedby]="fieldErrors().markdown?'material-markdown-hint material-markdown-error':'material-markdown-hint'"></textarea><small id="material-markdown-hint">Строка «# Заголовок» станет названием, каждая «## Часть» откроет раздел. До 200 000 символов.</small>@if(fieldErrors().markdown;as text){<small class="error" id="material-markdown-error">{{text}}</small>}</label>}
    @else{<label class="field">Файл<input #fileInput type="file" name="materialFile" (change)="chooseFile($event)" [disabled]="busy()" [attr.aria-invalid]="fieldErrors().file?true:null" [attr.aria-describedby]="fieldErrors().file?'material-file-hint material-file-error':'material-file-hint'"><small id="material-file-hint">ZIP, PDF, Java, TXT или Markdown · непустой файл до 20 МиБ.</small>@if(fieldErrors().file;as text){<small class="error" id="material-file-error">{{text}}</small>}</label>}
    @if(error()){<mentor-error-banner [message]="error()"/>}
    <div class="form-actions"><button class="btn primary" type="submit" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>Сохраняем…}@else{<mentor-icon name="plus"/>Добавить материал}</button></div>
  </form>
</section>` })
export class MaterialFormComponent {
    readonly workspaceId = input.required<string>();
    readonly studentId = input.required<string>();
    readonly lessonId = input<string | null>(null);
    readonly saved = output<MaterialSummary>();
    readonly kind = signal<Kind>('doc'); readonly audience = signal<Audience>('student'); readonly contentKey = signal(''); readonly title = signal(''); readonly markdown = signal(''); readonly file = signal<File | null>(null);
    readonly busy = signal(false); readonly error = signal('');
    // Validation errors sit under their fields; the banner is for the server's answer only.
    readonly fieldErrors = signal<FieldErrors>({});
    readonly roles = computed(() => ROLES.filter(role => role.audience === this.audience() && role.lesson === !!this.lessonId()));
    private readonly api = inject(MaterialsApi); private readonly session = inject(SessionStore);
    private readonly scope = createBoundScope(() => [this.workspaceId(), this.studentId(), this.lessonId()]);
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    private readonly focusLater = focusAfterRender();
    constructor() { effect(() => { this.scope.bind(); this.kind.set('doc'); this.audience.set('student'); this.contentKey.set(''); this.title.set(''); this.markdown.set(''); this.file.set(null); this.busy.set(false); this.error.set(''); this.fieldErrors.set({}); }); }
    setKind(value: string) { if (value === 'doc' || value === 'download') { this.kind.set(value); this.error.set(''); this.fieldErrors.set({}); } }
    setAudience(value: string) { if (value === 'student' || value === 'teacher') { this.audience.set(value); if (!this.roles().some(role => role.key === this.contentKey())) this.contentKey.set(''); } }
    chooseFile(event: Event) { this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); this.error.set(''); this.fieldErrors.set({}); }
    validate(): FieldErrors {
        const errors: FieldErrors = {};
        if (this.kind() === 'doc') { if (!this.markdown().trim()) errors.markdown = 'Введите текст материала.'; else if (this.markdown().length > 200000) errors.markdown = 'Текст должен быть не больше 200 000 символов.'; }
        else { const file = this.file(); if (!file) errors.file = 'Выберите файл.'; else if (!file.size || file.size > 20971520) errors.file = 'Файл должен быть непустым и не больше 20 МиБ.'; }
        if (this.title().length > 200) errors.title = 'Заголовок должен быть не больше 200 символов.';
        return errors;
    }
    save(event?: Event) {
        event?.preventDefault(); if (this.busy() || !this.scope.active() || this.session.actor()?.role !== 'TEACHER' || this.session.actor()?.workspaceId !== this.workspaceId()) return; this.error.set('');
        const errors = this.validate(); this.fieldErrors.set(errors);
        if (Object.keys(errors).length) { this.focusLater('[aria-invalid="true"]', this.scope.capture()); return; }
        const form = new FormData(); form.append('kind', this.kind()); form.append('audience', this.audience()); if (this.contentKey()) form.append('contentKey', this.contentKey()); if (this.title().trim()) form.append('title', this.title().trim());
        if (this.kind() === 'doc') form.append('markdown', this.markdown()); else form.append('file', this.file()!, this.file()!.name);
        this.busy.set(true);
        this.scope.track(this.api.create(this.workspaceId(), this.studentId(), this.lessonId(), form)).subscribe({
            next: created => { this.busy.set(false); this.title.set(''); this.markdown.set(''); this.file.set(null); const input = this.fileInput(); if (input) input.nativeElement.value = ''; this.saved.emit(created); },
            error: error => { this.busy.set(false); this.error.set(errorMessage(error, 'Не удалось сохранить материал.', { 413: 'Файл больше 20 МиБ.' })); },
        });
    }
}

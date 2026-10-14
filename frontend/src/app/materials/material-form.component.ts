import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { MaterialsApi, MaterialSummary } from './materials-api.service';
import { SessionStore } from '../core/session.store';
import { IconComponent } from '../core/icon.component';
type Kind = 'doc' | 'download';
type Audience = 'student' | 'teacher';
// The roles the screens understand; the key is stored as contentKey and decides where a document opens.
const ROLES: { key: string; label: string; audience: Audience; lesson: boolean }[] = [
    { key: 'student', label: 'Задания на занятие', audience: 'student', lesson: true },
    { key: 'homework', label: 'Домашняя работа', audience: 'student', lesson: true },
    { key: 'student-materials', label: 'Материалы урока', audience: 'student', lesson: true },
    { key: 'review', label: 'Ревью ДЗ', audience: 'student', lesson: true },
    { key: 'student-roadmap', label: 'Маршрут обучения', audience: 'student', lesson: false },
    { key: 'lesson', label: 'Сценарий занятия', audience: 'teacher', lesson: true },
    { key: 'guide', label: 'Методичка', audience: 'teacher', lesson: true },
    { key: 'answers', label: 'Эталоны', audience: 'teacher', lesson: true },
    { key: 'source', label: 'Описание комплекта', audience: 'teacher', lesson: true },
    { key: 'roadmap', label: 'Маршрут (для наставника)', audience: 'teacher', lesson: false },
    { key: 'profile', label: 'Профиль ученика', audience: 'teacher', lesson: false },
];
@Component({ selector: 'mentor-material-form', imports: [IconComponent], template: `
<section class="material-form box" aria-labelledby="material-form-title">
  <div class="sh"><h3 id="material-form-title">Добавить материал</h3><span class="vis" [class.private]="audience()==='teacher'" [class.public]="audience()==='student'"><mentor-icon [name]="audience()==='teacher'?'eye-off':'eye'"/>{{audience()==='teacher'?'Только вам':'Видно ученику'}}</span></div>
  @if(lessonId()){<p class="small-muted">Первый материал переводит занятие в «Подготовлено»: ученик увидит всё, что помечено «Видно ученику».</p>}
  <form (submit)="save($event)" novalidate [attr.aria-busy]="busy()">
    <div class="form-grid">
      <label class="auth-field">Тип<select name="kind" [value]="kind()" (change)="setKind($any($event.target).value)" [disabled]="busy()"><option value="doc">Документ (Markdown)</option><option value="download">Файл</option></select></label>
      <label class="auth-field">Кому<select name="audience" [value]="audience()" (change)="setAudience($any($event.target).value)" [disabled]="busy()"><option value="student">Ученику</option><option value="teacher">Только мне</option></select></label>
      <label class="auth-field">Роль<select name="contentKey" [value]="contentKey()" (change)="contentKey.set($any($event.target).value)" [disabled]="busy()"><option value="">Без роли</option>@for(role of roles();track role.key){<option [value]="role.key">{{role.label}}</option>}</select></label>
    </div>
    <label class="auth-field">Заголовок <span class="label-note">· необязательно</span><input name="title" maxlength="200" autocomplete="off" [value]="title()" (input)="title.set($any($event.target).value)" [readOnly]="busy()"></label>
    @if(kind()==='doc'){<label class="auth-field">Текст в Markdown<textarea name="markdown" rows="12" [value]="markdown()" (input)="markdown.set($any($event.target).value)" [readOnly]="busy()"></textarea><small>Строка «# Заголовок» станет названием, каждая «## Часть» откроет раздел. До 200 000 символов.</small></label>}
    @else{<label class="auth-field">Файл<input #fileInput type="file" name="materialFile" (change)="chooseFile($event)" [disabled]="busy()"><small>ZIP, PDF, Java, TXT или Markdown · непустой файл до 20 МиБ.</small></label>}
    @if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
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
    readonly roles = computed(() => ROLES.filter(role => role.audience === this.audience() && role.lesson === !!this.lessonId()));
    private readonly api = inject(MaterialsApi); private readonly session = inject(SessionStore); private readonly owner = this.session.generation();
    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    setKind(value: string) { if (value === 'doc' || value === 'download') { this.kind.set(value); this.error.set(''); } }
    setAudience(value: string) { if (value === 'student' || value === 'teacher') { this.audience.set(value); if (!this.roles().some(role => role.key === this.contentKey())) this.contentKey.set(''); } }
    chooseFile(event: Event) { this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); this.error.set(''); }
    validate(): string | null {
        if (this.kind() === 'doc') { if (!this.markdown().trim()) return 'Введите текст материала.'; if (this.markdown().length > 200000) return 'Текст должен быть не больше 200 000 символов.'; }
        else { const file = this.file(); if (!file) return 'Выберите файл.'; if (!file.size || file.size > 20971520) return 'Файл должен быть непустым и не больше 20 МиБ.'; }
        if (this.title().length > 200) return 'Заголовок должен быть не больше 200 символов.';
        return null;
    }
    save(event?: Event) {
        event?.preventDefault(); if (this.busy() || this.owner !== this.session.generation()) return; this.error.set('');
        const invalid = this.validate(); if (invalid) { this.error.set(invalid); return; }
        const form = new FormData(); form.append('kind', this.kind()); form.append('audience', this.audience()); if (this.contentKey()) form.append('contentKey', this.contentKey()); if (this.title().trim()) form.append('title', this.title().trim());
        if (this.kind() === 'doc') form.append('markdown', this.markdown()); else form.append('file', this.file()!, this.file()!.name);
        this.busy.set(true);
        this.api.create(this.workspaceId(), this.studentId(), this.lessonId(), form).subscribe({
            next: created => { if (this.owner !== this.session.generation()) return; this.busy.set(false); this.title.set(''); this.markdown.set(''); this.file.set(null); const input = this.fileInput(); if (input) input.nativeElement.value = ''; this.saved.emit(created); },
            error: error => { if (this.owner !== this.session.generation()) return; this.busy.set(false); this.error.set(error.status === 409 ? 'Документ с этой ролью уже есть. Удалите его или выберите другую роль.' : error.status === 413 ? 'Файл больше 20 МиБ.' : error.error?.message ?? 'Не удалось сохранить материал.'); },
        });
    }
}

import { Component, DestroyRef, ElementRef, Injectable, Injector, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { components } from '../api/schema';
import type { LessonRef } from '../editor/lesson-text-api.service';
import { PlatformApi } from '../core/platform-api.service';
import { SessionStore } from '../core/session.store';
import { IconComponent } from '../core/icon.component';
import { GRADES, Grade, GradeComponent } from '../homework/grade.component';

export type CodeComment = components['schemas']['CodeComment'];
export type CodeTarget = CodeComment['targetKind'];
const listPath = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/code-comments';
const itemPath = '/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/code-comments/{commentId}';
@Injectable({ providedIn: 'root' })
export class CodeCommentsApi {
    private readonly api = inject(PlatformApi);
    private readonly session = inject(SessionStore);
    private params(lesson: LessonRef) { return { workspaceId: lesson.workspaceId, studentId: lesson.studentId, lessonId: lesson.id }; }
    list(lesson: LessonRef, targetKind: CodeTarget, targetId: string, preview = false) { return this.session.scope(this.api.get(listPath, { pathParams: this.params(lesson), query: { targetKind, targetId, ...(preview ? { audience: 'student' } : {}) } })); }
    create(lesson: LessonRef, input: components['schemas']['CodeCommentInput']) { return this.session.scope(this.api.post(listPath, input, { pathParams: this.params(lesson) })); }
    remove(lesson: LessonRef, id: string) { return this.session.scope(this.api.delete(itemPath, { pathParams: { ...this.params(lesson), commentId: id } })); }
}
// Lines exactly as the server counts them; a final newline does not add a visible empty line.
export function codeLines(text: string): string[] {
    const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}
type Draft = { file: string; line: number; grade: Grade | null; body: string; variant: string };

@Component({ selector: 'mentor-code-review', imports: [IconComponent, GradeComponent], template: `
<div class="code-review">
  @if(error()){<p class="auth-error" role="alert">{{error()}}</p>}
  @if(editable()){<p class="small-muted m-0">Нажмите <b>+</b> у строки, чтобы оставить комментарий. Ученик увидит его рядом со своим кодом.</p>}
  @else if(comments().length){<p class="small-muted m-0">Комментариев наставника: {{comments().length}}.</p>}
  @for(file of listing();track file.name){
    <h4 class="code-file"><mentor-icon name="file-text"/>{{file.name}}@if(countFor(file.name);as n){<span class="count">· комментариев: {{n}}</span>}</h4>
    <ol class="code-lines" [attr.aria-label]="'Код файла '+file.name">
      @for(text of file.lines;track $index;let n=$index){<li [class.noted]="notesAt(file.name,n+1).length">
        <span class="ln" aria-hidden="true">{{n+1}}</span>
        <code>{{text||' '}}</code>
        @if(editable()){<button class="add-note" type="button" [attr.data-line]="file.name+':'+(n+1)" (click)="open(file.name,n+1)" [attr.aria-label]="'Комментарий к строке '+(n+1)+' файла '+file.name" [attr.aria-expanded]="isOpen(file.name,n+1)"><mentor-icon name="plus"/></button>}
        @for(note of notesAt(file.name,n+1);track note.id){<div class="line-note" role="note" tabindex="-1" [attr.data-note]="note.id" [attr.aria-label]="'Комментарий к строке '+(n+1)">
          <p class="note-head">@if(note.grade){<mentor-grade [grade]="note.grade"/>}<span class="small-muted">строка {{note.line}}</span>
            @if(editable()){<button class="btn sm text danger" type="button" (click)="remove(note)" [disabled]="busy()"><mentor-icon name="x"/>Удалить</button>}</p>
          <p class="prewrap m-0">{{note.body}}</p>
          @if(note.variant){<p class="variant-label">Вариант</p><pre class="code-view"><code>{{note.variant}}</code></pre>}
        </div>}
        @if(draft();as d){@if(d.file===file.name&&d.line===n+1){<form class="line-note note-form" (submit)="save($event)" [attr.aria-label]="'Новый комментарий к строке '+(n+1)">
          <fieldset class="grade-picker"><legend>Оценка строки <span class="label-note">· необязательно</span></legend><div class="grade-options"><label class="check-row"><input type="radio" [name]="'note-grade-'+n" [checked]="d.grade===null" (change)="patch({grade:null})">Без оценки</label>
            @for(g of grades;track g.value){<label class="check-row"><input type="radio" [name]="'note-grade-'+n" [checked]="d.grade===g.value" (change)="patch({grade:g.value})"><mentor-grade [grade]="g.value"/></label>}</div></fieldset>
          <label class="auth-field">Комментарий<textarea rows="3" maxlength="2000" required [value]="d.body" (input)="patch({body:$any($event.target).value})"></textarea></label>
          <label class="auth-field">Вариант кода <span class="label-note">· необязательно</span><textarea class="mono" rows="3" maxlength="2000" [value]="d.variant" (input)="patch({variant:$any($event.target).value})"></textarea></label>
          <div class="form-actions"><button class="btn" type="button" (click)="close()" [disabled]="busy()">Отмена</button><button class="btn primary" type="submit" [disabled]="busy()||!d.body.trim()"><mentor-icon [name]="busy()?'loader':'send'" [class.spin]="busy()"/>Оставить комментарий</button></div>
        </form>}}
      </li>}
    </ol>
  }
</div>` })
export class CodeReviewComponent {
    readonly lesson = input.required<LessonRef>();
    readonly targetKind = input.required<CodeTarget>();
    readonly targetId = input.required<string>();
    readonly files = input.required<Record<string, string>>();
    readonly editable = input(false);
    readonly preview = input(false);
    readonly noted = output<number>();
    readonly grades = GRADES;
    private readonly api = inject(CodeCommentsApi);
    private readonly session = inject(SessionStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    readonly comments = signal<CodeComment[]>([]);
    readonly draft = signal<Draft | null>(null);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly listing = computed(() => Object.keys(this.files()).sort().map(name => ({ name, lines: codeLines(this.files()[name] ?? '') })));
    private readonly byLine = computed(() => { const map = new Map<string, CodeComment[]>(); for (const note of this.comments()) { const key = note.file + '\n' + note.line; map.set(key, [...(map.get(key) ?? []), note]); } return map; });
    constructor() {
        effect(onCleanup => {
            this.session.generation(); const lesson = this.lesson(), kind = this.targetKind(), id = this.targetId(), preview = this.preview();
            this.comments.set([]); this.draft.set(null); this.error.set(''); this.noted.emit(0);
            const sub = this.api.list(lesson, kind, id, preview).subscribe({ next: list => { this.comments.set(list.items); this.noted.emit(list.items.length); }, error: () => this.error.set('Не удалось загрузить комментарии к коду.') });
            onCleanup(() => sub.unsubscribe());
        });
    }
    notesAt(file: string, line: number) { return this.byLine().get(file + '\n' + line) ?? []; }
    countFor(file: string) { return this.comments().filter(note => note.file === file).length; }
    isOpen(file: string, line: number) { const d = this.draft(); return !!d && d.file === file && d.line === line; }
    open(file: string, line: number) { if (!this.editable()) return; if (this.isOpen(file, line)) { this.close(); return; } this.draft.set({ file, line, grade: null, body: '', variant: '' }); this.focus('.note-form textarea'); }
    close() { const d = this.draft(); this.draft.set(null); if (d) this.focus(`[data-line="${CSS.escape(d.file + ':' + d.line)}"]`); }
    // Keyboard focus follows the form: into it on open, back to the line's button or onto the new note on close.
    private focus(selector: string) { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector }); }
    patch(change: Partial<Draft>) { this.draft.update(d => d ? { ...d, ...change } : d); }
    save(event: Event) {
        event.preventDefault(); const d = this.draft();
        if (!d || !d.body.trim() || !this.editable() || this.busy()) return;
        this.busy.set(true); this.error.set('');
        this.api.create(this.lesson(), { targetKind: this.targetKind(), targetId: this.targetId(), file: d.file, line: d.line, grade: d.grade, body: d.body.trim(), variant: d.variant }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: note => { this.busy.set(false); this.comments.update(list => [...list, note]); this.draft.set(null); this.noted.emit(this.comments().length); this.focus(`[data-note="${CSS.escape(note.id)}"]`); },
            error: e => { this.busy.set(false); this.error.set(e.status === 409 ? 'У этого кода уже слишком много комментариев.' : 'Не удалось сохранить комментарий. Текст остался в форме.'); },
        });
    }
    remove(note: CodeComment) {
        if (!this.editable() || this.busy()) return;
        this.busy.set(true); this.error.set('');
        this.api.remove(this.lesson(), note.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => { this.busy.set(false); this.comments.update(list => list.filter(item => item.id !== note.id)); this.noted.emit(this.comments().length); this.focus(`[data-line="${CSS.escape(note.file + ':' + note.line)}"]`); },
            error: () => { this.busy.set(false); this.error.set('Не удалось удалить комментарий.'); },
        });
    }
}

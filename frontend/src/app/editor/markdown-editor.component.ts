import { Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { SessionStore } from '../core/session.store';
import { createBoundScope } from '../core/bound-scope';
import { LessonTextApi, LessonRef, LessonText, TextKind } from './lesson-text-api.service';
import { MarkdownImport } from './markdown-import.service';
import { MarkdownRenderer } from './markdown-renderer.service';
import { transform, EditState } from './markdown-editing';
import { IconComponent } from '../core/icon.component';
import { ErrorBannerComponent } from '../core/error-banner.component';
import { errorMessage } from '../core/api-error';
import { saveBlob } from '../core/download';
@Component({ selector: 'mentor-markdown-editor', imports: [IconComponent, ErrorBannerComponent], template: `
<section class="lesson-md-editor" [hidden]="!active()" [attr.aria-busy]="busy()" aria-label="Редактор Markdown">
  <div class="md-editor-intro"><div><h2>{{labels[kind()]}}</h2><p class="small-muted">@if(kind()==='teacherNotes'){<span class="vis private"><mentor-icon name="eye-off"/>Только вам</span>}@else{<span class="vis public"><mentor-icon name="eye"/>Видно ученику</span>} {{kind()==='teacherNotes'?'Ученик этот текст не увидит.':'Текст появится у ученика в этом занятии.'}}</p></div></div>
  @if(pending();as file){<div class="callout"><p><b>{{file.name}}</b> · Как добавить файл?</p><div class="actions"><button class="btn sm" type="button" (click)="applyImport('replace')">Заменить текст</button><button class="btn sm" type="button" (click)="applyImport('append')">Добавить в конец</button><button class="btn sm text" type="button" (click)="pending.set(null)">Отмена импорта</button></div></div>}
  @if(error()){<mentor-error-banner [message]="error()"/>}
  @if(conflict()){<div class="warning-banner"><p>Пока вы редактировали, текст изменился. Скачайте свою версию, откройте редактор заново и перенесите правки.</p><button class="btn sm" type="button" (click)="downloadSource()"><mentor-icon name="download"/>Скачать введённый .md</button></div>}
  @if(reading()){<p class="loading" role="status">Читаем Markdown-файл…</p>}
  <form class="mde" (submit)="save($event)" novalidate>
    <div class="md-editor-bar"><div role="group" aria-label="Форматирование текста">@for(tool of tools;track tool[0]){@if(tool[0]==='bullet'||tool[0]==='link'){<span class="md-sep" aria-hidden="true"></span>}<button class="md-tool" type="button" [attr.aria-label]="tool[2]" [title]="tool[2]" (click)="format(tool[0])" [disabled]="busy()"><mentor-icon [name]="tool[1]"/>@if(tool[0]==='code'){Java}</button>}<span class="md-sep" aria-hidden="true"></span><button class="md-tool" type="button" (click)="undo()" [disabled]="busy()||!canUndo()" aria-label="Отменить" title="Отменить"><mentor-icon name="undo"/></button><button class="md-tool" type="button" (click)="redo()" [disabled]="busy()||!canRedo()" aria-label="Повторить" title="Повторить"><mentor-icon name="redo"/></button></div>
      <div class="md-right"><div class="seg md-view-tools" role="group" aria-label="Вид редактора">@for(mode of modes;track mode[0]){<button type="button" (click)="view.set(mode[0])" [attr.aria-pressed]="view()===mode[0]">{{mode[1]}}</button>}</div><button class="btn sm" type="button" (click)="fileInput.click()" [disabled]="busy()"><mentor-icon name="upload"/>Загрузить .md</button><input #fileInput type="file" accept=".md,.markdown,text/markdown" hidden (change)="chooseFile($event)"></div></div>
    <div class="md-editor-panes" [attr.data-view]="view()"><div class="md-source-pane" [hidden]="view()==='preview'"><label class="md-pane-title" [for]="sourceId">Текст · Markdown</label><textarea #textarea [id]="sourceId" name="markdown" [value]="source()" (input)="edit($event)" (keydown)="shortcut($event)" maxlength="200000" rows="16" [readOnly]="busy()" aria-label="Текст занятия" spellcheck="true"></textarea></div><div class="md-preview-pane" [hidden]="view()==='source'" role="region" aria-label="Предварительный просмотр"><p class="md-pane-title">Предварительный просмотр</p><div class="markdown-body md-preview-scroll" tabindex="0" [innerHTML]="rendered()"></div></div></div>
    <div class="md-editor-foot"><output aria-label="Количество символов">{{source().length}} / 200 000 знаков</output><p>Текст не сохраняется сам: нажмите «Сохранить».</p><div class="actions"><button type="button" class="btn" (click)="cancel()" [disabled]="busy()">Отмена</button><button type="submit" class="btn primary" [disabled]="busy()">@if(busy()){<mentor-icon class="spin" name="loader"/>}Сохранить</button></div></div></form>
</section>` })
export class MarkdownEditorComponent {
    readonly value = input.required<string>(); readonly revision = input.required<number>(); readonly kind = input.required<TextKind>(); readonly lesson = input.required<LessonRef>();
    readonly saved = output<LessonText>(); readonly cancelled = output<void>(); readonly source = signal('');
    readonly conflict = signal(false); readonly rendered = signal(''); readonly error = signal(''); readonly busy = signal(false); readonly reading = signal(false);
    readonly pending = signal<{ text: string; name: string; stamp: number } | null>(null);
    readonly view = signal<'source' | 'both' | 'preview'>(globalThis.innerWidth <= 700 ? 'source' : 'both');
    readonly modes = [['source', 'Текст'], ['both', 'Рядом'], ['preview', 'Просмотр']] as const;
    readonly labels = { teacherNotes: 'Сценарий преподавателя', studentNotes: 'Задания ученика', reviewNotes: 'Ревью занятия' };
    readonly tools = [['bold','bold','Жирный текст'],['italic','italic','Курсив'],['heading','heading','Заголовок второго уровня'],['bullet','list','Маркированный список'],['numbered','list-ordered','Нумерованный список'],['quote','quote','Цитата'],['link','link','Ссылка'],['table','table','Таблица'],['code','code','Блок кода Java']];
    private readonly session = inject(SessionStore);
    private readonly importer = inject(MarkdownImport); private readonly renderer = inject(MarkdownRenderer); private readonly api = inject(LessonTextApi);
    private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea'); private readonly destroyRef = inject(DestroyRef);
    private readonly closed = signal(false);
    private readonly scope = createBoundScope(() => { const lesson = this.lesson(); return [lesson.workspaceId, lesson.studentId, lesson.id, this.kind(), this.revision(), this.value()]; });
    readonly active = computed(() => this.scope.active() && !this.closed() && this.session.actor()?.role === 'TEACHER' && this.session.actor()?.workspaceId === this.lesson().workspaceId);
    readonly canUndo = signal(false); readonly canRedo = signal(false);
    readonly sourceId = `md-source-${++editorSequence}`;
    private history: EditState[] = []; private position = 0; private request = 0; private saveRequest?: Subscription;
    constructor() {
        effect(() => { const value = this.value(); this.session.generation(); this.scope.bind(); this.closed.set(false); this.conflict.set(false); this.request++; this.pending.set(null); this.reading.set(false); this.saveRequest?.unsubscribe(); this.busy.set(false); this.error.set(''); this.source.set(value); this.history = [{ value, start: value.length, end: value.length }]; this.position = 0; this.updateHistory(); });
        effect(onCleanup => { const source = this.source(); if (!this.scope.active()) return; const current = this.scope.capture(); const timer = setTimeout(() => { if (current() && this.active()) this.rendered.set(this.renderer.render(source)); }, 120); onCleanup(() => clearTimeout(timer)); });
        this.destroyRef.onDestroy(() => { this.request++; this.pending.set(null); this.saveRequest?.unsubscribe(); });
    }
    private current(): EditState { const element = this.textarea()?.nativeElement; return { value: this.source(), start: element?.selectionStart ?? this.source().length, end: element?.selectionEnd ?? this.source().length }; }
    private updateHistory() { this.canUndo.set(this.position > 0); this.canRedo.set(this.position < this.history.length - 1); }
    private record(state: EditState) {
        if (state.value === this.history[this.position]?.value) this.history[this.position] = state;
        else { this.history = this.history.slice(0, this.position + 1); this.history.push(state); this.position++; if (this.history.length > 150) { this.history.shift(); this.position--; } }
        this.updateHistory();
    }
    private apply(state: EditState) { this.request++; this.pending.set(null); this.reading.set(false); this.source.set(state.value); const element = this.textarea()?.nativeElement; if (element) { element.value = state.value; element.focus(); element.setSelectionRange(state.start, state.end); } }
    edit(event: Event) { if (!this.active() || this.busy()) return; const element = event.target as HTMLTextAreaElement; this.request++; this.pending.set(null); this.reading.set(false); this.source.set(element.value); this.record({ value: element.value, start: element.selectionStart, end: element.selectionEnd }); }
    format(command: string) { if (!this.active() || this.busy()) return; const current = this.current(); this.record(current); const state = transform(current, command); if (state.value.length > 200000) { this.error.set('В тексте может быть не больше 200 000 символов.'); return; } this.record(state); this.apply(state); }
    undo() { if (!this.active() || this.busy() || !this.canUndo()) return; this.position--; this.apply(this.history[this.position]); this.updateHistory(); }
    redo() { if (!this.active() || this.busy() || !this.canRedo()) return; this.position++; this.apply(this.history[this.position]); this.updateHistory(); }
    shortcut(event: KeyboardEvent) { if (!(event.ctrlKey || event.metaKey) || event.altKey) return; const key = event.key.toLowerCase(); if (['b','i','z','y'].includes(key)) { event.preventDefault(); if (key === 'b' || key === 'i') this.format(key === 'b' ? 'bold' : 'italic'); else if (key === 'y' || event.shiftKey) this.redo(); else this.undo(); } }
    chooseFile(event: Event) { const element = event.target as HTMLInputElement, file = element.files?.[0]; element.value = ''; if (file) void this.importFile(file); }
    async importFile(file: File) {
        if (!this.active() || this.busy()) return; const stamp = ++this.request, current = this.scope.capture(); this.pending.set(null); this.error.set(''); this.reading.set(true);
        try { const text = await this.importer.read(file); if (current() && this.active() && stamp === this.request) { this.pending.set({ text, name: file.name, stamp }); if (!this.source()) this.applyImport('replace'); } }
        catch (error) { if (current() && this.active() && stamp === this.request) this.error.set(error instanceof Error ? error.message : 'Не удалось прочитать файл.'); }
        finally { if (current() && (stamp === this.request || this.pending()?.stamp === stamp)) this.reading.set(false); }
    }
    applyImport(mode: 'replace' | 'append') {
        const pending = this.pending(); if (!this.active() || this.busy() || !pending || pending.stamp !== this.request) return;
        const current = this.current(); const separator = !current.value || /\n\n$/.test(current.value) ? '' : /\n$/.test(current.value) ? '\n' : '\n\n';
        const value = mode === 'append' ? current.value + separator + pending.text : pending.text;
        if (value.length > 200000) { this.error.set('В тексте может быть не больше 200 000 символов.'); return; }
        this.record(current); const state = { value, start: value.length, end: value.length }; this.record(state); this.apply(state); this.reading.set(false);
    }
    downloadSource() {
        if (!this.active() || this.busy() || !this.conflict()) return;
        saveBlob(new Blob([this.source()], { type: 'text/markdown;charset=utf-8' }), this.kind() + '-local.md');
    }
    cancel() { this.closed.set(true); this.request++; this.pending.set(null); this.reading.set(false); this.saveRequest?.unsubscribe(); this.cancelled.emit(); }
    save(event?: Event) {
        event?.preventDefault(); if (!this.active() || this.busy()) return; this.error.set(''); if (this.source().length > 200000) { this.error.set('В тексте может быть не больше 200 000 символов.'); return; }
        this.request++; this.pending.set(null); this.reading.set(false); this.busy.set(true); const lesson = this.lesson(), kind = this.kind(), revision = this.revision(), markdown = this.source();
        this.saveRequest = this.scope.track(this.api.save(lesson, kind, markdown, revision)).subscribe({ next: saved => { if (this.active()) { this.busy.set(false); this.saved.emit(saved); } }, error: error => { if (this.active()) { this.busy.set(false); this.conflict.set(error.status === 409); this.error.set(errorMessage(error, 'Не удалось сохранить текст. Введённый текст сохранён в редакторе.', { 409: 'Текст уже изменили в другой вкладке. Введённый текст сохранён в редакторе.' })); } } });
    }
}
let editorSequence = 0;


import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../core/icon.component';
import { MonacoEditorComponent } from './monaco-editor.component';
import type { Mode, SourceFiles } from './practice-api.service';
export type ResetKind = 'keep' | 'template';
// The student's files: tabs, save/export actions, draft status, the code editor and the run controls.
// All state belongs to the workbench; this panel only shows it and reports what the student did.
@Component({
    selector: 'mentor-editor-panel',
    imports: [MonacoEditorComponent, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
    template: `
        <section class="practice-editor" aria-label="Твои файлы">
          <header>
            <nav class="practice-files" aria-label="Файлы решения">
              @for (name of fileNames(); track name) {
                <button type="button" [attr.aria-pressed]="file() === name" (click)="fileChosen.emit(name)">{{ name }}</button>
              }
            </nav>
            <div class="file-actions">
              @if (writable()) {
                <button class="btn text sm" (click)="saveRequested.emit()" [disabled]="busy() || !compatible()"><mentor-icon name="save"/>Сохранить код</button>
              }
              @if (writable() || exportable()) {
                <button class="btn text sm" (click)="exportRequested.emit()"><mentor-icon name="download"/>Экспортировать код</button>
              }
            </div>
          </header>
          <span class="draft-state" role="status">{{ draftState() }}</span>
          @if (!compatible()) {
            <p class="warning-banner">Упражнение обновилось. Твой код остался на прежней ревизии. Экспортируй его перед переходом.</p>
          }
          @if (draftError()) {
            <p class="auth-error" role="alert">{{ draftError() }}</p>
          }
          @if (file(); as name) {
            <mentor-monaco-editor [value]="text()" [file]="name" [context]="editorContext()" [readonly]="readonly()" [dark]="dark()" (changed)="edited.emit({ name, text: $event })"/>
          }
          @if (writable()) {
            <div class="practice-controls">
              <button class="btn" data-action="run" (click)="runRequested.emit('run')" [disabled]="sending() || !runnable()"><mentor-icon name="play"/>Проверить примеры</button>
              <button class="btn primary" data-action="submit" (click)="runRequested.emit('submit')" [disabled]="sending() || !runnable()">
                @if (sending()) {<mentor-icon class="spin" name="loader"/>} @else {<mentor-icon name="send"/>}Отправить на все проверки
              </button>
            </div>
            @if (!compatible() || conflict()) {
              <div class="callout reset-choice">
                <p>Переход выполняется только по твоему выбору. Сервер сохранит архив прежнего сохранённого черновика.</p>
                <div class="actions">
                  <button class="btn sm" (click)="resetChosen.emit('keep')">Перенести мой код</button>
                  <button class="btn sm" (click)="resetChosen.emit('template')">Взять новые заготовки</button>
                </div>
              </div>
            }
          } @else {
            <p class="callout">Просмотр сохранённого кода · только чтение. Сохранение и запуск недоступны.</p>
          }
        </section>
    `,
})
export class EditorPanelComponent {
    readonly files = input.required<SourceFiles>();
    readonly file = input.required<string>();
    readonly editorContext = input.required<string>();
    // The student owns this draft: saving, running and the revision choice are offered.
    readonly writable = input(false);
    // Export is also offered to the owner of retained source while editing is suspended.
    readonly exportable = input(false);
    readonly readonly = input(false);
    readonly dark = input(false);
    readonly busy = input(false);
    readonly dirty = input(false);
    readonly compatible = input(true);
    readonly conflict = input(false);
    readonly draftError = input('');
    readonly sending = input(false);
    readonly runnable = input(false);
    readonly fileChosen = output<string>();
    readonly edited = output<{ name: string; text: string }>();
    readonly saveRequested = output<void>();
    readonly exportRequested = output<void>();
    readonly runRequested = output<Mode>();
    readonly resetChosen = output<ResetKind>();
    readonly fileNames = computed(() => Object.keys(this.files()));
    readonly draftState = computed(() => this.busy() ? 'Сохраняем…' : this.dirty() ? 'Есть несохранённые изменения' : 'Черновик сохранён');
    readonly text = computed(() => this.files()[this.file()] ?? '');
}

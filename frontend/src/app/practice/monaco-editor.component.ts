import { Component, DestroyRef, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { createBoundScope } from '../core/bound-scope';
import { MonacoLoader, CodeEditor, MonacoApi, defineEditorThemes } from './monaco-loader.service';
@Component({ selector: 'mentor-monaco-editor', template: `<div #host class="monaco-host" [hidden]="!ready()"></div><textarea [hidden]="ready()" [attr.aria-label]="'Код '+file()" [value]="value()" [readOnly]="readonly()" spellcheck="false" (input)="change($event)"></textarea>@if(failed()){<p class="small-muted" role="status">Доступен обычный редактор: Monaco не загрузился.</p>}<button type="button" class="text-link editor-fallback" (click)="fallback()" [hidden]="!ready()">Обычный редактор</button>` })
export class MonacoEditorComponent {
    readonly value = input.required<string>();
    readonly file = input.required<string>();
    readonly context = input.required<string>();
    readonly readonly = input(false);
    readonly dark = input(false);
    readonly changed = output<string>();
    readonly ready = signal(false);
    readonly failed = signal(false);
    private readonly loader = inject(MonacoLoader);
    private readonly scope = createBoundScope(() => [this.context()]);
    private readonly host = viewChild<ElementRef<HTMLElement>>('host');
    private editor: CodeEditor | null = null;
    private api: MonacoApi | null = null;
    private editing = false;
    private preferFallback = false;
    constructor() {
        inject(DestroyRef).onDestroy(() => this.editor?.dispose());
        effect(onCleanup => {
            const file = this.file(), host = this.host();
            this.scope.bind();
            this.ready.set(false);
            this.editor?.dispose();
            this.editor = null;
            this.failed.set(false);
            if (!host || this.preferFallback || !this.scope.current())
                return;
            let cancelled = false; const current = this.scope.capture();
            this.loader.load().then(api => { if (cancelled || !current() || this.preferFallback)
                return; this.api = api; defineEditorThemes(api); const editor = api.editor.create(host.nativeElement, { value: this.value(), language: 'java', readOnly: this.readonly(), automaticLayout: true, minimap: { enabled: false }, fontSize: 14, lineHeight: 24, fontFamily: "'PT Mono', ui-monospace, Consolas, monospace", theme: this.dark() ? 'mentor-dark' : 'mentor-light', renderLineHighlight: 'line', scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 12, bottom: 12 }, ariaLabel: 'Код ' + file }); this.editor = editor; editor.onDidChangeModelContent(() => { if (!this.editing && current() && !this.readonly())
                this.changed.emit(editor.getValue()); }); this.ready.set(true); }).catch(() => { if (!cancelled && current())
                this.failed.set(true); });
            onCleanup(() => { cancelled = true; });
        });
        effect(() => { const dark = this.dark(); if (this.ready()) this.api?.editor.setTheme?.(dark ? 'mentor-dark' : 'mentor-light'); });
        effect(() => { const value = this.value(), readonly = this.readonly(); const editor = this.editor; if (editor) {
            this.editing = true;
            if (editor.getValue() !== value)
                editor.setValue(value);
            editor.updateOptions({ readOnly: readonly });
            this.editing = false;
        } });
    }
    private active() { return this.scope.active(); }
    change(event: Event) { if (this.active() && !this.readonly())
        this.changed.emit((event.target as HTMLTextAreaElement).value); }
    fallback() { this.preferFallback = true; this.editor?.dispose(); this.editor = null; this.ready.set(false); }
}

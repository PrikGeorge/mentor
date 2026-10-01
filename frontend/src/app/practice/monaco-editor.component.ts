import { Component, DestroyRef, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { MonacoLoader, CodeEditor } from './monaco-loader.service';
@Component({ selector: 'mentor-monaco-editor', template: `<div #host class="monaco-host" [hidden]="!ready()"></div><textarea [hidden]="ready()" [attr.aria-label]="'Код '+file()" [value]="value()" [readOnly]="readonly()" spellcheck="false" (input)="change($event)"></textarea>@if(failed()){<p class="small-muted" role="status">Доступен обычный редактор: Monaco не загрузился.</p>}<button class="text-link editor-fallback" (click)="fallback()" [hidden]="!ready()">Обычный редактор</button>` })
export class MonacoEditorComponent {
    readonly value = input.required<string>();
    readonly file = input.required<string>();
    readonly context = input.required<string>();
    readonly readonly = input(false);
    readonly changed = output<string>();
    readonly ready = signal(false);
    readonly failed = signal(false);
    private readonly loader = inject(MonacoLoader);
    private readonly session = inject(SessionStore);
    private readonly generation = this.session.generation();
    private readonly host = viewChild<ElementRef<HTMLElement>>('host');
    private editor: CodeEditor | null = null;
    private bound = '';
    private alive = true;
    private editing = false;
    private preferFallback = false;
    constructor() {
        inject(DestroyRef).onDestroy(() => { this.alive = false; this.editor?.dispose(); });
        effect(onCleanup => {
            const context = this.context(), file = this.file(), host = this.host();
            this.bound = context;
            this.ready.set(false);
            this.editor?.dispose();
            this.editor = null;
            this.failed.set(false);
            if (!host || this.preferFallback || this.generation !== this.session.generation())
                return;
            let cancelled = false;
            this.loader.load().then(api => { if (cancelled || !this.active(context) || this.preferFallback)
                return; const editor = api.editor.create(host.nativeElement, { value: this.value(), language: 'java', readOnly: this.readonly(), automaticLayout: true, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, wordWrap: 'on', ariaLabel: 'Код ' + file }); this.editor = editor; editor.onDidChangeModelContent(() => { if (!this.editing && this.active(context) && !this.readonly())
                this.changed.emit(editor.getValue()); }); this.ready.set(true); }).catch(() => { if (!cancelled && this.active(context))
                this.failed.set(true); });
            onCleanup(() => { cancelled = true; });
        });
        effect(() => { const value = this.value(), readonly = this.readonly(); const editor = this.editor; if (editor) {
            this.editing = true;
            if (editor.getValue() !== value)
                editor.setValue(value);
            editor.updateOptions({ readOnly: readonly });
            this.editing = false;
        } });
    }
    private active(context = this.bound) { return this.alive && this.generation === this.session.generation() && context === this.context() && this.bound === context; }
    change(event: Event) { if (this.active() && !this.readonly())
        this.changed.emit((event.target as HTMLTextAreaElement).value); }
    fallback() { this.preferFallback = true; this.editor?.dispose(); this.editor = null; this.ready.set(false); }
}

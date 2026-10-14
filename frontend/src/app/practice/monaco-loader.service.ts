import { Injectable } from '@angular/core';
export interface CodeEditor {
    getValue(): string;
    setValue(value: string): void;
    updateOptions(options: Record<string, unknown>): void;
    onDidChangeModelContent(callback: () => void): {
        dispose(): void;
    };
    dispose(): void;
}
export interface MonacoApi {
    editor: {
        create(element: HTMLElement, options: Record<string, unknown>): CodeEditor;
        defineTheme?(name: string, theme: Record<string, unknown>): void;
        setTheme?(name: string): void;
    };
}
// Editor themes follow the design tokens (light: paper and ink, dark: graphite and mint).
const theme = (base: string, ink: string, muted: string, string: string, type: string, surface: string, tint: string, rule: string, cursor: string) => ({
    base, inherit: true,
    rules: [{ token: 'keyword', foreground: ink, fontStyle: 'bold' }, { token: 'string', foreground: string }, { token: 'number', foreground: string }, { token: 'type', foreground: type }, { token: 'type.identifier', foreground: type }, { token: 'comment', foreground: muted, fontStyle: 'italic' }, { token: 'annotation', foreground: muted }],
    colors: { 'editor.background': '#' + surface, 'editor.foreground': '#' + ink, 'editorLineNumber.foreground': '#' + muted, 'editorLineNumber.activeForeground': '#' + ink, 'editor.lineHighlightBackground': '#' + tint, 'editor.lineHighlightBorder': '#' + tint, 'editorCursor.foreground': '#' + cursor, 'editor.selectionBackground': '#' + rule, 'editorIndentGuide.background1': '#' + rule, 'editorWidget.background': '#' + surface, 'editorWidget.border': '#' + ink },
});
export function defineEditorThemes(api: MonacoApi): void {
    api.editor.defineTheme?.('mentor-light', theme('vs', '1C1A17', '6B655C', '7A3E12', '2B4C7E', 'FFFFFF', 'F3F1EC', 'D8D4CC', '1C1A17'));
    api.editor.defineTheme?.('mentor-dark', theme('vs-dark', 'EEF2F7', '93A1B5', 'F2C38B', '9CC3FF', '0E131B', '151C27', '253041', '36E4A6'));
}
type LocalRequire = ((modules: string[], success: (api: MonacoApi) => void, failure: (error: unknown) => void) => void) & {
    config(options: unknown): void;
};
type EditorWindow = Window & {
    require?: LocalRequire;
    monaco?: MonacoApi;
    MonacoEnvironment?: {
        getWorkerUrl: () => string;
    };
};
@Injectable({ providedIn: 'root' })
export class MonacoLoader {
    private pending: Promise<MonacoApi> | null = null;
    load(): Promise<MonacoApi> {
        const host = window as EditorWindow;
        if (host.monaco)
            return Promise.resolve(host.monaco);
        if (this.pending)
            return this.pending;
        this.pending = new Promise<MonacoApi>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Monaco did not load')), 15000);
            const fail = (error: unknown) => { clearTimeout(timer); reject(error); };
            const start = () => { if (!host.require) {
                fail(new Error('Local AMD loader unavailable'));
                return;
            } host.MonacoEnvironment = { getWorkerUrl: () => new URL('/vendor/monaco/worker-bootstrap.js', location.origin).href }; host.require.config({ paths: { vs: new URL('/vendor/monaco/vs', location.origin).href } }); host.require(['vs/editor/editor.main'], api => { clearTimeout(timer); resolve(host.monaco ?? api); }, fail); };
            if (host.require) {
                start();
                return;
            }
            const script = document.createElement('script');
            script.src = '/vendor/monaco/vs/loader.js';
            script.onload = start;
            script.onerror = () => { script.remove(); fail(new Error('Local Monaco assets unavailable')); };
            document.head.append(script);
        }).catch(error => { this.pending = null; throw error; });
        return this.pending;
    }
}

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
    };
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

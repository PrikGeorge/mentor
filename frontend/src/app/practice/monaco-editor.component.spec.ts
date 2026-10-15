import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MonacoEditorComponent } from './monaco-editor.component';
import { MonacoLoader, MonacoApi } from './monaco-loader.service';
import { SessionStore } from '../core/session.store';
describe('Accessible Monaco fallback', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(load: () => Promise<MonacoApi>) { TestBed.configureTestingModule({ imports: [MonacoEditorComponent], providers: [provideHttpClient(), { provide: MonacoLoader, useValue: { load } }] }); const fixture = TestBed.createComponent(MonacoEditorComponent); fixture.componentRef.setInput('value', ' exact\n'); fixture.componentRef.setInput('file', 'Task.java'); fixture.componentRef.setInput('context', 'lesson1:e1:1'); fixture.detectChanges(); fixture.detectChanges(); return fixture; }
    it('keeps labelled textarea editing when local Monaco loading fails', async () => { const fixture = setup(() => Promise.reject(new Error('blocked'))); await fixture.whenStable(); fixture.detectChanges(); await Promise.resolve(); fixture.detectChanges(); const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea'); expect(textarea).not.toBeNull(); expect(textarea.value).toBe(' exact\n'); expect(textarea.getAttribute('aria-label')).toContain('Task.java'); let changed = ''; fixture.componentInstance.changed.subscribe(value => changed = value); textarea.value = ' unsaved\r\n'; textarea.dispatchEvent(new Event('input')); expect(changed).toBe(' unsaved\n'); expect(fixture.nativeElement.textContent).toContain('обычный редактор'); });
    it('rejects late Monaco completion and old input handlers after context/account changes', async () => { let resolve!: (api: MonacoApi) => void; const fixture = setup(() => new Promise(value => resolve = value)); const create = vi.fn(); fixture.componentRef.setInput('context', 'lesson2:e1:1'); let count = 0; fixture.componentInstance.changed.subscribe(() => count++); const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea'); textarea.value = 'late'; textarea.dispatchEvent(new Event('input')); TestBed.inject(SessionStore).invalidate(); resolve({ editor: { create } }); await fixture.whenStable(); fixture.detectChanges(); expect(create).not.toHaveBeenCalled(); expect(count).toBe(0); });
    it('rejects a disposed editor callback after returning to the same context', async () => {
        const callbacks: (() => void)[] = [], dispose = vi.fn();
        const api: MonacoApi = { editor: { create: () => ({ getValue: () => 'edit', setValue: () => {}, updateOptions: () => {}, dispose, onDidChangeModelContent: callback => { callbacks.push(callback); return { dispose: () => {} }; } }) } };
        const fixture = setup(() => Promise.resolve(api)); await fixture.whenStable();
        const oldCallback = callbacks[0]; expect(oldCallback).toBeDefined(); const changed = vi.fn(); fixture.componentInstance.changed.subscribe(changed);
        fixture.componentRef.setInput('context', 'lesson2:e1:1'); fixture.detectChanges(); await fixture.whenStable();
        fixture.componentRef.setInput('context', 'lesson1:e1:1'); fixture.detectChanges(); await fixture.whenStable();
        expect(dispose).toHaveBeenCalled(); oldCallback(); expect(changed).not.toHaveBeenCalled();
        callbacks[callbacks.length - 1](); expect(changed).toHaveBeenCalledWith('edit');
    });
});

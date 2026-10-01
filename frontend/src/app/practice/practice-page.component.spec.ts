import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PracticeWorkbench } from './practice-page.component';
import { DraftRecovery } from './draft-recovery.service';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { MonacoLoader } from './monaco-loader.service';
import type { PublicExercise } from './practice-api.service';
const lesson = { workspaceId: 'w1', studentId: 's1', id: 'l1' }, exercise: PublicExercise = { id: 'e1', revision: 1, title: 'Synthetic exercise', statement: 'Public statement', environment: { id: 'java', title: 'Java21', javaVersion: 21, dependencies: [] }, starterFiles: { 'Task.java': 'template' } }, draft = { exerciseId: 'e1', exerciseRevision: 1, revision: 0, files: exercise.starterFiles, updatedAt: null };
const root = '/api/v1/workspaces/w1/students/s1/lessons/l1/practice', attempt = { id: 'accepted-id', exerciseId: 'e1', exerciseRevision: 1, mode: 'run', environmentRevision: 'synthetic', jobState: 'queued', files: exercise.starterFiles, result: null, createdAt: '2030-01-01T00:00:00Z' };
describe('Account/lesson-bound practice workbench', () => {
    it('warns before losing unsaved code while session revalidation is unavailable', () => {
        const {component, http, fixture} = page();
        const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
        try {
            component.draft.edit('Task.java', 'only copy of unsaved code');
            component.revalidate();
            http.expectOne('/api/v1/auth/session').flush({}, {status: 503, statusText: 'Unavailable'});
            expect(component.draft.files()['Task.java']).toBe('only copy of unsaved code');
            const event = new Event('beforeunload', {cancelable: true});
            window.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        } finally {storage.mockRestore(); fixture.destroy();}
    });
    it('keeps unload protection while session validation is pending without revealing or writing source', () => {
        const {component, http, fixture} = page();
        try {
            component.draft.edit('Task.java', 'retained pending source');
            component.revalidate();
            const pending = http.expectOne('/api/v1/auth/session');
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.practice-page').hidden).toBe(true);
            component.run('submit');
            component.draft.edit('Task.java', 'stale mutation');
            http.expectNone(request => request.method === 'POST' || request.method === 'PUT');
            expect(component.draft.files()['Task.java']).toBe('retained pending source');
            expect(unloadWarning()).toBe(true);
            pending.flush({}, {status:503,statusText:'Unavailable'});
        } finally {fixture.destroy();}
    });
    it('retains an unchanged owner warning until source is confirmed saved', async () => {
        const {component, http, fixture} = page();
        try {
            expect(unloadWarning()).toBe(false);
            component.draft.edit('Task.java', 'retained same owner source');
            component.revalidate();
            http.expectOne('/api/v1/auth/session').flush({account:{userId:'u1',workspaceId:'w1',role:'STUDENT',authVersion:1},csrfToken:'synthetic'});
            expect(unloadWarning()).toBe(true);
            const save=component.draft.save();
            http.expectOne(root+'/exercises/e1/draft').flush({...draft,revision:1,files:{'Task.java':'retained same owner source'}});
            expect(await save).toBe(true);
            expect(unloadWarning()).toBe(false);
        } finally {fixture.destroy();}
    });
    it('does not keep an old-owner unload warning after the session generation changes', () => {
        const {component, http, fixture} = page();
        try {
            component.draft.edit('Task.java', 'old owner source');
            component.revalidate();
            http.expectOne('/api/v1/auth/session').flush({account:{userId:'teacher',workspaceId:'w1',role:'TEACHER',authVersion:1},csrfToken:'other'});
            expect(unloadWarning()).toBe(false);
            component.run('submit');
            component.draft.edit('Task.java','late old owner source');
            http.expectNone(request=>request.method==='POST'||request.method==='PUT');
        } finally {fixture.destroy();}
    });
    it('removes the retained-source unload handler and cancels validation on destroy', () => {
        const {component, http, fixture} = page();
        component.draft.edit('Task.java','destroyed source');
        component.revalidate();
        const pending=http.expectOne('/api/v1/auth/session');
        fixture.destroy();
        expect(pending.cancelled).toBe(true);
        expect(unloadWarning()).toBe(false);
        expect(component.draft.files()).toEqual({});
    });
    function unloadWarning(){const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}
    beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({ imports: [PracticeWorkbench], providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting(), { provide: MonacoLoader, useValue: { load: () => Promise.reject(new Error('fixture fallback')) } }] }); });
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); localStorage.clear(); TestBed.resetTestingModule(); });
    function page(role: 'STUDENT' | 'TEACHER' = 'STUDENT', preview = false, before = () => { }, historyRows: import('./practice-api.service').HistoryEntry[] = []) { const http = TestBed.inject(HttpTestingController), session = TestBed.inject(SessionStore); session.load().subscribe(); http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'u1', workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' }); before(); const fixture = TestBed.createComponent(PracticeWorkbench); fixture.componentRef.setInput('lesson', lesson); fixture.componentRef.setInput('preview', preview); fixture.detectChanges(); const suffix = preview ? '?audience=student' : ''; http.expectOne(root + suffix).flush({ revision: 0, exercises: [{ assignmentId: 'as1', placement: 'class', exercise, draft: { ...draft, outdated: false } }] }); http.expectOne(root + '/history?page=0&size=100' + (preview ? '&audience=student' : '')).flush({ items: historyRows, page: 0, size: 100, total: historyRows.length }); for (const request of http.match(r => r.url.endsWith('/materials')))
        request.flush({ items: [], page: 0, size: 25, total: 0 }); fixture.detectChanges(); http.expectOne(root + '/exercises/e1/draft' + suffix).flush(draft); http.expectOne(root + '/exercises/e1/attempts?page=0&size=25' + (preview ? '&audience=student' : '')).flush({ items: [], page: 0, size: 25, total: 0 }); http.expectOne(root + '/draft-archives?exerciseId=e1&page=0&size=25' + (preview ? '&audience=student' : '')).flush({ items: [], page: 0, size: 25, total: 0 }); fixture.detectChanges(); return { fixture, http, component: fixture.componentInstance, session }; }
    it('restores an accepted attempt ID on reload and polls it without another enqueue', () => { const { fixture, http } = page('STUDENT', false, () => { const recovery = TestBed.inject(DraftRecovery); recovery.saveIntent(recovery.key('u1', 'w1', 's1', 'l1', 'e1', 1), { key: 'stable-key', attemptId: 'accepted-id', request: { files: exercise.starterFiles, mode: 'run', exerciseRevision: 1 } }); }); http.expectOne(root + '/exercises/e1/attempts/accepted-id').flush({ ...attempt, environmentRevision: null, jobState: 'completed', result: { status: 'accepted', passed: 1, total: 1, elapsedMs: 1, tests: [] } }); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Версия окружения не сохранена'); http.expectNone(request => request.method === 'POST'); expect(fixture.nativeElement.textContent).toContain('Все проверки пройдены'); fixture.destroy(); });
    it('retries an unknown outcome with the immutable same key and payload', () => { const { component, http, fixture } = page(); component.run('run'); const first = http.expectOne(root + '/exercises/e1/attempts'), key = first.request.headers.get('Idempotency-Key'), body = first.request.body; first.error(new ProgressEvent('error')); component.run('run'); const second = http.expectOne(root + '/exercises/e1/attempts'); expect(second.request.headers.get('Idempotency-Key')).toBe(key); expect(second.request.body).toEqual(body); second.flush(attempt, { status: 202, statusText: 'Accepted' }); http.expectOne(root + '/exercises/e1/attempts/accepted-id').flush({ ...attempt, jobState: 'failed', result: { status: 'unavailable', passed: 0, total: 0, elapsedMs: 1, tests: [] } }); fixture.destroy(); });
    it('teacher preview has public reads but no pupil execution or stale input write', () => { const { component, http, fixture } = page('TEACHER', true); component.run('submit'); expect(fixture.nativeElement.querySelector('[data-action=submit]')).toBeNull(); http.expectNone(request => request.method === 'POST' || request.method === 'PUT'); fixture.componentRef.setInput('lesson', { ...lesson, id: 'l2' }); component.run('run'); http.expectNone(request => request.method === 'POST' || request.method === 'PUT'); fixture.destroy(); });
    it('replays an old accepted-or-unknown payload after catalog publication without running new code', () => { const { component, http, fixture } = page(); component.run('run'); const first = http.expectOne(root + '/exercises/e1/attempts'), key = first.request.headers.get('Idempotency-Key'), body = first.request.body; first.error(new ProgressEvent('error')); component.refreshCatalog(); http.expectOne(root).flush({ revision: 0, exercises: [{ assignmentId: 'as1', placement: 'class', exercise: { ...exercise, revision: 2, starterFiles: { 'Task.java': 'new template' } }, draft: { ...draft, outdated: true } }] }); fixture.detectChanges(); expect(component.draft.files()).toEqual(exercise.starterFiles); component.recoverAttempt(); const replay = http.expectOne(root + '/exercises/e1/attempts'); expect(replay.request.headers.get('Idempotency-Key')).toBe(key); expect(replay.request.body).toEqual(body); replay.flush(attempt, { status: 202, statusText: 'Accepted' }); http.expectOne(root + '/exercises/e1/attempts/accepted-id').flush({ ...attempt, jobState: 'completed', result: { status: 'accepted', passed: 1, total: 1, elapsedMs: 1, tests: [] } }); fixture.destroy(); });
    it('discovers an unavailable attempt-only exercise without manufacturing a missing draft', async () => { const { component, http, fixture } = page('STUDENT', false, () => { }, [{ exerciseId: 'obsolete', active: false, hasDraft: false, hasAttempts: true, hasArchives: false }]); await component.choose('obsolete'); fixture.detectChanges(); const drafts = http.match(root + '/exercises/obsolete/draft'); for (const request of drafts)
        request.flush({ message: 'No saved draft' }, { status: 404, statusText: 'Not Found' }); http.expectOne(root + '/exercises/obsolete/attempts?page=0&size=25').flush({ items: [{ ...attempt, exerciseId: 'obsolete' }], page: 0, size: 25, total: 1 }); http.expectOne(root + '/draft-archives?exerciseId=obsolete&page=0&size=25').flush({ items: [], page: 0, size: 25, total: 0 }); fixture.detectChanges(); expect(drafts).toHaveLength(0); expect(fixture.nativeElement.textContent).toContain('История упражнения obsolete'); http.expectNone(request => request.method === 'POST' || request.method === 'PUT'); fixture.destroy(); });
 it('freezes source and polling until visible-tab session revalidation completes',()=>{const{component,fixture,http}=page();component.draft.edit('Task.java','unsaved tab source');const visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');try{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));expect(component.runnable()).toBe(false);expect(component.draft.files()).toEqual({'Task.java':'unsaved tab source'});Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));component.run('run');http.expectNone(request=>request.method==='POST');http.expectOne('/api/v1/auth/session').flush({account:{userId:'u1',workspaceId:'w1',role:'STUDENT',authVersion:1},csrfToken:'synthetic'});expect(component.runnable()).toBe(true);expect(component.draft.files()).toEqual({'Task.java':'unsaved tab source'});}finally{if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete(document as unknown as Record<string,unknown>)['visibilityState'];fixture.destroy();}});
 it('resuming a different actual account starts no old HTTP/storage writes and hides source',()=>{const{component,fixture,http}=page();component.draft.edit('Task.java','private unsaved source');const visibility=Object.getOwnPropertyDescriptor(document,'visibilityState'),writes=vi.spyOn(Storage.prototype,'setItem');try{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));http.expectOne('/api/v1/auth/session').flush({account:{userId:'teacher',workspaceId:'w1',role:'TEACHER',authVersion:1},csrfToken:'synthetic-other'});component.run('submit');component.draft.edit('Task.java','late old source');http.expectNone(request=>request.method==='PUT'||request.method==='POST');expect(writes).not.toHaveBeenCalled();fixture.detectChanges();expect(fixture.nativeElement.querySelector('.practice-page').hidden).toBe(true);expect(JSON.parse(localStorage.getItem(TestBed.inject(DraftRecovery).key('u1','w1','s1','l1','e1',1))!).files).toEqual({'Task.java':'private unsaved source'});}finally{writes.mockRestore();if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete(document as unknown as Record<string,unknown>)['visibilityState'];fixture.destroy();}});});


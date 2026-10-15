import { renderResources } from '../students/domain-test-support';
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {HttpEventType,provideHttpClient,withInterceptors} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {HomeworkPageComponent} from './homework-page.component';
import {testLesson as lesson,testSubmission as submission} from './homework-test-support';
import {SessionStore} from '../core/session.store';
import {sessionInterceptor} from '../core/session.interceptor';
const root='/api/v1/workspaces/w1/students/s1/lessons/l1/homework';
describe('Lesson-bound homework submission UI',()=>{
 beforeEach(()=>TestBed.configureTestingModule({imports:[HomeworkPageComponent],providers:[provideRouter([]),provideHttpClient(withInterceptors([sessionInterceptor])),provideHttpClientTesting()]}));
 afterEach(()=>{TestBed.inject(HttpTestingController).verify();TestBed.resetTestingModule();});
 async function page(role:'STUDENT'|'TEACHER'='STUDENT',preview=false){const http=TestBed.inject(HttpTestingController),session=TestBed.inject(SessionStore);session.load().subscribe();http.expectOne('/api/v1/auth/session').flush({account:{userId:role==='STUDENT'?'student':'teacher',workspaceId:'w1',role,authVersion:1},csrfToken:'test-token'});const fixture=TestBed.createComponent(HomeworkPageComponent);fixture.componentRef.setInput('lesson',lesson);fixture.componentRef.setInput('preview',preview);fixture.detectChanges();for(const request of http.match(root+'?page=0&size=25'))request.flush({items:[],page:0,size:25,total:0});await renderResources();fixture.detectChanges();return{fixture,http,session,component:fixture.componentInstance,element:fixture.nativeElement as HTMLElement};}
 for(const status of [413,503,0])it(`never declares success for ${status} or upload100 without a committed response`,async () =>{
  const{fixture,component,http}=await page();component.file.set(new File(['code'],'work.java'));component.upload();const request=http.expectOne(root);request.event({type:HttpEventType.UploadProgress,loaded:4,total:4});fixture.detectChanges();expect(component.succeeded()).toBe(false);expect(component.progress()).toBe(100);
  if(status===0)request.error(new ProgressEvent('error'));else request.flush({message:'Не удалось загрузить'},{status,statusText:'Rejected'});fixture.detectChanges();expect(component.succeeded()).toBe(false);expect(component.error()).toBeTruthy();expect(component.unknown()).toBe(status!==413);
 });
 it('retries an unknown upload outcome with the same Idempotency-Key and clears the form once confirmed',async () =>{
  const{component,http,fixture,element}=await page();component.file.set(new File(['code'],'work.java'));component.setComment('Мой комментарий');component.upload();const first=http.expectOne(root);const key=first.request.headers.get('Idempotency-Key');expect(key).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);first.error(new ProgressEvent('error'));fixture.detectChanges();expect(component.unknown()).toBe(true);expect(element.textContent).toContain('Повторить отправку');expect(element.textContent).toContain('Обновить историю');expect(component.comment()).toBe('Мой комментарий');
  component.upload();const retry=http.expectOne(root);expect(retry.request.headers.get('Idempotency-Key')).toBe(key);retry.flush(submission,{status:201,statusText:'Created'});TestBed.tick();http.expectOne(root+'?page=0&size=25').flush({items:[submission],page:0,size:25,total:1});await renderResources();fixture.detectChanges();
  expect(component.unknown()).toBe(false);expect(component.succeeded()).toBe(true);expect(component.file()).toBeNull();expect(component.comment()).toBe('');expect(component.repositoryUrl()).toBe('');expect(element.querySelector<HTMLInputElement>('input[type=file]')!.value).toBe('');
  component.upload();http.expectNone(request=>request.method==='POST');expect(component.error()).toBe('Выберите файл работы.');
 });
 it('refreshes history without discarding the pending submission form', async () => {
  const {component,http,fixture}=await page(); const file=new File(['new code'],'new.java');
  component.file.set(file); component.setComment('Текущая работа'); component.setRepositoryUrl('https://example.test/current');
  component.refreshHistory(); TestBed.tick();
  const request=http.expectOne(root+'?page=0&size=25'); expect(component.loading()).toBe(true);
  request.flush({items:[submission],page:0,size:25,total:1}); await renderResources();
  expect(component.submissions()).toEqual([submission]); expect(component.latest()).toEqual(submission);
  expect(component.file()).toBe(file); expect(component.comment()).toBe('Текущая работа'); expect(component.repositoryUrl()).toBe('https://example.test/current');
  expect(component.loading()).toBe(false); fixture.destroy();
 });
 it('changes the Idempotency-Key as soon as the file, comment or link changes',async () =>{
  const{component,http}=await page();component.file.set(new File(['code'],'work.java'));component.upload();const first=http.expectOne(root);const key=first.request.headers.get('Idempotency-Key');first.error(new ProgressEvent('error'));
  component.setComment('другой текст');component.upload();const second=http.expectOne(root);const secondKey=second.request.headers.get('Idempotency-Key');expect(secondKey).toBeTruthy();expect(secondKey).not.toBe(key);second.error(new ProgressEvent('error'));
  component.setRepositoryUrl('https://example.test/repo');component.upload();const third=http.expectOne(root);expect(third.request.headers.get('Idempotency-Key')).not.toBe(secondKey);third.error(new ProgressEvent('error'));
  component.upload();expect(http.expectOne(root).request.headers.get('Idempotency-Key')).toBe(third.request.headers.get('Idempotency-Key'));
 });
 it('keeps distinct submissions and their own feedback in the lesson history',async () =>{
  const{component,http,fixture,element}=await page();component.file.set(new File(['code'],'work.java'));component.upload();http.expectOne(root).flush({...submission,id:'h2'},{status:201,statusText:'Created'});TestBed.tick();http.expectOne(root+'?page=0&size=25').flush({items:[{...submission,id:'h2'}, {...submission,status:'needs_revision',feedback:'Исправьте работу h1'}],page:0,size:25,total:2});await renderResources();fixture.detectChanges();expect(element.querySelectorAll('.homework-submission')).toHaveLength(2);expect(element.textContent).toContain('Исправьте работу h1');expect(component.succeeded()).toBe(true);expect(component.file()).toBeNull();
 });
 it('teacher preview never submits even through a stale direct handler',async () =>{const{component,http,element}=await page('TEACHER',true);component.file.set(new File(['code'],'work.java'));component.upload();http.expectNone(request=>request.method==='POST');expect(element.querySelector('input[type=file]')).toBeNull();});
 it('cancels active upload on lesson change and rejects its old handler before rendering',async () =>{const{fixture,component,http}=await page();component.file.set(new File(['code'],'work.java'));component.upload();const request=http.expectOne(root);fixture.componentRef.setInput('lesson',{...lesson,id:'l2'});component.upload();expect(http.match(r=>r.method==='POST')).toHaveLength(0);fixture.detectChanges();expect(request.cancelled).toBe(true);http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l2/homework?page=0&size=25').flush({items:[],page:0,size:25,total:0});fixture.detectChanges();expect(component.submissions()).toHaveLength(0);expect(component.file()).toBeNull();});
 it('never starts HTTP from a ZIP read completing after the lesson input changes before render',async () =>{
  const{component,fixture,http}=await page();let callback:() => void=()=>{};
  class Reader { static LOADING=1;readyState=1;result=new Uint8Array([80,75,3,4]).buffer;onerror:unknown;set onload(value:(()=>void)|null){if(value)callback=value;}readAsArrayBuffer(){}abort(){this.readyState=2;} }
  vi.stubGlobal('FileReader',Reader);
  try{component.file.set(new File(['PK\u0003\u0004data'],'work.zip'));component.upload();fixture.componentRef.setInput('lesson',{...lesson,id:'l2'});callback();const requests=http.match(request=>request.method==='POST');for(const request of requests)request.flush(submission,{status:201,statusText:'Created'});expect(requests).toHaveLength(0);}
  finally{vi.unstubAllGlobals();}
 });
 it('cancels active upload and hides the view on account invalidation',async () =>{const{fixture,component,http,session}=await page();component.file.set(new File(['code'],'work.java'));component.upload();const request=http.expectOne(root);session.invalidate();fixture.detectChanges();expect(request.cancelled).toBe(true);expect(component.succeeded()).toBe(false);expect((fixture.nativeElement as HTMLElement).querySelector('section')?.hidden).toBe(true);});
 it('clears the native file selection when the lesson changes',async () =>{const{fixture,component,http,element}=await page();const input=element.querySelector<HTMLInputElement>('input[type=file]')!;Object.defineProperty(input,'value',{value:'C:\\fakepath\\work.java',writable:true});component.file.set(new File(['code'],'work.java'));fixture.componentRef.setInput('lesson',{...lesson,id:'l2'});fixture.detectChanges();http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l2/homework?page=0&size=25').flush({items:[],page:0,size:25,total:0});expect(input.value).toBe('');});

 it('cancels an authenticated download on lesson change before it can create a browser URL',async () =>{const{fixture,component,http}=await page();const create=vi.fn();const OriginalURL=URL;vi.stubGlobal('URL',class extends OriginalURL{static override createObjectURL=create;});try{component.download(submission);const request=http.expectOne(root+'/'+submission.id+'/file');fixture.componentRef.setInput('lesson',{...lesson,id:'l2'});fixture.detectChanges();expect(request.cancelled).toBe(true);expect(create).not.toHaveBeenCalled();http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l2/homework?page=0&size=25').flush({items:[],page:0,size:25,total:0});}finally{vi.unstubAllGlobals();}});
 it('revokes the authenticated download object URL after use',async () =>{const{component,http}=await page();const create=vi.fn(()=> 'blob:test-homework'),revoke=vi.fn(),click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}),OriginalURL=URL;vi.stubGlobal('URL',class extends OriginalURL{static override createObjectURL=create;static override revokeObjectURL=revoke;});vi.useFakeTimers();try{component.download(submission);const blob=new Blob(['work']);http.expectOne(root+'/'+submission.id+'/file').flush(blob);expect(create).toHaveBeenCalledWith(blob);expect(click).toHaveBeenCalledOnce();vi.runAllTimers();expect(revoke).toHaveBeenCalledWith('blob:test-homework');}finally{vi.useRealTimers();click.mockRestore();vi.unstubAllGlobals();}});

});



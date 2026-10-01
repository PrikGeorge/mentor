import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {HttpEventType,provideHttpClient,withInterceptors} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {HomeworkApi,Submission} from './homework-api.service';
import {SessionStore} from '../core/session.store';
import {sessionInterceptor} from '../core/session.interceptor';
const lesson={workspaceId:'w1',studentId:'s1',id:'l1'};
export const submission:Submission={id:'h1',filename:'work.java',size:4,createdAt:'2026-10-01T00:00:00Z',comment:'Комментарий',repositoryUrl:'',status:'submitted',feedback:'',revision:1};
describe('Homework multipart transport',()=>{
 beforeEach(()=>TestBed.configureTestingModule({providers:[provideRouter([]),provideHttpClient(withInterceptors([sessionInterceptor])),provideHttpClientTesting()]}));
 afterEach(()=>{TestBed.inject(HttpTestingController).verify();TestBed.resetTestingModule();});
 function api(){const http=TestBed.inject(HttpTestingController);TestBed.inject(SessionStore).load().subscribe();http.expectOne('/api/v1/auth/session').flush({account:{userId:'student',workspaceId:'w1',role:'STUDENT',authVersion:1},csrfToken:'test-token'});return{http,api:TestBed.inject(HomeworkApi)};}
 it('uses one browser-boundary multipart file and emits success only for the final response',()=>{
  const{http,api:service}=api(),file=new File(['code'],'work.java');let result:Submission|undefined;service.submit(lesson,file,' comment ',' https://example.com/project ').subscribe(value=>result=value);
  const request=http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/homework');expect(request.request.method).toBe('POST');expect(request.request.body).toBeInstanceOf(FormData);const form=request.request.body as FormData;expect(form.getAll('file')).toHaveLength(1);expect((form.get('file') as File).name).toBe(file.name);expect((form.get('file') as File).size).toBe(file.size);expect(form.get('comment')).toBe('comment');expect(form.get('repositoryUrl')).toBe('https://example.com/project');expect(request.request.headers.has('Content-Type')).toBe(false);expect(request.request.headers.get('X-Mentor-Account')).toBe('student');expect(request.request.headers.get('X-CSRF-TOKEN')).toBe('test-token');expect(request.request.reportProgress).toBe(true);
  request.event({type:HttpEventType.UploadProgress,loaded:4,total:4});expect(result).toBeUndefined();request.flush(submission,{status:201,statusText:'Created'});expect(result).toEqual(submission);
 });
 it('rejects20MiB+1 before HTTP but accepts the exact file boundary',()=>{
  const{http,api:service}=api();let error:unknown;service.submit(lesson,new File([new Uint8Array(20971521)],'work.txt'),'','').subscribe({error:e=>error=e});expect(error).toBeTruthy();http.expectNone(request=>request.method==='POST');
  service.submit(lesson,new File([new Uint8Array(20971520)],'work.txt'),'','').subscribe();http.expectOne(request=>request.method==='POST').flush({...submission,size:20971520},{status:201,statusText:'Created'});
 });
 it('downloads through the authenticated scoped client as a Blob',()=>{const{http,api:service}=api();let result:Blob|undefined;service.download(lesson,'h1').subscribe(blob=>result=blob);const request=http.expectOne('/api/v1/workspaces/w1/students/s1/lessons/l1/homework/h1/file');expect(request.request.responseType).toBe('blob');const blob=new Blob(['code']);request.flush(blob);expect(result).toBe(blob);});
});


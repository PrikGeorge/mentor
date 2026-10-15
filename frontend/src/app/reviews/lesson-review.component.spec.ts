import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideHttpClient,withInterceptors} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {LessonReviewComponent} from './lesson-review.component';
import {testLesson as lesson,testSubmission as submission} from '../homework/homework-test-support';
import {SessionStore} from '../core/session.store';
import {sessionInterceptor} from '../core/session.interceptor';
const root='/api/v1/workspaces/w1/students/s1/lessons/l1/homework/h1/review';
describe('Submission-bound feedback form',()=>{
 beforeEach(()=>TestBed.configureTestingModule({imports:[LessonReviewComponent],providers:[provideRouter([]),provideHttpClient(withInterceptors([sessionInterceptor])),provideHttpClientTesting()]}));
 afterEach(()=>{TestBed.inject(HttpTestingController).verify();TestBed.resetTestingModule();});
 function review(preview=false){const http=TestBed.inject(HttpTestingController),session=TestBed.inject(SessionStore);session.load().subscribe();http.expectOne('/api/v1/auth/session').flush({account:{userId:'teacher',workspaceId:'w1',role:'TEACHER',authVersion:1},csrfToken:'test-token'});const fixture=TestBed.createComponent(LessonReviewComponent);fixture.componentRef.setInput('lesson',lesson);fixture.componentRef.setInput('submission',submission);fixture.componentRef.setInput('preview',preview);fixture.detectChanges();return{fixture,http,session,component:fixture.componentInstance,element:fixture.nativeElement as HTMLElement};}
 it('keeps feedback on409 and mutates exactly one submission revision',()=>{const{component,http,fixture}=review();component.feedback.set('Мой отзыв');component.status.set('needs_revision');component.save();const request=http.expectOne(root);expect(request.request.method).toBe('PATCH');expect(request.request.body).toEqual({revision:1,status:'needs_revision',feedback:'Мой отзыв'});request.flush({message:'Работа изменилась'},{status:409,statusText:'Conflict'});fixture.detectChanges();expect(component.feedback()).toBe('Мой отзыв');expect(component.error()).toBe('Работу уже изменили. Введённый текст сохранён в форме — обновите страницу.');});
 it('replaces feedback when the lesson identity changes and rejects the old handler before render',()=>{const{component,fixture,http}=review();component.feedback.set('Отзыв первой работы');fixture.componentRef.setInput('lesson',{...lesson,id:'l2'});component.save();http.expectNone(request=>request.method==='PATCH');fixture.componentRef.setInput('submission',{...submission,id:'h2',feedback:'Отзыв другой работы'});fixture.detectChanges();expect(component.feedback()).toBe('Отзыв другой работы');expect(component.error()).toBe('');});
 it('never exposes a teacher review form in student preview',()=>{const{component,element,http}=review(true);component.feedback.set('forbidden');component.save();http.expectNone(request=>request.method==='PATCH');expect(element.querySelector('form')).toBeNull();});
 it('invalidates a pending review immediately when only the submission revision changes',()=>{
  const{component,fixture,http}=review();let emitted=0;component.reviewed.subscribe(()=>emitted++);component.feedback.set('Старое ревью');component.save();const pending=http.expectOne(root);
  fixture.componentRef.setInput('submission',{...submission,revision:2,feedback:'Новая версия'});expect(component.active()).toBe(false);component.save();http.expectNone(request=>request.method==='PATCH');
  fixture.detectChanges();expect(pending.cancelled).toBe(true);expect(component.feedback()).toBe('Новая версия');expect(emitted).toBe(0);
  component.save();const current=http.expectOne(root);expect(current.request.body.revision).toBe(2);current.flush({...submission,revision:3});expect(emitted).toBe(1);
 });
});

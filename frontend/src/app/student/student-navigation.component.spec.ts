import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter,Router} from '@angular/router';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {StudentNavigationComponent} from './student-navigation.component';
import {publicStudent,publicLesson,student,lesson} from '../students/domain-test-support';
import {Motion} from '../core/motion';
import {SessionStore} from '../core/session.store';
@Component({template:''}) class Blank {}
describe('Lesson and student tabs',()=>{
 afterEach(()=>TestBed.resetTestingModule());
 it('marks only the actual practice tab as the current lesson section',async()=>{TestBed.configureTestingModule({imports:[StudentNavigationComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([{path:'learn/students/:studentId/lessons/:lessonId/student/practice',component:Blank}])]});const fixture=TestBed.createComponent(StudentNavigationComponent);fixture.componentRef.setInput('selection',{student:publicStudent,lesson:publicLesson,base:'/learn/students/s1',preview:false,learner:true,page:'practice'});fixture.componentRef.setInput('level','lesson');await TestBed.inject(Router).navigateByUrl('/learn/students/s1/lessons/l1/student/practice');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();const nav=fixture.nativeElement.querySelector('nav[aria-label="Разделы занятия"]');expect(nav).toBeTruthy();const current=nav.querySelectorAll('[aria-current=page]');expect(current).toHaveLength(1);expect(current[0].textContent).toBe('Тренажёр');expect(Array.from(nav.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>).map(link=>link.textContent)).toEqual(['Задания','Тренажёр','Материалы','Домашняя работа','Ревью']);});
 it('marks private teacher tabs with a hatched label and keeps learners without card tabs',async()=>{TestBed.configureTestingModule({imports:[StudentNavigationComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([{path:'teacher/students/:studentId',component:Blank}])]});const fixture=TestBed.createComponent(StudentNavigationComponent);fixture.componentRef.setInput('selection',{student,base:'/teacher/students/s1',preview:false,learner:false,page:''});await TestBed.inject(Router).navigateByUrl('/teacher/students/s1');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();const nav=fixture.nativeElement.querySelector('nav[aria-label="Карточка ученика"]');expect(nav.querySelector('[aria-current=page]')?.textContent).toBe('Занятия');expect(nav.querySelector('a[href$="/profile"] .hm')).toBeTruthy();expect(nav.querySelector('a[href$="/profile"]')?.textContent).toContain('только вам');fixture.componentRef.setInput('selection',{student:publicStudent,base:'/learn/students/s1',preview:false,learner:true,page:''});fixture.detectChanges();expect(fixture.nativeElement.querySelector('nav')).toBeNull();});

 // UX-28 M4: the lesson screen reloads on every section change, so the bar hands the start of the fill over to the next bar.
 describe('sliding fill',()=>{
  const rect=function(this:HTMLElement){const index=this.parentElement?Array.from(this.parentElement.children).indexOf(this):0;return {left:index*120,width:100,top:0,height:40,right:index*120+100,bottom:40,x:index*120,y:0,toJSON(){return this;}} as DOMRect;};
  let original:typeof HTMLElement.prototype.getBoundingClientRect;
  beforeEach(()=>{original=HTMLElement.prototype.getBoundingClientRect;HTMLElement.prototype.getBoundingClientRect=rect;});
  afterEach(()=>{HTMLElement.prototype.getBoundingClientRect=original;});
  async function render(){
   const animate=vi.fn((..._:unknown[])=>null);
   TestBed.configureTestingModule({imports:[StudentNavigationComponent],providers:[provideHttpClient(),provideHttpClientTesting(),{provide:Motion,useValue:{reduced:()=>false,animate}},provideRouter([{path:'teacher/students/:studentId/lessons/:lessonId/teacher/:section',component:Blank}])]});
   const fixture=TestBed.createComponent(StudentNavigationComponent);
   fixture.componentRef.setInput('selection',{student,lesson,base:'/teacher/students/s1',preview:false,learner:false,page:'review'});
   fixture.componentRef.setInput('level','lesson');
   const router=TestBed.inject(Router);
   const go=async(section:string)=>{await router.navigateByUrl('/teacher/students/s1/lessons/'+lesson.id+'/teacher/'+section);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();TestBed.tick();};
   await go('review');
   return {animate,go,layers:()=>animate.mock.calls.filter(call=>(call[2] as KeyframeAnimationOptions).pseudoElement==='::before')};
  }
  it('slides from the previous tab inside one lesson',async()=>{const {go,layers}=await render();expect(layers()).toHaveLength(0);await go('materials');expect(layers()).toHaveLength(1);});
  it('does not slide across an account change',async()=>{const {go,layers}=await render();const navigation=TestBed.inject(Router).navigateByUrl('/teacher/students/s1/lessons/'+lesson.id+'/teacher/materials');TestBed.inject(SessionStore).invalidate();await navigation;await go('materials');expect(layers()).toHaveLength(0);});
 });
});

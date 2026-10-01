import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter,Router} from '@angular/router';
import {StudentNavigationComponent} from './student-navigation.component';
import {publicStudent,publicLesson} from '../students/domain-test-support';
@Component({template:''}) class Blank {}
describe('Exact navigation current page',()=>{
 afterEach(()=>TestBed.resetTestingModule());
 it('marks only the actual practice route while retaining lesson-ancestor active styling',async()=>{TestBed.configureTestingModule({imports:[StudentNavigationComponent],providers:[provideRouter([{path:'learn/students/:studentId/lessons/:lessonId/student/practice',component:Blank}])]});const fixture=TestBed.createComponent(StudentNavigationComponent);fixture.componentRef.setInput('selection',{student:publicStudent,lesson:publicLesson,base:'/learn/students/s1',preview:false,learner:true,page:'practice'});await TestBed.inject(Router).navigateByUrl('/learn/students/s1/lessons/l1/student/practice');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();expect(fixture.componentInstance.current('/learn/students/s1/lessons/l1/student/practice')).toBe(true);const current=fixture.nativeElement.querySelectorAll('[aria-current=page]');expect(current).toHaveLength(1);expect(current[0].textContent).toBe('Тренажёр');const lessons=Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>).find(link=>link.textContent==='Занятия');expect(lessons?.classList.contains('active')).toBe(true);});
});


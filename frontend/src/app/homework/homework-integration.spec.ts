import {TestBed} from '@angular/core/testing';
import {configure,open,base,student,lesson,publicStudent,publicLesson} from '../students/domain-test-support';
import {testSubmission as submission} from './homework-test-support';
describe('Homework and lesson review integration',()=>{
 beforeEach(configure);afterEach(()=>TestBed.resetTestingModule());
 it('opens student homework within its selected lesson and preserves the single lesson heading',async()=>{
  const{fixture,http,element}=await open('/learn/students/s1/lessons/l1/student/homework','STUDENT');http.expectOne(base).flush(publicStudent);http.expectOne(base+'/lessons/l1').flush(publicLesson);fixture.detectChanges();http.expectOne(base+'/lessons/l1/homework?page=0&size=25').flush({items:[],page:0,size:25,total:0});fixture.detectChanges();expect(element.querySelector('mentor-homework-page')).toBeTruthy();expect(element.querySelector('input[name=homeworkFile]')).toBeTruthy();expect(element.querySelectorAll('h1')).toHaveLength(1);expect(element.textContent).not.toContain('Для этого занятия материалы появятся отдельно');http.verify();
 });
 it('keeps lesson reviewNotes separate from feedback to individual submissions',async()=>{
  const{fixture,http,element}=await open('/teacher/students/s1/lessons/l1/teacher/review');http.expectOne(base).flush(student);http.expectOne(base+'/lessons/l1').flush({...lesson,reviewNotes:'Общий отзыв занятия'});fixture.detectChanges();http.expectOne(base+'/lessons/l1/homework?page=0&size=25').flush({items:[{...submission,feedback:'Отзыв только к файлу'}],page:0,size:25,total:1});fixture.detectChanges();expect(element.querySelector('.lesson-source')?.textContent).toContain('Общий отзыв занятия');expect(element.querySelector('.submission-feedback')?.textContent).toContain('Отзыв только к файлу');expect(element.querySelector('mentor-lesson-review')).toBeTruthy();expect(element.querySelector('input[name=homeworkFile]')).toBeNull();http.verify();
 });
});

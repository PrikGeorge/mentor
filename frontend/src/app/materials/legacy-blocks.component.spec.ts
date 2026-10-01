import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LegacyHtmlComponent } from './legacy-blocks.component';
describe('Legacy document navigation',()=>{
 beforeEach(()=>TestBed.configureTestingModule({imports:[LegacyHtmlComponent],providers:[provideRouter([])]}));
 afterEach(()=>TestBed.resetTestingModule());
 for(const actualStudent of [false,true])it(`retains source-to-trainer links for ${actualStudent?'a learner':'public preview'}`,()=>{
  const f=TestBed.createComponent(LegacyHtmlComponent);f.componentRef.setInput('base',actualStudent?'/learn/students/s1/lessons/l1':'/teacher/students/s1/lessons/l1');f.componentRef.setInput('preview',!actualStudent);f.componentRef.setInput('html','<!-- task-code:ListTask:practice -->');f.componentRef.setInput('code',{ListTask:{text:'class ListTask {}',teacher:false,materialId:'d1'}});f.detectChanges();
  expect((f.nativeElement as HTMLElement).querySelector('.task-code a')?.getAttribute('href')).toBe(actualStudent?'/learn/students/s1/lessons/l1/student/practice/list-task':'/teacher/students/s1/lessons/l1/student/practice/list-task?preview=student');
 });
 it('maps a legacy lesson reference to the existing plan route and retains preview',()=>{
  const router=TestBed.inject(Router),navigate=vi.spyOn(router,'navigateByUrl').mockResolvedValue(true);const f=TestBed.createComponent(LegacyHtmlComponent);f.componentRef.setInput('base','/teacher/students/s1/lessons/l1');f.componentRef.setInput('preview',true);f.componentRef.setInput('html','<a href="#lesson">План</a>');f.detectChanges();(f.nativeElement as HTMLElement).querySelector('a')!.click();
  expect(navigate).toHaveBeenCalled();expect(router.serializeUrl(navigate.mock.calls[0][0] as ReturnType<Router['createUrlTree']>)).toBe('/teacher/students/s1/lessons/l1/student/tasks?preview=student');
 });
});



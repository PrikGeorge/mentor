import { renderResources } from '../students/domain-test-support';
import { TestBed } from '@angular/core/testing';
import { configure, open, base, student, lesson, publicStudent, publicLesson, click } from '../students/domain-test-support';
describe('Markdown and material lesson integration', () => {
    beforeEach(configure); afterEach(() => TestBed.resetTestingModule());
    it('opens the one-text editor using its independent revision and import toolbar', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1'); http.expectOne(base).flush(student); http.expectOne(base+'/lessons/l1').flush(lesson); await renderResources(); fixture.detectChanges();
        click(element,'Изменить сценарий'); http.expectOne(base+'/lessons/l1/texts/teacherNotes').flush({ kind: 'teacherNotes', markdown: '  exact  \n', revision: 4 }); await renderResources(); fixture.detectChanges();
        expect(element.querySelector('mentor-markdown-editor')).toBeTruthy(); expect(element.textContent).toContain('Загрузить .md'); expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('  exact  \n'); expect(element.querySelectorAll('h1')).toHaveLength(1); http.verify();
    });
    it('renders teacher/student lesson text through the single safe renderer', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/lessons/l1/student/tasks','STUDENT'); http.expectOne(base).flush(publicStudent); http.expectOne(base+'/lessons/l1').flush({ ...publicLesson, studentNotes: '### Публичное задание\n\n<script>unsafe</script>\n\n```java\n  class A {}\n```' }); await renderResources(); fixture.detectChanges();
        expect(element.querySelector('.lesson-source h3')?.textContent).toBe('Публичное задание'); expect(element.querySelector('.lesson-source script')).toBeNull(); expect(element.querySelector('.lesson-source code')?.textContent).toContain('  class A {}'); http.verify();
    });
    it('reads prepared student material from the narrowed backend instead of private lesson source', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1/student/tasks?preview=student'); http.expectOne(base+'?audience=student').flush(publicStudent); http.expectOne(base+'/lessons/l1?audience=student').flush({ ...publicLesson, status: 'prepared', bundleId: 'bundle' }); await renderResources(); fixture.detectChanges();
        http.expectOne(base+'/lessons/l1/materials?page=0&size=25&audience=student').flush({ items: [], page: 0, size: 25, total: 0 }); await renderResources(); fixture.detectChanges(); expect(element.textContent).toContain('Материалы пока не добавлены'); expect(element.querySelectorAll('h1')).toHaveLength(1); http.verify();
    });
    it('loads goal-related profile material with no fabricated lesson identifier', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/goal','STUDENT'); http.expectOne(base).flush(publicStudent); await renderResources(); fixture.detectChanges();
        const lessons = http.match(base+'/lessons?page=0&size=25'); for(const request of lessons) if(!request.cancelled) request.flush({items:[],page:0,size:25,total:0});
        http.expectOne(base+'/materials?page=0&size=25').flush({items:[],page:0,size:25,total:0});await renderResources(); fixture.detectChanges(); expect(element.textContent).toContain('Первая работа'); http.verify();
    });
    it('keeps saved public text visible alongside a prepared material bundle', async () => {
        const { fixture, http, element } = await open('/learn/students/s1/lessons/l1/student/tasks','STUDENT'); http.expectOne(base).flush(publicStudent); http.expectOne(base+'/lessons/l1').flush({ ...publicLesson,status:'prepared',bundleId:'bundle',studentNotes:'### Дополнение ученику' }); await renderResources(); fixture.detectChanges();
        http.expectOne(base+'/lessons/l1/materials?page=0&size=25').flush({items:[],page:0,size:25,total:0});await renderResources(); fixture.detectChanges(); expect(element.querySelector('.lesson-source h3')?.textContent).toBe('Дополнение ученику'); http.verify();
    });
});

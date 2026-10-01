import { TestBed } from '@angular/core/testing';
import { configure, open, student, lesson, base, click } from '../students/domain-test-support';

describe('Prepared lesson additions', () => {
  beforeEach(configure);
  afterEach(() => TestBed.resetTestingModule());
  for (const section of ['plan', 'review']) {
    it(`keeps prepared ${section} content without a contradictory empty-note message`, async () => {
      const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1/teacher/' + section);
      try {
        http.expectOne(base).flush(student);
        http.expectOne(base + '/lessons/l1').flush({ ...lesson, status: 'prepared', bundleId: 'bundle', teacherNotes: '', reviewNotes: '' });
        fixture.detectChanges();
        http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [], page: 0, size: 25, total: 0 });
        if (section === 'review') http.expectOne(request => request.url.endsWith('/lessons/l1/homework')).flush({ items: [], page: 0, size: 25, total: 0 });
        fixture.detectChanges();
        expect(element.textContent).not.toContain('Сценарий этого занятия ещё не добавлен');
        expect(element.textContent).not.toContain('Общий отзыв пока не добавлен');
        const label = section === 'review' ? 'Добавить дополнения к ревью' : 'Добавить дополнения к сценарию';
        click(element, label); fixture.detectChanges();
        const kind = section === 'review' ? 'reviewNotes' : 'teacherNotes';
        http.expectOne(base + '/lessons/l1/texts/' + kind).flush({ kind, revision: 1, markdown: '' });
        fixture.detectChanges();
        expect(element.querySelector('mentor-markdown-editor')).toBeTruthy();
        http.verify();
      } finally { fixture.destroy(); }
    });
  }
  it('labels existing prepared notes as additions and retains their content', async () => {
    const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1/teacher/plan');
    try {
      http.expectOne(base).flush(student);
      http.expectOne(base + '/lessons/l1').flush({ ...lesson, status: 'prepared', bundleId: 'bundle' });
      fixture.detectChanges();
      http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [], page: 0, size: 25, total: 0 });
      fixture.detectChanges();
      expect(element.textContent).toContain('Дополнения к сценарию');
      expect(element.querySelector('.lesson-source')?.textContent).toContain(lesson.teacherNotes);
      http.verify();
    } finally { fixture.destroy(); }
  });
  it('retains the empty scenario message for an ordinary unprepared lesson', async () => {
    const { fixture, http, element } = await open('/teacher/students/s1/lessons/l1/teacher/plan');
    try {
      http.expectOne(base).flush(student);
      http.expectOne(base + '/lessons/l1').flush({ ...lesson, teacherNotes: '' });
      fixture.detectChanges();
      expect(element.textContent).toContain('Сценарий этого занятия ещё не добавлен');
      http.verify();
    } finally { fixture.destroy(); }
  });
});

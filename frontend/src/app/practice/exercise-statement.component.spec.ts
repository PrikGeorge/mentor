import { TestBed } from '@angular/core/testing';
import { ExerciseStatementComponent } from './exercise-statement.component';
import type { MaterialView } from '../materials/materials-api.service';
import type { PublicExercise } from './practice-api.service';
const exercise: PublicExercise = { id: 'e1', revision: 1, title: 'Коллекции', statement: '**Условие**', environment: { id: 'java', title: 'Java без зависимостей', javaVersion: 21, dependencies: ['jackson'] }, starterFiles: { 'Task.java': 'class Task {}', 'Util.java': 'class Util {}' } };
const meta = { workspaceId: 'w1', studentId: 's1', lessonId: 'l1', bundleId: null, contentType: 'text/x-java', contentKey: null, title: null } as const;
const references: MaterialView[] = [
    { ...meta, id: 'public', audience: 'student', kind: 'code', filename: 'Reference.java', code: { text: 'class Reference {}', teacher: false, materialId: 'm1' } },
    { ...meta, id: 'private', audience: 'teacher', kind: 'code', filename: 'Answer.java', code: { text: 'PRIVATE_ANSWER', teacher: true, materialId: 'm2' } },
];
describe('Exercise statement', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(notesHtml = '') {
        TestBed.configureTestingModule({ imports: [ExerciseStatementComponent] });
        const fixture = TestBed.createComponent(ExerciseStatementComponent);
        fixture.componentRef.setInput('exercise', exercise);
        fixture.componentRef.setInput('statementHtml', '<p><strong>Условие</strong></p>');
        fixture.componentRef.setInput('notesHtml', notesHtml);
        fixture.componentRef.setInput('references', references);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }
    it('shows the rendered statement, environment and starter files read-only', () => {
        const element = setup();
        expect(element.querySelector('.practice-reading h3')?.textContent).toBe('Коллекции');
        expect(element.querySelector('.markdown-body strong')?.textContent).toBe('Условие');
        expect(element.textContent).toContain('Java 21');
        expect(element.textContent).toContain('Java без зависимостей · jackson');
        expect(Array.from(element.querySelectorAll('.practice-reference h4')).map(node => node.textContent)).toEqual(['Task.java', 'Util.java']);
        expect(element.querySelector('details')?.textContent).toContain('class Util {}');
    });
    it('adds lesson notes only when present and never shows teacher-only code references', () => {
        const silent = setup();
        expect(silent.textContent).not.toContain('Материалы занятия');
        expect(silent.textContent).toContain('Reference.java · исходная заготовка');
        expect(silent.textContent).not.toContain('PRIVATE_ANSWER');
        TestBed.resetTestingModule();
        const noted = setup('<p>Заметки</p>');
        expect(noted.textContent).toContain('Материалы занятия');
        expect(noted.querySelectorAll('.markdown-body')[1]?.textContent).toBe('Заметки');
    });
});

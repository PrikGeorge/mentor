import { TestBed } from '@angular/core/testing';
import { ExerciseListComponent, AssignedExercise } from './exercise-list.component';
import type { PublicExercise } from './practice-api.service';
const exercise: PublicExercise = { id: 'e1', revision: 1, title: 'Коллекции', statement: 'Условие', environment: { id: 'java', title: 'Java', javaVersion: 21, dependencies: [] }, starterFiles: { 'Task.java': 'template' } };
const rows: AssignedExercise[] = [
    { assignmentId: 'as1', placement: 'class', exercise, draft: { exerciseId: 'e1', exerciseRevision: 1, revision: 0, updatedAt: null, outdated: false } },
    { assignmentId: 'as2', placement: 'homework', exercise: { ...exercise, id: 'e2', title: 'Потоки' }, draft: { exerciseId: 'e2', exerciseRevision: 1, revision: 0, updatedAt: null, outdated: false } },
];
describe('Exercise list', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(selected = 'e1') {
        TestBed.configureTestingModule({ imports: [ExerciseListComponent] });
        const fixture = TestBed.createComponent(ExerciseListComponent);
        fixture.componentRef.setInput('rows', rows);
        fixture.componentRef.setInput('removed', [{ exerciseId: 'obsolete', active: false, hasDraft: true, hasAttempts: true, hasArchives: false }]);
        fixture.componentRef.setInput('selectedId', selected);
        fixture.detectChanges();
        return { fixture, buttons: Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.practice-exercises button')) };
    }
    it('lists assigned exercises with their placement, then removed ones as history, marking the current page', () => {
        const { buttons } = setup('e2');
        expect(buttons.map(button => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Коллекции На занятии', 'Потоки Домашняя работа', 'История · obsolete Снято с назначения']);
        expect(buttons.map(button => button.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    });
    it('reports the chosen exercise, including a removed one, without changing its own selection', () => {
        const { fixture, buttons } = setup();
        const chosen: string[] = [];
        fixture.componentInstance.chosen.subscribe(id => chosen.push(id));
        buttons[1].click();
        buttons[2].click();
        expect(chosen).toEqual(['e2', 'obsolete']);
        fixture.detectChanges();
        expect(buttons[0].getAttribute('aria-current')).toBe('page');
    });
    it('nests the files of the open exercise under it, marks the current file and its unsaved state, and reports file choices', () => {
        const { fixture } = setup('e1');
        fixture.componentRef.setInput('files', ['Task.java', 'Util.java']);
        fixture.componentRef.setInput('file', 'Util.java');
        fixture.componentRef.setInput('dirty', true);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const files = Array.from(element.querySelectorAll<HTMLButtonElement>('.tree-files button'));
        expect(files.map(button => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Task.java', 'Util.java не сохранён']);
        expect(files.map(button => !!button.querySelector('.tree-dirty'))).toEqual([false, true]);
        expect(files.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
        expect(element.querySelector('.tree-exercise[aria-current=page]')?.getAttribute('aria-expanded')).toBe('true');
        const chosen: string[] = [];
        fixture.componentInstance.fileChosen.subscribe(name => chosen.push(name));
        files[0].click();
        expect(chosen).toEqual(['Task.java']);
        fixture.componentRef.setInput('selectedId', 'e2');
        fixture.detectChanges();
        expect(element.querySelectorAll('.tree-files')).toHaveLength(1);
        expect(element.querySelector('.tree-files')?.previousElementSibling?.textContent).toContain('Потоки');
    });
});

import { TestBed } from '@angular/core/testing';
import { GRADES, GradeComponent, gradeOf } from './grade.component';

// Q-07: a grade sign never stands alone — the word always follows it, and only the doubtful grades are marked bad.
describe('Grade', () => {
    afterEach(() => TestBed.resetTestingModule());
    function render(grade: unknown) {
        TestBed.configureTestingModule({ imports: [GradeComponent] });
        const fixture = TestBed.createComponent(GradeComponent);
        fixture.componentRef.setInput('grade', grade);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    // The expected wording is written out here, not read from GRADES, so a changed word or colour fails the test.
    const expected = [
        ['excellent', '!!', 'отлично', false],
        ['good', '!', 'хорошо', false],
        ['interesting', '!?', 'интересно', false],
        ['dubious', '?!', 'сомнительно', true],
        ['mistake', '?', 'ошибка', true],
    ] as const;

    it('lists five grades from the best to a mistake', () => {
        expect(GRADES.map((grade) => [grade.value, grade.sign, grade.word, grade.bad])).toEqual(expected.map((row) => [...row]));
        expect(gradeOf('good')?.word).toBe('хорошо');
        expect(gradeOf(null)).toBeNull();
        expect(gradeOf(undefined)).toBeNull();
    });

    for (const [value, sign, word, bad] of expected) {
        it(`shows «${sign}» with the word «${word}»`, () => {
            const element = render(value);
            const mark = element.querySelector('.ev')!;
            expect(mark.textContent).toBe(sign + word);
            expect(mark.querySelector('b')?.getAttribute('aria-hidden')).toBe('true');
            expect(mark.classList.contains('bad')).toBe(bad);
        });
    }

    it('renders nothing without a grade', () => {
        expect(render(null).querySelector('.ev')).toBeNull();
    });
});

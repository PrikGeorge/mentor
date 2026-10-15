import { lessonEnded, lessonStatus } from './lesson-status';
describe('Lesson status tag', () => {
    // 15 October 2026, 12:00–13:00 in Moscow.
    const lesson = { status: 'prepared', date: '2026-10-15', time: '12:00', duration: 60 };
    const end = Date.parse('2026-10-15T10:00:00Z');
    it('ends exactly at start plus duration in Moscow time', () => {
        expect(lessonEnded(lesson, end - 1)).toBe(false);
        expect(lessonEnded(lesson, end)).toBe(true);
        expect(lessonEnded({}, end)).toBe(false);
    });
    it('shows the student a neutral «Прошло» instead of the missing mark, and the teacher the real state', () => {
        expect(lessonStatus(lesson, 'student', end - 1).label).toBe('Подготовлено');
        expect(lessonStatus(lesson, 'student', end)).toEqual({ label: 'Прошло', icon: 'calendar', on: false, quiet: true });
        expect(lessonStatus({ ...lesson, status: 'planned' }, 'student', end).label).toBe('Прошло');
        expect(lessonStatus(lesson, 'teacher', end).label).toBe('Подготовлено');
        expect(lessonStatus({ ...lesson, status: 'planned' }, 'teacher', end).label).toBe('Запланировано');
    });
    it('lets the explicit mark win for both viewers', () => {
        const held = { ...lesson, conductedAt: '2026-10-15T10:05:00Z' };
        expect(lessonStatus(held, 'student', end).label).toBe('Проведено');
        expect(lessonStatus(held, 'teacher', end - 1).label).toBe('Проведено');
    });
});

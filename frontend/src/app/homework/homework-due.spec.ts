import { afterDeadline, dueLine, dueShort, dueTag, overdueDays } from './homework-due';
describe('Homework deadline wording', () => {
    // Thursday 15 October 2026, 15:30 in Moscow.
    const now = Date.parse('2026-10-15T12:30:00Z');
    const due = (state: 'open' | 'overdue' | 'onTime' | 'late', date = '2026-10-17', time = '23:59') => ({ date, time, state });
    it('words an open deadline relative to Moscow days', () => {
        expect(dueShort(due('open'))).toBe('17.10, 23:59');
        expect(dueLine(due('open'), 'student', false, now)).toBe('Сдать до 17.10, 23:59 МСК · через 2 дн.');
        expect(dueLine(due('open', '2026-10-16'), 'student', false, now)).toBe('Сдать до 16.10, 23:59 МСК · завтра');
        expect(dueLine(due('open', '2026-10-15'), 'teacher', false, now)).toBe('ДЗ до 15.10, 23:59 МСК · сегодня');
        expect(dueTag(due('open'), 'teacher', false, now)).toBeNull();
    });
    it('is firm with the teacher and gentle with the student about an overdue deadline', () => {
        const late = due('overdue', '2026-10-13', '12:00');
        expect(overdueDays(late, now)).toBe(2);
        expect(dueTag(late, 'teacher', false, now)).toMatchObject({ label: 'Просрочено на 2 дн.', danger: true });
        expect(dueTag(due('overdue', '2026-10-15', '12:00'), 'teacher', false, now)?.label).toBe('Срок прошёл');
        expect(dueTag(late, 'student', false, now)).toMatchObject({ label: 'Срок прошёл', warn: true });
        expect(dueLine(late, 'student', false, now)).toBe('Срок был 13.10, 12:00. Сдай, когда будет готово — наставник посмотрит.');
        expect(dueLine(late, 'teacher', false, now)).toBe('Срок 13.10, 12:00 МСК прошёл, работ пока нет.');
    });
    it('never highlights an archived card as overdue', () => {
        const late = due('overdue', '2026-10-13', '12:00');
        expect(dueTag(late, 'teacher', true, now)).toBeNull();
        expect(dueTag(late, 'student', true, now)).toBeNull();
        expect(dueLine(late, 'student', true, now)).toBe('Срок был 13.10, 12:00 МСК.');
    });
    it('names met deadlines quietly and marks works sent after the deadline', () => {
        expect(dueTag(due('onTime'), 'student')).toMatchObject({ label: 'Сдано в срок', quiet: true });
        expect(dueTag(due('late'), 'teacher')).toMatchObject({ label: 'Сдано после срока', quiet: true });
        expect(dueLine(due('late'), 'teacher')).toBe('Срок 17.10, 23:59 МСК · сдано после срока');
        expect(afterDeadline(due('late'), '2026-10-17T20:59:00Z')).toBe(false);
        expect(afterDeadline(due('late'), '2026-10-17T20:59:01Z')).toBe(true);
        expect(afterDeadline(null, '2026-10-17T21:00:00Z')).toBe(false);
    });
});

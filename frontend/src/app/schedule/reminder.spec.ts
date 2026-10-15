import { lessonSummary } from '../students/domain-test-support';
import type { ScheduleItem } from './schedule-api.service';
import { reminderWindow, unmarkedLabel, unmarkedLessons } from './reminder';
const item = (id: string, date: string, time: string, conductedAt?: string): ScheduleItem => ({
    studentName: 'Анна',
    lesson: { ...lessonSummary, id, date, time, duration: 60, ...(conductedAt ? { conductedAt } : {}) },
});
describe('Conducted reminder', () => {
    it('covers the last 14 Moscow days including today', () => {
        expect(reminderWindow('2026-10-15')).toEqual({ from: '2026-10-02', to: '2026-10-15' });
    });
    it('keeps ended unmarked lessons, newest first, and skips marked, running and future ones', () => {
        const now = Date.parse('2026-10-15T12:30:00Z'); // 15:30 MSK
        const items = [
            item('old', '2026-10-03', '10:00'),
            item('marked', '2026-10-10', '10:00', '2026-10-10T08:00:00Z'),
            item('running', '2026-10-15', '15:00'),
            item('ended', '2026-10-15', '14:00'),
            item('later', '2026-10-15', '18:00'),
        ];
        expect(unmarkedLessons(items, now).map((entry) => entry.lesson.id)).toEqual(['ended', 'old']);
    });
    it('agrees the phrase with the number', () => {
        expect(unmarkedLabel(1)).toBe('1 прошедшее занятие не отмечено проведённым');
        expect(unmarkedLabel(2)).toBe('2 прошедших занятия не отмечены проведёнными');
        expect(unmarkedLabel(5)).toBe('5 прошедших занятий не отмечены проведёнными');
        expect(unmarkedLabel(11)).toBe('11 прошедших занятий не отмечены проведёнными');
        expect(unmarkedLabel(21)).toBe('21 прошедшее занятие не отмечено проведённым');
    });
});

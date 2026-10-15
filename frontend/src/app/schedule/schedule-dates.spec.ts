import { addDays, dayLabel, endTime, isCalendarDate, lessonEnd, lessonStart, mondayOf, moscowDate, weekDays, weekLabel } from './schedule-dates';
describe('Schedule calendar arithmetic', () => {
    it('takes «today» from Moscow, not from the browser clock zone', () => {
        expect(moscowDate(Date.parse('2026-10-15T20:59:00Z'))).toBe('2026-10-15');
        expect(moscowDate(Date.parse('2026-10-15T21:00:00Z'))).toBe('2026-10-16');
    });
    it('starts weeks on Monday and crosses months and years', () => {
        expect(mondayOf('2026-10-15')).toBe('2026-10-12');
        expect(mondayOf('2026-10-12')).toBe('2026-10-12');
        expect(mondayOf('2026-10-18')).toBe('2026-10-12');
        expect(mondayOf('2026-01-01')).toBe('2025-12-29');
        expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
        expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
        expect(weekLabel('2026-10-12')).toBe('12–18 октября 2026');
        expect(weekLabel('2026-10-26')).toBe('26 октября – 1 ноября 2026');
        expect(weekLabel('2025-12-29')).toBe('29 декабря 2025 – 4 января 2026');
        expect(dayLabel('2026-10-15')).toBe('Четверг, 15 октября');
    });
    it('accepts only real calendar dates', () => {
        expect(isCalendarDate('2026-10-15')).toBe(true);
        for (const value of ['2026-02-30', '15.10.2026', '2026-1-5', '', null, undefined]) expect(isCalendarDate(value)).toBe(false);
    });
    it('reads Moscow wall-clock times and wraps the end past midnight', () => {
        const lesson = { date: '2026-10-15', time: '23:30', duration: 90 };
        expect(lessonStart(lesson)).toBe(Date.parse('2026-10-15T20:30:00Z'));
        expect(lessonEnd(lesson)).toBe(Date.parse('2026-10-15T22:00:00Z'));
        expect(endTime(lesson)).toBe('01:00');
        expect(endTime({ time: '09:15', duration: 60 })).toBe('10:15');
    });
});

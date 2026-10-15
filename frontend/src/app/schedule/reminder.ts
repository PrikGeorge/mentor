import { lessonEnded } from '../lessons/lesson-status';
import type { ScheduleItem } from './schedule-api.service';
import { addDays, lessonStart } from './schedule-dates';
// T16: the teacher is reminded of lessons that ended without the «Проведено» mark. Only the last 14 days count, so the
// history imported from the old cabinet, where nothing was ever marked, never nags.
export const REMINDER_DAYS = 14;
export const REMINDER_LIMIT = 5;
export function reminderWindow(today: string) {
    return { from: addDays(today, -(REMINDER_DAYS - 1)), to: today };
}
// Newest first: the lesson that just ended is the one the teacher remembers.
export function unmarkedLessons(items: readonly ScheduleItem[], now: number) {
    return items.filter((item) => !item.lesson.conductedAt && lessonEnded(item.lesson, now)).sort((a, b) => lessonStart(b.lesson) - lessonStart(a.lesson));
}
// «1 прошедшее занятие не отмечено проведённым», «3 прошедших занятия не отмечены проведёнными».
export function unmarkedLabel(n: number) {
    const last = n % 10,
        tens = n % 100,
        one = last === 1 && tens !== 11,
        few = last >= 2 && last <= 4 && (tens < 12 || tens > 14);
    return one ? `${n} прошедшее занятие не отмечено проведённым` : `${n} ${few ? 'прошедших занятия' : 'прошедших занятий'} не отмечены проведёнными`;
}

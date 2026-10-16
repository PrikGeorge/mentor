import type { LessonSummary } from './schedule-api.service';
import { addDays, lessonEnd } from './schedule-dates';

// T23: one lesson on a calendar — the teacher sees whose it is, the student only their own; the link already
// carries the right branch (/teacher or /learn) and, in the teacher's preview, ?preview=student.
export interface CalendarEntry {
    lesson: LessonSummary;
    studentName?: string;
    link: string[];
    query: Record<string, string>;
}

export const UPCOMING_DAYS = 14;
export const UPCOMING_LIMIT = 10;

// The window of «Ближайшие занятия»: today and the next 13 Moscow days.
export function upcomingWindow(today: string) {
    return { from: today, to: addDays(today, UPCOMING_DAYS - 1) };
}

// Lessons that have not ended yet, in calendar order, at most UPCOMING_LIMIT, and how many more there are.
export function upcomingOf(entries: CalendarEntry[], now: number) {
    const open = entries.filter((entry) => lessonEnd(entry.lesson) > now);
    return { shown: open.slice(0, UPCOMING_LIMIT), more: Math.max(0, open.length - UPCOMING_LIMIT) };
}

// «1 занятие», «3 занятия», «5 занятий».
export function lessonsCount(n: number) {
    const last = n % 10,
        tens = n % 100;
    return n + (last === 1 && tens !== 11 ? ' занятие' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? ' занятия' : ' занятий');
}

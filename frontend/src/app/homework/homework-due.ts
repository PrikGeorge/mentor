import type { components } from '../api/schema';
import type { LessonTag } from '../lessons/lesson-status';
// T09: the homework deadline of a lesson. The server decides the state at read time; the interface only words it.
// Late work is always accepted, and an archived card is never shown as overdue (it accepts no work at all).
export type HomeworkDue = components['schemas']['HomeworkDue'];
const DAY = 86400000;
export function dueInstant(due: { date: string; time: string }) {
    return Date.parse(`${due.date}T${due.time}:00+03:00`);
}
// «20.10, 23:59».
export function dueShort(due: { date: string; time: string }) {
    return `${due.date.slice(8, 10)}.${due.date.slice(5, 7)}, ${due.time}`;
}
// Calendar days between Moscow dates: «сегодня», «завтра», «через 3 дн.».
function moscowDay(ms: number) {
    return Date.parse(
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) + 'T00:00:00Z'
    );
}
function relative(due: HomeworkDue, now: number) {
    const days = Math.round((Date.parse(due.date + 'T00:00:00Z') - moscowDay(now)) / DAY);
    return days <= 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} дн.`;
}
export function overdueDays(due: HomeworkDue, now: number) {
    return Math.floor((now - dueInstant(due)) / DAY);
}
// The tag next to the lesson status; null when there is nothing to add.
export function dueTag(
    due: HomeworkDue | undefined | null,
    viewer: 'teacher' | 'student',
    archived = false,
    now = Date.now()
): (LessonTag & { danger?: boolean; warn?: boolean }) | null {
    if (!due) return null;
    if (due.state === 'onTime') return { label: 'Сдано в срок', icon: 'check', on: false, quiet: true };
    if (due.state === 'late') return { label: 'Сдано после срока', icon: 'clock', on: false, quiet: true };
    if (due.state !== 'overdue' || archived) return null;
    if (viewer === 'student') return { label: 'Срок прошёл', icon: 'clock', on: false, quiet: false, warn: true };
    const days = overdueDays(due, now);
    return { label: days >= 1 ? `Просрочено на ${days} дн.` : 'Срок прошёл', icon: 'triangle-alert', on: false, quiet: false, danger: true };
}
// One line about the deadline for the student (homework page, dashboard) or the teacher.
export function dueLine(due: HomeworkDue, viewer: 'teacher' | 'student', archived = false, now = Date.now()) {
    if (due.state === 'onTime') return `Срок ${dueShort(due)} МСК · сдано в срок`;
    if (due.state === 'late') return `Срок ${dueShort(due)} МСК · сдано после срока`;
    if (due.state === 'overdue' && !archived)
        return viewer === 'student'
            ? `Срок был ${dueShort(due)}. Сдай, когда будет готово — наставник посмотрит.`
            : `Срок ${dueShort(due)} МСК прошёл, работ пока нет.`;
    if (due.state === 'overdue') return `Срок был ${dueShort(due)} МСК.`;
    return viewer === 'student' ? `Сдать до ${dueShort(due)} МСК · ${relative(due, now)}` : `ДЗ до ${dueShort(due)} МСК · ${relative(due, now)}`;
}
// A work sent after the deadline gets a quiet «после срока» in the history.
export function afterDeadline(due: HomeworkDue | null | undefined, createdAt: string) {
    return !!due && Date.parse(createdAt) > dueInstant(due);
}

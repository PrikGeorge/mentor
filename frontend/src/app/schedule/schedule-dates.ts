// Calendar arithmetic of the teacher's schedule (T04). Lessons are stored as Moscow wall-clock dates and times;
// Moscow has no daylight saving, so a fixed +03:00 offset turns them into instants.
const DAY = 86400000;
const weekdays = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const utc = (date: string) => Date.parse(date + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A real calendar day in ISO form; «2026-02-30» is not one.
export function isCalendarDate(value: string | null | undefined): value is string {
    return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(utc(value)) && iso(utc(value)) === value;
}
export function addDays(date: string, days: number) {
    return iso(utc(date) + days * DAY);
}
// Weeks start on Monday.
export function mondayOf(date: string) {
    return addDays(date, -((new Date(utc(date)).getUTCDay() + 6) % 7));
}
export function weekDays(monday: string) {
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
// «13–19 октября 2026», «27 октября – 2 ноября 2026», «29 декабря 2025 – 4 января 2026».
export function weekLabel(monday: string) {
    const [a, b] = [new Date(utc(monday)), new Date(utc(addDays(monday, 6)))];
    const end = `${b.getUTCDate()} ${months[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${a.getUTCDate()} ${months[a.getUTCMonth()]} ${a.getUTCFullYear()} – ${end}`;
    if (a.getUTCMonth() !== b.getUTCMonth()) return `${a.getUTCDate()} ${months[a.getUTCMonth()]} – ${end}`;
    return `${a.getUTCDate()}–${end}`;
}
// «Понедельник, 13 октября».
export function dayLabel(date: string) {
    const d = new Date(utc(date));
    return `${weekdays[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
export function lessonStart(lesson: { date: string; time: string }) {
    return Date.parse(`${lesson.date}T${lesson.time}:00+03:00`);
}
export function lessonEnd(lesson: { date: string; time: string; duration: number }) {
    return lessonStart(lesson) + lesson.duration * 60000;
}
// The wall-clock end, wrapping past midnight: 23:30 + 90 min → 01:00.
export function endTime(lesson: { time: string; duration: number }) {
    const [h, m] = lesson.time.split(':').map(Number);
    const minutes = (h * 60 + m + lesson.duration) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

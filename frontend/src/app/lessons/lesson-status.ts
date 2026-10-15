export type LessonTag = { label: string; icon: string; on: boolean; quiet: boolean };
type TaggedLesson = { status: string; conductedAt?: string; date?: string; time?: string; duration?: number };
// The tag of a lesson: the teacher's explicit "held" mark wins over material readiness. The student never sees whether
// the mark is missing (T16): once a lesson has ended without it, their tag is a neutral «Прошло».
export function lessonStatus(lesson: TaggedLesson, viewer: 'teacher' | 'student' = 'teacher', now = Date.now()): LessonTag {
    if (lesson.conductedAt) return { label: 'Проведено', icon: 'check-check', on: false, quiet: true };
    if (viewer === 'student' && lessonEnded(lesson, now)) return { label: 'Прошло', icon: 'calendar', on: false, quiet: true };
    return lesson.status === 'prepared'
        ? { label: 'Подготовлено', icon: 'check', on: true, quiet: false }
        : { label: 'Запланировано', icon: 'calendar', on: false, quiet: false };
}
// Lessons are Moscow wall-clock times; Moscow keeps +03:00 all year.
export function lessonEnded(lesson: { date?: string; time?: string; duration?: number }, now = Date.now()) {
    if (!lesson.date || !lesson.time || lesson.duration === undefined) return false;
    const end = Date.parse(`${lesson.date}T${lesson.time}:00+03:00`) + lesson.duration * 60000;
    return Number.isFinite(end) && end <= now;
}

// The tag of a lesson: the teacher's explicit "held" mark wins over material readiness.
export function lessonStatus(lesson: { status: string; conductedAt?: string }): { label: string; icon: string; on: boolean; quiet: boolean } {
    if (lesson.conductedAt) return { label: 'Проведено', icon: 'check-check', on: false, quiet: true };
    return lesson.status === 'prepared' ? { label: 'Подготовлено', icon: 'check', on: true, quiet: false } : { label: 'Запланировано', icon: 'calendar', on: false, quiet: false };
}

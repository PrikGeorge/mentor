import type { components } from '../api/schema';
import type { Attempt } from './practice-api.service';
export type AttemptSummary = components['schemas']['AttemptSummary'];
export type WorkerStatus = components['schemas']['WorkerStatus'];
// Human-readable attempt states shared by the result pane and the history list; the words are the ones the tests look for.
const RESULT_LABELS: Record<string, string> = {
    accepted: 'Все проверки пройдены',
    wrong_answer: 'Есть неверный ответ',
    compile_error: 'Ошибка компиляции',
    runtime_error: 'Ошибка выполнения',
    time_limit: 'Превышено время',
    error: 'Проверка временно недоступна',
    unavailable: 'Проверка временно недоступна',
};
const TEST_LABELS: Record<string, string> = { accepted: 'пройден', wrong_answer: 'не пройден', runtime_error: 'ошибка выполнения', time_limit: 'превышено время' };
const STATE_ICONS: Record<string, string> = { accepted: 'circle-check', wrong_answer: 'circle-x', compile_error: 'file-x', runtime_error: 'bug', time_limit: 'timer-off' };
const FAILURES = new Set(['wrong_answer', 'compile_error', 'runtime_error', 'time_limit']);
export function modeLabel(mode: Attempt['mode']) { return mode === 'run' ? 'Примеры' : 'Все проверки'; }
export function isFailure(attempt: Attempt) { return FAILURES.has(attempt.result?.status ?? ''); }
export function stateIcon(attempt: Attempt) {
    if (attempt.jobState === 'queued') return 'hourglass';
    if (attempt.jobState === 'running') return 'loader';
    return STATE_ICONS[attempt.result?.status ?? ''] ?? 'cloud-off';
}
export function stateLabel(attempt: Attempt) {
    if (attempt.jobState === 'queued') return 'В очереди';
    if (attempt.jobState === 'running') return 'Выполняется';
    const status = attempt.result?.status ?? '';
    if (status === 'accepted' || FAILURES.has(status)) return RESULT_LABELS[status];
    return attempt.jobState === 'failed' ? 'Проверка временно недоступна' : 'Результат проверки';
}
export function historyLabel(row: AttemptSummary) {
    const status = row.result?.status;
    if (status) return RESULT_LABELS[status] ?? status;
    return row.jobState === 'queued' ? 'В очереди' : row.jobState === 'running' ? 'Выполняется' : row.jobState;
}
export function testLabel(status: string) { return TEST_LABELS[status] ?? status; }
export function scalar(value: components['schemas']['PublicResultValue']) { return value === null ? 'null' : String(value); }

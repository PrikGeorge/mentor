import { HttpErrorResponse } from '@angular/common/http';

// FE-10: one reading of API failures for every screen. The server's `message` is an English diagnostic
// and never reaches the page: the problem code (or the HTTP status) chooses the Russian wording, and a
// caller may name its own text for a code or status where the context says more.
export interface ApiProblem {
    // HTTP status; 0 when the server was not reached; null for a failure that is not an HTTP response.
    status: number | null;
    code: string;
    requestId: string | null;
}

type Overrides = Partial<Record<string | number, string>>;

const BY_CODE: Record<string, string> = {
    INVALID_CREDENTIALS: 'Неверный логин или пароль.',
    UNAUTHORIZED: 'Сессия закончилась, нужно войти снова.',
    ACCOUNT_CHANGED: 'В другой вкладке сменили аккаунт или пароль. Нужно обновить страницу.',
    FORBIDDEN: 'Это действие недоступно.',
    ARCHIVED: 'Курс завершён, новые работы не принимаются.',
    NOT_FOUND: 'Не найдено. Возможно, это удалили или закрыли доступ.',
    REVISION_CONFLICT: 'Данные успели измениться. Нужно обновить страницу и повторить.',
    EXERCISE_REVISION_CONFLICT: 'Упражнение обновилось. Обнови страницу и выбери, как перейти на новую версию.',
    CONFLICT: 'Такие данные уже есть или успели измениться. Нужно обновить страницу и повторить.',
    ACCOUNT_EXISTS: 'У этого ученика уже есть аккаунт.',
    ACCOUNT_REQUIRED: 'У ученика ещё нет аккаунта. Сначала пригласите его.',
    LOGIN_EXISTS: 'Этот логин уже занят, нужен другой.',
    TOKEN_INVALID: 'Ссылка устарела или уже использована. Новую можно попросить у того, кто её прислал.',
    COMMENT_LIMIT: 'У этого кода уже слишком много комментариев. Удалите лишние.',
    LESSON_IN_USE: 'Занятие нельзя удалить: в нём есть работы, материалы или черновики.',
    MATERIAL_EXISTS: 'Документ с этой ролью уже есть. Удалите его или выберите другую роль.',
    NOT_TEXT: 'Этот файл нельзя показать как текст, его можно только скачать.',
    BLOB_CONFLICT: 'Загрузка прервалась, файл нужно выбрать ещё раз.',
    AUTH_BUSY: 'Сервер занят проверкой паролей. Можно повторить через пару секунд.',
    RATE_LIMITED: 'Слишком много попыток подряд. Можно повторить через несколько минут.',
    QUEUE_FULL: 'Очередь проверки заполнена. Повтори отправку чуть позже.',
    AUTH_UNAVAILABLE: 'Сервер временно недоступен. Можно повторить чуть позже.',
};

const BY_STATUS: Record<number, string> = {
    0: 'Нет связи с сервером. Можно проверить интернет и повторить.',
    401: BY_CODE['UNAUTHORIZED'],
    403: BY_CODE['FORBIDDEN'],
    404: BY_CODE['NOT_FOUND'],
    409: BY_CODE['REVISION_CONFLICT'],
    413: 'Файл или текст слишком большой.',
    429: BY_CODE['RATE_LIMITED'],
    503: BY_CODE['AUTH_UNAVAILABLE'],
};

// These describe the session or the card, not the action, so a screen's own text for the status never hides them.
const OVER_STATUS = new Set(['UNAUTHORIZED', 'ACCOUNT_CHANGED', 'ARCHIVED']);
// A temporary failure keeps the screen's own sentence in front: «Не удалось загрузить учеников. Нет связи…».
const TRANSIENT = new Set([0, 429, 503]);

export function apiProblem(error: unknown): ApiProblem {
    const status =
        error instanceof HttpErrorResponse
            ? error.status
            : typeof (error as { status?: unknown } | null)?.status === 'number'
              ? (error as { status: number }).status
              : null;
    const body = (error as { error?: unknown } | null)?.error;
    const field = (name: string) => {
        const value = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
        return typeof value === 'string' && value ? value : null;
    };
    const header = error instanceof HttpErrorResponse ? error.headers?.get('X-Request-ID') : null;
    return { status, code: field('code') ?? '', requestId: field('requestId') ?? header ?? null };
}

// Russian text for a failure: the caller's text for its code, a session-level code, the caller's text for the
// status, then the shared code and status texts, then `fallback` (input errors 400, server errors 500 and
// failures that are not HTTP responses keep the caller's context).
export function errorMessage(error: unknown, fallback: string, overrides: Overrides = {}): string {
    const { status, code } = apiProblem(error);
    const own = (code && overrides[code]) || (OVER_STATUS.has(code) ? BY_CODE[code] : '') || (status !== null && overrides[status]);
    if (own) return own;
    const shared = (code && BY_CODE[code]) || (status !== null && BY_STATUS[status]);
    if (!shared) return fallback;
    return status !== null && TRANSIENT.has(status) ? `${fallback} ${shared}` : shared;
}

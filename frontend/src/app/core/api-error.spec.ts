import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { apiProblem, errorMessage } from './api-error';

const failure = (status: number, code?: string, message = 'English diagnostic.') =>
    new HttpErrorResponse({ status, error: code ? { status, code, message, requestId: 'r-1' } : null, headers: new HttpHeaders({ 'X-Request-ID': 'h-1' }) });

describe('API errors', () => {
    it('reads the status, code and request id of a problem response', () => {
        expect(apiProblem(failure(409, 'REVISION_CONFLICT'))).toEqual({ status: 409, code: 'REVISION_CONFLICT', requestId: 'r-1' });
        expect(apiProblem(failure(502))).toEqual({ status: 502, code: '', requestId: 'h-1' });
        expect(apiProblem(new Error('local'))).toEqual({ status: null, code: '', requestId: null });
        expect(apiProblem(null)).toEqual({ status: null, code: '', requestId: null });
    });

    it('never shows the English server message', () => {
        expect(errorMessage(failure(404, 'NOT_FOUND', 'Resource unavailable.'), 'Не удалось.')).toBe('Не найдено. Возможно, это удалили или закрыли доступ.');
        expect(errorMessage(failure(401, 'INVALID_CREDENTIALS', 'Invalid login or password.'), 'Не удалось.')).toBe('Неверный логин или пароль.');
        expect(errorMessage(failure(400, 'INVALID_INPUT', 'Invalid date.'), 'Не удалось сохранить занятие.')).toBe('Не удалось сохранить занятие.');
        expect(errorMessage(failure(500, 'INTERNAL_ERROR'), 'Не удалось загрузить.')).toBe('Не удалось загрузить.');
    });

    it('prefers the caller text for a code or status, then the shared code, then the status', () => {
        expect(errorMessage(failure(409, 'COMMENT_LIMIT'), 'x', { 409: 'Своё' })).toBe('Своё');
        expect(errorMessage(failure(409, 'COMMENT_LIMIT'), 'x', { COMMENT_LIMIT: 'По коду', 409: 'По статусу' })).toBe('По коду');
        expect(errorMessage(failure(409, 'COMMENT_LIMIT'), 'x')).toBe('У этого кода уже слишком много комментариев. Удалите лишние.');
        expect(errorMessage(failure(409), 'x')).toBe('Данные успели измениться. Нужно обновить страницу и повторить.');
        expect(errorMessage(failure(413), 'x')).toBe('Файл или текст слишком большой.');
        expect(errorMessage(failure(429, 'QUEUE_FULL'), 'x')).toBe('x Очередь проверки заполнена. Повтори отправку чуть позже.');
    });

    it('keeps the session-level codes above a screen text for the status', () => {
        expect(errorMessage(failure(409, 'ACCOUNT_CHANGED'), 'x', { 409: 'Занятие уже изменили.' })).toBe(
            'В другой вкладке сменили аккаунт или пароль. Нужно обновить страницу.'
        );
        expect(errorMessage(failure(403, 'ARCHIVED'), 'x', { 403: 'Своё' })).toBe('Курс завершён, новые работы не принимаются.');
        expect(errorMessage(failure(401, 'INVALID_CREDENTIALS'), 'x', { INVALID_CREDENTIALS: 'Текущий пароль неверный.' })).toBe('Текущий пароль неверный.');
    });

    it('tells an unreachable server apart from a local failure and keeps the screen sentence in front', () => {
        expect(errorMessage(new HttpErrorResponse({ status: 0 }), 'Не удалось.')).toBe(
            'Не удалось. Нет связи с сервером. Можно проверить интернет и повторить.'
        );
        expect(errorMessage(failure(503, 'AUTH_UNAVAILABLE'), 'Не удалось загрузить учеников.')).toBe(
            'Не удалось загрузить учеников. Сервер временно недоступен. Можно повторить чуть позже.'
        );
        expect(errorMessage(new Error('Локальное сохранение недоступно.'), 'Не удалось.')).toBe('Не удалось.');
    });
});

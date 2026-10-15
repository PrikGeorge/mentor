import { inject, Injectable, signal } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { localDraftExpired } from '../core/local-drafts';
import type { SourceFiles, ExerciseRevision, AttemptIntent } from './practice-api.service';
export interface Recovery {
    files: SourceFiles;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is ExerciseRevision => typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
@Injectable({ providedIn: 'root' })
export class DraftRecovery {
    private readonly session = inject(SessionStore);
    readonly storageError = signal('');
    key(account: string, workspace: string, student: string, lesson: string, exercise: string, revision: ExerciseRevision) { return JSON.stringify(['mentor.practice.source.v1', account, workspace, student, lesson, exercise, [typeof revision, revision]]); }
    private owned(key: string) { try {
        const parts: unknown = JSON.parse(key);
        return Array.isArray(parts) && parts.length === 7 && parts[0] === 'mentor.practice.source.v1' && parts.slice(1, 6).every(value => typeof value === 'string' && value.length > 0) && Array.isArray(parts[6]) && parts[6].length === 2 && parts[6][0] === typeof parts[6][1] && revision(parts[6][1]) && parts[1] === this.session.actor()?.userId && parts[2] === this.session.actor()?.workspaceId;
    }
    catch {
        return false;
    } }
    save(key: string, files: SourceFiles): void { if (this.owned(key))
        this.write(key, { files, savedAt: Date.now() }); }
    read(key: string): Recovery | null { const value = this.load(key); return value && this.files(value['files']) ? { files: { ...value['files'] } } : null; }
    remove(key: string): void { this.removeOwned(key); }
    removeIntent(key: string): void { this.removeOwned(key, ':intent'); }
    private removeOwned(key: string, suffix = '') { if (!this.owned(key))
        return; try {
        localStorage.removeItem(key + suffix);
    }
    catch {
        this.storageError.set('Локальное хранилище недоступно.');
    } }
    saveIntent(key: string, intent: AttemptIntent) { if (this.owned(key))
        this.write(key + ':intent', { ...intent, savedAt: Date.now() }); }
    readIntent(key: string): AttemptIntent | null {
        const value = this.load(key, ':intent');
        if (!value)
            return null;
        const request = value['request'], token = value['key'], attempt = value['attemptId'];
        if (typeof token !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(token) || !record(request) || !this.files(request['files']) || !revision(request['exerciseRevision']) || (request['mode'] !== 'run' && request['mode'] !== 'submit') || attempt !== undefined && (typeof attempt !== 'string' || !attempt))
            return null;
        return { key: token, request: { files: { ...request['files'] }, exerciseRevision: request['exerciseRevision'], mode: request['mode'] }, ...(typeof attempt === 'string' ? { attemptId: attempt } : {}) };
    }
    private files(value: unknown): value is SourceFiles { return record(value) && Object.keys(value).length >= 1 && Object.keys(value).length <= 16 && Object.values(value).every(text => typeof text === 'string'); }
    private load(key: string, suffix = ''): Record<string, unknown> | null { if (!this.owned(key))
        return null; try {
        const raw = localStorage.getItem(key + suffix), value: unknown = raw ? JSON.parse(raw) : null;
        // FE-07: an expired copy is dropped instead of restored over the server draft.
        if (localDraftExpired(value)) {
            localStorage.removeItem(key + suffix);
            return null;
        }
        return record(value) ? value : null;
    }
    catch {
        this.storageError.set('Локальное восстановление недоступно. Код остаётся в редакторе.');
        return null;
    } }
    private write(key: string, value: unknown) { try {
        localStorage.setItem(key, JSON.stringify(value));
        this.storageError.set('');
    }
    catch {
        this.storageError.set('Локальное сохранение недоступно. Экспортируйте код перед выходом.');
        throw new Error(this.storageError());
    } }
}

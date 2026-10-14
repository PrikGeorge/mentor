import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import type { Submission } from './homework-api.service';
type SubmissionStatus = Submission['status'];

// Whose turn it is follows the latest homework exchange: a submitted work waits for the mentor, anything else is the student's move.
export type TurnState = 'none' | SubmissionStatus;
export interface Turn { state: TurnState; submittedAt?: string; reviewedAt?: string; lessonId?: string }
export function turnOf(latest: { status: SubmissionStatus; createdAt: string; reviewedAt?: string; lessonId?: string } | null | undefined): Turn {
    return latest ? { state: latest.status, submittedAt: latest.createdAt, reviewedAt: latest.reviewedAt, lessonId: latest.lessonId } : { state: 'none' };
}
export const mentorsTurn = (turn: Turn) => turn.state === 'submitted';
const moscow = (value: string | undefined, time: boolean) => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value)) : '';
export function turnHeadline(turn: Turn, viewer: 'student' | 'teacher'): { title: string; text: string } {
    if (viewer === 'teacher') return mentorsTurn(turn)
        ? { title: 'Ход за вами', text: `Работа отправлена ${moscow(turn.submittedAt, true)} и ждёт ревью.` }
        : { title: 'Ход у ученика', text: turn.state === 'none' ? 'Ученик ещё не сдавал работ.' : `Вы ответили ${moscow(turn.reviewedAt, false)}.` };
    if (mentorsTurn(turn)) return { title: 'Ход у наставника', text: `Работа отправлена ${moscow(turn.submittedAt, true)}. Можно спокойно заниматься другим.` };
    if (turn.state === 'needs_revision') return { title: 'Твой ход', text: 'Наставник просит доработать работу — открой ревью и отправь новую версию.' };
    if (turn.state === 'reviewed') return { title: 'Твой ход', text: `Наставник ответил ${moscow(turn.reviewedAt, false)}. Посмотри отзыв и переходи к следующим заданиям.` };
    return { title: 'Твой ход', text: 'Открой задания к занятию и сдай домашнюю работу, когда будет готово.' };
}
type Face = { title: string; note: string; value?: string; caption?: string };

@Component({
    selector: 'mentor-turn-clock', changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div class="clock" [class.mini]="mini()" role="group" [attr.aria-label]="label()">@for (face of faces(); track $index) {<div class="face" [class.on]="face.on" [class.off]="!face.on"><b>{{ face.title }}</b><span>{{ face.note }}</span>@if (!mini() && (face.value || !face.on)) {<strong [class.num]="face.value === countdown()">{{ face.value || '—' }}</strong>@if (face.caption) {<span>{{ face.caption }}</span>}}</div>}</div>`,
})
export class TurnClockComponent {
    readonly turn = input.required<Turn>();
    readonly viewer = input<'student' | 'teacher'>('student');
    readonly name = input('');
    readonly mini = input(false);
    // Lesson start (ISO). Only the time to the lesson is ever counted down, never the mentor's answer time.
    readonly start = input<string | null>(null);
    private readonly now = signal(Date.now());
    constructor() { const timer = setInterval(() => this.now.set(Date.now()), 30000); inject(DestroyRef).onDestroy(() => clearInterval(timer)); }
    readonly countdown = computed(() => {
        const start = this.start(); if (!start) return '';
        const left = Date.parse(start) - this.now(); if (!Number.isFinite(left) || left <= 0) return '';
        if (left > 48 * 3600000) return Math.floor(left / 86400000) + ' дн.';
        const minutes = Math.floor(left / 60000);
        return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    });
    readonly faces = computed<(Face & { on: boolean })[]>(() => {
        const turn = this.turn(), teacher = this.viewer() === 'teacher', mentor = mentorsTurn(turn);
        const student = (this.name().trim().split(/\s+/)[0] || 'Ученик');
        const sent = moscow(turn.submittedAt, true), answered = moscow(turn.reviewedAt, false);
        const countdown = !teacher && !mentor ? this.countdown() : '';
        const left: Face = mentor ? { title: student, note: `работа отправлена ${sent}` }
            : { title: student, note: (teacher ? 'ход у ученика' : 'твой ход') + (turn.state === 'needs_revision' ? ' · доработка' : ''), value: countdown, caption: countdown ? 'до занятия' : undefined };
        const right: Face = teacher
            ? mentor ? { title: 'Вы', note: 'ход за вами', value: 'ждёт ревью' } : { title: 'Вы', note: turn.state === 'none' ? 'ждёте работу' : `ответили ${answered}` }
            : mentor ? { title: 'Наставник', note: 'ход у наставника', value: 'проверяет' } : { title: 'Наставник', note: turn.state === 'none' ? 'ждёт твоего хода' : `ответил ${answered}` };
        return [{ ...left, on: !mentor }, { ...right, on: mentor }];
    });
    readonly label = computed(() => { const [left, right] = this.faces(); const on = left.on ? left : right; return `Чей ход: ${on.title} — ${on.note}` + (on.value ? `, ${on.value}` : '') + `. ${left.on ? right.title + ' — ' + right.note : left.title + ' — ' + left.note}.`; });
}

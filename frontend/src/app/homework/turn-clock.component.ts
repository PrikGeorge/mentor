import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { Clock } from '../core/clock';
import { Motion, animateOnChange, motionEase, motionMs } from '../core/motion';
import type { Submission } from './homework-api.service';
type SubmissionStatus = Submission['status'];

// Whose turn it is follows the latest homework exchange: a submitted work waits for the mentor, anything else is the student's move.
export type TurnState = 'none' | SubmissionStatus;
// kind attempt is a submitted trainer exercise placed as homework; the mentor answers it with a line comment instead of a review.
export type TurnKind = 'homework' | 'attempt';
export interface Turn { state: TurnState; submittedAt?: string; reviewedAt?: string; lessonId?: string; kind?: TurnKind }
export function turnOf(latest: { status: SubmissionStatus; createdAt: string; reviewedAt?: string; lessonId?: string; kind?: TurnKind } | null | undefined): Turn {
    return latest ? { state: latest.status, submittedAt: latest.createdAt, reviewedAt: latest.reviewedAt, lessonId: latest.lessonId, kind: latest.kind ?? 'homework' } : { state: 'none' };
}
export const mentorsTurn = (turn: Turn) => turn.state === 'submitted';
// Where the mentor answers this move: the review tab for a file, the trainer for an attempt.
export const turnSection = (turn: Turn) => turn.kind === 'attempt' ? 'practice' : 'review';
const sentPhrase = (turn: Turn, capital: boolean) => turn.kind === 'attempt' ? (capital ? 'Решение упражнения отправлено' : 'решение отправлено') : (capital ? 'Работа отправлена' : 'работа отправлена');
const moscow = (value: string | undefined, time: boolean) => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value)) : '';
export function turnHeadline(turn: Turn, viewer: 'student' | 'teacher'): { title: string; text: string } {
    if (viewer === 'teacher') return mentorsTurn(turn)
        ? { title: 'Ход за вами', text: `${sentPhrase(turn, true)} ${moscow(turn.submittedAt, true)} и ждёт ${turn.kind === 'attempt' ? 'вашего комментария' : 'ревью'}.` }
        : { title: 'Ход у ученика', text: turn.state === 'none' ? 'Ученик ещё не сдавал работ.' : `Вы ответили ${moscow(turn.reviewedAt, false)}.` };
    if (mentorsTurn(turn)) return { title: 'Ход у наставника', text: `${sentPhrase(turn, true)} ${moscow(turn.submittedAt, true)}. Можно спокойно заниматься другим.` };
    if (turn.state === 'needs_revision') return { title: 'Твой ход', text: 'Наставник просит доработать работу — открой ревью и отправь новую версию.' };
    if (turn.state === 'reviewed') return { title: 'Твой ход', text: `Наставник ответил ${moscow(turn.reviewedAt, false)}. Посмотри ревью и переходи к следующим заданиям.` };
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
    // UX-28 M2: the parent names what the clock is bound to (a lesson); only then a turn that changes in front of the user
    // plays as a move. Lists and cards pass nothing: there the turn is only ever shown, never seen changing.
    readonly motionKey = input<string | null>(null);
    private readonly now = inject(Clock).watch();
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly motion = inject(Motion);
    constructor() {
        animateOnChange({ value: () => mentorsTurn(this.turn()), key: () => this.motionKey(), play: () => this.playMove() });
    }
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
        const left: Face = mentor ? { title: student, note: `${sentPhrase(turn, false)} ${sent}` }
            : { title: student, note: (teacher ? 'ход у ученика' : 'твой ход') + (turn.state === 'needs_revision' ? ' · доработка' : ''), value: countdown, caption: countdown ? 'до занятия' : undefined };
        const right: Face = teacher
            ? mentor ? { title: 'Вы', note: 'ход за вами', value: 'ждёт ревью' } : { title: 'Вы', note: turn.state === 'none' ? 'ждёте работу' : `ответили ${answered}` }
            : mentor ? { title: 'Наставник', note: 'ход у наставника', value: 'проверяет' } : { title: 'Наставник', note: turn.state === 'none' ? 'ждёт твоего хода' : `ответил ${answered}` };
        return [{ ...left, on: !mentor }, { ...right, on: mentor }];
    });
    readonly label = computed(() => { const [left, right] = this.faces(); const on = left.on ? left : right; return `Чей ход: ${on.title} — ${on.note}` + (on.value ? `, ${on.value}` : '') + `. ${left.on ? right.title + ' — ' + right.note : left.title + ' — ' + left.note}.`; });
    // The side that moved presses its button, the fill slides over the shared edge, the other button rises.
    // Labels keep their previous colours until the fill is half-way, so the colour changes with a click, not a blend.
    private playMove(): Animation[] {
        if (this.motionKey() === null) return [];
        const faces = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.face'));
        const on = faces.find((face) => face.classList.contains('on'));
        const off = faces.find((face) => face.classList.contains('off'));
        if (!on || !off) return [];
        const toRight = faces.indexOf(on) === 1;
        const press = motionMs('instant'), move = motionMs('move'), rise = motionMs('quick');
        const start = Math.round(move * 0.3);
        const pressed = this.mini() ? 'translateY(2px) scaleY(.67)' : 'translateY(5px) scaleY(.78)';
        const held = (face: HTMLElement, other: HTMLElement) => Array.from(face.children).map((child, index) => {
            const twin = other.children[index];
            if (!twin || twin.tagName !== child.tagName) return null;
            const color = getComputedStyle(twin).color;
            return this.motion.animate(child, [{ color }, { color }], { duration: start + move / 2 });
        });
        const colours = [...held(on, off), ...held(off, on)];
        return [
            ...colours,
            this.motion.animate(off, [{ transform: 'none' }, { transform: pressed }], { duration: press, easing: motionEase('exit'), pseudoElement: '::before' }),
            this.motion.animate(off, [{ clipPath: 'inset(0)' }, { clipPath: toRight ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }], { duration: move, delay: start, easing: motionEase('move'), fill: 'backwards', pseudoElement: '::after' }),
            this.motion.animate(on, [{ clipPath: toRight ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }], { duration: move, delay: start, easing: motionEase('move'), fill: 'backwards', pseudoElement: '::after' }),
            this.motion.animate(on, [{ transform: pressed }, { transform: 'none' }], { duration: rise, delay: move, easing: motionEase('move'), fill: 'backwards', pseudoElement: '::before' }),
        ].filter((animation): animation is Animation => !!animation);
    }
}

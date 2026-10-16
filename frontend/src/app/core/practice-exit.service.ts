import { Injectable, signal } from '@angular/core';
export interface ExitParticipant {
    valid(): boolean;
    blocked?():boolean;
    dirty(): boolean;
    pause(value: boolean): void;
    save(): Promise<boolean>;
    export(): boolean;
    discard(): void;
}
@Injectable({ providedIn: 'root' })
export class PracticeExit {
    readonly open = signal(false);
    readonly busy = signal(false);
    readonly error = signal('');
    private participant: ExitParticipant | null = null;
    private resolve: ((allowed: boolean) => void) | null = null;
    private pending: Promise<boolean> | null = null;
    register(participant: ExitParticipant): () => void { this.participant = participant; return () => { if (this.participant === participant) {
        this.finish(false);
        this.participant = null;
    } }; }
    ask(): Promise<boolean> {
        if (this.pending)
            return this.pending;
        if(this.participant?.blocked?.())return Promise.resolve(false);
        if (!this.participant?.valid() || !this.participant.dirty())
            return Promise.resolve(true);
        this.participant.pause(true);
        this.error.set('');
        this.open.set(true);
        this.pending = new Promise(resolve => this.resolve = resolve);
        return this.pending;
    }
    async choose(action: 'save' | 'export' | 'discard' | 'cancel'): Promise<void> {
        const participant = this.participant;
        if (this.busy() || !this.pending)
            return;
        if (!participant?.valid()) {
            this.finish(false);
            return;
        }
        if (action === 'cancel') {
            participant.pause(false);
            this.finish(false);
            return;
        }
        this.busy.set(true);
        try {
            const allowed = action === 'save' ? await participant.save() : action === 'export' ? participant.export() : (participant.discard(), true);
            if (this.participant !== participant || !participant.valid()) {
                this.finish(false);
                return;
            }
            if (allowed)
                this.finish(true);
            else
                this.error.set('Код не сохранён и не скачан. Попробуй ещё раз или нажми «Отмена».');
        }
        catch {
            if (this.participant === participant && participant.valid())
                this.error.set('Не удалось сохранить или скачать код. Он остался в редакторе.');
        }
        finally {
            this.busy.set(false);
        }
    }
    private finish(allowed: boolean) { const resolve = this.resolve; this.resolve = null; this.pending = null; this.open.set(false); this.busy.set(false); this.error.set(''); resolve?.(allowed); }
}

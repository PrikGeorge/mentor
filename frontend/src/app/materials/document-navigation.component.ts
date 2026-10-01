import { Component, DestroyRef, effect, ElementRef, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import type { MaterialSection } from './materials-api.service';
@Component({ selector: 'mentor-document-navigation', template: `<aside class="document-toc"><details class="toc-disclosure" [open]="wide()"><summary>Разделы материала</summary><nav aria-label="Оглавление материала">@for(section of sections();track section.id){<a [href]="'#'+section.id" (click)="goTo(section.id,$event)" [attr.aria-current]="active()===section.id?'location':null">{{section.title}}</a>}</nav></details><button class="btn" type="button" (click)="expand()" [attr.aria-expanded]="expanded()">{{expanded()?'Свернуть пояснения':'Развернуть пояснения'}}</button><button class="btn" type="button" (click)="print()">Печать / PDF ↗</button></aside>` })
export class DocumentNavigationComponent {
    readonly sections = input<MaterialSection[]>([]); readonly active = signal(''); readonly expanded = signal(false); readonly wide = signal(globalThis.innerWidth > 1180);
    private readonly host: ElementRef<HTMLElement> = inject(ElementRef); private readonly router = inject(Router); private readonly destroyRef = inject(DestroyRef); private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
    private printing = false; private snapshot: { element: HTMLDetailsElement; open: boolean }[] = []; private focus: HTMLElement | null = null;
    private root() { return this.host.nativeElement.closest<HTMLElement>('.material-document'); }
    constructor() {
        const before = () => { const root = this.root(); if (!root || this.printing) return; this.printing = true; this.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null; this.snapshot = Array.from(root.querySelectorAll('details')).map(element => ({ element, open: element.open })); for (const state of this.snapshot) state.element.open = true; };
        const after = () => { for (const state of this.snapshot) if (state.element.isConnected) state.element.open = state.open; this.snapshot = []; this.printing = false; if (this.focus?.isConnected) this.focus.focus({ preventScroll: true }); this.refresh(); };
        const resize = () => this.wide.set(globalThis.innerWidth > 1180);
        const toggle = () => this.refresh();
        window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after); window.addEventListener('resize', resize); this.host.nativeElement.parentElement?.addEventListener('toggle', toggle, true);
        this.destroyRef.onDestroy(() => { after(); window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); window.removeEventListener('resize', resize); this.host.nativeElement.parentElement?.removeEventListener('toggle', toggle, true); });
        effect(onCleanup => { const id = this.fragment(); this.sections(); const timer = setTimeout(() => { if (id) this.goTo(id); this.refresh(); }, 0); onCleanup(() => clearTimeout(timer)); });
    }
    private refresh() { const details = this.root()?.querySelectorAll<HTMLDetailsElement>('.explanation-details') ?? []; this.expanded.set(details.length > 0 && Array.from(details).every(element => element.open)); }
    goTo(id: string, event?: Event) {
        event?.preventDefault(); const root = this.root(), section = root && Array.from(root.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === id);
        if (!section) return; for (let element: HTMLElement | null = section; element && element !== root; element = element.parentElement) if (element instanceof HTMLDetailsElement) element.open = true;
        const own = section.querySelector<HTMLDetailsElement>(':scope > details.roadmap-stage'); if (own) own.open = true;
        const heading = section.querySelector<HTMLElement>('h2,h3') ?? section; heading.tabIndex = -1; section.scrollIntoView?.({ block: 'start' }); heading.focus({ preventScroll: true }); this.active.set(id); this.refresh();
        if (event) void this.router.navigate([], { fragment: id, queryParamsHandling: 'preserve', replaceUrl: true });
    }
    expand() { const open = !this.expanded(); this.root()?.querySelectorAll<HTMLDetailsElement>('.explanation-details').forEach(element => element.open = open); this.refresh(); }
    print() { window.print(); }
}

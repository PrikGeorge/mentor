import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Motion } from './motion';
import { SessionStore } from './session.store';

// UX-28 M3: which navigations get the cross-fade between sections. Everything else changes instantly.
const PUBLIC_PATHS = new Set(['login', 'register', 'reset-password', 'account/password']);

export interface RouteMotionContext {
    reduced: boolean;
    // The session generation moved since NavigationStart: the old account must never fade over the new one.
    accountChanged: boolean;
}

const leaf = (route: ActivatedRouteSnapshot) => {
    let current = route;
    while (current.firstChild) current = current.firstChild;
    return current;
};
const isPublic = (route: ActivatedRouteSnapshot) => PUBLIC_PATHS.has(route.routeConfig?.path ?? '') || route.data['missing'] === true;
const isTrainer = (route: ActivatedRouteSnapshot) => (route.routeConfig?.path ?? '').includes('/practice');

export function shouldAnimate(from: ActivatedRouteSnapshot, to: ActivatedRouteSnapshot, context: RouteMotionContext): boolean {
    if (context.reduced || context.accountChanged) return false;
    const before = leaf(from);
    const after = leaf(to);
    // The same route config keeps the routed component (query-only changes, tabs inside one lesson screen): M4 plays there.
    if (before.routeConfig === after.routeConfig) return false;
    if (isPublic(before) || isPublic(after)) return false;
    // Monaco and the trainer's dark theme flash inside a snapshot.
    if (isTrainer(before) || isTrainer(after)) return false;
    return true;
}

@Injectable({ providedIn: 'root' })
export class RouteMotion {
    private readonly motion = inject(Motion);
    private readonly session = inject(SessionStore);
    private startedAt = this.session.generation();

    constructor() {
        // Created at start-up (app.config) so the very first NavigationStart is seen too.
        inject(Router)
            .events.pipe(filter((event) => event instanceof NavigationStart))
            .subscribe(() => (this.startedAt = this.session.generation()));
    }

    allow(from: ActivatedRouteSnapshot, to: ActivatedRouteSnapshot): boolean {
        return shouldAnimate(from, to, { reduced: this.motion.reduced(), accountChanged: this.startedAt !== this.session.generation() });
    }
}

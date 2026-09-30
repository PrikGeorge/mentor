import { inject, Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { Actor } from './session.store';
@Injectable({ providedIn: 'root' })
export class LegacyRouteAdapter {
  private readonly router = inject(Router);
  resolve(url: URL, actor: Actor): UrlTree | null {
    if (!url.hash || url.hash === '#main') return null;
    const missing = () => this.router.createUrlTree(['/not-found']);
    if (actor.role === 'ADMIN' || !actor.workspaceId) return missing();
    let parts: string[];
    try { parts = url.hash.slice(1).split('/').map(part => decodeURIComponent(part)); } catch { return missing(); }
    if (parts[0] !== 'students' || parts.some(part => !part || /[\/\\\u0000-\u001f]/.test(part))) return missing();
    const base = actor.role === 'TEACHER' ? '/teacher/students' : '/learn/students';
    if (parts.length <= 2) return this.router.createUrlTree([base, ...parts.slice(1)], { queryParams: this.preview(url, actor) });
    const profile = new Set(actor.role === 'TEACHER' ? ['profile','roadmap','projects','review','career','journal','goal','lessons'] : ['goal','lessons','roadmap','review']);
    if (parts[2] !== 'lessons' || parts.length < 4) {
      if (!profile.has(parts[2]) || parts.length > 4 || (parts[3] && !/^section-\d+$/.test(parts[3]))) return missing();
      return this.router.createUrlTree([base, parts[1], parts[2]], { fragment: parts[3] || undefined, queryParams: this.preview(url, actor) });
    }
    if (parts.length > 7) return missing();
    const audience = parts[4];
    if (audience && audience !== 'student' && audience !== 'teacher') return missing();
    if (actor.role === 'STUDENT' && audience !== 'student') return missing();
    const page = parts[5] || (audience === 'teacher' ? 'guide' : audience === 'student' ? 'tasks' : 'overview');
    const allowed = audience === 'student' ? ['tasks','materials','homework','code','practice','review'] : ['overview','plan','guide','materials','answers','run','verification','collections','streams','core','course','map-practice','code','practice','review'];
    if (!allowed.includes(page)) return missing();
    const detail = parts[6];
    if (detail && page !== 'code' && page !== 'practice' && !/^section-\d+$/.test(detail)) return missing();
    if (page === 'code' && (!detail || !(audience === 'student' ? ['ListTask','GroupingTask'] : ['ListTask','GroupingTask','ListSolutions','GroupingSolution']).includes(detail))) return missing();
    if (page === 'practice' && detail && !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(detail)) return missing();
    const commands = [base, parts[1], 'lessons', parts[3], ...(audience ? [audience, page] : [])];
    if (detail && ['code','practice'].includes(page)) commands.push(detail);
    return this.router.createUrlTree(commands, { fragment: detail?.startsWith('section-') ? detail : undefined, queryParams: this.preview(url, actor) });
  }
  private preview(url: URL, actor: Actor): Record<string,string> | undefined {
    return url.searchParams.get('screen') === 'student' && actor.role === 'TEACHER' ? { preview: 'student' } : undefined;
  }
}

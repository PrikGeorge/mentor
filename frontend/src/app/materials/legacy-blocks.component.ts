import { Component, computed, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { inject } from '@angular/core';
import type { components } from '../api/schema';
type Code = components['schemas']['MaterialCode'];
type Block = { kind: 'html'; html: string } | { kind: 'details'; summary: string; classes: string; id: string; open: boolean; children: Block[] } | { kind: 'group'; classes: string; id: string; children: Block[] } | { kind: 'source'; name: string; stage: string };
// Parse only inside an inert template. Never insert its raw DOM into the page.
function blocks(html: string): Block[] {
    const template = document.createElement('template'); template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,img,svg,math').forEach(element => element.remove());
    template.content.querySelectorAll('*').forEach(element => {
        for (const attribute of Array.from(element.attributes)) if (/^on/i.test(attribute.name) || ['style','src','srcset','action','formaction'].includes(attribute.name)) element.removeAttribute(attribute.name);
        if (element instanceof HTMLAnchorElement) {
            const href = element.getAttribute('href') ?? ''; let allowed = /^#[a-zA-Z0-9][\w/-]*$/.test(href);
            try { const url = new URL(href, location.origin); allowed ||= ['http:', 'https:','mailto:'].includes(url.protocol) && (/^(https?:\/\/|mailto:)/i.test(href) || url.origin === location.origin && /^\/api\/v1\/workspaces\/[^/]+\/materials\/[^/]+\/file$/.test(url.pathname)); } catch { /* remove unsafe link */ }
            if (!allowed || /[\u0000-\u0020\u007f\\]/.test(href)) element.removeAttribute('href');
            else if (/^(https?:|mailto:)/i.test(href)) { element.setAttribute('target','_blank'); element.setAttribute('rel','noopener noreferrer'); }
        }
    });
    const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]): Block[] => Array.from(nodes).flatMap<Block>(node => {
        if (node.nodeType === Node.COMMENT_NODE) { const match = /^\s*task-code:(\w+):(prediction|practice)\s*$/.exec(node.textContent ?? ''); return match ? [{ kind: 'source', name: match[1], stage: match[2] }] : []; }
        if (!(node instanceof HTMLElement)) { const escaped = document.createElement('span'); escaped.textContent = node.textContent; return [{ kind: 'html', html: escaped.innerHTML }]; }
        if (node.tagName === 'DETAILS') return [{ kind: 'details', summary: node.querySelector(':scope > summary')?.textContent ?? 'Пояснение', classes: node.className, id: node.id, open: node.hasAttribute('open'), children: walk(Array.from(node.childNodes).filter(child => !(child instanceof HTMLElement && child.tagName === 'SUMMARY'))) }];
        if (node.querySelector('details') || /<!--\s*task-code:/.test(node.innerHTML)) return [{ kind: 'group', classes: node.className, id: node.id, children: walk(node.childNodes) }];
        return [{ kind: 'html', html: node.outerHTML }];
    });
    return walk(template.content.childNodes);
}
@Component({ selector: 'mentor-legacy-blocks', imports: [RouterLink], template: `@for(block of nodes();track $index){@switch(block.kind){@case('html'){<div class="legacy-html" [innerHTML]="block.html" (click)="follow($event) "></div>}@case('details'){<details [class]="block.classes" [id]="block.id" [open]="block.open"><summary>{{block.summary}}</summary><mentor-legacy-blocks [nodes]="block.children" [code]="code()" [base]="base()" [preview]="preview()"/></details>}@case('group'){<div [class]="block.classes" [id]="block.id"><mentor-legacy-blocks [nodes]="block.children" [code]="code()" [base]="base()" [preview]="preview()"/></div>}@case('source'){@if(code()[block.name];as source){<article class="task-code"><h3>{{block.name}}.java</h3><p class="small-muted">Исходная заготовка · Только для чтения. Сохранённое решение открывается в тренажёре.</p><pre><code>{{excerpt(source)}}</code></pre><details><summary>Полный {{block.name}}.java</summary><pre><code>{{source.text}}</code></pre></details>@if(block.stage==='practice'&&taskFor(block.name);as task){<a class="btn primary" [routerLink]="base()+'/'+(publicView()?'student':'teacher')+'/practice/'+task" [queryParams]="preview()&&base().startsWith('/teacher')?{preview:'student'}:{}">Решать в тренажёре →</a>}</article>}@else{<p class="small-muted">Исходная заготовка недоступна.</p>}}}}` })
export class LegacyBlocksComponent {
    readonly nodes = input<Block[]>([]); readonly code = input<Record<string, Code>>({}); readonly base = input(''); readonly preview = input(false); private readonly router = inject(Router);
    publicView() { return this.preview() || this.base().startsWith('/learn/'); }
    taskFor(name: string) { return ({ ListTask: 'list-task', GroupingTask: 'grouping-task' } as Record<string,string>)[name]; }
    excerpt(code: Code) { const lines = code.text.split('\n'); return (code.excerpt ? lines.slice(code.excerpt.start,code.excerpt.end) : lines).map(line => line.replace(/^ {4}/,'')).join('\n'); }
    follow(event: Event) {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a'); const hash = anchor?.getAttribute('href'); if (!hash?.startsWith('#') || !this.base()) return;
        const parts = hash.slice(1).split('/'); if (!['student','lesson','practice','guide','homework','review','source','answers','materials','collections','streams','core','course','verification'].includes(parts[0])) return;
        event.preventDefault(); const audience = parts[0] === 'student' ? 'student' : this.publicView() ? 'student' : 'teacher', section = parts[0] === 'student' ? 'tasks' : parts[0] === 'source' ? 'code' : parts[0] === 'lesson' ? this.publicView() ? 'tasks' : 'plan' : parts[0];
        const detail = ['code','practice'].includes(section) && parts[1] ? '/' + encodeURIComponent(parts[1]) : '', fragment = parts[1]?.startsWith('section-') ? parts[1] : undefined;
        void this.router.navigateByUrl(this.router.createUrlTree([this.base()+'/'+audience+'/'+section+detail], { fragment, queryParams: audience === 'student' && this.base().startsWith('/teacher') ? { preview: 'student' } : {} }));
    }
}
@Component({ selector: 'mentor-legacy-html', imports: [LegacyBlocksComponent], template: `<mentor-legacy-blocks [nodes]="parsed()" [code]="code()" [base]="base()" [preview]="preview()"/>` })
export class LegacyHtmlComponent { readonly html = input(''); readonly code = input<Record<string, Code>>({}); readonly base = input(''); readonly preview = input(false); readonly parsed = computed(() => blocks(this.html())); }



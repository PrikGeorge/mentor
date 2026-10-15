import { Component, computed, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { inject } from '@angular/core';
import type { components } from '../api/schema';
type Code = components['schemas']['MaterialCode'];
type Block = {
    kind: 'html';
    html: string;
} | {
    kind: 'details';
    summary: string;
    classes: string;
    id: string;
    open: boolean;
    children: Block[];
} | {
    kind: 'group';
    classes: string;
    id: string;
    children: Block[];
} | {
    kind: 'source';
    name: string;
    stage: string;
};
// Parse only inside an inert template. Never insert its raw DOM into the page.
function blocks(html: string): Block[] {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,img,svg,math').forEach(element => element.remove());
    template.content.querySelectorAll('*').forEach(element => {
        for (const attribute of Array.from(element.attributes))
            if (/^on/i.test(attribute.name) || ['style', 'src', 'srcset', 'action', 'formaction'].includes(attribute.name))
                element.removeAttribute(attribute.name);
        if (element instanceof HTMLAnchorElement) {
            const href = element.getAttribute('href') ?? '';
            let allowed = /^#[a-zA-Z0-9][\w/-]*$/.test(href);
            try {
                const url = new URL(href, location.origin);
                allowed ||= ['http:', 'https:', 'mailto:'].includes(url.protocol) && (/^(https?:\/\/|mailto:)/i.test(href) || url.origin === location.origin && /^\/api\/v1\/workspaces\/[^/]+\/materials\/[^/]+\/file$/.test(url.pathname));
            }
            catch { /* remove unsafe link */ }
            if (!allowed || /[\u0000-\u0020\u007f\\]/.test(href))
                element.removeAttribute('href');
            else if (/^(https?:|mailto:)/i.test(href)) {
                element.setAttribute('target', '_blank');
                element.setAttribute('rel', 'noopener noreferrer');
            }
        }
    });
    const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]): Block[] => Array.from(nodes).flatMap<Block>(node => {
        if (node.nodeType === Node.COMMENT_NODE) {
            const match = /^\s*task-code:(\w+):(prediction|practice)\s*$/.exec(node.textContent ?? '');
            return match ? [{ kind: 'source', name: match[1], stage: match[2] }] : [];
        }
        if (!(node instanceof HTMLElement)) {
            const escaped = document.createElement('span');
            escaped.textContent = node.textContent;
            return [{ kind: 'html', html: escaped.innerHTML }];
        }
        if (node.tagName === 'DETAILS')
            return [{ kind: 'details', summary: node.querySelector(':scope > summary')?.textContent ?? 'Пояснение', classes: node.className, id: node.id, open: node.hasAttribute('open'), children: walk(Array.from(node.childNodes).filter(child => !(child instanceof HTMLElement && child.tagName === 'SUMMARY'))) }];
        if (node.querySelector('details') || /<!--\s*task-code:/.test(node.innerHTML))
            return [{ kind: 'group', classes: node.className, id: node.id, children: walk(node.childNodes) }];
        return [{ kind: 'html', html: node.outerHTML }];
    });
    return walk(template.content.childNodes);
}
@Component({ selector: 'mentor-legacy-blocks', imports: [RouterLink], template: `@for(block of nodes();track $index){@switch(block.kind){@case('html'){<div class="legacy-html" [innerHTML]="block.html" (click)="follow($event) "></div>}@case('details'){<details [class]="block.classes" [id]="block.id" [open]="block.open"><summary>{{block.summary}}</summary><mentor-legacy-blocks [nodes]="block.children" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/></details>}@case('group'){<div [class]="block.classes" [id]="block.id"><mentor-legacy-blocks [nodes]="block.children" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/></div>}@case('source'){@if(code()[block.name];as source){<article class="task-code"><h3>{{block.name}}.java</h3><p class="small-muted">Исходная заготовка · только чтение. Сохранённое решение открывается в тренажёре.</p><pre><code>{{excerpt(source)}}</code></pre><details><summary>Полный {{block.name}}.java</summary><pre><code>{{source.text}}</code></pre></details>@if(block.stage==='practice'&&taskFor(block.name);as task){<a class="btn primary" [routerLink]="base()+'/'+(publicView()?'student':'teacher')+'/practice/'+task" [queryParams]="preview()&&base().startsWith('/teacher')?{preview:'student'}:{}">Решать в тренажёре →</a>}</article>}@else{<p class="small-muted">Исходная заготовка недоступна.</p>}}}}` })
export class LegacyBlocksComponent {
    readonly nodes = input<Block[]>([]);
    readonly code = input<Record<string, Code>>({});
    readonly base = input('');
    readonly preview = input(false);
    readonly targets = input<Record<string, string>>({});
    private readonly router = inject(Router);
    publicView() { return this.preview() || this.base().startsWith('/learn/'); }
    taskFor(name: string) { return ({ ListTask: 'list-task', GroupingTask: 'grouping-task' } as Record<string, string>)[name]; }
    excerpt(code: Code) { const lines = code.text.split('\n'); return (code.excerpt ? lines.slice(code.excerpt.start, code.excerpt.end) : lines).map(line => line.replace(/^ {4}/, '')).join('\n'); }
    follow(event: Event) {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
        const hash = anchor?.getAttribute('href');
        if (!hash?.startsWith('#') || !this.base())
            return;
        const parts = hash.slice(1).split('/'), key = parts[0], profile = /^\/(teacher|learn)\/students\/[^/]+/.exec(this.base())?.[0];
        if (!profile || parts.length > 3)
            return;
        const lesson = this.base() !== profile, publicView = this.publicView(), source = key === 'source';
        const target = this.targets()[source ? parts[1] : key], fragment = parts[source ? 2 : 1];
        const query = publicView && profile.startsWith('/teacher') ? { preview: 'student' } : {};
        const navigate = (path: string, fragment?: string) => { event.preventDefault(); void this.router.navigateByUrl(this.router.createUrlTree([path], { fragment, queryParams: query })); };
        if (key === 'student' && lesson) {
            if (parts.length > 2 || fragment && !/^section-\d+$/.test(fragment))
                return;
            event.preventDefault();
            void this.router.navigateByUrl(this.router.createUrlTree([this.base() + '/student/tasks'], { fragment, queryParams: profile.startsWith('/teacher') ? { preview: 'student' } : {} }));
            return;
        }
        if (typeof target === 'string' && target.startsWith(profile + '/') && (!fragment || /^section-\d+$/.test(fragment))) {
            navigate(target, fragment);
            return;
        }
        if (source)
            return;
        if (parts.length > 2 || fragment && !/^section-\d+$/.test(fragment))
            return;
        const profilePages = ['profile', 'projects', 'roadmap', 'career', 'journal', 'goal', 'core', 'course'];
        if (profilePages.includes(key)) {
            if (publicView && !['goal', 'roadmap'].includes(key))
                return;
            navigate(profile + '/' + key, fragment);
            return;
        }
        if (key === 'library') {
            navigate(profile + '/materials', fragment);
            return;
        }
        if (!lesson) {
            if (['materials', 'review', 'lessons'].includes(key))
                navigate(profile + '/' + key, fragment);
            return;
        }
        const allowed = publicView ? ['lesson', 'practice', 'homework', 'review', 'materials'] : ['lesson', 'plan', 'practice', 'guide', 'homework', 'review', 'answers', 'materials', 'collections', 'streams', 'verification', 'run', 'map-practice'];
        if (!allowed.includes(key))
            return;
        const section = key === 'lesson' ? publicView ? 'tasks' : 'plan' : key;
        const audience = publicView ? 'student' : 'teacher';
        navigate(this.base() + '/' + audience + '/' + section, fragment);
    }
}
@Component({ selector: 'mentor-legacy-html', imports: [LegacyBlocksComponent], template: `<mentor-legacy-blocks [nodes]="parsed()" [code]="code()" [base]="base()" [preview]="preview()" [targets]="targets()"/>` })
export class LegacyHtmlComponent {
    readonly html = input('');
    readonly code = input<Record<string, Code>>({});
    readonly base = input('');
    readonly preview = input(false);
    readonly targets = input<Record<string, string>>({});
    readonly parsed = computed(() => blocks(this.html()));
}

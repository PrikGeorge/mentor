import { Injectable } from '@angular/core';
import MarkdownIt from 'markdown-it';
@Injectable({ providedIn: 'root' })
export class MarkdownRenderer {
    private readonly markdown = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });
    constructor() {
        const original = this.markdown.validateLink.bind(this.markdown);
        this.markdown.validateLink = destination => {
            if (!original(destination) || /[\u0000-\u0020\u007f\\]/.test(destination) || !/^(?:https?:\/\/[^/\\]|mailto:[^?#])/i.test(destination)) return false;
            try { const url = new URL(destination); return url.protocol === 'mailto:' ? Boolean(url.pathname) : ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname); } catch { return false; }
        };
        this.markdown.renderer.rules['link_open'] = (tokens, index, options, env, renderer) => {
            tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer'); return renderer.renderToken(tokens, index, options);
        };
        this.markdown.renderer.rules['image'] = (tokens, index, options, env) => this.markdown.utils.escapeHtml(this.markdown.renderer.renderInlineAsText(tokens[index].children ?? [], options, env));
    }
    render(source: string): string { return this.markdown.render(source); }
}

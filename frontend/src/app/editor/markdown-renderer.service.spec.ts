import { MarkdownRenderer } from './markdown-renderer.service';
describe('Single safe Markdown renderer', () => {
    const renderer = new MarkdownRenderer();
    it('preserves significant Java whitespace and renders supported Markdown', () => {
        const html = renderer.render('## Задача\n\n```java\n  class A {\n    String value = "Ж😀";  \n  }\n```');
        expect(html).toContain('<h2>Задача</h2>'); expect(html).toContain('language-java');
        expect(html).toContain('  class A {\n    String value = &quot;Ж😀&quot;;  \n  }');
    });
    it('disables user HTML, resource-loading images and unsafe navigation', () => {
        const html = renderer.render('<script>x</script>\n\n![Описание](https://example.com/private.png)\n\n[bad](javascript:alert(1)) [relative](/api/v1/private) [hash](#teacher)');
        expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<img'); expect(html).toContain('Описание'); expect(html).not.toContain('href=');
    });
    it('allows explicit http/https/mailto links with opener protection only', () => {
        const html = renderer.render('[site](https://example.com/a) [http](http://example.com) [mail](mailto:teacher@example.com)');
        expect(html.match(/<a /g)).toHaveLength(3); expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3); expect(html).toContain('target="_blank"');
    });
});

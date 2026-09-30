'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rendererPath = path.join(__dirname, '../dist/lesson-markdown.js');
const vendorPath = path.join(__dirname, '../dist/vendor/markdown-it/markdown-it.min.js');

function renderer() {
  assert.ok(fs.existsSync(rendererPath), 'the lesson Markdown renderer must be available');
  return require(rendererPath);
}

test('lesson Markdown renders headings, emphasis, lists, quotes and tables', () => {
  const html = renderer().render('# Коллекции\n\n**Важно** и *пример*.\n\n- Список\n- Множество\n\n1. Читать\n2. Решить\n\n> Заметка\n\n| Тип | Размер |\n| --- | --- |\n| List | 2 |');
  for (const expected of ['<h1>Коллекции</h1>', '<strong>Важно</strong>', '<em>пример</em>', '<ul>', '<li>Список</li>', '<ol>', '<li>Читать</li>', '<blockquote>', '<table>', '<th>Тип</th>', '<td>List</td>']) {
    assert.ok(html.includes(expected), expected);
  }
});

test('legacy plain text retains line breaks and empty notes remain empty', () => {
  const render = renderer().render;
  assert.equal(render('Первая строка\r\nВторая строка'), '<p>Первая строка<br>\nВторая строка</p>\n');
  for (const source of ['', null, undefined]) assert.equal(render(source), '');
});

test('Java fences and inline code escape HTML and generic types', () => {
  const html = renderer().render('`List<String>`\n\n```java\nList<String> names = new ArrayList<>();\nSystem.out.println("<script>alert(1)</script>");\n```');
  assert.match(html, /<code>List&lt;String&gt;<\/code>/);
  assert.match(html, /<pre><code class="language-java">List&lt;String&gt; names = new ArrayList&lt;&gt;\(\);/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<String>/i);
});

test('raw HTML is visible text and cannot add executable elements', () => {
  const html = renderer().render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)><a href="javascript:alert(1)">x</a></svg>\n\n<iframe src="https://example.com"></iframe>');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<(?:script|img|svg|iframe|a)\b/i);
});

test('external links allow absolute HTTP, HTTPS and mailto with opener protection', () => {
  const html = renderer().render('[HTTP](http://example.com/path) [HTTPS](https://example.com/path?q=1&x=2) [Email](mailto:teacher@example.com) <https://example.org>');
  assert.match(html, /href="http:\/\/example\.com\/path"/);
  assert.match(html, /href="https:\/\/example\.com\/path\?q=1&amp;x=2"/);
  assert.match(html, /href="mailto:teacher@example\.com"/);
  assert.match(html, /href="https:\/\/example\.org"/);
  for (const tag of html.match(/<a\b[^>]*>/g) || []) {
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
  assert.equal((html.match(/<a\b/g) || []).length, 4);
});

test('note links cannot navigate portal hashes, relative paths or unsupported schemes', () => {
  const urls = ['#students/private', '/api/materials/private', 'notes.md', './notes.md', '../notes.md', '?role=teacher', '//example.com', 'ftp://example.com', 'tel:123', 'file:///etc/passwd', 'javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'https:///example.com', 'http://'];
  for (const url of urls) {
    const html = renderer().render(`[open](${url})`);
    assert.doesNotMatch(html, /<a\b/i, url);
  }
});

test('encoded dangerous destinations never become links', () => {
  const urls = ['jav&#x61;script:alert(1)', 'javascript&#58;alert(1)', 'javascript%3Aalert(1)', '%6a%61%76%61%73%63%72%69%70%74%3Aalert(1)', '%256a%2561vascript%253Aalert(1)', 'java%0Ascript:alert(1)', 'java&#x09;script:alert(1)', 'data&#58;text/html,test', '&#47;&#47;example.com', '%2Fapi%2Fmaterials%2Fprivate'];
  for (const url of urls) {
    const html = renderer().render(`[open](${url})`);
    assert.doesNotMatch(html, /<a\b/i, url);
  }
});

test('images render escaped alternative text without loading remote or local resources', () => {
  const html = renderer().render('![Схема <img src=x onerror=alert(1)>](https://example.com/tracker.png)\n\n![**пример**](/api/materials/private)\n\n![data](data:image/png;base64,AAAA)\n\n[![inner](https://example.com/pixel.png)](https://example.org)');
  assert.match(html, /Схема &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /пример/);
  assert.doesNotMatch(html, /<(?:img|iframe|object|embed|video|audio|source)\b|<[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /href="(?:\/api|data:|https:\/\/example\.com\/)/i);
});

test('user controlled link titles and fence languages cannot escape attributes', () => {
  const html = renderer().render('[link](https://example.com "&quot; onmouseover=&quot;alert(1)")\n\n```java\" onmouseover=\"alert(1)\n<script>bad</script>\n```');
  assert.match(html, /title="&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(html, /class="language-java&quot;"/);
  assert.doesNotMatch(html, /<[^>]*\sonmouseover="|<script>/i);
});

test('the browser bundle exposes the same safe renderer without network APIs', () => {
  assert.ok(fs.existsSync(vendorPath), 'the browser Markdown parser must be vendored');
  assert.ok(fs.existsSync(rendererPath), 'the lesson Markdown renderer must be available');
  const context = vm.createContext({ URL, atob });
  context.window = context;
  vm.runInContext(fs.readFileSync(vendorPath, 'utf8'), context, { filename: vendorPath });
  vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), context, { filename: rendererPath });
  const source = '# Browser\n\n![tracking](https://example.com/pixel.png)\n\n[unsafe](#private)';
  assert.equal(typeof context.MENTOR_MARKDOWN.render, 'function');
  assert.equal(context.MENTOR_MARKDOWN.render(source), renderer().render(source));
  assert.doesNotMatch(context.MENTOR_MARKDOWN.render(source), /<img\b|<a\b/i);
});

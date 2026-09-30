'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const editor = require('../dist/lesson-editor.js');

test('long lesson source is retained by markup and the textarea permits the advertised limit', () => {
  const source='а'.repeat(200000);
  const html=editor.markup({name:'teacherNotes',value:source,label:'Сценарий'});
  assert.equal(html.match(/maxlength="(\d+)"/)[1],'200000');
  assert.ok(html.includes(source));
  assert.ok(/200\s000 \/ 200\s000/.test(html));
});

test('inline formatting preserves surrounding source and selects editable text', () => {
  assert.deepEqual(editor.transform('one two three', 4, 7, 'bold'), {value:'one **two** three',start:6,end:9});
  assert.deepEqual(editor.transform('one **two** three', 6, 9, 'bold'), {value:'one two three',start:4,end:7});
  assert.deepEqual(editor.transform('', 0, 0, 'italic'), {value:'*текст*',start:1,end:6});
});

test('block formatting covers selected lines without touching the following line', () => {
  assert.deepEqual(editor.transform('alpha\nbeta\ngamma', 2, 11, 'bullet'), {value:'- alpha\n- beta\ngamma',start:0,end:14});
  assert.equal(editor.transform('### Old\nTitle', 0, 13, 'heading').value, '## Old\n## Title');
  assert.equal(editor.transform('- alpha\n- beta', 0, 14, 'bullet').value, 'alpha\nbeta');
  assert.equal(editor.transform('alpha\nbeta', 0, 10, 'numbered').value, '1. alpha\n2. beta');
  assert.equal(editor.transform('alpha\nbeta', 0, 10, 'quote').value, '> alpha\n> beta');
});

test('formatting at the beginning of an empty first line keeps subsequent content intact', () => {
  assert.deepEqual(editor.transform('\nnext',0,0,'heading'), {value:'## \nnext',start:0,end:3});
});

test('Java code fences safely contain existing Markdown backticks', () => {
  assert.equal(editor.transform('```',0,3,'code').value, '````java\n```\n````');
});

test('link, Java block and table insert valid editable Markdown templates', () => {
  assert.deepEqual(editor.transform('read', 0, 4, 'link'), {value:'[read](https://example.com)',start:7,end:26});
  assert.deepEqual(editor.transform('beforeafter', 6, 6, 'code'), {value:'before\n\n```java\n// Ваш код\n```\n\nafter',start:16,end:26});
  assert.equal(editor.transform('System.out.println("hi");', 0, 25, 'code').value, '```java\nSystem.out.println("hi");\n```');
  assert.equal(editor.transform('',0,0,'table').value, '| Заголовок | Описание |\n| --- | --- |\n| Значение | Текст |');
});

test('history restores imports atomically and drops redo after a new edit', () => {
  const history = editor.createHistory({value:'original',start:8,end:8});
  history.record({value:'imported',start:0,end:0});
  assert.equal(history.undo().value, 'original');
  assert.equal(history.redo().value, 'imported');
  history.undo();
  history.record({value:'new work',start:8,end:8});
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().value, 'original');
});

test('consecutive typing can merge while retaining the starting document', () => {
  const history = editor.createHistory({value:'',start:0,end:0});
  history.record({value:'a',start:1,end:1});
  history.record({value:'ab',start:2,end:2}, {merge:true});
  assert.equal(history.undo().value, '');
  assert.equal(history.redo().value, 'ab');
});

function file(name, value, advertisedSize) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  return {name, size:advertisedSize ?? bytes.length, arrayBuffer:async()=>bytes.buffer};
}

test('Markdown import decodes UTF-8 and accepts exact character boundary without truncation', async () => {
  assert.equal(await editor.readMarkdownFile(file('Урок.MARKDOWN', '\ufeff# Привет\n🙂')), '# Привет\n🙂');
  const longLesson = '# Занятие\n\n'+'Длинный текст урока.\n'.repeat(3000);
  assert.equal(await editor.readMarkdownFile(file('lesson.md',longLesson)),longLesson);
  assert.equal((await editor.readMarkdownFile(file('lesson.md','я'.repeat(200000)))).length, 200000);
  await assert.rejects(editor.readMarkdownFile(file('lesson.md', 'я'.repeat(200001))), /200.?000/);
});

test('Markdown import rejects unsupported files, invalid UTF-8, binary and oversized bytes', async () => {
  await assert.rejects(editor.readMarkdownFile(file('lesson.md.exe','# hello')), /\.md/);
  await assert.rejects(editor.readMarkdownFile(file('lesson.md',[0xc3,0x28])), /UTF-8/);
  await assert.rejects(editor.readMarkdownFile(file('lesson.md','hello\0world')), /бинарн/i);
  await assert.rejects(editor.readMarkdownFile(file('lesson.md','a',1024*1024+1)), /1 МБ/);
  await assert.rejects(editor.readMarkdownFile(file('lesson.md',new Uint8Array(1024*1024+1).fill(65),1)), /1 МБ/);
});

test('empty Markdown imports are rejected instead of offering to erase the draft', async () => {
  await assert.rejects(editor.readMarkdownFile(file('empty.md','')), /пуст/i);
  await assert.rejects(editor.readMarkdownFile(file('spaces.md','\ufeff \r\n\t')), /пуст/i);
});

test('append respects the whole-document limit and creates a paragraph boundary', () => {
  assert.equal(editor.importValue('existing','new text','append'), 'existing\n\nnew text');
  assert.equal(editor.importValue('existing\n\n','new text','append'), 'existing\n\nnew text');
  assert.equal(editor.importValue('existing','replacement','replace'), 'replacement');
  const base='a'.repeat(100000),addition='б'.repeat(99998);
  assert.equal(editor.importValue(base,addition,'append'),base+'\n\n'+addition);
  assert.throws(()=>editor.importValue(base,addition+'x','append'), /200.?000/);
});

test('file reads never overwrite edits made while the read is pending', async () => {
  const guard = editor.createImportGuard();
  let release;
  const pending = guard.read({name:'lesson.md',size:3,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  guard.changed();
  release(new TextEncoder().encode('new').buffer);
  assert.equal((await pending).status, 'stale');
});

test('latest file selection wins and disposal or saving invalidates in-flight reads', async () => {
  const guard = editor.createImportGuard();
  let release;
  const first = guard.read({name:'one.md',size:3,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  assert.deepEqual(await guard.read(file('two.md','two')), {status:'ready',text:'two'});
  release(new TextEncoder().encode('one').buffer);
  assert.equal((await first).status, 'stale');
  const saved = guard.read(file('three.md','three'));
  guard.setBusy(true);
  assert.equal((await saved).status, 'blocked');
  guard.setBusy(false);
  const closing = guard.read(file('four.md','four'));
  guard.dispose();
  assert.equal((await closing).status, 'disposed');
  assert.equal((await guard.read(file('five.md','five'))).status, 'disposed');
});

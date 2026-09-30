const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function loadUI(){
 const context={window:{},document:{getElementById(){return null}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);
 context.window.LESSON_UI.setContent(JSON.parse(fs.readFileSync(path.join(root,'private/materials/content.json'),'utf8')));
 return context.window.LESSON_UI;
}
const ui=loadUI();
test('homework exposes all three steps through stable section links',()=>{
 const html=ui.doc('homework',{studentMode:true});
 const steps=ui.content.docs.homework.sections;
 assert.deepEqual(Array.from(steps,s=>s.id),['section-0','section-1','section-2']);
 assert.match(steps[0].title,/Шаг 1.*Поиск/);
 assert.match(steps[1].title,/Шаг 2/);
 assert.match(steps[2].title,/Шаг 3.*сдачу/);
 for(const id of ['section-0','section-1','section-2']){
  assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,new RegExp('href="#homework/'+id+'"'));
 }
 assert.match(html,/null/);
 assert.match(html,/3 часа 30 минут/);
 assert.match(html,/Шаг 1.*Шаг 2.*Шаг 3/s);
 assert.equal((html.match(/class="next-section"/g)||[]).length,2);
});
test('student tasks start in place with downloads and omit duplicate window controls',()=>{
 const studentHtml=ui.doc('student',{studentMode:true});
 assert.doesNotMatch(studentHtml,/student\.html|teacher-lesson|ListSolutions|GroupingSolution/);
 const toolbar=studentHtml.match(/<div class="doc-tools">([\s\S]*?)<\/div>/)[1];
 assert.equal((toolbar.match(/<a /g)||[]).length,2,'start and bundle are the only top-level task actions');
 assert.doesNotMatch(toolbar,/ListTask|GroupingTask|#source\//);
 assert.doesNotMatch(studentHtml,/эталон(?:ах|ы|а)? преподавателя|Эталон преподавателя/);
 assert.match(studentHtml,/<a class="btn primary" href="#student\/section-0">/);
 assert.match(studentHtml,/href="\/api\/materials\/student-lesson-2026-09-27" download/);
 assert.match(ui.doc('student'),/href="\/api\/materials\/student-sheet"/);
 assert.match(ui.doc('homework',{studentMode:true}),/<a class="btn primary" href="#homework\/section-0">/);
});

function studentSection(html,id){
 return html.match(new RegExp('<section class="doc-content doc-section" id="'+id+'">([\\s\\S]*?)<\\/section>'))[1];
}

test('students can inspect starter methods beside each task before opening the trainer',()=>{
 const html=ui.doc('student',{studentMode:true});
 const prediction=studentSection(html,'section-0'),list=studentSection(html,'section-1'),grouping=studentSection(html,'section-2');
 for(const section of [prediction,list,grouping]){
  assert.match(section,/Исходная заготовка/);
  assert.match(section,/Только для чтения/);
  assert.match(section,/сохранённое решение/);
  assert.match(section,/<pre class="task-code-excerpt"><code>/);
 }
 assert.match(prediction,/static List&lt;Integer&gt; select/);
 assert.ok(prediction.indexOf('result.sort(Integer::compareTo)')<prediction.indexOf('запиши три прогноза'),'original code precedes the prediction question');
 assert.doesNotMatch(prediction,/<details|#practice\//,'prediction stays focused on reading');
 assert.match(list,/result.sort\(Integer::compareTo\)/);
 assert.match(list,/href="#practice\/list-task">Решать в тренажёре/);
 assert.match(grouping,/static class Loan/);
 assert.match(grouping,/final int bookId/);
 assert.match(grouping,/final int readerId/);
 assert.match(grouping,/static List&lt;String&gt; duplicateReport/);
 assert.match(grouping,/TODO: implement duplicateReport/);
 assert.match(grouping,/href="#practice\/grouping-task">Решать в тренажёре/);
 for(const section of [list,grouping]){
  const [visible,full]=section.split('<details class="task-code-full">');
  assert.doesNotMatch(visible,/public static void main/,'checks stay in the full-file disclosure');
  assert.match(full,/public static void main/);
  assert.doesNotMatch(section,/<details[^>]*\bopen\b/);
 }
});

test('task excerpts render the current starter record safely and reject a teacher source',()=>{
 const isolated=loadUI();
 isolated.content.code.ListTask.text=isolated.content.code.ListTask.text.replace('source.stream()','source.stream() /* <origin> */');
 let html=isolated.doc('student',{studentMode:true});
 assert.match(studentSection(html,'section-0'),/source.stream\(\) \/\* &lt;origin&gt; \*\//);
 assert.doesNotMatch(html,/<origin>/);
 isolated.content.code.ListTask={text:'TEACHER_SOURCE_MUST_NOT_RENDER',teacher:true};
 isolated.content.code.GroupingTask={text:'TEACHER_SOURCE_MUST_NOT_RENDER',teacher:true};
 html=isolated.doc('student',{studentMode:true});
 assert.doesNotMatch(html,/TEACHER_SOURCE_MUST_NOT_RENDER/);
});

test('offline task sheet preserves inline code without broken trainer links or solution content',()=>{
 const html=fs.readFileSync(path.join(root,'private/materials/student.html'),'utf8');
 assert.equal((html.match(/class="task-code-excerpt"/g)||[]).length,3);
 assert.match(html,/static List&lt;Integer&gt; select/);
 assert.match(html,/static class Loan/);
 assert.match(html,/TODO: implement duplicateReport/);
 assert.doesNotMatch(html,/#practice\/|#source\/|ListSolutions|GroupingSolution|эталон.*преподавателя/i);
 const toolbar=html.match(/<nav class="doc-tools"[^>]*>([\s\S]*?)<\/nav>/)[1];
 assert.doesNotMatch(toolbar,/ListTask|GroupingTask/);
 assert.match(html,/<style>[\s\S]*\.task-code/);
 assert.doesNotMatch(html,/<script|onclick=|href="(?:\/api|downloads)|<link /);
});

test('content replacement and clearing update the live getter and renderers',()=>{
 const isolated=loadUI(),previous=isolated.content;
 isolated.setContent({docs:{},code:{},viewData:{}});
 assert.notEqual(isolated.content,previous);assert.match(isolated.doc('student'),/Этой страницы здесь нет/);
 isolated.setContent(previous);assert.match(isolated.doc('student'),/static List&lt;Integer&gt; select/);
 isolated.setContent(null);assert.deepEqual(Object.keys(isolated.content.docs),[]);assert.deepEqual(Object.keys(isolated.content.viewData),[]);
});
test('guide preserves sections and full explanations while speech stays outside disclosures',()=>{
 const guide=ui.content.docs.guide,html=ui.doc('guide');
 assert.deepEqual(Array.from(guide.sections,s=>s.id),['section-0','section-1','section-2','section-3','section-4','section-5','section-6','section-7','section-8']);
 assert.match(html,/data-expand-explanations/);
 const folds=Array.from(html.matchAll(/<details class="explanation-details">([\s\S]*?)<\/details>/g),m=>m[1]);
 assert.ok(folds.length>=25,'long reasoning is collapsed');
 for(const fold of folds){
  assert.match(fold,/<summary>Почему/);
  assert.doesNotMatch(fold,/class="say"|Ожидаемый ответ|<strong>Реплика:/);
 }
 assert.match(html,/отрицательное число/);
 assert.match(html,/Сначала считаем все совпадения, потом делим на страницы/);
 assert.match(html,/Ожидаемый ответ:/);
 assert.match(html,/<blockquote class="say">/);
 const headings=Array.from(guide.raw.matchAll(/^\*\*(Почему[^*]+)\*\*/gm),m=>m[1]);
 const text=html.replace(/<[^>]+>/g,'');
 for(const title of headings)assert.ok(text.includes(ui.esc(title.replace(/`/g,''))),title+' retained');
});
test('document navigation uses compact disclosures and preserves every document anchor',()=>{
 for(const key of ['guide','student','run','homework','projects']){
  const html=ui.doc(key);
  assert.match(html,/<details class="toc toc-disclosure"><summary>Разделы материала<\/summary><nav class="toc-links"/);
  for(const section of ui.content.docs[key].sections){
   assert.ok(html.includes('id="'+section.id+'"'));
   assert.ok(html.includes('href="#'+key+'/'+section.id+'"'));
  }
 }
});
test('shared navigation icons are inline decorative SVGs with no remote references',()=>{
 assert.equal(typeof ui.icon,'function');
 for(const name of ['students','lessons','goal','roadmap','review','profile','projects','teacher','student','home','materials','code']){
  const html=ui.icon(name);
  assert.match(html,/<svg /);
  assert.match(html,/aria-hidden="true"/);
  assert.match(html,/viewBox="0 0 24 24"/);
  assert.doesNotMatch(html,/https?:|<script|<title/);
 }
 assert.equal(ui.icon('unknown'),'');
});
test('recompiling cached documents in a relocated checkout retains links to included material',()=>{
 assert.ok(ui.content.docs.student.html.includes('href="#homework"'),'homework remains accessible from task instructions');
 const links=Array.from(ui.content.docs.core.html.matchAll(/href="(#[^"]+)"/g),m=>m[1]);
 assert.deepEqual(links,['#collections','#streams','#map-practice','#map-practice','#streams','#streams','#streams','#map-practice']);
});

test('spoken guide prompts retain sentence punctuation without stray paragraphs',()=>{
 const html=ui.content.docs.guide.html;
 assert.equal(/<\/blockquote>\s*<p>\s*[.,!?;:…]/.test(html),false,'punctuation stays with the spoken sentence');
 assert.ok(html.includes('семь найденных книг никуда не делись».</p></blockquote>'));
 assert.ok(html.includes('<p>Обычный поиск нужно исправить раньше этого дополнительного случая.</p>'));
});

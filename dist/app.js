'use strict';
let content = {docs:{},code:{},viewData:{}};
function setContent(snapshot){content=snapshot&&typeof snapshot==='object'?snapshot:{docs:{},code:{},viewData:{}};content.docs||={};content.code||={};content.viewData||={};}
const teacherView=()=>content.viewData.teacher||{};
const descriptors=()=>content.viewData.descriptors||teacherView().descriptors||{};
const resources=()=>content.viewData.resources||teacherView().resources||[];
const main = document.getElementById('main');
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const printButton = '<button class="btn" data-print>Печать / PDF ↗</button>';
function icon(name){
 const shapes={
  students:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  lessons:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2"/>',
  goal:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  roadmap:'<path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3zm0-15v15m6-12v15"/>',
  review:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2m-6 8 2 2 4-4m-6 7h6"/>',
  profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  projects:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18m-11 0v3h4v-3"/>',
  teacher:'<path d="m2 9 10-5 10 5-10 5-10-5zm4 2v6l6 3 6-3v-6m4-2v7"/>',
  student:'<circle cx="12" cy="6" r="3"/><path d="M6 21v-5a6 6 0 0 1 12 0v5m-6-8v8"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1V10z"/>',
  materials:'<path d="M12 5a15 15 0 0 0-9-2v16a15 15 0 0 1 9 2m0-16a15 15 0 0 1 9-2v16a15 15 0 0 0-9 2V5z"/>',
  code:'<path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16"/>'
 };
 return shapes[name]?`<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name]}</svg>`:'';
}
function heading(label,title,description,actions=''){
 return `<div class="page-head"><div><p class="eyebrow">${label}</p><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="actions">${actions}</div></div>`;
}
function lesson(){return teacherView().lessonHtml||notFound();}
function docExtras(key,options={}){
 if(key==='guide')return `<div class="doc-tools"><a class="btn primary" href="#guide/section-0">Начать с подготовки</a><a class="btn" href="#answers">Эталоны преподавателя →</a><a class="btn" href="/api/materials/teacher-lesson-2026-09-27" download>↓ Комплект преподавателя</a><button class="btn" data-expand-explanations aria-expanded="false">Развернуть пояснения</button></div>`;
 if(key==='student')return `<div class="doc-tools"><a class="btn primary" href="#student/section-0">Начать задания</a><a class="btn" href="/api/materials/student-lesson-2026-09-27" download>↓ Скачать комплект</a>${options.studentMode?'':'<a class="btn" href="/api/materials/student-sheet" target="_blank" rel="noopener">Отдельный экран ученика ↗</a>'}</div>`;
 if(key==='homework')return `<div class="doc-tools"><a class="btn primary" href="#homework/section-0">Начать с поиска</a><a class="btn" href="/api/materials/student-lesson-2026-09-27" download>↓ Скачать задания и заготовки</a><button class="btn" data-copy-doc="homework">Скопировать задание</button></div>`;
 if(key==='profile')return teacherView().profileFacts||'';
 return '';
}
function taskCode(name,stage){
 const tasks={ListTask:'list-task',GroupingTask:'grouping-task'},c=content.code[name];
 if(!tasks[name]||!c||c.teacher)return '<p class="small-muted">Исходная заготовка недоступна. Открой файл из учебного комплекта.</p>';
 const lines=c.text.split('\n'),range=c.excerpt;
 const excerpt=(range?lines.slice(range.start,range.end):lines).map(line=>line.replace(/^ {4}/,'')).join('\n');
 const full=stage==='practice'?`<details class="task-code-full"><summary>Полный ${esc(name)}.java и проверки</summary><pre><code>${esc(c.text)}</code></pre></details>`:'';
 const action=stage==='practice'?`<div class="task-code-actions"><a class="btn primary" href="#practice/${tasks[name]}">Решать в тренажёре →</a></div>`:'';
 return `<div class="task-code" data-task-source="${esc(name)}"><div class="task-code-heading"><strong>${esc(name)}.java</strong><span>Исходная заготовка · Только для чтения</span></div><p class="task-code-note">Здесь показан исходный код задания. Твоё сохранённое решение открывается в тренажёре.</p><pre class="task-code-excerpt"><code>${esc(excerpt)}</code></pre>${full}${action}</div>`;
}
function taskCodeInDocument(html){
 return html.replace(/<!-- task-code:(\w+):(prediction|practice) -->/g,(_,name,stage)=>taskCode(name,stage));
}
function doc(key,options={}){
 const d=content.docs[key];if(!d)return notFound();const desc=descriptors()[key]||['МАТЕРИАЛЫ',''];
 const number=(n,total)=>`${String(n).padStart(2,'0')}/${String(total).padStart(2,'0')}`;
 const partNumber=n=>number(n,content.docs.student.sections.length);
 const label=(s,i)=>key==='guide'?(s.studentParts?.length?`К ${s.studentParts.length===1?'части':'частям'} ${s.studentParts.map(partNumber).join(' и ')}`:'Для преподавателя'):number(i+1,d.sections.length);
 const title=s=>key==='student'?s.title.replace(/^\d{2}\/\d{2}\s*·\s*/,''):s.title;
 const studentLinks=s=>key==='guide'&&s.studentParts?.length?`<div class="doc-tools">${s.studentParts.map(n=>`<a class="text-link" href="#student/section-${n-1}">Открыть часть ${partNumber(n)} ученика →</a>`).join('')}</div>`:'';
 const shortTitle=s=>title(s).replace(/^\d{2}:\d{2}–\d{2}:\d{2}(?: \([^)]*\))?\.\s*/,'').replace(/ — \d+–\d+ минут$/,'');
 const tocTitle=(s,i)=>key==='student'?`${number(i+1,d.sections.length)} · ${shortTitle(s)}`:shortTitle(s);
 const nextSection=i=>i+1<d.sections.length?`<a class="next-section" href="#${key}/${d.sections[i+1].id}"><span>Далее</span> <strong>${esc(shortTitle(d.sections[i+1]))} →</strong></a>`:'';
 return heading(desc[0],esc(d.title),desc[1],printButton)+docExtras(key,options)+`<div class="doc-layout"><div class="doc-main"><div class="doc-content doc-intro">${d.intro}</div>${d.sections.map((s,i)=>`<section class="doc-content doc-section" id="${s.id}"><span class="section-kicker">${label(s,i)}</span><h2 tabindex="-1">${esc(title(s))}</h2>${studentLinks(s)}${key==='student'?taskCodeInDocument(s.html):s.html}${nextSection(i)}</section>`).join('')}</div>${d.sections.length?`<details class="toc toc-disclosure"><summary>Разделы материала</summary><nav class="toc-links" aria-label="Оглавление материала">${d.sections.map((s,i)=>`<a href="#${key}/${s.id}">${esc(tocTitle(s,i))}</a>`).join('')}<a class="btn" href="#lesson">← План занятия</a></nav></details>`:''}</div>`;
}
function materials(){return heading('БИБЛИОТЕКА','Материалы под рукой','К занятию — только необходимое. Остальное сохранено для следующих шагов.')+`<div class="resource-toolbar"><div class="filter-tabs" role="group" aria-label="Темы материалов">${['Все','Урок','Core','Backend'].map((t,i)=>`<button data-filter="${t}" aria-pressed="${i===0}">${t}</button>`).join('')}</div><input class="search" id="resource-search" aria-label="Поиск по материалам" placeholder="Найти материал…" type="search"></div><div class="resource-grid" id="resource-grid"></div><div class="callout">Конспекты по коллекциям и стримам открываются целиком на сайте. Индексы Core и Backend также содержат ссылки на локальные источники наставника; такие ссылки отмечены текстом.</div>`;}
let filter='Все';
function renderResources(){
 const query=(document.getElementById('resource-search')?.value||'').trim().toLowerCase();
 const chosen=resources().filter(r=>(filter==='Все'||r[1]===filter)&&r.join(' ').toLowerCase().includes(query));
 document.getElementById('resource-grid').innerHTML=chosen.map(r=>`<article class="resource-card"><span class="type">${r[1]} / ${r[0]==='answers'?'ДЛЯ ПРЕПОДАВАТЕЛЯ':'МАТЕРИАЛ'}</span><h3>${r[2]}</h3><p>${r[3]}</p><a href="#${r[0]}">Открыть <span>↗</span></a></article>`).join('')||'<p class="empty">Материалов с таким названием нет. Попробуйте другое слово или выберите «Все».</p>';
}
function source(name){
 const c=content.code[name];
 if(!c)return notFound();
 return heading(c.teacher?'ЭТАЛОН ПРЕПОДАВАТЕЛЯ':'УЧЕБНАЯ ЗАГОТОВКА',esc(name)+'.java',c.teacher?'Показывать после самостоятельной попытки и обсуждения.':'Рабочий файл упражнения. Сначала прогноз, затем запуск и изменение кода.',`<a class="btn" href="/api/materials/${encodeURIComponent(c.materialId||name)}" download>↓ Скачать Java</a>`)+`<div class="doc-tools"><a class="btn" href="#${c.teacher?'answers':'student'}">← ${c.teacher?'Эталоны':'Условия задания'}</a><a class="btn" href="#run">Как запустить</a></div><div class="doc-content"><div class="code-toolbar"><span>${name}.java · UTF-8</span><button data-copy-code="${name}">Копировать</button></div><pre class="code-view"><code>${c.text.split('\n').map((l,i)=>`<span class="code-line"><span class="line-no" aria-hidden="true">${i+1}</span>${esc(l)}</span>`).join('')}</code></pre></div>`;
}
function answers(){return heading('ТОЛЬКО ДЛЯ ПРЕПОДАВАТЕЛЯ','Эталоны и подсказки','Здесь готовые реализации. Для демонстрации ученику откройте отдельный экран заданий.')+`<div class="callout">Перед открытием решения попросите ученика объяснить вход, ожидаемый результат и выбранные коллекции. Сначала дайте одну подсказку из методички.</div><div class="resource-grid">${(teacherView().answersCards||[]).map(r=>`<article class="resource-card"><span class="type">JAVA / ЭТАЛОН</span><h3>${r[1]}</h3><p>${r[2]}</p><a href="#source/${r[0]}">Посмотреть код <span>↗</span></a></article>`).join('')}</div><div class="doc-tools"><a class="btn" href="/api/materials/teacher-lesson-2026-09-27" download>↓ Комплект преподавателя</a><a class="btn" href="#verification">Как проверены примеры</a><a class="btn primary" href="#guide">Вернуться к методичке</a></div>`;}
function review(){return teacherView().reviewHtml||notFound();}
function notFound(){return heading('МАТЕРИАЛ НЕ НАЙДЕН','Этой страницы здесь нет','Перейдите к карточке ученика и выберите занятие.', '<a class="btn primary" href="#students">Все ученики</a>');}
let toastTimeout;
function toast(text){const t=document.getElementById('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.remove('show'),3500)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Скопировано')}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.top='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'Скопировано':'Не удалось скопировать. Выделите текст и нажмите Ctrl+C.')}}
window.LESSON_UI={heading,lesson,doc,source,answers,review,materials,notFound,esc,icon,toast,copy,setContent,get content(){return content},renderResources,setFilter(value){filter=value;renderResources()}};

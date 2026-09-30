'use strict';
const UI=window.LESSON_UI, R=window.MentorRoutes, SC=window.STUDENT_CABINET;
const portalMain=document.getElementById('main');
let model={students:[],lessons:[]}, context={kind:'students'}, formMode=null, formTarget=null, saving=false;
let generation=0,portalReady=false,activeAccountId=null,presentation=false;
let lessonEditor=null;
const brand=document.querySelector('.brand'),sidebarFoot=document.querySelector('.sidebar-foot'),siteFooter=document.querySelector('.site-footer');
const neutralShell={brand:brand.innerHTML,brandHref:brand.href,sidebarFoot:sidebarFoot.innerHTML,siteFooter:siteFooter.innerHTML,title:document.title};
const teacherPreview=new URLSearchParams(location.search).get('screen')==='student';
const e=UI.esc;
const dateLabel=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
const lessonCount=n=>n+' '+(n%10===1&&n%100!==11?'занятие':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'занятия':'занятий');
const studentLessons=sid=>model.lessons.filter(l=>l.studentId===sid).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
const studentUrl=(page)=>R.studentHref(context.student.id,page);
const lessonUrl=(audience,page,detail)=>R.lessonHref(context.student.id,context.lesson.id,audience,page,detail);
const presentationUrl=()=> './?screen=student'+lessonUrl('student','tasks');
const prepared=()=>R.hasPreparedBundle(context.lesson);
const printControl='<button class="btn" data-print>Печать / PDF ↗</button>';
async function api(path,options={}){
 return window.MENTOR_AUTH.request(path,options);
}
async function refresh(){const owner=activeAccountId,stamp=generation;const next=await api('/api/state',{expectedAccountId:owner});if(stamp!==generation||owner!==activeAccountId)throw Object.assign(new Error('Аккаунт изменился.'),{status:409,code:'ACCOUNT_CHANGED'});model=next;}
function empty(title,text,action=''){return `<div class="empty-state"><span class="empty-icon">◇</span><h2>${title}</h2><p>${text}</p>${action}</div>`;}
function badge(lesson){return `<span class="pill ${lesson.status==='prepared'?'':'neutral'}">${lesson.status==='prepared'?'Подготовлено':'Запланировано'}</span>`;}
function lessonSummary(l){return `<article class="lesson-list-item"><div class="calendar-tile"><strong>${Number(l.date.slice(-2))}</strong><span>${new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(l.date+'T12:00:00'))}</span></div><div class="lesson-list-copy"><div class="lesson-list-meta">${e(l.time)} МСК · ${l.duration} мин · ${e(l.date.slice(0,4))}</div><h3><a href="${R.lessonHref(l.studentId,l.id)}">${e(l.title)}</a></h3><div class="lesson-shortcuts"><a class="btn primary" href="${R.lessonHref(l.studentId,l.id,'teacher','guide')}">${R.hasPreparedBundle(l)?'Методичка':'Сценарий'}</a><a class="btn" href="./?screen=student${R.lessonHref(l.studentId,l.id,'student','tasks')}" target="_blank" rel="noopener">Экран ученика ↗</a><a class="text-link" href="${R.lessonHref(l.studentId,l.id)}">Все материалы →</a></div></div><div class="lesson-list-end">${badge(l)}</div></article>`;}
function studentsPage(){
 return UI.heading('ЛОКАЛЬНЫЙ КАБИНЕТ','Мои ученики','Выберите ученика, чтобы открыть его занятия, материалы и план обучения.','<button class="btn primary" data-action="add-student">+ Добавить ученика</button>')+
 `<div class="students-grid">${model.students.map(s=>{const lessons=studentLessons(s.id),focus=R.lessonFocus(lessons);return `<a class="student-card" href="${R.studentHref(s.id)}"><div class="student-card-top"><span class="avatar">${e(Array.from(s.name)[0].toUpperCase())}</span><span class="pill neutral">${lessonCount(lessons.length)}</span></div><h2>${e(s.name)}</h2><p class="student-direction">${e(s.direction||'Направление не указано')}</p><p class="student-goal">${e(s.goal||'Цель обучения можно добавить в карточке')}</p><div class="student-card-foot"><span>${focus?(focus.upcoming?'Ближайшее занятие':'Последнее по дате')+'<br>'+dateLabel(focus.lesson.date)+' · '+e(focus.lesson.time):'Первое занятие ещё не добавлено'}</span><b>→</b></div></a>`}).join('')}<button class="student-card add-student-card" data-action="add-student"><span class="plus-mark">+</span><h2>Новый ученик</h2><p>Отдельная карточка,<br>занятия и материалы</p></button></div><div class="local-note"><span>◎</span><p>Всё хранится на этом компьютере. Карточки останутся после закрытия браузера и повторного запуска кабинета.</p></div>`;
}
function studentPage(){const s=context.student,lessons=studentLessons(s.id);
 return UI.heading('КАРТОЧКА УЧЕНИКА',e(s.name),e(s.direction||'Индивидуальное обучение'),`<a class="btn learner-entry" href="./?screen=student${R.studentHref(s.id)}" target="_blank" rel="noopener">Кабинет ученика ↗</a><button class="btn" data-action="edit-student">Изменить карточку</button><button class="btn primary" data-action="add-lesson">+ Добавить занятие</button>`)+
 `<section class="student-overview"><div class="avatar large">${e(Array.from(s.name)[0].toUpperCase())}</div><div><p class="eyebrow">ЦЕЛЬ ОБУЧЕНИЯ</p><h2>${e(s.goal||'Цель пока не указана')}</h2><p>${e(s.schedule||'Расписание пока не задано')}</p></div><span class="pill neutral">${lessonCount(lessons.length)}</span></section><div id="account-access-root"></div>${s.studentReview?`<p class="callout"><a class="text-link" href="${studentUrl('review')}">Предыдущие отзывы без привязки к занятию →</a></p>`:''}<div class="columns"><section class="panel"><div class="panel-title"><h2>Занятия</h2><span class="small-muted">По дате · сначала новые</span></div>${lessons.length?`<div class="lesson-list">${lessons.map(lessonSummary).join('')}</div>`:empty('Первое занятие','Добавьте дату и тему. Для каждого занятия будут отдельные разделы преподавателя и ученика.','<button class="btn primary" data-action="add-lesson">+ Добавить занятие</button>')}</section><aside class="stack"><section class="panel panel-inner"><span class="task-marker">ОБ УЧЕНИКЕ</span><h3>Заметки наставника</h3><p class="plain-note">${e(s.notes||'Здесь можно записать нагрузку, предпочтения и текущий фокус.')}</p><button class="text-button" data-action="edit-student">Изменить →</button></section>${s.id==='michael'?`<section class="panel panel-inner"><span class="task-marker">СОПРОВОЖДЕНИЕ</span><div class="compact-actions"><a class="text-link" href="${studentUrl('profile')}">Навыки и наблюдения →</a><a class="text-link" href="${studentUrl('roadmap')}">Маршрут обучения →</a><a class="text-link" href="${studentUrl('projects')}">Учебные проекты →</a></div></section>`:`<section class="panel panel-inner"><span class="task-marker">СЛЕДУЮЩИЙ ШАГ</span><p class="plain-note">После первого занятия здесь можно будет уточнить уровень и составить индивидуальный маршрут. Материалы других учеников сюда не переносятся.</p></section>`}</aside></div>`;
}
function dayHeader(){const l=context.lesson;return UI.heading(`${e(context.student.name)} / ${dateLabel(l.date)}`,e(l.title),`${e(l.time)} · ${l.duration} минут · по Москве`,`${badge(l)}<button class="btn" data-action="${prepared()?'edit-teacher-notes':'edit-lesson'}">${prepared()?'Заметки к занятию':'Изменить занятие'}</button>`);}
function sectionReady(role,page){return page==='practice'||page==='homework'||page==='review'||prepared()||(role==='teacher'&&['guide','plan'].includes(page)?Boolean(context.lesson.teacherNotes):role==='student'&&page==='tasks'?Boolean(context.lesson.studentNotes):false);}
function roleCard(role,title,description,links){return `<section class="audience-panel ${role}"><header><span class="audience-symbol">${UI.icon(role)}</span><h2>${title}</h2></header><p class="audience-description">${description}</p><div class="audience-links">${links.map(x=>`<a href="${lessonUrl(role,x[0])}" class="${sectionReady(role,x[0])?'':'not-ready'}"><span><strong>${x[1]}</strong><small>${sectionReady(role,x[0])?x[2]:'Пока не добавлено'}</small></span><b aria-hidden="true">→</b></a>`).join('')}</div></section>`;}
function lessonOverview(){
 if(!prepared())return dayHeader()+`<section class="lesson-preparation"><h2>Подготовка занятия</h2><p class="subtitle">Добавляйте материалы по мере готовности. Дата и время уже сохранены.</p><div class="lesson-preparation-grid"><article class="lesson-preparation-card"><span class="lesson-preparation-step">01 · ТОЛЬКО ДЛЯ ВАС</span><h3>Сценарий преподавателя</h3><p>План, вопросы и подсказки для ведения занятия.</p><span class="small-muted">${context.lesson.teacherNotes?'Сценарий добавлен':'Пока не добавлен'}</span><button class="btn" data-action="edit-teacher-notes">${context.lesson.teacherNotes?'Изменить сценарий':'Добавить сценарий'}</button>${context.lesson.teacherNotes?`<a class="text-link" href="${lessonUrl('teacher','guide')}">Открыть сценарий →</a>`:''}</article><article class="lesson-preparation-card"><span class="lesson-preparation-step">02 · ВИДНО УЧЕНИКУ</span><h3>Задания ученика</h3><p>Условия задач, инструкции и учебные материалы.</p><span class="small-muted">${context.lesson.studentNotes?'Задания добавлены':'Пока не добавлены'}</span><button class="btn" data-action="edit-student-notes">${context.lesson.studentNotes?'Изменить задания':'Добавить задания'}</button></article><article class="lesson-preparation-card"><span class="lesson-preparation-step">03 · ПРАКТИКА</span><h3>Тренажёр</h3><p>Добавьте задачи с проверкой кода и смотрите решения ученика.</p><a class="btn" href="${lessonUrl('teacher','practice')}">Открыть тренажёр →</a></article></div><div class="lesson-preparation-footer"><a class="btn learner-entry" href="${presentationUrl()}" target="_blank" rel="noopener">Экран ученика ↗</a><a class="text-link" href="${lessonUrl('teacher','review')}">Ревью занятия →</a></div></section>`;
 return dayHeader()+`<div class="lesson-start"><a class="btn primary" href="${lessonUrl('teacher','guide')}">Открыть методичку →</a><a class="btn learner-entry" href="${presentationUrl()}" target="_blank" rel="noopener">Экран ученика ↗</a><a class="btn" href="${lessonUrl('teacher','practice')}">Тренажёр</a></div><section class="lesson-preparation"><h2>Дополнения к занятию</h2><div class="lesson-preparation-actions"><button class="btn" data-action="edit-teacher-notes">Сценарий преподавателя</button><button class="btn" data-action="edit-student-notes">Задания ученика</button></div></section><div class="audience-split">`+
 roleCard('teacher','Для преподавателя','Сценарий, ожидаемые ответы и решения. Используйте этот раздел для подготовки и ведения урока.',[
 ['plan','План занятия',prepared()?'Пять этапов с 12:00 до 13:00':'Порядок работы и заметки'],['guide','Подробная методичка',prepared()?'Что говорить, спрашивать и подсказывать':'Сценарий и реплики преподавателя'],['practice','Тренажёр','Задачи занятия, результаты и код ученика'],['review','Ревью занятия','Общий отзыв и проверка сданных работ'],['answers','Эталоны и разбор','Готовые реализации и проверка понимания'],['materials','Материалы для подготовки','Конспекты, примеры и команды запуска']])+roleCard('student','Для ученика','Условия, заготовки и домашняя работа. Без преподавательских реплик и готовых решений.',[
 ['tasks','Задания на занятие',prepared()?'ListTask, GroupingTask и исправление поиска':'Условия и ожидаемый результат'],['practice','Тренажёр','Решение задач и автоматическая проверка'],['materials','Учебные материалы','Заготовки и инструкция запуска'],['homework','Домашняя работа',prepared()?'Поиск и группировка · загрузка работы':'Загрузка работы для ревью'],['review','Ревью занятия','Обратная связь и проверенные работы']])+`</div>${prepared()?`<div class="callout"><strong>На это занятие:</strong> два небольших упражнения и одно исправление в Library. Урок подготовлен; проведение пока не подтверждено.</div>`:''}`;}
function roleStrip(){
 const student=context.audience==='student',l=context.lesson;
 if(presentation&&student)return '';
 const target=presentation?R.studentHref(context.student.id,'lessons'):lessonUrl();
 const tabs=student?'':`<nav class="day-tabs" aria-label="Разделы преподавателя">${[['plan','План'],['guide','Методичка'],['practice','Тренажёр'],['review','Ревью'],['answers','Эталоны'],['materials','Материалы']].map(x=>`<a href="${lessonUrl('teacher',x[0])}" class="${context.page===x[0]?'active':''}" ${context.page===x[0]?'aria-current="page"':''}>${x[1]}${sectionReady('teacher',x[0])?'':'<span class="tab-empty" aria-label="пока не добавлено"> · пусто</span>'}</a>`).join('')}</nav>`;
 return `<section class="lesson-context${student?' learner-context':''}" aria-label="Выбранное занятие"><div class="lesson-caption"><a href="${target}">${e(l.title)}</a><span>${dateLabel(l.date)} · ${e(l.time)} МСК · ${l.duration} мин</span></div>${presentation?'':`<div class="role-controls"><span class="role-label ${student?'student':'teacher'}">${UI.icon(student?'student':'teacher')}${student?'Ученик':'Преподаватель'}</span><a class="text-link" href="${lessonUrl(student?'teacher':'student',student?'guide':'tasks')}">${student?'К преподавателю':'К ученику'} →</a></div>`}</section>${tabs}`;
}
function noteHtml(value){return window.MENTOR_MARKDOWN?`<div class="markdown-body">${window.MENTOR_MARKDOWN.render(value)}</div>`:`<div class="plain-note">${e(value)}</div>`;}
function plainNotes(value,title,role){return `<section class="doc-content notes-document"><h2>${title}</h2>${value?noteHtml(value):`<p class="subtitle">${role==='teacher'?'Сценарий этого занятия ещё не добавлен.':'Задания и материалы этого занятия ещё не добавлены.'}</p>`}${!presentation?`<div class="doc-tools"><button class="btn" data-action="${role==='teacher'?'edit-teacher-notes':'edit-student-notes'}">Добавить или изменить текст</button></div>`:''}</section>`;}
function studentMaterials(){return UI.heading('К ЭТОМУ ЗАНЯТИЮ','Материалы ученика','Скачайте заготовки и откройте их в своей IDE. Готовые решения в этот комплект не входят.',printControl)+`<div class="resource-grid"><article class="resource-card"><span class="type">JAVA / ЗАГОТОВКА</span><h3>ListTask.java</h3><p>Отбор и сортировка. Пять проверок в main.</p><a href="${lessonUrl('student','code','ListTask')}">Посмотреть код <span>→</span></a></article><article class="resource-card"><span class="type">JAVA / ЗАГОТОВКА</span><h3>GroupingTask.java</h3><p>Отчёт по книгам. Шесть проверок в main.</p><a href="${lessonUrl('student','code','GroupingTask')}">Посмотреть код <span>↗</span></a></article></div><div class="download-row"><a class="btn primary" href="/api/materials/student-lesson-2026-09-27" download>↓ Скачать комплект ученика</a></div><section class="doc-content"><h2>Как запустить</h2><p>Распакуйте архив и откройте PowerShell в его папке. Нужен JDK 17 или новее.</p><pre><code>New-Item -ItemType Directory -Force -Path '.\\build\\student' | Out-Null\njavac --release 17 -encoding UTF-8 -d '.\\build\\student' '.\\code\\student\\ListTask.java' '.\\code\\student\\GroupingTask.java'\njava -cp '.\\build\\student' ListTask\njava -cp '.\\build\\student' GroupingTask</code></pre><p>Запускайте команды java отдельно. Заготовки компилируются, но намеренно не проходят проверки до вашей работы. Исправьте методы, не меняя проверки.</p><p>Результат после выполнения заданий: <code>PASS: 5 list checks</code> и <code>PASS: 6 grouping checks</code>.</p></section>`;}
function lessonView(){
 if(context.page==='overview')return lessonOverview();
 if(context.page==='review')return roleStrip()+UI.heading('ОБРАТНАЯ СВЯЗЬ · '+dateLabel(context.lesson.date),'Ревью занятия','Отзывы относятся к этому занятию и его домашней работе.',context.audience==='teacher'?'<button class="btn" data-action="edit-review">Изменить отзыв</button>':printControl)+SC.lessonReview(context)+'<div id="practice-root"><p class="subtitle">Загружаем отзывы к работам…</p></div>';
 if(context.page==='practice')return roleStrip()+`<div id="practice-root" aria-live="polite"><p class="subtitle">Открываем практику…</p></div>`;
 let view='';const teacher=context.audience==='teacher',page=context.page,l=context.lesson;
 if(!prepared()){
  const labels={plan:'План занятия',guide:'Методичка преподавателя',answers:'Эталоны',materials:'Материалы',tasks:'Задания на занятие',homework:'Домашняя работа',code:'Учебный код'};
  view=UI.heading(dateLabel(l.date),labels[page]||'Материалы',(!teacher&&page==='tasks'?e(context.student.name):`${e(context.student.name)} · ${e(l.time)} · ${l.duration} минут`),printControl);
  if(['guide','plan','tasks'].includes(page))view+=plainNotes(teacher?l.teacherNotes:l.studentNotes,teacher?'Заметки и сценарий':'Задания и материалы',context.audience);
  else view+=empty('Пока нет материалов','Для этого занятия материалы ещё не подготовлены. Они появятся отдельно от материалов других учеников.',presentation?'':`<button class="btn" data-action="${teacher?'edit-teacher-notes':'edit-student-notes'}">Добавить заметки к занятию</button>`);
 }else if(page==='code')view=UI.source(context.detail);
 else if(teacher){view=page==='plan'?UI.lesson():page==='answers'?UI.answers():page==='materials'?UI.materials():UI.doc(page);}
 else{view=page==='tasks'?UI.doc('student',{studentMode:true}):page==='homework'?UI.doc('homework'):studentMaterials();}
 if(prepared()&&((teacher&&page==='guide')||(!teacher&&page==='tasks'))&&(!presentation||(teacher?l.teacherNotes:l.studentNotes)))view=plainNotes(teacher?l.teacherNotes:l.studentNotes,'Дополнение к занятию',context.audience)+view;
 return roleStrip()+view;
}
function contextualizeLinks(){
 portalMain.querySelectorAll('a').forEach(a=>{
  const href=a.getAttribute('href')||'';
  if(href==='student.html'&&context.kind==='lesson'){a.href=presentationUrl();return;}
  if(!href.startsWith('#')||href.startsWith('#students')||href==='#main')return;
  const [key,detail]=href.slice(1).split('/');
  if(key==='review'){const reviewLesson=context.lesson||studentLessons(context.student.id).find(R.hasPreparedBundle);a.href=reviewLesson?R.lessonHref(context.student.id,reviewLesson.id,presentation?'student':'teacher','review',detail):R.studentHref(context.student.id,'review',detail);}
  else if(['profile','roadmap','projects','career','journal'].includes(key)){a.href=R.studentHref(context.student.id,key,detail);}
  else if(context.kind==='lesson'){
   if(key==='lesson')a.href=lessonUrl();
   else if(key==='source')a.href=lessonUrl(['ListSolutions','GroupingSolution'].includes(detail)?'teacher':'student','code',detail);
   else if(key==='student')a.href=lessonUrl('student','tasks',detail);
   else if(key==='homework')a.href=lessonUrl('student','homework',detail);
   else if(key==='practice')a.href=lessonUrl('student','practice',detail);
   else a.href=lessonUrl('teacher',key,detail);
  }else{
   const l=studentLessons(context.student.id).find(R.hasPreparedBundle);
   if(!l){a.removeAttribute('href');return;}
   if(key==='lesson')a.href=R.lessonHref(context.student.id,l.id);
   else if(key==='student'||key==='homework')a.href=R.lessonHref(context.student.id,l.id,'student',key==='student'?'tasks':'homework',detail);
   else if(key==='source')a.href=R.lessonHref(context.student.id,l.id,['ListSolutions','GroupingSolution'].includes(detail)?'teacher':'student','code',detail);
   else a.href=R.lessonHref(context.student.id,l.id,'teacher',key,detail);
  }
 });
 portalMain.querySelectorAll('a[href^="https://"]').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});
 if(presentation)portalMain.querySelectorAll('a[href^="#students"]').forEach(a=>{const r=R.parseRoute(a.hash,model);if(!R.isStudentRoute(r))a.remove()});
}
function sideNav(){
 const s=context.student,l=context.lesson;
 const mergedLesson=presentation&&context.kind==='lesson'&&context.audience==='student';
 document.querySelector('.topbar').classList.toggle('lesson-topbar',mergedLesson);
 if(presentation){
  document.getElementById('context-nav').innerHTML=SC.navigation(context);
  document.querySelector('.brand').innerHTML=`<span class="monogram">${e(Array.from(s?.name||'У')[0].toUpperCase())}</span><span>${e(s?.name||'Ученик')}<small>${e(s?.direction||'УЧЕНИК')}</small></span>`;
  document.querySelector('.brand').href=s?R.studentHref(s.id):'#';
  document.querySelector('.sidebar-foot').innerHTML='<span class="status-dot"></span>Кабинет ученика<p>Цель, занятия и обратная связь</p>';
  document.querySelector('.site-footer').innerHTML='Кабинет ученика <span>Мои занятия, материалы и обратная связь</span>';
  document.getElementById('crumb').innerHTML=mergedLesson?`<a class="lesson-top-title" href="${R.studentHref(s.id,'lessons')}">${e(l.title)}</a><div class="lesson-top-meta"><a href="${R.studentHref(s.id)}">${e(s.name)}</a><span aria-hidden="true">·</span><span>${dateLabel(l.date)} · ${e(l.time)} МСК · ${l.duration} мин</span></div>`:`${s?`<a href="${R.studentHref(s.id)}">${e(s.name)}</a>`:'Кабинет ученика'}<span>/</span><b>${l?dateLabel(l.date):context.kind==='student'?'Главная':({goal:'Моя цель',lessons:'Занятия',roadmap:'Маршрут обучения',review:'Предыдущие отзывы'}[context.page]||'Материалы')}</b>`;
  return;
 }
 const item=(href,label,icon,active)=>`<a href="${href}" ${active?'class="active" aria-current="page"':''}><span class="nav-icon">${UI.icon(icon)}</span>${label}</a>`;
 let nav='<nav aria-label="Главное меню">'+item('#students','Все ученики','students',context.kind==='students')+'</nav>';
 if(s){nav+=`<div class="selected-student"><span class="avatar small">${e(Array.from(s.name)[0].toUpperCase())}</span><div><strong>${e(s.name)}</strong><small>${e(s.direction||'Обучение')}</small></div></div><p class="nav-label">КАРТОЧКА УЧЕНИКА</p><nav aria-label="Карточка ученика">${item(R.studentHref(s.id),'Занятия','lessons',context.kind==='student')}`;
  if(s.id==='michael')nav+=[['profile','Навыки и наблюдения','profile'],['roadmap','Маршрут обучения','roadmap'],['projects','Учебные проекты','projects']].map(x=>item(R.studentHref(s.id,x[0]),x[1],x[2],context.kind==='profile'&&context.page===x[0])).join('');
  nav+='</nav>';
 }
 if(l)nav+=context.audience==='student'?SC.lessonNavigation(context):`<p class="nav-label">ТЕКУЩЕЕ ЗАНЯТИЕ</p><nav aria-label="Материалы выбранного дня">${item(lessonUrl(),'Обзор занятия','materials',context.page==='overview')}</nav>`;
 document.getElementById('context-nav').innerHTML=nav;
 const crumb=document.getElementById('crumb');
 crumb.innerHTML=presentation?`Экран ученика <span>/</span> <b>${e(s?.name||'Занятие')}</b>`:`<a href="#students">Ученики</a>${s?`<span>/</span><a href="${R.studentHref(s.id)}">${e(s.name)}</a>`:''}${l?`<span>/</span><b>${dateLabel(l.date)}</b>`:''}`;
}
function render(){
 if(!portalReady)return;
 if(location.hash==='#account'){window.MENTOR_AUTH.showPasswordForm(false);return;}
 document.body.classList.toggle('auth-screen',false);
 window.MENTOR_ACCOUNT_ACCESS?.dispose?.();
 context=R.parseRoute(location.hash,model);
 const routeKey=location.hash.replace(/\/section-\d+$/,'');
 if(context.detail?.startsWith('section-')&&portalMain.dataset.route===routeKey){window.DOCUMENT_NAVIGATION.goTo(context.detail);return;}
 window.MENTOR_PRACTICE?.dispose();
 portalMain.dataset.route=routeKey;
 if(presentation&&!R.isStudentRoute(context)){
  const own=window.MENTOR_AUTH.session()?.account;
  if(own?.role==='student'&&model.students.some(s=>s.id===own.studentId)){location.hash=R.studentHref(own.studentId);return;}
  context={kind:'missing',student:context.student};
 }
 document.body.classList.toggle('student-presentation',presentation);
 document.body.classList.toggle('student-cabinet',presentation);
 sideNav();
 if(presentation){
  portalMain.innerHTML=context.kind==='student'||context.kind==='profile'?SC.page(context,model):context.kind==='lesson'?lessonView():empty('Материал недоступен','Открой свой кабинет или выбери занятие в меню.',context.student?`<a class="btn" href="${R.studentHref(context.student.id)}">Мой кабинет</a>`:'');
 }else portalMain.innerHTML=context.kind==='students'?studentsPage():context.kind==='student'?studentPage():context.kind==='lesson'?lessonView():context.kind==='profile'?(context.page==='review'?SC.reviewArchive(context.student,model,'teacher'):context.student.id==='michael'&&['profile','roadmap','projects','career','journal'].includes(context.page)?UI.doc(context.page):studentPage()):UI.notFound();
 if(context.student)contextualizeLinks();
 let practiceRoot=document.getElementById('practice-root');
 if(context.kind==='lesson'&&context.audience==='student'&&(context.page==='homework'||context.page==='tasks'&&!prepared())){
  practiceRoot=document.createElement('section');practiceRoot.id='practice-root';
  practiceRoot.innerHTML='<p class="subtitle">Загружаем задания и сдачи…</p>';
  const pageHead=portalMain.querySelector('.page-head');
  if(pageHead)pageHead.insertAdjacentElement('afterend',practiceRoot);else portalMain.append(practiceRoot);
 }
 if(practiceRoot&&window.MENTOR_PRACTICE)window.MENTOR_PRACTICE.mount(practiceRoot,{studentId:context.student.id,lessonId:context.lesson.id,presentation:context.audience==='student',page:context.page,exerciseId:context.page==='practice'?context.detail:null});
 if(context.kind==='student'&&!presentation)window.MENTOR_ACCOUNT_ACCESS?.mount?.(document.getElementById('account-access-root'),{studentId:context.student.id,auth:window.MENTOR_AUTH});
 if(context.kind==='lesson'&&context.audience==='teacher'&&context.page==='materials'&&prepared()){
  UI.setFilter('Все');contextualizeLinks();document.getElementById('resource-search').addEventListener('input',()=>{UI.renderResources();contextualizeLinks()});
 }
 document.title=(context.student?context.student.name+' · ':'')+(presentation?'Кабинет ученика':context.lesson?'Занятие '+context.lesson.date:context.kind==='students'?'Ученики':'Кабинет наставника');
 closeMenu();
 window.DOCUMENT_NAVIGATION.mount(portalMain);
 requestAnimationFrame(()=>{if(context.detail?.startsWith('section-'))window.DOCUMENT_NAVIGATION.goTo(context.detail);else{window.scrollTo(0,0);portalMain.focus({preventScroll:true})}});
}
function input(label,name,value='',opts={}){return `<label class="form-field"><span>${label}${opts.required?' <b>*</b>':''}</span><input name="${name}" type="${opts.type||'text'}" value="${e(value)}" ${opts.required?'required':''} ${opts.max?'maxlength="'+opts.max+'"':''} ${opts.min?'min="'+opts.min+'"':''} ${opts.limit?'max="'+opts.limit+'"':''}></label>`;}
function textarea(label,name,value='',hint='',max=20000){return `<label class="form-field"><span>${label}</span><textarea name="${name}" rows="5" maxlength="${max}">${e(value)}</textarea>${hint?`<small>${hint}</small>`:''}</label>`;}
const lessonNoteEditors={
 'edit-teacher-notes':{field:'teacherNotes',title:'Сценарий занятия',label:'План, вопросы и подсказки',hint:'Только для преподавателя. Ученик этот текст не видит.'},
 'edit-student-notes':{field:'studentNotes',title:'Задания ученика',label:'Задания и учебные материалы',hint:'Ученик увидит этот текст в заданиях занятия.'},
 'edit-review':{field:'reviewNotes',title:'Ревью занятия',label:'Отзыв и следующие шаги',hint:'Ученик увидит этот текст в разделе «Ревью» этого занятия.'}
};
const editorModes=['add-student','edit-student','add-lesson','edit-lesson',...Object.keys(lessonNoteEditors)];
function disposeLessonEditor(){lessonEditor?.dispose();lessonEditor=null;}
function openEditor(mode){
 if(saving||window.MENTOR_AUTH.session()?.account.role!=='teacher'||!editorModes.includes(mode))return;
 if(mode!=='add-student'&&!context.student)return;
 if((mode==='edit-lesson'||lessonNoteEditors[mode])&&(!context.lesson||context.lesson.studentId!==context.student.id))return;
 if(mode==='edit-lesson'&&prepared())return;
 disposeLessonEditor();
 formMode=mode;formTarget={studentId:context.student?.id,lessonId:context.lesson?.id,accountId:activeAccountId,returnHash:location.hash};const s=context.student||{},l=context.lesson||{};let title,description,fields;
 if(mode==='add-student'||mode==='edit-student'){
  const data=mode==='edit-student'?s:{};title=mode==='edit-student'?'Карточка ученика':'Новый ученик';description='У каждого ученика будут свои занятия и материалы.';
  fields=`<fieldset class="form-section"><legend>Основные сведения</legend><div class="form-pair">${input('Имя','name',data.name,{required:true,max:120})}${input('Направление','direction',data.direction||'Java Backend',{max:120})}</div>${input('Цель обучения','goal',data.goal,{max:1000})}${input('Расписание','schedule',data.schedule,{max:500})}</fieldset><fieldset class="form-section"><legend>Для преподавателя</legend>${textarea('Заметки наставника','notes',data.notes,'В кабинете ученика не показываются.',5000)}</fieldset><fieldset class="form-section form-role student"><legend>Материалы ученика</legend>${textarea('Маршрут обучения','studentRoadmap',data.studentRoadmap,s.id==='michael'?'Дополнение к подготовленному маршруту Михаэля.':'Этапы, задачи и критерии готовности.')}${data.studentReview?textarea('Архивный отзыв без занятия','studentReview',data.studentReview,'Новые отзывы добавляйте в конкретное занятие.'):''}</fieldset>`;
 }else if(lessonNoteEditors[mode]){
  const editor=lessonNoteEditors[mode];title=editor.title;description=e(s.name)+' · '+e(l.title);
  fields=window.MENTOR_LESSON_EDITOR?window.MENTOR_LESSON_EDITOR.markup({name:editor.field,value:l[editor.field]||'',label:editor.label,hint:editor.hint}):textarea(editor.label,editor.field,l[editor.field],editor.hint,200000);
 }else{
  const editing=mode==='edit-lesson',data=editing?l:{};title=editing?'Изменить занятие':'Новое занятие';description=e(s.name)+' · время по Москве'+(editing?'':'. Материалы можно добавить после создания.');
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  fields=input('Тема занятия','title',data.title,{required:true,max:200})+`<div class="form-grid">${input('Дата','date',data.date||localDate,{type:'date',required:true})}${input('Время','time',data.time||'12:00',{type:'time',required:true})}${input('Длительность, мин','duration',data.duration||60,{type:'number',required:true,min:15,limit:240})}</div>`;
 }
 document.getElementById('editor-body').innerHTML=`<header class="editor-head"><div><p class="eyebrow">${title==='Новый ученик'?'УЧЕНИКИ':'ЛОКАЛЬНЫЙ КАБИНЕТ'}</p><h2 id="editor-title">${title}</h2><p>${description}</p></div><button type="button" data-action="close-editor" class="close-dialog" aria-label="Закрыть форму">×</button></header><div class="editor-scroll">${fields}</div><div class="editor-actions"><p id="form-error" role="alert" class="form-error" hidden></p><div class="editor-buttons"><button type="button" class="btn" data-action="close-editor">Отмена</button><button type="submit" class="btn primary" id="save-record">${mode==='add-lesson'?'Создать занятие':mode==='add-student'?'Добавить':'Сохранить'}</button></div></div>`;
 const dialog=document.getElementById('editor-dialog');dialog.dataset.mode=mode;dialog.classList.toggle('note-editor',Boolean(lessonNoteEditors[mode]&&window.MENTOR_LESSON_EDITOR));
 if(lessonNoteEditors[mode]&&window.MENTOR_LESSON_EDITOR)lessonEditor=window.MENTOR_LESSON_EDITOR.mount(document.getElementById('editor-body'),{render:window.MENTOR_MARKDOWN?.render||e});
 dialog.showModal();
 (document.getElementById('editor-form').querySelector('.lesson-md-editor textarea')||document.getElementById('editor-form').querySelector('input, textarea'))?.focus();
}
async function submitEditor(event){event.preventDefault();if(saving||!portalReady||!formMode||!formTarget)return;const form=event.currentTarget;if(!form.reportValidity())return;
 const stamp=generation,owner=activeAccountId,mode=formMode,targetInfo={...formTarget};
 const current=()=>stamp===generation&&owner===activeAccountId&&window.MENTOR_AUTH.session()?.account.id===owner&&portalReady;
 if(!current()||targetInfo.accountId!==owner)return;
 saving=true;const button=document.getElementById('save-record'),saveLabel=button.textContent;button.disabled=true;button.textContent='Сохраняем…';
 const values=Object.fromEntries(new FormData(form));if('duration'in values)values.duration=Number(values.duration);
 lessonEditor?.setBusy(true);
 let endpoint,method,target;
 if(mode==='add-student'){endpoint='/api/students';method='POST';}
 else if(mode==='edit-student'){endpoint='/api/students/'+encodeURIComponent(targetInfo.studentId);method='PATCH';}
 else{endpoint='/api/students/'+encodeURIComponent(targetInfo.studentId)+'/lessons'+(mode==='add-lesson'?'':'/'+encodeURIComponent(targetInfo.lessonId));method=mode==='add-lesson'?'POST':'PATCH';}
 try{const result=await api(endpoint,{method,body:JSON.stringify(values),expectedAccountId:owner});if(!current())return;await refresh();if(!current())return;
  target=lessonNoteEditors[mode]?targetInfo.returnHash:result.lesson?R.lessonHref(result.lesson.studentId,result.lesson.id):R.studentHref(result.student.id);
  delete portalMain.dataset.route;
  disposeLessonEditor();document.getElementById('editor-dialog').close();if(location.hash===target)render();else location.hash=target;UI.toast('Сохранено на этом компьютере');
 }catch(error){if(!current())return;const alert=document.getElementById('form-error');if(alert){alert.textContent=error.message;alert.hidden=false;}button.textContent=saveLabel;}
 finally{if(current()){saving=false;button.disabled=false;lessonEditor?.setBusy(false);}}
}
function closeMenu(){document.getElementById('sidebar').classList.remove('open');document.getElementById('menu-toggle').setAttribute('aria-expanded','false');}
document.getElementById('editor-form').addEventListener('submit',submitEditor);
document.getElementById('editor-dialog').addEventListener('cancel',ev=>{if(saving)ev.preventDefault()});
document.getElementById('editor-dialog').addEventListener('close',()=>{if(!document.getElementById('editor-dialog').open)disposeLessonEditor()});
document.addEventListener('click',event=>{
 if(!portalReady){if(event.target.closest?.('button')?.dataset.action==='retry')initialize(window.MENTOR_AUTH.session());return;}
 const link=event.target.closest('a[href^="#"]');
 if(link&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();const hash=link.getAttribute('href');if(hash==='#main'){portalMain.focus();return}if(location.hash===hash)render();else location.hash=hash;}
 const b=event.target.closest('button');
 if(b?.dataset.action){if(b.dataset.action==='close-editor'){if(!saving)document.getElementById('editor-dialog').close();}else if(editorModes.includes(b.dataset.action))openEditor(b.dataset.action);else if(b.dataset.action==='retry')initialize(window.MENTOR_AUTH.session());}
 if(b?.hasAttribute('data-print'))window.print();
 if(b?.hasAttribute('data-expand-explanations'))window.DOCUMENT_NAVIGATION.expandExplanations();
 if(b?.dataset.copyCode)UI.copy(UI.content.code[b.dataset.copyCode].text);
 if(b?.dataset.copyDoc)UI.copy(UI.content.docs[b.dataset.copyDoc].raw.replace(/\[([^\]]+)\]\((?:<)?[A-Za-z]:[^)]+\)/g,'$1'));
 if(b?.dataset.filter){document.querySelectorAll('[data-filter]').forEach(t=>t.setAttribute('aria-pressed',t===b));UI.setFilter(b.dataset.filter);contextualizeLinks();}
 if(b?.id==='menu-toggle'){const open=document.getElementById('sidebar').classList.toggle('open');b.setAttribute('aria-expanded',String(open));}
 else if(!event.target.closest('.sidebar'))closeMenu();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
window.addEventListener('hashchange',render);
function stop(options={}){
 disposeLessonEditor();
 generation++;portalReady=false;activeAccountId=null;presentation=false;model={students:[],lessons:[]};context={kind:'students'};formMode=null;formTarget=null;saving=false;
 window.MENTOR_ACCOUNT_ACCESS?.dispose?.();
 window.MENTOR_PRACTICE?.dispose?.(options);
 UI.setContent(null);
 portalMain.innerHTML='';delete portalMain.dataset.route;
 document.getElementById('context-nav').innerHTML='';document.getElementById('auth-controls').innerHTML='';
 document.getElementById('crumb').textContent='Кабинет';
 document.body.classList.toggle('student-presentation',false);document.body.classList.toggle('student-cabinet',false);
 document.querySelector('.topbar').classList.toggle('lesson-topbar',false);
 const editor=document.getElementById('editor-dialog');if(editor.open)editor.close();
 document.getElementById('editor-body').innerHTML='';
 brand.innerHTML=neutralShell.brand;brand.href=neutralShell.brandHref;sidebarFoot.innerHTML=neutralShell.sidebarFoot;siteFooter.innerHTML=neutralShell.siteFooter;document.title=neutralShell.title;
}
async function initialize(session){
 stop();if(!session){window.MENTOR_AUTH.showLogin();return}
 const stamp=generation,owner=session.account.id;
 activeAccountId=owner;presentation=session.account.role==='student'||session.account.role==='teacher'&&teacherPreview;
 document.body.classList.toggle('auth-screen',false);
 portalMain.innerHTML='<p class="subtitle">Открываем кабинет…</p>';
 try{
  const [nextModel,content]=await Promise.all([api('/api/state',{expectedAccountId:owner}),api('/api/content',{expectedAccountId:owner})]);
  if(stamp!==generation||window.MENTOR_AUTH.session()?.account.id!==owner)return;
  model=nextModel;UI.setContent(content);portalReady=true;
  document.getElementById('auth-controls').innerHTML=`<span class="auth-identity">${e(session.account.login)} · ${session.account.role==='teacher'?(teacherPreview?'Преподаватель · Просмотр кабинета ученика':'Преподаватель'):'Ученик'}</span><button type="button" class="auth-control" data-auth-action="password">Пароль</button><button type="button" class="auth-control" data-auth-action="logout">Выйти</button><span class="auth-action-error" role="alert" aria-live="polite"></span>`;
  if(['','#login','#register','#reset-password','#account'].includes(location.hash))location.hash=session.account.role==='student'&&session.account.studentId?R.studentHref(session.account.studentId):'#students';
  render();
 }catch(error){if(stamp!==generation)return;portalMain.innerHTML=UI.heading('НЕ УДАЛОСЬ ОТКРЫТЬ','Кабинет временно недоступен','Проверьте соединение и повторите попытку.','<button class="btn" data-action="retry">Повторить</button>')+`<div class="callout rust">${e(error.message)}</div>`;}
}
window.MENTOR_PORTAL={stop};
window.MENTOR_AUTH.subscribe(initialize);
window.MENTOR_AUTH.start();

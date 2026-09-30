(function(root,factory){
 'use strict';
 if(typeof module!=='undefined'&&module.exports)module.exports=factory;
 else root.STUDENT_CABINET=factory(root.LESSON_UI,root.MentorRoutes,root.MENTOR_MARKDOWN);
})(typeof window!=='undefined'?window:globalThis,function(UI,R,markdown){
 'use strict';
 const e=UI.esc;
 const date=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
 const icon=name=>typeof UI.icon==='function'?UI.icon(name):'';
 const menu=[['','Главная','home'],['lessons','Занятия','lessons'],['goal','Моя цель','goal'],['roadmap','Маршрут обучения','roadmap']];
 const link=(s,page)=>R.studentHref(s.id,page);
 const lessons=(s,state)=>state.lessons.filter(l=>l.studentId===s.id).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 function lessonNavigation(ctx){
  if(ctx.kind!=='lesson'||ctx.audience!=='student'||!ctx.student||!ctx.lesson)return '';
  const activePage=ctx.page==='code'?'materials':ctx.page;
  return `<section class="learner-lesson-menu"><p class="nav-label">ЗАНЯТИЕ · ${e(new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(ctx.lesson.date+'T12:00:00')))}</p><nav aria-label="Разделы занятия">${[['tasks','Задания','student'],['practice','Тренажёр','code'],['materials','Материалы','materials'],['homework','Домашняя работа','materials'],['review','Ревью','review']].map(([page,label,name])=>`<a href="${R.lessonHref(ctx.student.id,ctx.lesson.id,'student',page)}" ${activePage===page?'class="active" aria-current="page"':''}><span class="nav-icon">${icon(name)}</span>${label}</a>`).join('')}</nav></section>`;
 }
 function navigation(ctx){
  const s=ctx.student;if(!s)return '';
  return `<p class="nav-label">МОЁ ОБУЧЕНИЕ</p><nav aria-label="Кабинет ученика">${menu.map(([page,label,name])=>{const active=ctx.kind==='student'&&!page||ctx.kind==='profile'&&ctx.page===page;return `<a href="${link(s,page)}" ${active?'class="active" aria-current="page"':''}><span class="nav-icon">${icon(name)}</span>${label}</a>`}).join('')}</nav>${lessonNavigation(ctx)}`;
 }
 function lessonCard(s,l,focused=false,upcoming=false){
  const bundle=R.hasPreparedBundle(l),tasks=bundle||Boolean(l.studentNotes?.trim());
  const availability=bundle?'Материалы готовы':tasks?'Задания добавлены · материалы готовятся':'Текст заданий и материалы не добавлены';
  const actions=focused?[['tasks','Открыть задания',tasks],['homework','Домашняя работа',true],['review','Ревью',true]]:[['tasks','Задания',tasks],['materials','Материалы',bundle],['homework','Домашняя работа',true],['review','Ревью',true]];
  return `<article class="learner-lesson panel${focused?' lesson-focus':''}"><div class="learner-lesson-heading"><div>${focused?`<p class="eyebrow">${upcoming?'БЛИЖАЙШЕЕ ЗАНЯТИЕ':'ПОСЛЕДНЕЕ ЗАНЯТИЕ'}</p>`:''}<p class="lesson-datetime">${date(l.date)} · ${e(l.time)} МСК · ${e(l.duration)} мин</p><h2>${e(l.title)}</h2></div>${bundle?'<span class="pill neutral">Материалы готовы</span>':''}</div>${bundle?'':`<p class="lesson-availability">${availability}</p>`}${focused&&!upcoming?'<p class="lesson-availability">Дата занятия прошла. Факт проведения здесь не отмечен.</p>':''}<div class="doc-tools">${actions.map(([page,title,available])=>`<a class="btn ${page==='tasks'?'primary':''}" href="${R.lessonHref(s.id,l.id,'student',page)}">${icon(page==='tasks'?'student':page==='homework'||page==='review'?'review':'materials')}${title}${available?'':' · готовится'}</a>`).join('')}</div></article>`;
 }
 function lessonList(s,state){
  const items=lessons(s,state);
  if(!items.length)return '<div class="empty-state"><h2>Занятий пока нет</h2><p>Здесь появятся даты занятий, задания и материалы.</p></div>';
  return `<div class="learner-lessons">${items.map(l=>lessonCard(s,l)).join('')}</div>`;
 }
 function goal(s){
  return `<section class="learner-goal"><span class="audience-symbol">${icon('goal')}</span><div><p class="eyebrow">МОЯ ЦЕЛЬ</p><h2>${e(s.goal||'Цель обучения ещё предстоит определить')}</h2><p>${e(s.direction||'Индивидуальное обучение')}${s.schedule?' · '+e(s.schedule):''}</p></div></section>`;
 }
 function home(s,state,now=new Date()){
  const focus=R.lessonFocus(lessons(s,state),now);
  return UI.heading('КАБИНЕТ УЧЕНИКА',e(s.name),'Открой задания к занятию или вернись к домашней работе.')+(focus?lessonCard(s,focus.lesson,true,focus.upcoming):lessonList(s,state))+`<div class="learner-section-title"><a class="text-link" href="${link(s,'lessons')}">Все занятия →</a></div><div class="learner-goal-compact">${goal(s)}</div><nav class="learner-destinations" aria-label="Следующие шаги"><a href="${link(s,'goal')}">${icon('goal')}Моя цель</a><a href="${link(s,'roadmap')}">${icon('roadmap')}Маршрут обучения</a></nav>`;
 }
 function studentDoc(s,key,page,sectionHref=section=>R.studentHref(s.id,page,section)){
  const d=UI.content.docs[key];
  if(!d)return '<div class="empty-state"><h2>Материал готовится</h2><p>Наставник добавит его после обсуждения.</p></div>';
  const review=page==='review',week=!review&&d.sections.find(section=>/ближайшую неделю/i.test(section.title));
  const sections=week?[week,...d.sections.filter(section=>section!==week)]:d.sections;
  let intro=`<div class="doc-content doc-intro">${d.intro}</div>`;
  if(review){
   const paragraphs=d.intro.match(/<p>[\s\S]*?<\/p>/g)||[],reviewView=UI.content.viewData?.students?.[s.id]?.review||UI.content.viewData?.review||{};
   const priorities=(reviewView.priorities||[]).filter(item=>d.sections.some(section=>section.id===item.sectionId)),metadataCount=reviewView.metadataParagraphs||0;
   intro=`<section class="review-priorities"><h2>С чего начать</h2>${paragraphs.length?paragraphs.slice(metadataCount).join(''):d.intro}<div class="doc-tools">${priorities.map(item=>`<a class="btn" href="${sectionHref(item.sectionId)}">${e(item.label)}</a>`).join('')}</div></section>${metadataCount?`<details class="review-metadata"><summary>Дата и версия проверки</summary><div class="doc-content">${paragraphs.length?paragraphs.slice(0,metadataCount).join(''):d.intro}</div></details>`:''}`;
  }
  return `<div class="doc-layout"><div class="doc-main">${intro}${sections.map((section,i)=>{const stage=!review&&/^Этап\s+\d+\./.test(section.title),heading=`<h2>${e(section.title)}</h2>`;return `<section class="doc-content doc-section${stage?' roadmap-stage-section':''}${section===week?' roadmap-week':''}" id="${section.id}">${stage?`<details class="roadmap-stage"><summary>${heading}</summary><div class="roadmap-stage-body">${section.html}</div></details>`:`<span class="section-kicker">${String(i+1).padStart(2,'0')} / ${String(sections.length).padStart(2,'0')}</span>${heading}${section.html}`}</section>`}).join('')}</div><details class="toc toc-disclosure"><summary>Разделы материала</summary><nav class="toc-links" aria-label="Оглавление материала">${sections.map(section=>`<a href="${sectionHref(section.id)}">${e(section.title)}</a>`).join('')}</nav></details></div>`;
 }
 function lessonReview(ctx){
  const s=ctx.student,l=ctx.lesson,d=UI.content.docs['student-review'];
  const prepared=d?.studentId===s.id&&l.studentId===s.id&&d.lessonId===l.id&&d.bundleId===l.bundleId;
  const note=l.reviewNotes||'',hasNote=Boolean(note.trim());
  let html=hasNote?`<section class="doc-content"><h2>Отзыв по занятию</h2><div class="${markdown?'markdown-body':'plain-note'}">${markdown?markdown.render(note):e(note)}</div></section>`:'';
  if(prepared&&ctx.audience==='teacher'&&typeof UI.review==='function')html+=`<details class="doc-content"><summary>Технический разбор проверки Library · для преподавателя</summary>${UI.review()}</details>`;
  if(prepared)html+=studentDoc(s,'student-review','review',section=>R.lessonHref(s.id,l.id,ctx.audience||'student','review',section));
  else if(!hasNote)html+='<section class="doc-content"><h2>Общий отзыв пока не добавлен</h2><p>Преподаватель оставит здесь итоги занятия и следующие шаги. Замечания к сданным файлам появятся ниже.</p></section>';
  return html;
 }
 function reviewArchive(s,state,audience='student'){
  const items=lessons(s,state);
  return UI.heading('ОБРАТНАЯ СВЯЗЬ','Ревью по занятиям','Выберите занятие, чтобы открыть его отзыв и проверенные работы.')+
   (items.length?`<div class="learner-lessons">${items.map(l=>`<a class="panel panel-inner" href="${R.lessonHref(s.id,l.id,audience,'review')}"><p class="eyebrow">${date(l.date)}</p><h2>${e(l.title)}</h2><span class="text-link">Открыть ревью →</span></a>`).join('')}</div>`:'<div class="empty-state"><h2>Проверок по занятиям пока нет</h2><p>Ревью появится в соответствующем занятии.</p></div>')+
   (s.studentReview?`<section class="doc-content"><h2>Предыдущий отзыв без привязки к занятию</h2><div class="plain-note">${e(s.studentReview)}</div></section>`:'');
 }
 function page(ctx,state){
  const s=ctx.student;
  if(ctx.kind==='student')return home(s,state);
  if(ctx.page==='lessons')return UI.heading('МОЁ ОБУЧЕНИЕ','Мои занятия','Открой нужную дату, чтобы перейти к заданиям, домашней работе и ревью.')+lessonList(s,state)+(s.studentReview?`<p class="callout"><a class="text-link" href="${link(s,'review')}">Предыдущие отзывы без привязки к занятию →</a></p>`:'');
  if(ctx.page==='review')return reviewArchive(s,state);
  if(ctx.page==='goal')return UI.heading('МОЁ ОБУЧЕНИЕ','Моя цель','Ориентир для выбора задач и следующих этапов.')+goal(s)+(UI.content.viewData?.students?.[s.id]?.goalHtml||UI.content.viewData?.goalHtml||'');
  const isReview=ctx.page==='review',title=isReview?'Ревью домашки':'Маршрут обучения',text=isReview?s.studentReview:s.studentRoadmap,key=isReview?'student-review':'student-roadmap';
  let result=UI.heading(isReview?'ОБРАТНАЯ СВЯЗЬ':'МОЁ ОБУЧЕНИЕ',title,isReview?'Что уже получилось и что нужно проверить в следующей версии.':'Шаги, практика и понятный результат каждого этапа.','<button class="btn" data-print>Печать / PDF ↗</button>');
  const hasDocument=UI.content.docs[key]?.studentId===s.id;
  if(text)result+=`<section class="doc-content"><h2>${hasDocument?'Дополнение':title}</h2><div class="plain-note">${e(text)}</div></section>`;
  if(hasDocument)result+=studentDoc(s,key,ctx.page);
  else if(!text)result+=`<div class="empty-state"><h2>${isReview?'Проверок пока нет':'Маршрут ещё не составлен'}</h2><p>${isReview?'Здесь появятся замечания к домашней работе и следующие шаги.':'Здесь появится план с учётом твоей цели и текущего уровня.'}</p></div>`;
  return result;
 }
 return {navigation,lessonNavigation,page,home,lessonReview,reviewArchive};
});

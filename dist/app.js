'use strict';
const content = window.MENTOR_CONTENT;
const main = document.getElementById('main');
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const printButton = '<button class="btn" data-print>Печать / PDF ↗</button>';
const steps = [
 ['12:00','5 мин','Сначала прогноз, потом запуск','Ученик предсказывает поведение списка и различает число записей и читателей.'],
 ['12:05','15 мин','Почему List нельзя сортировать','ListTask: прочитать исключение, объяснить toList(), проверить два исправления.'],
 ['12:20','18 мин','Одна книга — её читатели','GroupingTask: счётчик появлений, Map и Set, отдельная строка для каждой книги.'],
 ['12:38','15 мин','Переносим исправление в Library','Воспроизвести падение search, изменить один участок, повторить три проверки.'],
 ['12:53','7 мин','Закрепляем и выбираем первый шаг','Три вопроса без эталона. Договориться о домашней работе на несколько дней.']
];
function heading(label,title,description,actions=''){
 return `<div class="page-head"><div><p class="eyebrow">${label}</p><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="actions">${actions}</div></div>`;
}
function lesson(){
 return heading('ВОСКРЕСЕНЬЕ · 27 СЕНТЯБРЯ 2026','План на час','От чтения чужого кода — к осмысленному исправлению в своём проекте.','<span class="pill">● Урок подготовлен</span>') + `
 <section class="lesson-hero"><div class="hero-copy"><p class="eyebrow">JAVA CORE / LIBRARY</p><h2>Из ошибки — в проверку.<br>Списки и группировка</h2><p>Два небольших упражнения и одно исправление в Library. Реплики преподавателя, ожидаемые ответы и подсказки уже разложены по этапам.</p><div class="actions"><a class="btn primary" href="#guide/section-1">Открыть методичку <span>→</span></a><a class="btn light" href="student.html" target="_blank" rel="noopener">Задания на экран ↗</a></div></div><div class="hero-date"><span class="day">ВОСКРЕСЕНЬЕ</span><strong>27</strong><span class="month">сентября · 2026</span><span class="time">12:00–13:00</span><span class="zone">Москва · 60 минут</span></div></section>
 <div class="columns"><section class="panel"><div class="panel-title"><h2>Ход занятия</h2><span class="small-muted">5 этапов · 60 минут</span></div><ol class="agenda">${steps.map((s,i)=>`<li><a class="agenda-row" href="#guide/section-${i+1}"><div class="agenda-time">${s[0]}<small>${s[1]}</small></div><div><h3>${s[2]}</h3><p>${s[3]}</p></div><span class="agenda-arrow">↗</span></a></li>`).join('')}</ol><div class="panel-bottom"><a class="text-link" href="#guide/section-0">До звонка: подготовка за 10 минут <span>→</span></a></div></section>
 <aside class="stack"><section class="panel panel-inner"><span class="task-marker">РЕЗУЛЬТАТ ЧАСА</span><h3>Что ученик сможет объяснить</h3><ul class="mini-list"><li>Почему toList() и sort() конфликтуют.</li><li>Зачем хранить количество появлений отдельно от читателей.</li><li>Как проверка подтверждает исправление search.</li></ul><a class="text-link" href="#guide/section-5">Вопросы на выходе →</a></section><section class="panel panel-inner"><span class="task-marker">ПОД РУКОЙ</span><div class="meta-pair"><span>Учебный код</span><strong>JDK 17+</strong></div><div class="meta-pair"><span>Практика после урока</span><strong>3–3,5 ч</strong></div><div class="compact-actions"><a class="btn" href="downloads/student-lesson-2026-09-27.zip" download>↓ Заготовки ученика</a><a class="text-link" href="#run">Команды запуска →</a></div></section></aside></div>
 <div class="quick-grid"><a class="quick-card" href="#guide/section-6"><span class="number">01 / ЕСЛИ ЗАСТРЯЛ</span><h3>Запасной сценарий</h3><p>Как сократить упражнение, сохранив смысл и границы часа.</p></a><a class="quick-card" href="#homework"><span class="number">02 / ПОСЛЕ ЗАНЯТИЯ</span><h3>Домашняя работа</h3><p>Поиск, проверки и индекс по книге. Обязательный минимум и дополнение.</p></a><a class="quick-card" href="#review"><span class="number">03 / ОСНОВАНИЕ</span><h3>Что показало ревью</h3><p>Наблюдения по четырём задачам из проверенного снимка Library.</p></a></div>`;
}
const descriptors={
 guide:['СЦЕНАРИЙ · 27 СЕНТЯБРЯ · 12:00–13:00','Что говорить, что показать и как проверить понимание. Читайте по порядку или переходите к нужному времени.'],
 student:['ПРАКТИКА НА ЗАНЯТИИ','Условия, входные данные и ожидаемые результаты. Готовые реализации находятся отдельно, в эталонах преподавателя.'],
 homework:['ПОСЛЕ УРОКА · 3–3,5 ЧАСА','Выполнить за несколько дней в пределах недельной нагрузки. Срок сдачи договоримся определить по результату занятия.'],
 profile:['УЧЕНИК / НАБЛЮДЕНИЯ','Подтверждённые условия, практика в коде и навыки, которые ещё нужно проверить самостоятельно.'],
 roadmap:['МАРШРУТ / ДО 6 ДЕКАБРЯ','Предлагаемый маршрут под 5–9 часов самостоятельной работы. Переход к следующему этапу — после практической проверки.'],
 projects:['ПРАКТИКА / ОТ CORE ДО BACKEND','Развиваем Library по небольшим проверяемым этапам. Отдельный мини-проект проверяет перенос навыков.'],
 run:['УЧЕБНЫЙ КОМПЛЕКТ','Команды запуска, устройство папок и ожидаемый результат. Примеры не требуют Maven.'],
 verification:['ПРОВЕРКА МАТЕРИАЛОВ','Факты проверки учебных примеров. Это не оценка самостоятельной работы ученика.'],
 career:['ПОДГОТОВКА К РАБОТЕ','06.12.2026 — срок записи в карьерный трек. Готовность оцениваем по задачам, объяснению и защите проекта.'],
 core:['БИБЛИОТЕКА МАТЕРИАЛОВ / CORE','Подборка конкретных заданий из материалов наставника. Выбираем 2–3, весь список не является домашкой на одну неделю.'],
 course:['БИБЛИОТЕКА МАТЕРИАЛОВ / BACKEND','Индекс курса nikita: что брать для следующих этапов и какие оговорки учитывать. Локальные источники отмечены отдельно.'],
 journal:['ИСТОРИЯ СОПРОВОЖДЕНИЯ','Даты подготовки, проверенные версии и результаты. Исторические записи сохранены.'],
 collections:['МАТЕРИАЛ ИЗ КУРСА MISHA','Полный конспект по коллекциям. Для этого занятия достаточно List, Set, Map и свойств полученного списка.'],
 streams:['МАТЕРИАЛ ИЗ КУРСА MISHA','Пошаговые примеры Stream API и Optional. Готовые решения разбираем после собственной попытки.'],
 'map-practice':['МАТЕРИАЛ ИЗ КУРСА ANNA','Короткие задачи на выбор ключа и значения карты. Дополнительная практика, не обязательный объём ближайшего урока.']
};
function docExtras(key){
 if(key==='guide')return `<div class="doc-tools"><a class="btn primary" href="#guide/section-0">Начать с подготовки</a><a class="btn" href="#answers">Эталоны преподавателя →</a><a class="btn" href="downloads/teacher-lesson-2026-09-27.zip" download>↓ Комплект преподавателя</a></div>`;
 if(key==='student')return `<div class="doc-tools"><a class="btn primary" href="student.html" target="_blank" rel="noopener">Отдельный экран без ответов ↗</a><a class="btn" href="downloads/student-lesson-2026-09-27.zip" download>↓ Комплект ученика</a><a class="btn" href="#source/ListTask">ListTask.java</a><a class="btn" href="#source/GroupingTask">GroupingTask.java</a></div>`;
 if(key==='homework')return `<div class="doc-tools"><button class="btn primary" data-copy-doc="homework">Скопировать задание</button><a class="btn" href="downloads/student-lesson-2026-09-27.zip" download>↓ Задания и заготовки</a></div>`;
 if(key==='profile')return `<div class="facts"><div class="fact"><small>Рынок</small><strong>Москва</strong></div><div class="fact"><small>Обычный график</small><strong>Пн / пт · 60 мин</strong></div><div class="fact"><small>Самостоятельно</small><strong>5–9 ч / неделю</strong></div></div>`;
 return '';
}
function doc(key){
 const d=content.docs[key], desc=descriptors[key]||['МАТЕРИАЛЫ',''];
 return heading(desc[0],esc(d.title),desc[1],printButton)+docExtras(key)+`<div class="doc-layout"><div class="doc-main"><div class="doc-content doc-intro">${d.intro}</div>${d.sections.map((s,i)=>`<section class="doc-content doc-section" id="${s.id}"><span class="section-kicker">${String(i+1).padStart(2,'0')} / ${String(d.sections.length).padStart(2,'0')}</span><h2>${esc(s.title)}</h2>${s.html}</section>`).join('')}${!d.sections.length?'':''}</div><nav class="toc" aria-label="Оглавление материала"><h3>В этом материале</h3>${d.sections.map(s=>`<a href="#${key}/${s.id}">${esc(s.title)}</a>`).join('')}<a class="btn" href="#lesson">← План занятия</a></nav></div>`;
}
const resources=[
 ['guide','Урок','Методичка преподавателя','Полный текст на 60 минут: реплики, вопросы, ответы и подсказки.'],
 ['student','Урок','Лист ученика','Два учебных упражнения и перенос исправления в Library.'],
 ['run','Урок','Запуск учебного кода','JDK 17+, команды для PowerShell, ожидаемые сообщения проверок.'],
 ['answers','Урок','Эталоны и разбор','Два способа сортировки и индекс по книге. Открывать после попытки.'],
 ['collections','Core','Коллекции: List, Set, Map','Полный конспект из Misha: контракты, примеры и выбор коллекции.'],
 ['streams','Core','Stream API по шагам','Пошаговые примеры из Misha. Упорядочивание и получение результата.'],
 ['map-practice','Core','Небольшие задачи на Map','Частотная карта и группировка из материалов anna.'],
 ['core','Core','Практика после Generics','12 отобранных заданий, критерии приёмки и замечания к исходным тестам.'],
 ['course','Backend','Курс для следующих этапов','Индекс nikita: SQL, JDBC, REST, JPA, тесты и Docker.'],
 ['projects','Backend','Library Backend','Последовательность задач, контракты API и критерии готовности проекта.'],
 ['career','Backend','Подготовка к работе','Самопрезентация, защита проекта и сценарии пробного собеседования.'],
 ['verification','Урок','Проверка комплекта','Что было запущено и как отличить заготовку от готового эталона.']
];
function materials(){return heading('БИБЛИОТЕКА','Материалы под рукой','К занятию — только необходимое. Остальное сохранено для следующих шагов.')+`<div class="resource-toolbar"><div class="filter-tabs" role="group" aria-label="Темы материалов">${['Все','Урок','Core','Backend'].map((t,i)=>`<button data-filter="${t}" aria-pressed="${i===0}">${t}</button>`).join('')}</div><input class="search" id="resource-search" aria-label="Поиск по материалам" placeholder="Найти материал…" type="search"></div><div class="resource-grid" id="resource-grid"></div><div class="callout">Конспекты по коллекциям и стримам открываются целиком на сайте. Индексы Core и Backend также содержат ссылки на локальные источники наставника; такие ссылки отмечены текстом.</div>`;}
let filter='Все';
function renderResources(){
 const query=(document.getElementById('resource-search')?.value||'').trim().toLowerCase();
 const chosen=resources.filter(r=>(filter==='Все'||r[1]===filter)&&r.join(' ').toLowerCase().includes(query));
 document.getElementById('resource-grid').innerHTML=chosen.map(r=>`<article class="resource-card"><span class="type">${r[1]} / ${r[0]==='answers'?'ДЛЯ ПРЕПОДАВАТЕЛЯ':'МАТЕРИАЛ'}</span><h3>${r[2]}</h3><p>${r[3]}</p><a href="#${r[0]}">Открыть <span>↗</span></a></article>`).join('')||'<p class="empty">Материалов с таким названием нет. Попробуйте другое слово или выберите «Все».</p>';
}
function source(name){
 const c=content.code[name];
 if(!c)return notFound();
 return heading(c.teacher?'ЭТАЛОН ПРЕПОДАВАТЕЛЯ':'УЧЕБНАЯ ЗАГОТОВКА',esc(name)+'.java',c.teacher?'Показывать после самостоятельной попытки и обсуждения.':'Рабочий файл упражнения. Сначала прогноз, затем запуск и изменение кода.',`<a class="btn" href="downloads/${name}.java" download>↓ Скачать Java</a>`)+`<div class="doc-tools"><a class="btn" href="#${c.teacher?'answers':'student'}">← ${c.teacher?'Эталоны':'Условия задания'}</a><a class="btn" href="#run">Как запустить</a></div><div class="doc-content"><div class="code-toolbar"><span>${name}.java · UTF-8</span><button data-copy-code="${name}">Копировать</button></div><pre class="code-view"><code>${c.text.split('\n').map((l,i)=>`<span class="code-line"><span class="line-no" aria-hidden="true">${i+1}</span>${esc(l)}</span>`).join('')}</code></pre></div>`;
}
function answers(){return heading('ТОЛЬКО ДЛЯ ПРЕПОДАВАТЕЛЯ','Эталоны и подсказки','Здесь готовые реализации. Для демонстрации ученику откройте отдельный экран заданий.')+`<div class="callout">Перед открытием решения попросите ученика объяснить вход, ожидаемый результат и выбранные коллекции. Сначала дайте одну подсказку из методички.</div><div class="resource-grid">${[['ListSolutions','Списки: два решения','sorted().toList() и изменяемая копия ArrayList. 12 проверок поведения.'],['GroupingSolution','Группировка по книге','Счётчик появлений и отдельное множество читателей для каждой книги. 9 проверок.']].map(r=>`<article class="resource-card"><span class="type">JAVA / ЭТАЛОН</span><h3>${r[1]}</h3><p>${r[2]}</p><a href="#source/${r[0]}">Посмотреть код <span>↗</span></a></article>`).join('')}</div><div class="doc-tools"><a class="btn" href="downloads/teacher-lesson-2026-09-27.zip" download>↓ Комплект преподавателя</a><a class="btn" href="#verification">Как проверены примеры</a><a class="btn primary" href="#guide">Вернуться к методичке</a></div>`;}
function review(){
 const reports=[
 ['01','Выдача и возврат','Нужна доработка','22 из 23 сценариев','Основная выдача и возврат работают. В результате отказа нужна коллекция причин; сейчас возвращается строка. Отдельно воспроизведён конфликт ID: добавление может заменить существующую книгу.','Довести контракт результата и проверить, что при конфликте ID старая книга сохраняется.'],
 ['02','Отчёт по выданным книгам','Поведение проверено','12 из 12 сценариев','Экземпляры подсчитываются корректно, имена читателей уникальны и отсортированы. Тип значения изменён с Long на BorrowedBookStat. Это отдельный вопрос согласованного API, а не ошибка подсчёта.','Согласовать расширенный тип результата и сохранить проверки для одинаковых названий с разными ID.'],
 ['03','Корректность учёта','Нужна доработка','13 из 22 сценариев','Все четыре вида нарушений обнаруживаются, но данные разных книг могут попасть в один объект; отсутствующая книга может создавать повторные проблемы. Порядок результата также нужно задать явно.','Одна проблема на пару «bookId + тип». Отдельно считать вхождения книги и собирать её уникальных читателей.'],
 ['04','Поиск и страницы','Фокус занятия','Падение воспроизведено','Активный фильтр заменяет список результатом Stream.toList(), затем sort() вызывает UnsupportedOperationException. Настоящий null в поле фильтра также приводит к ошибке; возможен выход за диапазон int при вычислении смещения страницы.','На занятии — одна причина падения сортировки. Дома — null, пробелы, порядок и страницы. Переполнение — дополнительная задача.']
 ];
 return heading('СНИМОК РЕВЬЮ · 27.09.2026','Library: что проверено','Эти выводы относятся к сохранённой версии репозитория. Новые коммиты автоматически не проверяются.',`<a class="btn" href="https://github.com/Sulfurkino/Library/tree/${content.sha}" target="_blank" rel="noopener">Открыть коммит ↗</a>`)+`<div class="callout">Проверенная версия: <code>${content.sha}</code>. Сборка проверялась на JDK 21 с переопределением версии компилятора; в pom указана Java 22. Прошедшие проверки подтверждают поведение на примерах, а самостоятельность проверяем на занятии.</div>${reports.map(r=>`<article class="review-card"><header><div><p class="eyebrow">ЗАДАНИЕ ${r[0]} / ${r[3]}</p><h2>${r[1]}</h2></div><span class="pill ${r[0]==='02'?'':'rust'}">${r[2]}</span></header><p>${r[4]}</p><p><strong>Следующий шаг.</strong> ${r[5]}</p><div class="evidence">${r[0]==='04'?'<a class="text-link" href="#guide/section-4">Разобрать на занятии →</a>':r[0]==='03'?'<a class="text-link" href="#guide/section-3">Упражнение на группировку →</a>':'Результаты сохранены в журнале сопровождения.'}</div></article>`).join('')}<a class="btn" href="#journal">Открыть полный журнал →</a>`;
}
function notFound(){return heading('МАТЕРИАЛ НЕ НАЙДЕН','Этой страницы здесь нет','Перейдите к плану занятия или библиотеке материалов.', '<a class="btn primary" href="#lesson">К плану занятия</a>');}
let routeKey='lesson';
function route(){
 const parts=decodeURIComponent(location.hash.slice(1)||'lesson').split('/');
 const key=parts[0]; routeKey=key;
 main.innerHTML=key==='lesson'?lesson():key==='materials'?materials():key==='source'?source(parts[1]):key==='answers'?answers():key==='review'?review():content.docs[key]?doc(key):notFound();
 const label=key==='lesson'?'План на час':key==='materials'?'Материалы':key==='review'?'Ревью Library':key==='answers'?'Эталоны':key==='source'?(parts[1]+'.java'):content.docs[key]?.title||'Страница';
 document.title=label+' · Михаэль'; document.getElementById('crumb').textContent=label;
 const active=['source','answers','run','verification','collections','streams','map-practice','core','course'].includes(key)?'materials':key==='journal'?'review':key==='career'?'roadmap':key;
 document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===active);if(a.dataset.nav===active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
 document.getElementById('sidebar').classList.remove('open');document.getElementById('menu-toggle').setAttribute('aria-expanded','false');
 if(key==='materials'){filter='Все';renderResources();document.getElementById('resource-search').addEventListener('input',renderResources)}
 main.querySelectorAll('a[href^="https://"]').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});
 requestAnimationFrame(()=>{if(parts[1]?.startsWith('section-')){document.getElementById(parts[1])?.scrollIntoView();}else window.scrollTo(0,0);main.focus({preventScroll:true})});
}
let toastTimeout;
function toast(text){const t=document.getElementById('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.remove('show'),3500)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Скопировано')}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.top='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'Скопировано':'Не удалось скопировать. Выделите текст и нажмите Ctrl+C.')}}
document.addEventListener('click',e=>{
 const link=e.target.closest('a[href^="#"]');
 if(link && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey){
  e.preventDefault();
  if(link.getAttribute('href')==='#main'){main.focus({preventScroll:false});return}
  if(location.hash===link.getAttribute('href'))route();
  else location.hash=link.getAttribute('href');
 }
 const t=e.target.closest('button');
 if(t?.hasAttribute('data-print'))window.print();
 if(t?.dataset.copyCode)copy(content.code[t.dataset.copyCode].text);
 if(t?.dataset.copyDoc)copy(content.docs[t.dataset.copyDoc].raw.replace(/\[([^\]]+)\]\((?:<)?[A-Za-z]:[^)]+\)/g,'$1'));
 if(t?.dataset.filter){filter=t.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b===t));renderResources()}
 if(t?.id==='menu-toggle'){const open=document.getElementById('sidebar').classList.toggle('open');t.setAttribute('aria-expanded',String(open));}
 else if(!e.target.closest('.sidebar')){document.getElementById('sidebar').classList.remove('open');document.getElementById('menu-toggle').setAttribute('aria-expanded','false')}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.getElementById('sidebar').classList.remove('open');document.getElementById('menu-toggle').setAttribute('aria-expanded','false')}});
window.addEventListener('hashchange',route);route();

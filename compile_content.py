"""Create the browser's static content snapshot. No network or runtime dependencies."""
from pathlib import Path
import sys, re, json, html, shutil, zipfile
try:
    import markdown
except ImportError:
    sys.path.insert(0, str(Path.home() / 'AppData/Local/Temp/mentor-site-authoring'))
    import markdown

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent
CONTENT = ROOT / 'content'
DIST = ROOT / 'dist'
CONTENT.mkdir(exist_ok=True)
(DIST / 'downloads').mkdir(exist_ok=True)
REFRESH = '--refresh' in sys.argv
lesson = BASE / 'Уроки/2026-09-27'
docs = {
    'guide': (lesson / '01_Преподавателю.md', 'Методичка преподавателя'),
    'student': (lesson / '02_Ученику.md', 'Задания ученика'),
    'homework': (lesson / 'ДЗ.md', 'Домашнее задание'),
    'run': (lesson / 'README.md', 'Как запустить примеры'),
    'verification': (lesson / 'Проверка.md', 'Проверка учебного комплекта'),
    'profile': (BASE / 'Паспорт.md', 'Карточка ученика'),
    'roadmap': (BASE / 'План.md', 'Маршрут обучения'),
    'projects': (BASE / 'Проекты.md', 'Учебные проекты'),
    'career': (BASE / 'Карьера.md', 'Подготовка к работе'),
    'core': (BASE / 'Материалы_core.md', 'Практика Java Core'),
    'course': (BASE / 'Материалы_nikita.md', 'Материалы для Backend'),
    'journal': (BASE / 'Журнал.md', 'Журнал и последнее ревью'),
    'collections': (BASE.parent.parent / 'Misha/Lessons/src/baseLesson/student_materials/10 Коллекции.md', 'Коллекции: List, Set, Map'),
    'streams': (BASE.parent.parent / 'Misha/Lessons/src/baseLesson/student_materials/14a Stream API и Optional — пошаговые примеры.md', 'Stream API: пошаговые примеры'),
    'map-practice': (BASE.parent.parent / 'anna/collections/task/mapTask.md', 'Задачи на Map'),
}
files = {
    'ListTask': lesson / 'code/student/ListTask.java',
    'GroupingTask': lesson / 'code/student/GroupingTask.java',
    'ListSolutions': lesson / 'code/teacher/ListSolutions.java',
    'GroupingSolution': lesson / 'code/teacher/GroupingSolution.java',
}
sha = 'deef9f94a1bee97161cfef4f9fb457f8b7c99713'
paths = {str(p).replace('\\', '/').lower(): k for k, (p, _) in docs.items()}
paths.update({str(p).replace('\\', '/').lower(): 'source/' + k for k, p in files.items()})

def link(m):
    label, url = m.group(1), m.group(2).strip('<>')
    if not re.match(r'(?i)([a-z]:[/\\]|file:)', url):
        return m.group(0)
    normalized = re.sub(r':\d+$', '', url).replace('\\', '/').lower()
    target = paths.get(normalized)
    if target:
        return '[' + label + '](#' + target + ')'
    if 'library-review-2026-09-27/src/main/java/' in normalized:
        name = re.sub(r':\d+$', '', url).split('/')[-1]
        line = re.search(r':(\d+)$', url)
        return f'[{label}](https://github.com/Sulfurkino/Library/blob/{sha}/src/main/java/{name}' + (f'#L{line[1]}' if line else '') + ')'
    # Preserve a reference label, without creating a broken link to the mentor's disk.
    return label + ' <small class="local-ref">(локальный источник наставника)</small>'

def render(text):
    text = re.sub(r'\[([^\]]+)\]\((<[^>]+>|[^)]+)\)', link, text)
    result = markdown.markdown(text, extensions=['fenced_code', 'tables', 'sane_lists'])
    result = re.sub(r'<a href="(?!https?://|#)[^"]+">(.*?)</a>', r'\1 <small class="local-ref">(ссылка исходного курса)</small>', result)
    # Visually distinguish read-aloud speech; source text stays unchanged.
    result = re.sub(r'<p>(«(?:(?!</p>)[\s\S])*?»(?:\.)?)</p>', r'<blockquote class="say"><span class="say-label">Сказать ученику</span><p>\1</p></blockquote>', result)
    result = re.sub(r'<p>(Ожидаем:[\s\S]*?)</p>', r'<div class="expected"><p>\1</p></div>', result)
    return result

data = {'docs': {}, 'code': {}, 'sha': sha, 'date': '2026-09-27', 'time': '12:00–13:00'}
for key, (source, title) in docs.items():
    cached = CONTENT / (key + '.md')
    if REFRESH or not cached.exists():
        cached.write_text(source.read_text(encoding='utf-8-sig'), encoding='utf-8')
    text = cached.read_text(encoding='utf-8')
    chunks = re.split(r'^## (.+)$', text, flags=re.M)
    sections = [{'title': chunks[i], 'html': render(chunks[i+1]), 'id': f'section-{(i-1)//2}'} for i in range(1, len(chunks), 2)]
    intro = re.sub(r'^# .+\n', '', chunks[0], count=1)
    data['docs'][key] = {'title': title, 'intro': render(intro), 'sections': sections, 'html': render(text), 'raw': text}

for key, source in files.items():
    cached = CONTENT / (key + '.java')
    if REFRESH or not cached.exists():
        cached.write_text(source.read_text(encoding='utf-8-sig'), encoding='utf-8')
    text = cached.read_text(encoding='utf-8')
    data['code'][key] = {'text': text, 'teacher': key in ['ListSolutions', 'GroupingSolution']}
    (DIST / 'downloads' / (key + '.java')).write_text(text, encoding='utf-8')

for role, code_names, doc_names in [
    ('student', ['ListTask', 'GroupingTask'], ['student', 'homework']),
    ('teacher', ['ListSolutions', 'GroupingSolution', 'ListTask', 'GroupingTask'], ['guide', 'run', 'verification', 'student', 'homework'])
]:
    with zipfile.ZipFile(DIST / 'downloads' / (role + '-lesson-2026-09-27.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for key in code_names:
            code_role = 'teacher' if data['code'][key]['teacher'] else 'student'
            z.write(CONTENT / (key + '.java'), f'code/{code_role}/{key}.java')
        for key in doc_names:
            # Downloaded documents contain plain references rather than unusable disk links.
            plain = re.sub(r'\[([^\]]+)\]\((?:<)?[A-Za-z]:[^)]+\)', r'\1', data['docs'][key]['raw'])
            z.writestr(docs[key][0].name, plain)
        z.writestr('START.txt', 'Урок 27.09.2026, 12:00–13:00 МСК. JDK 17+.\n' +
            'Из этой папки: создайте build, затем выполните:\n' +
            f'javac --release 17 -encoding UTF-8 -d build code/{role}/*.java\n' +
            '\n'.join('java -cp build ' + name for name in code_names if data['code'][name]['teacher'] == (role == 'teacher')) +
            '\nЗаготовки ученика намеренно не проходят проверки до выполнения задания.\n')

(DIST / 'content.js').write_text('window.MENTOR_CONTENT = ' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';\n', encoding='utf-8')

def student_html(key):
    value = data['docs'][key]['html']
    value = value.replace('href="#student"', 'href="#tasks"').replace('href="#homework"', 'href="#homework"')
    return re.sub(r'<a href="#(?!tasks|homework|source/)[^"]+">(.*?)</a>', r'\1', value)

student_page = '''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Задания · Михаэль · 27 сентября</title><meta name="theme-color" content="#173d37"><link rel="stylesheet" href="style.css"></head><body><div class="student-standalone"><div class="brand"><span class="monogram">м.</span><span>Михаэль<small>Практика Java Core</small></span></div><header class="student-top"><div><p class="eyebrow">27 СЕНТЯБРЯ 2026 · 12:00–13:00 · МОСКВА</p><h1>Списки и группировка</h1><p>Сначала объясни предположение. Затем проверь его кодом.</p></div><button class="btn" onclick="window.print()">Печать / PDF ↗</button></header><nav class="doc-tools" aria-label="Разделы задания"><a class="btn primary" href="#tasks">Условия</a><a class="btn" href="#ListTask">ListTask.java</a><a class="btn" href="#GroupingTask">GroupingTask.java</a><a class="btn" href="#homework">Домашняя работа</a><a class="btn" href="downloads/student-lesson-2026-09-27.zip" download>↓ Скачать комплект</a></nav>'''
student_page += '<article class="doc-content" id="tasks">' + student_html('student') + '</article>'
for key in ['ListTask','GroupingTask']:
    student_page += '<section class="doc-content" id="'+key+'"><h2>'+key+'.java</h2><p>Учебная заготовка. Сохраните файл и запустите по инструкции выше.</p><div class="download-row"><a class="btn" href="downloads/'+key+'.java" download>↓ Скачать '+key+'.java</a></div><pre><code>'+html.escape(data['code'][key]['text'])+'</code></pre></section>'
student_page += '<article class="doc-content" id="homework">'+student_html('homework')+'</article><footer class="small-muted">Учебный комплект · 27.09.2026 · Готовые реализации в этот экран и архив ученика не включены.</footer></div></body></html>'
student_page = student_page.replace('#source/ListTask','#ListTask').replace('#source/GroupingTask','#GroupingTask')
(DIST / 'student.html').write_text(student_page, encoding='utf-8')
print(f'Prepared {len(docs)} full documents, {len(files)} Java files, 2 role-specific archives')

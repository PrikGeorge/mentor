"""Compile non-executable private materials. No network or runtime dependencies."""
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
PRIVATE = ROOT / 'private/materials'
CONTENT.mkdir(exist_ok=True)
(PRIVATE / 'downloads').mkdir(parents=True, exist_ok=True)
REFRESH = '--refresh' in sys.argv
lesson = BASE / 'Уроки/2026-09-27'
docs = {
    'guide': (lesson / '01_Преподавателю.md', 'Методичка преподавателя'),
    'student-roadmap': (BASE / 'Ученику/Маршрут.md', 'Маршрут ученика'),
    'student-review': (BASE / 'Ученику/Ревью-ДЗ.md', 'Ревью домашней работы'),
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
# Cached sources may refer to the original checkout on another disk. Match only
# the known documents, using their file and enclosing folder as portable keys.
portable_paths = {}
for source, target in [(p, k) for k, (p, _) in docs.items()] + [(p, 'source/' + k) for k, p in files.items()]:
    suffix = '/' + (source.name if source.parent == BASE else source.parent.name + '/' + source.name)
    portable_paths[suffix.lower()] = target

def link(m):
    label, url = m.group(1), m.group(2).strip('<>')
    if not re.match(r'(?i)([a-z]:[/\\]|file:)', url):
        return m.group(0)
    normalized = re.sub(r':\d+$', '', url).replace('\\', '/').lower()
    target = paths.get(normalized) or next((key for suffix, key in portable_paths.items() if normalized.endswith(suffix)), None)
    if target:
        return '[' + label + '](#' + target + ')'
    if 'library-review-2026-09-27/src/main/java/' in normalized:
        name = re.sub(r':\d+$', '', url).split('/')[-1]
        line = re.search(r':(\d+)$', url)
        return f'[{label}](https://github.com/Sulfurkino/Library/blob/{sha}/src/main/java/{name}' + (f'#L{line[1]}' if line else '') + ')'
    # Preserve a reference label, without creating a broken link to the mentor's disk.
    return label + ' <small class="local-ref">(локальный источник наставника)</small>'

def explanation(m):
    label, body = m.group(1), m.group(2)
    # Spoken prompts remain visible alongside the hidden background explanation.
    spoken = re.search(r'\s*<strong>Реплика:</strong>\s*(«[\s\S]*?»[.!?…]*)([\s\S]*)$', body)
    prompt = ''
    if spoken:
        body = body[:spoken.start()]
        prompt = '<blockquote class="say"><span class="say-label">Реплика:</span><p>' + spoken[1] + '</p></blockquote>'
        if spoken[2].strip():
            prompt += '<p>' + spoken[2].strip() + '</p>'
    return '<details class="explanation-details"><summary>' + label + '</summary><div class="explanation"><p>' + body.strip() + '</p></div></details>' + prompt

def render(text, collapse_explanations=False):
    text = re.sub(r'\[([^\]]+)\]\((<[^>]+>|[^)]+)\)', link, text)
    result = markdown.markdown(text, extensions=['fenced_code', 'tables', 'sane_lists'])
    result = re.sub(r'<a href="(?!https?://|#)[^"]+">(.*?)</a>', r'\1 <small class="local-ref">(ссылка исходного курса)</small>', result)
    # Visually distinguish read-aloud speech; source text stays unchanged.
    result = re.sub(r'<p>(«(?:(?!</p>)[\s\S])*?»(?:\.)?)</p>', r'<blockquote class="say"><span class="say-label">Сказать ученику</span><p>\1</p></blockquote>', result)
    result = re.sub(r'<p>(Ожидаем:[\s\S]*?)</p>', r'<div class="expected"><p>\1</p></div>', result)
    if collapse_explanations:
        result = re.sub(r'<p><strong>(Почему(?:(?!</strong>)[\s\S])*?)</strong>((?:(?!</p>)[\s\S])*?)</p>', explanation, result)
    else:
        result = re.sub(r'<p>(<strong>Почему(?:(?!</p>)[\s\S])*?)</p>', r'<div class="explanation"><p>\1</p></div>', result)
    result = re.sub(r'<p><strong>Сказать коротко:</strong>\s*((?:(?!</p>)[\s\S])*?)</p>', r'<blockquote class="say"><span class="say-label">Объяснить ученику</span><p>\1</p></blockquote>', result)
    return result

data = {'docs': {}, 'code': {}, 'viewData': json.loads((CONTENT / 'view-data.json').read_text(encoding='utf-8')), 'sha': sha}
manifest = {'version': 1, 'snapshot': 'content.json', 'materials': []}
STUDENT_DOCS = {'student-roadmap', 'student-review', 'student', 'homework', 'run', 'collections', 'streams', 'map-practice'}
def material(id, file, audience='student', lesson_scope=True, **extra):
    record = {'id': id, 'file': file, 'studentId': 'michael', 'audience': audience,
              'contentType': 'application/json; charset=utf-8', 'filename': Path(file).name, **extra}
    if lesson_scope:
        record.update(lessonId='lesson-2026-09-27', bundleId='library-2026-09-27')
    manifest['materials'].append(record)
for key, (source, title) in docs.items():
    cached = CONTENT / (key + '.md')
    if REFRESH or not cached.exists():
        cached.write_text(source.read_text(encoding='utf-8-sig'), encoding='utf-8')
    text = cached.read_text(encoding='utf-8')
    chunks = re.split(r'^## (.+)$', text, flags=re.M)
    sections = []
    for i in range(1, len(chunks), 2):
        body = chunks[i+1]
        section = {'title': chunks[i], 'id': f'section-{(i-1)//2}'}
        if key == 'guide':
            marker = re.search(r'\*\*К част(?:и|ям) (.+?) листа ученика\.\*\*', body)
            section['studentParts'] = []
            if marker:
                section['studentParts'] = [int(n) for n in re.findall(r'(\d{2})/07', marker[1])]
                body = body[:marker.start()] + body[marker.end():]
        section['html'] = render(body, key == 'guide')
        sections.append(section)
    intro = re.sub(r'^# .+\n', '', chunks[0], count=1)
    data['docs'][key] = {'studentId': 'michael', 'title': title, 'intro': render(intro, key == 'guide'), 'sections': sections, 'html': render(text, key == 'guide'), 'raw': text}
    if key == 'student-review':
        # This source explicitly records the 27 September review, not a profile-wide review.
        data['docs'][key].update(lessonId='lesson-2026-09-27', bundleId='library-2026-09-27')
    material('doc-' + key, 'content.json', audience='student' if key in STUDENT_DOCS else 'teacher',
             lesson_scope=key not in {'student-roadmap', 'profile', 'roadmap', 'projects', 'career', 'core', 'course', 'journal'}, kind='doc', key=key)

for key, source in files.items():
    cached = CONTENT / (key + '.java')
    if REFRESH or not cached.exists():
        cached.write_text(source.read_text(encoding='utf-8-sig'), encoding='utf-8')
    text = cached.read_text(encoding='utf-8')
    data['code'][key] = {'text': text, 'teacher': key in ['ListSolutions', 'GroupingSolution'], 'materialId': key}
    if key in ['ListTask', 'GroupingTask']:
        # Store positions, not a second copy of the code. Both renderers read the
        # excerpt from this original source record, and a changed layout fails
        # compilation rather than silently showing an unrelated fragment.
        method = 'select' if key == 'ListTask' else 'duplicateReport'
        method_start = re.search(r'^    static List<[^>]+> ' + method + r'\b', text, re.M)
        start = method_start if key == 'ListTask' else re.search(r'^    static class Loan\b', text, re.M)
        end = re.search(r'^    }', text[method_start.start():], re.M) if method_start else None
        if not start or not method_start or not end:
            raise ValueError(f'Cannot locate the task excerpt in {key}.java')
        data['code'][key]['excerpt'] = {
            'start': text.count('\n', 0, start.start()),
            'end': text.count('\n', 0, method_start.start() + end.end()) + 1,
        }
    audience = 'teacher' if data['code'][key]['teacher'] else 'student'
    (PRIVATE / 'downloads' / (key + '.java')).write_text(text, encoding='utf-8')
    material('code-' + key, 'content.json', audience=audience, kind='code', key=key)
    material(key, 'downloads/' + key + '.java', audience=audience, kind='download', contentType='text/plain; charset=utf-8')

TASK_CODE_MARKER = r'<!-- task-code:(\w+):(prediction|practice) -->'

def task_excerpt(name):
    source = data['code'][name]
    bounds = source['excerpt']
    lines = source['text'].split('\n')[bounds['start']:bounds['end']]
    return '\n'.join(re.sub(r'^ {4}', '', line) for line in lines)

def archive_entry(archive, name, text):
    # A content-only snapshot has identical bytes on repeated compilation.
    entry = zipfile.ZipInfo(name, date_time=(2026, 9, 27, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_DEFLATED
    entry.external_attr = 0o644 << 16
    archive.writestr(entry, text.encode('utf-8'))

for role, code_names, doc_names in [
    ('student', ['ListTask', 'GroupingTask'], ['student', 'homework']),
    ('teacher', ['ListSolutions', 'GroupingSolution', 'ListTask', 'GroupingTask'], ['guide', 'run', 'verification', 'student', 'homework'])
]:
    material(role + '-lesson-2026-09-27', 'downloads/' + role + '-lesson-2026-09-27.zip', audience=role, kind='download', contentType='application/zip')
    with zipfile.ZipFile(PRIVATE / 'downloads' / (role + '-lesson-2026-09-27.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for key in code_names:
            code_role = 'teacher' if data['code'][key]['teacher'] else 'student'
            archive_entry(z, f'code/{code_role}/{key}.java', data['code'][key]['text'])
        for key in doc_names:
            # Downloaded documents contain plain references rather than unusable disk links.
            plain = re.sub(r'\[([^\]]+)\]\((?:<)?[A-Za-z]:[^)]+\)', r'\1', data['docs'][key]['raw'])
            plain = re.sub(TASK_CODE_MARKER, lambda m: 'Исходная заготовка — только для чтения:\n\n```java\n' + task_excerpt(m[1]) + '\n```', plain)
            archive_entry(z, docs[key][0].name, plain)
        archive_entry(z, 'START.txt', ('Урок 27.09.2026, 12:00–13:00 МСК. JDK 17+.\n' if role == 'teacher' else 'Урок 27.09.2026. JDK 17+.\n') +
            'Из этой папки: создайте build, затем выполните:\n' +
            f'javac --release 17 -encoding UTF-8 -d build code/{role}/*.java\n' +
            '\n'.join('java -cp build ' + name for name in code_names if data['code'][name]['teacher'] == (role == 'teacher')) +
            '\nЗаготовки ученика намеренно не проходят проверки до выполнения задания.\n')

material('view-michael', 'content.json', lesson_scope=False, kind='view', key='michael')
(PRIVATE / 'content.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def offline_task_code(match):
    name, stage = match[1], match[2]
    source = data['code'].get(name)
    if name not in ['ListTask', 'GroupingTask'] or not source or source['teacher']:
        raise ValueError(f'Invalid student source: {name}')
    full = ('<details class="task-code-full"><summary>Полный ' + name + '.java и проверки</summary><pre><code>' +
            html.escape(source['text']) + '</code></pre></details>') if stage == 'practice' else ''
    return ('<div class="task-code" data-task-source="' + name + '"><div class="task-code-heading"><strong>' + name +
            '.java</strong><span>Исходная заготовка · Только для чтения</span></div>' +
            '<p class="task-code-note">Здесь показан исходный код задания. Редактируй копию файла из комплекта в своём редакторе.</p>' +
            '<pre class="task-code-excerpt"><code>' + html.escape(task_excerpt(name)) + '</code></pre>' + full + '</div>')

def student_html(key):
    value = data['docs'][key]['html']
    value = re.sub(TASK_CODE_MARKER, offline_task_code, value)
    value = value.replace('href="#student"', 'href="#tasks"').replace('href="#homework"', 'href="#homework"')
    return re.sub(r'<a href="#(?!tasks|homework)[^"]+">(.*?)</a>', r'\1', value)

student_styles = '\n'.join((DIST / name).read_text(encoding='utf-8') for name in ['style.css', 'task-code.css'])
student_page = '''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Задания · Михаэль · 27 сентября</title><meta name="theme-color" content="#173d37"><style>''' + student_styles + '''</style></head><body><div class="student-standalone"><div class="brand"><span class="monogram">м.</span><span>Михаэль<small>Практика Java Core</small></span></div><header class="student-top"><div><p class="eyebrow">27 СЕНТЯБРЯ 2026 · ПРАКТИКА</p><h1>Списки и группировка</h1><p>Сначала объясни предположение. Затем проверь его кодом.</p></div></header><nav class="doc-tools" aria-label="Разделы задания"><a class="btn primary" href="#tasks">Начать задания</a><a class="btn" href="#homework">Домашняя работа</a></nav>'''
student_page += '<article class="doc-content" id="tasks">' + student_html('student') + '</article>'
student_page += '<article class="doc-content" id="homework">'+student_html('homework')+'</article><footer class="small-muted">Учебный комплект · 27.09.2026 · Сохраняй свои изменения в отдельной копии заготовки.</footer></div></body></html>'
(PRIVATE / 'student.html').write_text(student_page, encoding='utf-8')
material('student-sheet', 'student.html', kind='download', contentType='text/html; charset=utf-8')
for role in ['student', 'teacher']:
    with zipfile.ZipFile(PRIVATE / 'downloads' / (role + '-lesson-2026-09-27.zip'), 'a', zipfile.ZIP_DEFLATED) as z:
        archive_entry(z, 'student.html', student_page)
(PRIVATE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(docs)} full documents, {len(files)} Java files, 2 role-specific archives')

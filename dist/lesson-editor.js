(function (global) {
  'use strict';
  const MAX_CHARS = 200000, MAX_BYTES = 1024 * 1024;
  const maxCharsLabel = MAX_CHARS.toLocaleString('ru-RU');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const limitMessage = 'В тексте может быть не больше '+maxCharsLabel+' символов. Сократите его и попробуйте снова.';
  let editorId = 0;

  function transform(value, start, end, command) {
    value = String(value);
    start = Math.max(0, Math.min(value.length, start));
    end = Math.max(start, Math.min(value.length, end));
    const selected = value.slice(start, end);
    function insert(text, offset, length) {
      return {value:value.slice(0,start)+text+value.slice(end),start:start+offset,end:start+offset+length};
    }
    if (command === 'bold' || command === 'italic') {
      const marker = command === 'bold' ? '**' : '*';
      if (start >= marker.length && value.slice(start-marker.length,start) === marker && value.slice(end,end+marker.length) === marker) {
        return {value:value.slice(0,start-marker.length)+selected+value.slice(end+marker.length),start:start-marker.length,end:end-marker.length};
      }
      const text = selected || 'текст';
      return insert(marker+text+marker, marker.length, text.length);
    }
    if (command === 'link') {
      const label = (selected || 'текст ссылки').replace(/([\[\]\\])/g,'\\$1');
      return insert('['+label+'](https://example.com)', label.length+3, 19);
    }
    if (command === 'code' || command === 'table') {
      const before = value.slice(0,start), after = value.slice(end);
      const lead = before ? (/\n\n$/.test(before)?'':/\n$/.test(before)?'\n':'\n\n') : '';
      const tail = after ? (/^\n\n/.test(after)?'':/^\n/.test(after)?'\n':'\n\n') : '';
      if (command === 'table') {
        const table = '| Заголовок | Описание |\n| --- | --- |\n| Значение | Текст |';
        return insert(lead+table+tail, lead.length+2, 9);
      }
      const code = selected || '// Ваш код';
      const fence = '`'.repeat(Math.max(3, ...Array.from(code.matchAll(/`+/g), match => match[0].length+1)));
      return insert(lead+fence+'java\n'+code+'\n'+fence+tail, lead.length+fence.length+5, code.length);
    }
    if (['heading','bullet','numbered','quote'].includes(command)) {
      const lineStart = start === 0 ? 0 : value.lastIndexOf('\n',start-1)+1;
      const last = end > start && value[end-1] === '\n' ? end-1 : end;
      let lineEnd = value.indexOf('\n',last);
      if (lineEnd < 0) lineEnd = value.length;
      const lines = value.slice(lineStart,lineEnd).split('\n');
      const pattern = command === 'heading' ? /^#{1,6} +/ : command === 'bullet' ? /^[-+*] +/ : command === 'numbered' ? /^\d+[.)] +/ : /^> ?/;
      const toggleOff = lines.every(line => command === 'heading' ? /^## +/.test(line) : pattern.test(line));
      const text = lines.map((line,index) => {
        const clean = line.replace(pattern,'');
        if (toggleOff) return clean;
        return (command === 'heading' ? '## ' : command === 'bullet' ? '- ' : command === 'numbered' ? (index+1)+'. ' : '> ')+clean;
      }).join('\n');
      return {value:value.slice(0,lineStart)+text+value.slice(lineEnd),start:lineStart,end:lineStart+text.length};
    }
    return {value,start,end};
  }

  function createHistory(initial) {
    const copy = state => ({value:state.value,start:state.start,end:state.end});
    let states = [copy(initial)], position = 0;
    return {
      remember(state) { if (states[position].value === state.value) states[position] = copy(state); },
      record(state, options = {}) {
        if (states[position].value === state.value) { states[position] = copy(state); return; }
        states = states.slice(0,position+1);
        if (options.merge && position > 0) states[position] = copy(state);
        else { states.push(copy(state)); position++; }
        if (states.length > 150) { states.shift(); position--; }
      },
      undo() { if (position > 0) position--; return copy(states[position]); },
      redo() { if (position < states.length-1) position++; return copy(states[position]); },
      canUndo: () => position > 0,
      canRedo: () => position < states.length-1
    };
  }

  async function readMarkdownFile(file) {
    if (!file || !/\.(md|markdown)$/i.test(file.name || '')) throw new Error('Выберите Markdown-файл с расширением .md или .markdown.');
    if (file.size > MAX_BYTES) throw new Error('Файл слишком большой: допустимо до 1 МБ и '+maxCharsLabel+' символов.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error('Файл слишком большой: допустимо до 1 МБ и '+maxCharsLabel+' символов.');
    let text;
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
    catch (_) { throw new Error('Не удалось прочитать UTF-8. Сохраните Markdown-файл в кодировке UTF-8 и выберите его снова.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Похоже, это бинарный файл. Выберите текстовый Markdown-файл.');
    if (text.length > MAX_CHARS) throw new Error(limitMessage);
    if (!text.trim()) throw new Error('Файл пуст. Выберите Markdown-файл с текстом.');
    return text;
  }

  function importValue(current, incoming, mode) {
    const separator = !current || !incoming || /\n\n$/.test(current) ? '' : /\n$/.test(current) ? '\n' : '\n\n';
    const value = mode === 'append' ? current+separator+incoming : incoming;
    if (value.length > MAX_CHARS) throw new Error(limitMessage);
    return value;
  }

  function createImportGuard() {
    let revision = 0, request = 0, alive = true, busy = false;
    return {
      changed() { revision++; },
      setBusy(value) { busy = Boolean(value); request++; },
      dispose() { alive = false; request++; },
      async read(file) {
        if (!alive) return {status:'disposed'};
        if (busy) return {status:'blocked'};
        const stamp = ++request, version = revision;
        let text, error;
        try { text = await readMarkdownFile(file); } catch (problem) { error = problem; }
        if (!alive) return {status:'disposed'};
        if (busy) return {status:'blocked'};
        if (stamp !== request || version !== revision) return {status:'stale'};
        return error ? {status:'error',error} : {status:'ready',text};
      }
    };
  }

  function markup({name, value = '', label = 'Текст занятия', hint = ''}) {
    const id = 'lesson-md-'+(++editorId);
    const tool = (command, text, title, extra = '') => `<button type="button" class="md-tool ${extra}" data-md-command="${command}" title="${title}" aria-label="${title}">${text}</button>`;
    return `<section class="lesson-md-editor" data-md-view="both" aria-label="Редактор Markdown">
      <div class="md-editor-intro"><div><label class="md-editor-label" for="${id}-source">${escape(label)}</label>${hint?`<p id="${id}-hint" class="md-editor-hint">${escape(hint)}</p>`:''}</div><button type="button" class="btn md-import" data-md-import>↑ Загрузить .md</button></div>
      <div class="md-editor-bar"><div class="md-format-tools" role="group" aria-label="Форматирование текста">
        ${tool('heading','H₂','Заголовок второго уровня')}${tool('bold','<b>Ж</b>','Жирный текст (Ctrl / ⌘ B)')}${tool('italic','<i>К</i>','Курсив (Ctrl / ⌘ I)')}
        <span class="md-tool-divider" aria-hidden="true"></span>${tool('bullet','• ≡','Маркированный список')}${tool('numbered','1.','Нумерованный список')}${tool('quote','❞','Цитата')}
        <span class="md-tool-divider" aria-hidden="true"></span>${tool('link','↗','Ссылка')}${tool('code','&lt;/&gt;','Блок кода Java')}${tool('table','⊞','Таблица')}
        <span class="md-tool-divider" aria-hidden="true"></span>${tool('undo','↶','Отменить (Ctrl / ⌘ Z)')}${tool('redo','↷','Повторить (Ctrl / ⌘ Shift Z)')}
      </div><div class="md-view-tools" role="group" aria-label="Вид редактора"><button type="button" data-md-view-button="source" aria-controls="${id}-source-pane" aria-pressed="false">Текст</button><button type="button" data-md-view-button="both" aria-controls="${id}-source-pane ${id}-preview-pane" aria-pressed="true">Рядом</button><button type="button" data-md-view-button="preview" aria-controls="${id}-preview-pane" aria-pressed="false">Просмотр</button></div></div>
      <div class="md-import-choice" role="group" aria-label="Как добавить файл" hidden><p data-md-file-label></p><p class="md-choice-hint">В редакторе уже есть текст. Заменить его или добавить файл в конец?</p><div><button class="btn" type="button" data-md-choice="replace">Заменить текст</button><button class="btn" type="button" data-md-choice="append">Добавить в конец</button><button class="btn" type="button" data-md-choice="cancel">Отмена</button></div></div>
      <p class="md-editor-error" role="alert" hidden></p><p class="md-editor-status" role="status" aria-live="polite" hidden></p>
      <div class="md-editor-panes"><div id="${id}-source-pane" class="md-source-pane"><div class="md-pane-title">ТЕКСТ · MARKDOWN</div><textarea id="${id}-source" name="${escape(name)}" maxlength="${MAX_CHARS}" rows="16" aria-label="${escape(label)}" aria-describedby="${id}-help ${id}-count${hint?' '+id+'-hint':''}" spellcheck="true" placeholder="## Тема занятия&#10;&#10;Напишите план или задания…&#10;&#10;- Первый шаг&#10;- Второй шаг">\n${escape(value)}</textarea></div><div id="${id}-preview-pane" class="md-preview-pane" role="region" aria-label="Предварительный просмотр"><div class="md-pane-title">ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР</div><div class="md-preview-scroll" tabindex="0"><div class="markdown-body"></div></div></div></div>
      <div class="md-editor-foot"><p id="${id}-help">Markdown: заголовки, списки, ссылки и код. Изменения сохранятся после нажатия «Сохранить».</p><output id="${id}-count" class="md-character-count" aria-label="Количество символов">${String(value).length.toLocaleString('ru-RU')} / ${maxCharsLabel}</output></div>
      <input type="file" class="md-file-input" accept=".md,.markdown,text/markdown" aria-label="Выбрать Markdown-файл" tabindex="-1" hidden>
    </section>`;
  }

  function mount(root, options = {}) {
    const host = root.matches?.('.lesson-md-editor') ? root : root.querySelector('.lesson-md-editor');
    if (!host) return {dispose() {},setBusy() {}};
    const find = selector => host.querySelector(selector);
    const source = find('textarea'), preview = find('.markdown-body'), fileInput = find('input[type="file"]');
    const choice = find('.md-import-choice'), error = find('.md-editor-error'), status = find('.md-editor-status');
    const sourcePane = find('.md-source-pane'), previewPane = find('.md-preview-pane');
    const count = find('.md-character-count'), viewButtons = [...host.querySelectorAll('[data-md-view-button]')];
    const buttons = [...host.querySelectorAll('button')], undo = find('[data-md-command="undo"]'), redo = find('[data-md-command="redo"]');
    const read = () => ({value:source.value,start:source.selectionStart,end:source.selectionEnd});
    const history = createHistory(read()), guard = createImportGuard();
    const windowObject = source.ownerDocument.defaultView;
    const mobile = windowObject.matchMedia?.('(max-width: 700px)');
    const listeners = [];
    let disposed = false, busy = false, pending = null, previewTimer = null, typingTime = 0, typingEnd = -1, importSequence = 0;
    let view = mobile?.matches ? 'source' : 'both';
    const render = options.render || global.MENTOR_MARKDOWN?.render || (text => '<p>'+escape(text).replace(/\n/g,'<br>')+'</p>');
    function listen(target, type, handler, settings) { target.addEventListener(type,handler,settings); listeners.push(()=>target.removeEventListener(type,handler,settings)); }
    function message(text, isError = false) {
      error.hidden = !isError || !text; error.textContent = isError ? text : '';
      status.hidden = isError || !text; status.textContent = isError ? '' : text;
    }
    function updateButtons() {
      buttons.forEach(button => { button.disabled = busy; });
      undo.disabled = busy || !history.canUndo(); redo.disabled = busy || !history.canRedo();
      source.readOnly = busy; fileInput.disabled = busy;
      host.setAttribute('aria-busy',String(busy));
    }
    function updatePreview() {
      clearTimeout(previewTimer);
      if (disposed) return;
      try { preview.innerHTML = source.value.trim() ? render(source.value) : '<p class="md-preview-empty">Здесь появится текст так, как его увидят после сохранения.</p>'; }
      catch (_) { preview.textContent = source.value; }
    }
    function setView(next) {
      if (disposed) return;
      view = mobile?.matches && next === 'both' ? 'source' : next;
      host.dataset.mdView = view;
      sourcePane.hidden = view === 'preview'; previewPane.hidden = view === 'source';
      viewButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mdViewButton === view)));
      if (view !== 'source') updatePreview();
    }
    function clearChoice() { pending = null; choice.hidden = true; }
    function changed() {
      guard.changed(); clearChoice();
      count.textContent = source.value.length.toLocaleString('ru-RU')+' / '+maxCharsLabel;
      source.setCustomValidity(source.value.length > MAX_CHARS ? limitMessage : '');
      count.classList.toggle('md-count-limit',source.value.length >= MAX_CHARS);
      clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview,140);
      updateButtons();
    }
    function apply(state, record = true) {
      if (state.value.length > MAX_CHARS) { message(limitMessage,true); return false; }
      if (record) history.record(state);
      source.value = state.value; source.setSelectionRange(state.start,state.end);
      typingTime = 0; typingEnd = -1; changed();
      if (view === 'preview') setView('source');
      source.focus({preventScroll:true});
      return true;
    }
    function command(action) {
      if (busy || disposed) return;
      history.remember(read()); message('');
      if (action === 'undo') apply(history.undo(),false);
      else if (action === 'redo') apply(history.redo(),false);
      else apply(transform(source.value,source.selectionStart,source.selectionEnd,action));
    }
    async function selectFile(file) {
      if (!file || busy || disposed) return;
      clearChoice(); message('Читаем файл…');
      const sequence = ++importSequence;
      const result = await guard.read(file);
      if (disposed || busy || sequence !== importSequence) return;
      if (result.status === 'stale') { message('Текст изменился во время чтения файла. Чтобы импортировать его, выберите файл ещё раз.'); return; }
      if (result.status === 'error') { message(result.error.message || 'Не удалось прочитать файл.',true); return; }
      if (result.status !== 'ready') return;
      if (source.value.length) {
        pending = {text:result.text,name:file.name};
        find('[data-md-file-label]').textContent = file.name+' · '+result.text.length.toLocaleString('ru-RU')+' символов';
        choice.hidden = false; message(''); find('[data-md-choice="replace"]').focus();
      } else {
        history.remember(read());
        apply({value:result.text,start:0,end:0});
        message('Файл добавлен в редактор. Проверьте текст и нажмите «Сохранить».');
      }
    }
    listen(host,'mousedown',event => { if (event.target.closest('[data-md-command]')) event.preventDefault(); });
    listen(host,'click',event => {
      const button = event.target.closest('button');
      if (!button || !host.contains(button) || busy || disposed) return;
      if (button.hasAttribute('data-md-import')) { fileInput.value = ''; fileInput.click(); }
      else if (button.dataset.mdCommand) command(button.dataset.mdCommand);
      else if (button.dataset.mdViewButton) setView(button.dataset.mdViewButton);
      else if (button.dataset.mdChoice) {
        if (button.dataset.mdChoice === 'cancel') { clearChoice(); message('Импорт отменён. Текст не изменён.'); source.focus(); return; }
        if (!pending) return;
        try {
          const value = importValue(source.value,pending.text,button.dataset.mdChoice);
          history.remember(read());
          apply({value,start:button.dataset.mdChoice === 'append' ? value.length : 0,end:button.dataset.mdChoice === 'append' ? value.length : 0});
          message('Файл добавлен в редактор. Проверьте текст и нажмите «Сохранить».');
        } catch (problem) { message(problem.message,true); }
      }
    });
    listen(fileInput,'change',() => { const file = fileInput.files?.[0]; fileInput.value = ''; selectFile(file); });
    listen(source,'beforeinput',event => {
      history.remember(read());
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); command(event.inputType === 'historyUndo' ? 'undo' : 'redo'); }
      else if (source.selectionStart !== typingEnd || source.selectionStart !== source.selectionEnd) typingTime = 0;
    });
    listen(source,'input',() => {
      if (busy || disposed) return;
      const now = Date.now();
      history.record(read(),{merge:typingTime > 0 && now-typingTime < 700});
      typingTime = now; typingEnd = source.selectionEnd; message(''); changed();
    });
    listen(source,'keydown',event => {
      if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = /^Key[BIYZ]$/.test(event.code || '') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
      const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'z' ? (event.shiftKey?'redo':'undo') : key === 'y' ? 'redo' : '';
      if (action) { event.preventDefault(); event.stopPropagation(); command(action); }
    });
    listen(source,'invalid',() => { if (view === 'preview') setView('source'); source.focus(); });
    listen(previewPane,'click',event => { if (event.target.closest('a')) event.preventDefault(); });
    if (mobile?.addEventListener) listen(mobile,'change',() => setView(view));
    setView(view); changed(); updatePreview();
    return {
      setBusy(value) {
        if (disposed) return;
        busy = Boolean(value); guard.setBusy(busy); importSequence++; clearChoice(); if (busy) message(''); updateButtons();
      },
      dispose() {
        if (disposed) return;
        disposed = true; guard.dispose(); importSequence++; clearTimeout(previewTimer); clearChoice();
        listeners.forEach(remove => remove());
      }
    };
  }

  const api = {markup,mount,transform,createHistory,readMarkdownFile,importValue,createImportGuard};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.MENTOR_LESSON_EDITOR = api;
})(typeof window === 'object' ? window : globalThis);

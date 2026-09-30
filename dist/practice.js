(function(root) {
  'use strict';

  const MAX_UPLOAD = 20 * 1024 * 1024;
  const MAX_SOURCE = 256 * 1024;
  const statuses = {
    accepted:'Все тесты пройдены', wrong_answer:'Есть ошибки в решении', compile_error:'Ошибка компиляции',
    runtime_error:'Ошибка выполнения', time_limit:'Превышено время', error:'Проверка не завершена', unavailable:'Проверка недоступна'
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d) : 'Дата неизвестна'; };
  const bytes = value => value < 1024 ? value + ' Б' : value < 1024*1024 ? (value/1024).toFixed(1) + ' КиБ' : (value/1024/1024).toFixed(1) + ' МиБ';
  const textValue = value => typeof value === 'string' ? value : JSON.stringify(value,null,2);
  const resultLabel = (result,mode) => result && result.status === 'accepted' && mode === 'run' ? 'Примеры пройдены' : statuses[result && result.status] || 'Проверка не завершена';
  let draftSerial = 0;

  function formatError(error) {
    if (error && error.name === 'AbortError') return 'Запрос отменён.';
    if (error && (error.name === 'TypeError' || error.name === 'TimeoutError')) return 'Не удалось связаться с локальным сервером. Проверьте подключение и повторите запрос.';
    return error && error.message ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  }
  function allowedFiles(starter, supplied) {
    const files = {};
    for (const name of Object.keys(starter || {})) files[name] = supplied && typeof supplied[name] === 'string' ? supplied[name] : starter[name];
    return files;
  }
  function validateUpload(file, repository) {
    if (!file || !file.size) return 'Выберите непустой файл с домашней работой.';
    if (file.size > MAX_UPLOAD) return 'Размер файла должен быть не больше 20 МиБ.';
    if (!/\.(zip|java|txt|md|pdf)$/i.test(file.name)) return 'Допустимы ZIP, Java, TXT, Markdown и PDF.';
    if (repository) { try { const url = new URL(repository); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); } catch { return 'Укажите HTTPS-ссылку на репозиторий без логина и пароля.'; } }
    return '';
  }
  async function request(path, options) {
    if (!root.MENTOR_AUTH || !root.MENTOR_AUTH.session()) throw Object.assign(new Error('Сессия завершена.'),{status:401,code:'UNAUTHORIZED'});
    return root.MENTOR_AUTH.request(path,{cache:'no-store',...options});
  }

  // A draft is independent of its view: navigation cannot dispose an in-flight save
  // or let an earlier response replace code typed after that request started.
  function createDraftSession(config) {
    const starter = clone(config.starterFiles), storageKey = 'mentor.practice.draft.' + (config.accountId ? encodeURIComponent(config.accountId)+'.' : '') + config.key;
    const owner = Date.now().toString(36)+'-'+(++draftSerial)+'-'+Math.random().toString(36).slice(2);
    let ownedRecovery = null, ownedPrevious = null;
    const remote = config.remoteDraft || {};
    const remoteOutdated = remote.outdated || (remote.exerciseRevision && remote.exerciseRevision !== config.exerciseRevision);
    let files = remoteOutdated && remote.files ? clone(remote.files) : allowedFiles(starter,remote.files), revision = remote.revision || 0;
    let exerciseRevision = remote.exerciseRevision || config.exerciseRevision;
    let dirty = false, localSaved = false, status = remote.outdated ? 'outdated' : 'saved', error = '', updatedAt = remote.updatedAt;
    let inflight = null, generation = 0, resetting = false, frozen = false, logoutLocked = false;
    const listeners = new Set();
    try {
      const recoveryRecord = config.storage && config.storage.getItem(storageKey);
      const stored = JSON.parse(recoveryRecord || 'null');
      if (stored && stored.files && stored.dirty && (!config.accountId || stored.accountId === config.accountId)) {
        // This exact recovered record may be retired after an explicit save/reset.
        // A later write by another tab still fails the compare-and-delete check.
        ownedRecovery = recoveryRecord;
        exerciseRevision = stored.exerciseRevision || config.exerciseRevision;
        files = exerciseRevision !== config.exerciseRevision ? clone(stored.files) : allowedFiles(starter,stored.files); dirty = true; localSaved = true;
        if (exerciseRevision !== config.exerciseRevision || remote.outdated) status = 'outdated';
        else if (stored.revision !== revision) status = equal(files,allowedFiles(starter,remote.files)) ? 'saved' : 'conflict';
        else status = 'dirty';
        if (status === 'saved') dirty = false;
      }
    } catch { /* Recovery storage may be blocked; the editor still works in memory. */ }
    if (exerciseRevision !== config.exerciseRevision) status = 'outdated';
    function recoveryMatches() {
      if (!localSaved || !dirty) return false;
      try {
        const stored = JSON.parse(config.storage && config.storage.getItem(storageKey) || 'null');
        return Boolean(stored && stored.dirty && (!config.accountId || stored.accountId === config.accountId) && stored.revision === revision && stored.exerciseRevision === exerciseRevision && equal(stored.files,files));
      } catch { return false; }
    }
    function snapshot() { return {files:clone(files),revision,exerciseRevision,targetRevision:config.exerciseRevision,dirty,localSaved:recoveryMatches(),status,error,updatedAt,logoutLocked,locked:frozen || logoutLocked || resetting || status === 'outdated'}; }
    function emit() { for (const listener of listeners) listener(snapshot()); }
    function lockForLogout() { if (!logoutLocked) { logoutLocked = true; emit(); } }
    function unlockForLogout() { if (logoutLocked) { logoutLocked = false; emit(); } }
    function freeze(reason = 'Сессия изменилась. Войдите под прежней учётной записью, чтобы продолжить работу.') {
      if (frozen) return;
      frozen = true; generation++; status = 'frozen'; error = reason; emit();
    }
    function ownerActive() { if (config.isOwnerActive && !config.isOwnerActive()) { freeze(); return false; } return !frozen; }
    function persist() {
      try {
        if (!config.storage) throw new Error('Storage unavailable');
        if (dirty || status === 'outdated' || status === 'conflict') {
          const record = JSON.stringify({owner,accountId:config.accountId || null,files,revision,exerciseRevision,dirty:true});
          config.storage.setItem(storageKey,record); ownedRecovery = record;
        } else if (ownedRecovery && config.storage.getItem(storageKey) === ownedRecovery) {
          // Another tab may have written a recovery while this save was in flight.
          // Remove only the exact record this session last wrote.
          config.storage.removeItem(storageKey); ownedRecovery = null;
        }
        localSaved = dirty;
      } catch { localSaved = false; }
    }
    function edit(name, value) {
      if (!ownerActive() || logoutLocked || resetting || status === 'outdated') return;
      if (!Object.prototype.hasOwnProperty.call(starter,name)) throw new Error('Этот файл не входит в упражнение.');
      if (files[name] === value) return;
      files[name] = value; generation++; dirty = true;
      if (!['conflict','outdated','saving'].includes(status)) status = 'dirty';
      persist(); emit();
    }
    function flush({allowDuringLogout = false} = {}) {
      if (!ownerActive() || logoutLocked && !allowDuringLogout) return Promise.resolve(false);
      if (inflight) return inflight;
      if (status === 'outdated' || status === 'conflict') return Promise.resolve(false);
      if (!dirty) return Promise.resolve(true);
      inflight = (async () => {
        while (dirty) {
          const version = generation, sent = clone(files);
          status = 'saving'; error = ''; emit();
          try {
            if (!ownerActive()) return false;
            if (Object.values(sent).reduce((total,source)=>total+new TextEncoder().encode(source).length,0) > MAX_SOURCE) throw new Error('Код слишком большой: максимум 256 КиБ на упражнение. Скачайте копию и сократите файлы.');
            const answer = await config.send({files:sent,revision,exerciseRevision:config.exerciseRevision});
            if (!ownerActive()) return false;
            revision = answer.draft.revision; updatedAt = answer.draft.updatedAt;
            exerciseRevision = answer.draft.exerciseRevision || config.exerciseRevision;
            dirty = generation !== version; status = dirty ? 'dirty' : 'saved'; persist(); emit();
          } catch (failure) {
            if (failure.status === 401 || (failure.status === 409 && (failure.code === 'ACCOUNT_CHANGED' || failure.data && failure.data.code === 'ACCOUNT_CHANGED'))) { freeze(); return false; }
            if (!ownerActive()) return false;
            status = failure.status === 409 ? 'conflict' : 'error'; error = formatError(failure); persist(); emit(); return false;
          }
        }
        return true;
      })().finally(() => { inflight = null; });
      return inflight;
    }
    function resolveConflict(serverDraft, keepLocal) {
      if (!ownerActive() || logoutLocked || inflight) return false;
      revision = serverDraft.revision || 0;
      exerciseRevision = serverDraft.exerciseRevision || config.exerciseRevision;
      if (!keepLocal) { files = allowedFiles(starter,serverDraft.files); generation++; }
      dirty = keepLocal;
      status = serverDraft.outdated || exerciseRevision !== config.exerciseRevision ? 'outdated' : keepLocal ? 'dirty' : 'saved';
      error = ''; persist(); emit(); return true;
    }
    function reset() {
      if (!ownerActive() || logoutLocked) return Promise.resolve(false);
      if (inflight) return inflight;
      const old = snapshot();
      try { ownedPrevious = JSON.stringify({...old,owner,accountId:config.accountId || null}); config.storage && config.storage.setItem(storageKey+'.previous',ownedPrevious); } catch { /* Export remains available. */ }
      resetting = true; status = 'saving'; emit();
      inflight = (async () => {
        try {
          const answer = await config.send({files:clone(starter),revision,exerciseRevision:config.exerciseRevision,resetForExerciseRevision:config.exerciseRevision});
          if (!ownerActive()) { resetting = false; return false; }
          files = allowedFiles(starter,answer.draft.files); revision = answer.draft.revision;
          exerciseRevision = config.exerciseRevision; updatedAt = answer.draft.updatedAt; generation++;
          dirty = false; resetting = false; status = 'saved'; error = ''; persist(); emit(); return true;
        } catch (failure) {
          if (failure.status === 401 || (failure.status === 409 && (failure.code === 'ACCOUNT_CHANGED' || failure.data && failure.data.code === 'ACCOUNT_CHANGED'))) { resetting = false; freeze(); return false; }
          if (!ownerActive()) { resetting = false; return false; }
          resetting = false; status = old.status; error = formatError(failure); persist(); emit(); return false;
        }
      })().finally(() => { inflight = null; });
      return inflight;
    }
    function discardRecovery() {
      try {
        if (ownedRecovery && config.storage.getItem(storageKey) === ownedRecovery && JSON.parse(ownedRecovery).owner === owner) config.storage.removeItem(storageKey);
        if (ownedPrevious && config.storage.getItem(storageKey+'.previous') === ownedPrevious) config.storage.removeItem(storageKey+'.previous');
      } catch { /* Storage may be unavailable during logout. */ }
      ownedRecovery = null; ownedPrevious = null;
    }
    return {snapshot,edit,flush,reset,resolveConflict,freeze,lockForLogout,unlockForLogout,discardRecovery,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
  }

  function getDraftSession(config,sessions) {
    const cacheKey = (config.accountId ? encodeURIComponent(config.accountId)+'.' : '')+config.key;
    const previous = sessions.get(cacheKey), state = previous && previous.snapshot();
    // A GET begun before navigation may arrive after a PATCH acknowledgement.
    // Never replace the acknowledged revision with that older server snapshot.
    if (state && state.status !== 'frozen' && state.targetRevision === config.exerciseRevision && (state.dirty || state.status === 'saving' || state.revision >= (config.remoteDraft && config.remoteDraft.revision || 0))) return previous;
    const session = createDraftSession(config); sessions.set(cacheKey,session); return session;
  }

  let active = null, monacoLoading = null, lastOwnerId = null;
  const drafts = new Map();
  const logoutLocks = new Set(), logoutPreparations = new Map();
  const assetBase = root.document && root.document.currentScript ? new URL('.',root.document.currentScript.src).href : null;
  function loadMonaco() {
    if (root.monaco && root.monaco.editor) return Promise.resolve(root.monaco);
    if (monacoLoading) return monacoLoading;
    monacoLoading = new Promise((resolve,reject) => {
      const base = new URL('vendor/monaco/',assetBase || root.location.href).href;
      root.MonacoEnvironment = {getWorkerUrl:() => base+'worker-bootstrap.js'};
      let settled = false;
      const timer = root.setTimeout(() => finish(new Error('Monaco loading timed out')),12000);
      function finish(error) { if (settled) return; settled = true; root.clearTimeout(timer); error ? reject(error) : resolve(root.monaco); }
      function start() {
        try {
          root.require.config({paths:{vs:base+'vs'}});
          root.require(['vs/editor/editor.main'],() => finish(),failure => finish(failure));
        } catch (failure) { finish(failure); }
      }
      if (root.require && root.require.config) start();
      else {
        const script = root.document.createElement('script'); script.src = base+'vs/loader.js'; script.async = true;
        script.onload = start; script.onerror = () => finish(new Error('Monaco loader unavailable'));
        root.document.head.append(script);
      }
    });
    return monacoLoading;
  }
  function safeStorage() { try { return root.localStorage; } catch { return null; } }
  function localPracticeHost() {
    try { return ['127.0.0.1','localhost'].includes(new URL(root.location.href).hostname); } catch { return false; }
  }
  function legacyRecoveryEntries() {
    const storage = safeStorage(), found = [];
    if (!storage) return found;
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key || !/^mentor\.practice\.draft\.[^/]+\/[^/]+\/[^/]+(?:\.previous)?$/.test(key)) continue;
        let record;
        try { record = JSON.parse(storage.getItem(key) || 'null'); } catch { continue; }
        if (!record || Object.prototype.hasOwnProperty.call(record,'accountId') || !record.files || typeof record.files !== 'object') continue;
        const files = Object.entries(record.files).filter(([name,source])=>name && typeof source === 'string');
        if (files.length) found.push({key,files});
      }
    } catch { /* Storage may be blocked or a record malformed; no account data is claimed. */ }
    return found;
  }
  function button(action,label,extra = '') { return '<button type="button" class="practice-button" data-practice-action="'+action+'" '+extra+'>'+label+'</button>'; }
  function pill(text,tone = '') { return '<span class="practice-pill '+(tone?'practice-'+tone:'')+'">'+esc(text)+'</span>'; }
  function resultMarkup(result,mode) {
    if (!result) return '<p class="practice-muted">Результат появится после запуска примеров или полной проверки.</p>';
    const tone = result.status === 'accepted' ? 'success' : result.status === 'wrong_answer' ? 'warning' : 'danger';
    return '<div class="practice-result-heading">'+pill(resultLabel(result,mode),tone)+
      '<span>'+Number(result.passed || 0)+' из '+Number(result.total || 0)+' тестов'+(Number.isFinite(result.elapsedMs)?' · '+(result.elapsedMs/1000).toFixed(2)+' с':'')+'</span></div>'+
      (result.diagnostics?'<pre class="practice-diagnostics">'+esc(textValue(result.diagnostics))+'</pre>':'')+
      '<div class="practice-test-list">'+(result.tests || []).map(test => {
        const passed = test.status === 'passed' || test.status === 'accepted' || test.status === 'pass';
        return '<details class="practice-test" '+(!passed?'open':'')+'><summary><span class="practice-test-mark '+(passed?'practice-success':'practice-danger')+'">'+(passed?'✓':'!')+'</span>'+esc(test.name || 'Тест')+'<span class="practice-test-label">'+(passed?'Пройден':esc(statuses[test.status] || 'Не пройден'))+'</span></summary><div class="practice-test-body">'+
          (test.message?'<p>'+esc(test.message)+'</p>':'')+
          ['expected','actual','stdout'].filter(key => test[key] !== undefined).map(key => '<div><strong>'+({expected:'Ожидалось',actual:'Получено',stdout:'Вывод программы'}[key])+'</strong><pre>'+esc(textValue(test[key]))+'</pre></div>').join('')+
          (!test.message && test.expected === undefined && test.actual === undefined && test.stdout === undefined ? '<p class="practice-muted">'+(passed?'Результат соответствует условию.':'Проверяющий не вернул подробности.')+'</p>':'')+'</div></details>';
      }).join('')+'</div>';
  }
  function sourcesMarkup(files) { return '<div class="practice-source-list">'+Object.entries(files || {}).map(([name,source])=>'<details class="practice-source" open><summary>'+esc(name)+'</summary><pre><code>'+esc(source)+'</code></pre></details>').join('')+'</div>'; }
  function exportFiles(files, exerciseId) {
    const entries = Object.entries(files);
    const content = entries.length === 1 ? entries[0][1] : entries.map(([name,source])=>'// ===== '+name+' =====\n'+source).join('\n\n');
    downloadText(content,entries.length === 1 ? entries[0][0].split('/').pop() : exerciseId+'-source.txt');
  }
  function downloadText(content, filename) {
    const url = root.URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const link = root.document.createElement('a'); link.href = url; link.download = filename;
    root.document.body.append(link); link.click(); link.remove(); root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
  }
  function exportLegacyRecovery() {
    const entries = legacyRecoveryEntries();
    if (!entries.length) return;
    const content = entries.map(({key,files})=>'// ===== '+key+' =====\n'+files.map(([name,source])=>'// --- '+name+' ---\n'+source).join('\n\n')).join('\n\n');
    downloadText(content,'legacy-practice-backups.txt');
  }

  class PracticeView {
    constructor(container,options) {
      this.container = container; this.options = options; this.alive = true; this.sequence = 0; this.attemptSequence = 0;
      const account = root.MENTOR_AUTH && root.MENTOR_AUTH.session() && root.MENTOR_AUTH.session().account;
      this.accountId = account && account.id; this.readOnly = Boolean(account && account.role === 'teacher');
      if (this.accountId) lastOwnerId = this.accountId;
      this.apiBase = '/api/students/'+encodeURIComponent(options.studentId)+'/lessons/'+encodeURIComponent(options.lessonId);
      this.abort = new AbortController(); this.models = new Map(); this.modelViews = new Map(); this.busy = false;
      this.click = event => this.onClick(event); this.submit = event => this.onSubmit(event);
      container.addEventListener('click',this.click); container.addEventListener('submit',this.submit);
      container.classList.add('practice-root');
      this.unsubscribeAuth = root.MENTOR_AUTH && root.MENTOR_AUTH.subscribe(session=>{ if (!session || !session.account || session.account.id !== this.accountId) this.freezeSession(); });
      this.ready = this.load();
    }
    sessionOwnerActive() { const session = root.MENTOR_AUTH && root.MENTOR_AUTH.session(); return !this.sessionFrozen && Boolean(this.accountId) && Boolean(session && session.account && session.account.id === this.accountId); }
    ownerActive() { return this.alive && this.sessionOwnerActive() && !logoutLocks.has(this.accountId); }
    freezeSession() {
      if (this.sessionFrozen) return;
      this.sessionFrozen = true; ++this.sequence; ++this.attemptSequence; this.abort.abort(); root.clearTimeout(this.saveTimer);
      for (const [key,draft] of drafts) if (key.startsWith(encodeURIComponent(this.accountId)+'.')) draft.freeze();
      this.updateDraftStatus();
    }
    async request(path,options={}) {
      if (!this.sessionOwnerActive()) { this.freezeSession(); throw Object.assign(new Error('Сессия изменилась.'),{status:409,code:'ACCOUNT_CHANGED'}); }
      const {allowDuringLogout,...networkOptions} = options;
      if (logoutLocks.has(this.accountId) && !allowDuringLogout && /^(POST|PUT|PATCH|DELETE)$/i.test(networkOptions.method || 'GET')) throw Object.assign(new Error('Завершается выход из кабинета.'),{status:409,code:'LOGOUT_PENDING'});
      try {
        const answer = await request(path,{...networkOptions,expectedAccountId:this.accountId});
        if (!this.sessionOwnerActive()) { this.freezeSession(); throw Object.assign(new Error('Сессия изменилась.'),{status:409,code:'ACCOUNT_CHANGED'}); }
        return answer;
      } catch (failure) {
        if (failure.status === 401 || failure.status === 409 && (failure.code === 'ACCOUNT_CHANGED' || failure.data && failure.data.code === 'ACCOUNT_CHANGED')) this.freezeSession();
        throw failure;
      }
    }
    query(selector) { return this.container.querySelector(selector); }
    href(page,id,audience = 'student') {
      const {studentId,lessonId} = this.options;
      return root.MentorRoutes ? root.MentorRoutes.lessonHref(studentId,lessonId,audience,page,id) : '#students/'+encodeURIComponent(studentId)+'/lessons/'+encodeURIComponent(lessonId)+'/'+audience+'/'+page+(id?'/'+encodeURIComponent(id):'');
    }
    exercisePath(id = this.exercise && this.exercise.id) { return this.apiBase+'/practice/exercises/'+encodeURIComponent(id); }
    async load() {
      const sequence = ++this.sequence;
      this.container.innerHTML = '<div class="practice-panel"><p class="practice-muted" role="status">'+(this.options.page === 'review'?'Загружаем сданные работы и ревью…':'Загружаем упражнения и домашнюю работу…')+'</p></div>';
      try {
        const teacher = this.readOnly && this.options.page === 'practice' && !this.options.exerciseId && !this.options.presentation;
        const [data,catalog] = await Promise.all([this.request(this.apiBase+'/practice',{signal:this.abort.signal}),teacher?this.request('/api/practice/catalog',{signal:this.abort.signal}):Promise.resolve(null)]);
        if (!this.ownerActive() || sequence !== this.sequence) return;
        this.data = data; this.catalog = catalog;
        if (this.options.page === 'review') this.renderReview();
        else if (this.options.exerciseId) this.renderEditor();
        else if (teacher) this.renderTeacher();
        else this.renderSummary();
      } catch (failure) {
        if (!this.alive || this.sessionFrozen || failure.name === 'AbortError') return;
        this.container.innerHTML = '<div class="practice-panel practice-error" role="alert"><h2>'+(this.options.page === 'review'?'Не удалось загрузить ревью':'Не удалось загрузить практику')+'</h2><p>'+esc(formatError(failure))+'</p>'+button('retry-load','Повторить')+'</div>';
      }
    }
    renderSummary() {
      const homework = this.options.page === 'homework';
      const exercises = (this.data.exercises || []).filter(exercise=>homework?exercise.placement === 'homework':exercise.placement !== 'homework');
      this.container.innerHTML = '<section class="practice-panel"><div class="practice-section-heading"><div><p class="practice-eyebrow">JAVA · ПРАКТИКА</p><h2>'+(homework?'Домашняя практика':'Решить на сайте')+'</h2></div>'+pill('Упражнений: '+exercises.length)+'</div>'+
        '<p class="practice-muted">'+(homework?'Небольшие упражнения проверяются автоматически. Полную домашнюю работу отправьте ниже.':'Откройте упражнение, напишите решение и проверьте его. Черновик сохраняется для этого занятия.')+'</p>'+this.exerciseCards(exercises)+
        (!this.options.presentation && !this.readOnly?'<a class="practice-text-link" href="'+this.href('practice',null,'teacher')+'">Назначить упражнения и проверить работы →</a>':'')+'</section>'+
        (homework?(this.readOnly?'':this.uploadMarkup())+'<section class="practice-panel"><div class="practice-section-heading"><h2>Отправленные работы</h2><a class="practice-text-link" href="'+this.href('review')+'">Ревью по занятию →</a></div><div data-practice-submissions>'+this.submissionsMarkup(false)+'</div></section>':'');
    }
    renderReview() {
      const canReview = this.readOnly && !this.options.presentation;
      this.container.innerHTML = '<section class="practice-panel"><h2>Ревью сданных работ</h2><div data-practice-submissions>'+this.submissionsMarkup(canReview)+'</div></section>';
    }
    exerciseCards(exercises) {
      if (!exercises.length) return '<p class="practice-empty">Упражнения пока не назначены.</p>';
      return '<div class="practice-cards">'+exercises.map(exercise=>{
        const attempts = exercise.attempts || [], current = attempts.filter(attempt=>String(attempt.exerciseRevision) === String(exercise.revision)), last = current[0];
        const accepted = current.some(attempt=>attempt.mode === 'submit' && attempt.result && attempt.result.status === 'accepted');
        return '<article class="practice-card"><div class="practice-card-meta">'+pill(exercise.placement === 'homework'?'Домашняя практика':'На занятии')+
          (accepted?pill('Решено','success'):last?pill(resultLabel(last.result,last.mode)):pill(exercise.draft && exercise.draft.outdated?'Черновик прошлой версии':exercise.draft && (exercise.draft.revision > 0 || exercise.draft.updatedAt)?'Есть черновик':attempts.length?'Есть попытки прошлой версии':'Не начато'))+'</div><h3>'+esc(exercise.title)+'</h3><p>'+esc((exercise.statement || '').split('\n').find(line=>line.trim()) || 'Условие доступно в тренажёре.')+'</p><div class="practice-card-footer"><span>'+esc(exercise.environment && exercise.environment.title || 'Java')+'</span><a class="practice-button practice-primary" href="'+this.href('practice',exercise.id)+'">Решать →</a></div></article>';
      }).join('')+'</div>';
    }
    uploadMarkup() {
      return '<section class="practice-panel practice-upload-panel"><p class="practice-eyebrow">НА РЕВЬЮ</p><h2>Сдать домашнюю работу</h2><p class="practice-muted">Прикрепите проект или отдельный файл для ревью. Обратная связь появится под отправленной работой; файлы здесь не запускаются.</p><form data-practice-form="upload"><label class="practice-field"><span>Файл работы</span><input type="file" name="homeworkFile" accept=".zip,.java,.txt,.md,.pdf" required><small>ZIP, Java, TXT, Markdown или PDF · до 20 МиБ</small></label><label class="practice-field"><span>Комментарий к работе</span><textarea name="comment" maxlength="10000" rows="3" placeholder="Что получилось, где нужна помощь"></textarea></label><label class="practice-field"><span>Репозиторий <small>необязательно</small></span><input type="url" name="repositoryUrl" placeholder="https://github.com/…" maxlength="2048"></label><div class="practice-form-bottom"><button class="practice-button practice-primary" type="submit">Отправить на ревью</button><p class="practice-form-status" role="status" aria-live="polite"></p></div></form></section>';
    }
    submissionsMarkup(teacher,selected) {
      const submissions = selected || this.data.submissions || [];
      if (!submissions.length) return '<p class="practice-empty">'+(this.options.page === 'review'?'По этому занятию ещё нет сданных работ. После отправки здесь появятся статус проверки и обратная связь.':teacher?'Ученик ещё не отправил домашнюю работу.':'Здесь появятся ваши отправленные работы и обратная связь.')+'</p>';
      return '<div class="practice-submissions">'+submissions.map(submission=>{
        const status = {submitted:'Ожидает проверки',reviewed:'Проверено',needs_revision:'Нужна доработка'}[submission.status] || 'Ожидает проверки';
        let repo = ''; try { const url = new URL(submission.repositoryUrl); if (url.protocol === 'https:') repo = '<a class="practice-text-link" href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">Репозиторий ↗</a>'; } catch { /* Optional URL. */ }
        return '<article class="practice-submission" data-practice-submission-card="'+esc(submission.id)+'"><header><div><h3>'+esc(submission.filename)+'</h3><p class="practice-muted">'+date(submission.createdAt)+' · '+bytes(submission.size || 0)+'</p></div>'+pill(status,submission.status === 'reviewed'?'success':submission.status === 'needs_revision'?'warning':'')+'</header>'+
          (submission.comment?'<p class="practice-prewrap">'+esc(submission.comment)+'</p>':'')+'<div class="practice-actions"><a class="practice-button" href="'+this.apiBase+'/homework/'+encodeURIComponent(submission.id)+'/file" download>↓ Скачать файл</a>'+repo+'</div>'+
          (submission.feedback?'<div class="practice-feedback"><strong>Обратная связь'+(submission.reviewedAt?' · '+date(submission.reviewedAt):'')+'</strong><p>'+esc(submission.feedback)+'</p></div>':'')+
          (teacher?'<details class="practice-review"><summary>'+(submission.feedback?'Изменить ревью':'Оставить ревью')+'</summary><form data-practice-form="review" data-submission="'+esc(submission.id)+'"><label class="practice-field"><span>Обратная связь</span><textarea name="feedback" rows="4" maxlength="10000" required>'+esc(submission.feedback || '')+'</textarea></label><label class="practice-field"><span>Результат ревью</span><select name="status"><option value="reviewed" '+(submission.status === 'reviewed'?'selected':'')+'>Проверено</option><option value="needs_revision" '+(submission.status === 'needs_revision'?'selected':'')+'>Нужна доработка</option></select></label><div class="practice-form-bottom"><button class="practice-button practice-primary" type="submit">Сохранить ревью</button><p class="practice-form-status" role="status"></p></div></form></details>':'')+'</article>';
      }).join('')+'</div>';
    }
    renderTeacher() {
      this.closeAttempt();
      this.container.innerHTML = '<header class="practice-page-heading"><p class="practice-eyebrow">КАБИНЕТ ПРЕПОДАВАТЕЛЯ</p><h1>Тренажёр занятия</h1><p class="practice-muted">Задачи ученика, результаты проверок и код решений — в одном месте.</p></header>'+
        (localPracticeHost() && legacyRecoveryEntries().length ? '<section class="practice-panel"><h2>Старые локальные черновики</h2><p class="practice-muted">Найдены черновики до введения учётных записей. Можно скачать копию на этом устройстве. Они не привязываются к аккаунту и не удаляются.</p>'+button('export-legacy','↓ Скачать старые черновики')+'</section>' : '')+
        '<section class="practice-teacher-section"><div class="practice-section-heading"><h2>Задачи ученика</h2></div><div class="practice-teacher-tasks" data-practice-teacher-tasks>'+this.teacherTasks()+'</div></section>'+
        '<details class="practice-panel practice-assignment-editor"'+(!(this.data.exercises || []).length?' open':'')+'><summary>Изменить задачи</summary><p class="practice-muted">Выберите задачи для занятия и домашней практики, затем сохраните назначения.</p><form data-practice-form="assignments"><div class="practice-assignment-list">'+(this.catalog.exercises || []).map(exercise=>{
        const assignment = (this.data.exercises || []).find(item=>item.id === exercise.id);
        return '<label class="practice-assignment"><span><strong>'+esc(exercise.title)+'</strong><small>'+esc(exercise.environment && exercise.environment.title || 'Java')+' · версия '+esc(exercise.revision)+'</small></span><select name="'+esc(exercise.id)+'" aria-label="Назначение: '+esc(exercise.title)+'"><option value="">Не назначено</option><option value="class" '+(assignment && assignment.placement === 'class'?'selected':'')+'>На занятии</option><option value="homework" '+(assignment && assignment.placement === 'homework'?'selected':'')+'>Домашняя практика</option></select></label>';
      }).join('')+'</div><div class="practice-form-bottom"><button class="practice-button practice-primary" type="submit">Сохранить назначения</button><p class="practice-form-status" role="status" aria-live="polite"></p></div></form></details><section class="practice-panel practice-review-link"><div><h2>Ревью домашней работы</h2><p class="practice-muted">Ожидает проверки: '+(this.data.submissions || []).filter(submission=>submission.status === 'submitted').length+'</p></div><a class="practice-text-link" href="'+this.href('review',null,'teacher')+'">Перейти к ревью →</a></section>';
    }
    teacherTasks() {
      if (!(this.data.exercises || []).length) return '<p class="practice-empty">Задачи пока не назначены. Выберите их ниже — здесь появятся результаты ученика.</p>';
      return this.data.exercises.map(exercise=>{
        const attempts = exercise.attempts || [], current = attempts.filter(attempt=>String(attempt.exerciseRevision) === String(exercise.revision)), latest = current[0];
        const solved = current.some(attempt=>attempt.mode === 'submit' && attempt.result && attempt.result.status === 'accepted');
        const state = solved?'Решено':latest?'В работе':attempts.length?'Попытки прошлой версии':exercise.draft && exercise.draft.outdated?'Черновик прошлой версии':exercise.draft && (exercise.draft.revision > 0 || exercise.draft.updatedAt)?'Есть черновик':'Не начато';
        return '<article class="practice-teacher-task" data-practice-teacher-task="'+esc(exercise.id)+'"><header class="practice-teacher-task-heading"><h3>'+esc(exercise.title)+'</h3>'+pill(state,solved?'success':attempts.length && !latest?'warning':'')+'</header>'+
          '<div class="practice-teacher-task-meta">'+pill(exercise.placement === 'homework'?'Домашняя практика':'На занятии')+'<span>'+esc(exercise.environment && exercise.environment.title || 'Java')+' · версия '+esc(exercise.revision)+'</span></div>'+
          '<p class="practice-muted">'+(latest?'Последняя проверка: '+esc(resultLabel(latest.result,latest.mode))+' · '+(latest.mode === 'submit'?'Полная проверка':'Запуск примеров')+' · '+date(latest.createdAt):attempts.length?'Для текущей версии попыток пока нет. Старые решения доступны в истории.':'Попыток пока нет.')+'</p>'+
          '<div class="practice-teacher-task-actions">'+(latest?button('attempt','Код и результат','data-exercise="'+esc(exercise.id)+'" data-attempt="'+esc(latest.id)+'"'):'')+'<a class="practice-text-link" href="'+this.href('practice',exercise.id,'teacher')+'">Условие и код →</a></div>'+
          '<div data-practice-attempt-detail data-exercise="'+esc(exercise.id)+'"></div>'+(attempts.length?'<details class="practice-teacher-history"><summary>История попыток ('+attempts.length+')</summary>'+this.historyMarkup(exercise)+'</details>':'')+'</article>';
      }).join('');
    }
    historyMarkup(exercise) {
      const attempts = exercise.attempts || [];
      if (!attempts.length) return '<p class="practice-muted">Попыток пока нет.</p>';
      return '<ol class="practice-history">'+attempts.map(attempt=>'<li><button type="button" class="practice-history-button" data-practice-action="attempt" data-exercise="'+esc(exercise.id)+'" data-attempt="'+esc(attempt.id)+'"><span><strong>'+(attempt.mode === 'submit'?'Полная проверка':'Запуск примеров')+'</strong><small>'+date(attempt.createdAt)+' · версия '+esc(attempt.exerciseRevision || exercise.revision)+'</small></span>'+pill(resultLabel(attempt.result,attempt.mode),attempt.result && attempt.result.status === 'accepted'?'success':'')+'<span aria-hidden="true">↗</span></button></li>').join('')+'</ol>';
    }
    renderEditor() {
      const exercise = (this.data.exercises || []).find(item=>item.id === this.options.exerciseId);
      if (!exercise) { this.container.innerHTML = '<section class="practice-panel"><h2>Упражнение не назначено</h2><p class="practice-muted">Выберите доступное упражнение в заданиях этого занятия.</p><a class="practice-button" href="'+this.href('tasks')+'">К заданиям</a></section>'; return; }
      this.exercise = exercise;
      if (this.readOnly) { this.renderPreview(exercise); return; }
      const key = [this.options.studentId,this.options.lessonId,exercise.id].map(encodeURIComponent).join('/');
      const ownerId = this.accountId;
      const draft = getDraftSession({key,accountId:ownerId,starterFiles:exercise.starterFiles,exerciseRevision:exercise.revision,remoteDraft:exercise.draft,storage:safeStorage(),isOwnerActive:()=>this.sessionOwnerActive(),send:body=>this.request(this.exercisePath(exercise.id)+'/draft',{method:'PATCH',body:JSON.stringify(body),keepalive:new TextEncoder().encode(JSON.stringify(body)).length < 60000,allowDuringLogout:true})},drafts);
      this.draft = draft; this.currentFile = Object.keys(draft.snapshot().files)[0];
      const env = exercise.environment || {};
      this.container.innerHTML = '<header class="practice-page-heading"><a class="practice-back" href="'+this.href(exercise.placement === 'homework'?'homework':'tasks')+'">← '+(exercise.placement === 'homework'?'Домашняя работа':'Задания занятия')+'</a><div class="practice-section-heading"><h1>'+esc(exercise.title)+'</h1>'+pill(exercise.placement === 'homework'?'Домашняя практика':'На занятии')+'</div></header><div class="practice-editor-layout"><section class="practice-panel practice-statement"><p class="practice-eyebrow">УСЛОВИЕ</p><div class="practice-statement-text">'+esc(exercise.statement)+'</div><details class="practice-environment"><summary>'+esc(env.title || 'Java')+' · окружение</summary><p>Java '+esc(env.javaVersion || '21')+' · версия упражнения '+esc(exercise.revision)+'</p><p class="practice-muted">Используйте файлы и библиотеки этого задания.</p>'+
        (env.dependencies && env.dependencies.length?'<ul>'+env.dependencies.map(dep=>'<li><code>'+esc(typeof dep === 'string'?dep:dep.coordinate || [dep.groupId,dep.artifactId,dep.version].filter(Boolean).join(':'))+'</code></li>').join('')+'</ul>':'<p class="practice-muted">Без внешних библиотек.</p>')+'</details></section><section class="practice-code-panel" aria-label="Решение на Java"><div class="practice-code-top"><strong>Моё решение</strong><span class="practice-editor-kind" data-practice-editor-kind>Java · текстовый редактор</span></div><div class="practice-file-tabs" role="tablist" aria-label="Файлы решения">'+Object.keys(draft.snapshot().files).map((name,index)=>'<button class="practice-file-tab" type="button" role="tab" aria-selected="'+(index === 0)+'" data-practice-action="file" data-file="'+esc(name)+'">'+esc(name)+'</button>').join('')+'</div><div class="practice-editor-surface"><div class="practice-monaco" data-practice-monaco hidden></div><textarea class="practice-fallback" data-practice-code spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Java-код: '+esc(this.currentFile)+'"></textarea></div><div class="practice-save-row"><span data-practice-save role="status" aria-live="polite"></span>'+button('save','Сохранить')+button('export','↓ Скачать код')+'</div><div data-practice-draft-notice></div><div class="practice-run-bar">'+button('run','▷ Запустить примеры')+button('submit','Проверить решение','data-practice-primary="true"')+'<span class="practice-shortcut">Ctrl + Enter — примеры</span></div><p class="practice-runner-note" data-practice-runner>'+esc(this.data.runner && this.data.runner.message || 'Состояние проверки неизвестно.')+'</p></section></div><section class="practice-panel practice-results"><div class="practice-section-heading"><h2>Результат проверки</h2><span class="practice-muted" data-practice-result-meta></span></div><div data-practice-result role="status" aria-live="polite">'+resultMarkup(null)+'</div></section><section class="practice-panel"><h2>История попыток</h2><p class="practice-muted">Каждая попытка хранит код, который был отправлен на проверку.</p><div data-practice-history>'+this.historyMarkup(exercise)+'</div><div data-practice-attempt-detail></div></section>';
      const fallback = this.query('[data-practice-code]'); fallback.value = draft.snapshot().files[this.currentFile] || '';
      fallback.addEventListener('input',()=>this.changed(fallback.value));
      fallback.addEventListener('keydown',event=>{
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.run('run'); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.draft.flush(); }
      });
      this.unsubscribe = draft.subscribe(()=>{ if (this.alive) this.updateDraftStatus(); });
      this.updateDraftStatus(); this.attachMonaco();
      if (draft.snapshot().dirty && !['outdated','conflict'].includes(draft.snapshot().status)) this.saveTimer = root.setTimeout(()=>draft.flush(),700);
    }
    renderPreview(exercise) {
      const teacher = !this.options.presentation;
      this.container.innerHTML = '<header class="practice-page-heading"><a class="practice-back" href="'+(teacher?this.href('practice',null,'teacher'):this.href('tasks'))+'">'+(teacher?'← К тренажёру занятия':'← К заданиям')+'</a><h1>'+esc(exercise.title)+'</h1></header><section class="practice-panel"><p class="practice-eyebrow">ТОЛЬКО ПРОСМОТР</p><h2>Только просмотр</h2><p class="practice-statement-text">'+esc(exercise.statement)+'</p><h3>Код ученика</h3>'+sourcesMarkup(exercise.draft && exercise.draft.files || exercise.starterFiles)+button('export-preview','↓ Скачать код')+'<h3>История попыток</h3>'+this.historyMarkup(exercise)+'</section><div data-practice-attempt-detail></div>';
    }
    changed(value) {
      if (!this.ownerActive()) return;
      this.draft.edit(this.currentFile,value); root.clearTimeout(this.saveTimer);
      this.saveTimer = root.setTimeout(()=>this.draft.flush(),900);
    }
    async attachMonaco() {
      try {
        const monaco = await loadMonaco(); if (!this.ownerActive() || !this.exercise) return;
        const host = this.query('[data-practice-monaco]'); if (!host) return;
        for (const [name,source] of Object.entries(this.draft.snapshot().files)) {
          const model = monaco.editor.createModel(source,'java'); this.models.set(name,model);
          model.onDidChangeContent(()=>{ if (!this.syncingModels && this.alive) { this.draft.edit(name,model.getValue()); root.clearTimeout(this.saveTimer); this.saveTimer = root.setTimeout(()=>this.draft.flush(),900); } });
        }
        monaco.editor.defineTheme('mentor-practice',{base:'vs',inherit:true,rules:[],colors:{'editor.background':'#fffefa','editorLineNumber.foreground':'#7d887e','editor.lineHighlightBackground':'#f2f3e9','editorCursor.foreground':'#173d37','editor.selectionBackground':'#dce9b7'}});
        host.hidden = false;
        this.editor = monaco.editor.create(host,{model:this.models.get(this.currentFile),theme:'mentor-practice',automaticLayout:true,fontFamily:'Cascadia Code, Consolas, monospace',fontSize:14,lineHeight:23,minimap:{enabled:false},scrollBeyondLastLine:false,padding:{top:16,bottom:20},lineNumbers:'on',lineNumbersMinChars:3,glyphMargin:false,folding:true,tabSize:4,insertSpaces:true,wordBasedSuggestions:'off',quickSuggestions:true,bracketPairColorization:{enabled:true},autoClosingBrackets:'always',accessibilitySupport:'auto',ariaLabel:'Java-код: '+this.currentFile,stickyScroll:{enabled:false},fixedOverflowWidgets:false,readOnly:this.draft.snapshot().locked});
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,()=>this.run('run'));
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,()=>this.draft.flush());
        this.query('[data-practice-code]').hidden = true;
        this.query('[data-practice-editor-kind]').textContent = 'Java · Monaco';
      } catch {
        if (!this.alive) return;
        if (this.editor) { this.editor.dispose(); this.editor = null; }
        for (const model of this.models.values()) model.dispose(); this.models.clear();
        const host = this.query('[data-practice-monaco]'), fallback = this.query('[data-practice-code]');
        if (host) host.hidden = true;
        if (fallback) { fallback.hidden = false; fallback.value = this.draft.snapshot().files[this.currentFile] || ''; }
        const kind = this.query('[data-practice-editor-kind]'); if (kind) kind.textContent = 'Java · текстовый редактор (Monaco недоступен)';
      }
    }
    updateDraftStatus() {
      if (!this.draft || !this.alive) return;
      const state = this.draft.snapshot(), label = this.query('[data-practice-save]');
      const labels = {saved:state.updatedAt?'Сохранено на сервере · '+date(state.updatedAt):'Черновик не изменён',saving:'Сохраняем на сервере…',dirty:state.localSaved?'Изменения сохранены в браузере · ждут отправки':'Изменения пока только в редакторе',error:state.localSaved?'В браузере сохранено · сервер недоступен':'Не сохранено · скачайте код',conflict:'Есть другая версия черновика',outdated:'Изменилась версия упражнения',frozen:'Сессия изменилась · черновик сохранён для прежнего аккаунта'};
      if (label) { label.textContent = state.logoutLocked ? 'Завершается выход из кабинета…' : labels[state.status] || 'Есть изменения'; label.className = 'practice-save-status'+(['error','conflict','outdated'].includes(state.status)?' practice-warning':''); }
      const notice = this.query('[data-practice-draft-notice]');
      if (notice) {
        const signature = state.status+'|'+state.error;
        if (this.noticeSignature !== signature) {
          this.noticeSignature = signature;
          notice.innerHTML = state.status === 'outdated'?'<div class="practice-notice"><strong>Упражнение обновилось.</strong><p>Старый код сохранён. Скачайте его перед переходом к новой заготовке.</p>'+button('export','↓ Скачать старый код')+button('reset','Загрузить новую заготовку')+(state.error?'<p role="alert">'+esc(state.error)+'</p>':'')+'</div>':state.status === 'conflict'?'<div class="practice-notice"><strong>На сервере есть другая версия.</strong><p>Ваш код остался в редакторе. Сравните версии перед сохранением.</p>'+button('compare','Сравнить с сервером')+button('export','↓ Скачать мой код')+'<div data-practice-conflict></div></div>':state.status === 'frozen'?'<div class="practice-notice" role="alert">'+esc(state.error)+' '+button('export','↓ Скачать код')+'</div>':state.status === 'error'?'<div class="practice-notice" role="alert">'+esc(state.error)+' '+button('save','Повторить сохранение')+'</div>':'';
        }
      }
      const outdated = state.locked;
      const fallback = this.query('[data-practice-code]'); if (fallback) fallback.readOnly = outdated;
      if (this.editor) this.editor.updateOptions({readOnly:outdated});
      for (const action of ['run','submit']) { const control = this.query('[data-practice-action="'+action+'"]'); if (control) control.disabled = this.busy || outdated || !(this.data.runner && this.data.runner.available); }
      const save = this.query('[data-practice-action="save"]'); if (save) save.disabled = state.locked || state.status === 'saving' || state.status === 'conflict';
    }
    switchFile(name) {
      if (!this.draft || !Object.prototype.hasOwnProperty.call(this.draft.snapshot().files,name)) return;
      if (this.editor) { this.modelViews.set(this.currentFile,this.editor.saveViewState()); this.editor.setModel(this.models.get(name)); if (this.modelViews.has(name)) this.editor.restoreViewState(this.modelViews.get(name)); this.editor.updateOptions({ariaLabel:'Java-код: '+name}); }
      this.currentFile = name;
      const fallback = this.query('[data-practice-code]'); fallback.value = this.draft.snapshot().files[name]; fallback.setAttribute('aria-label','Java-код: '+name);
      for (const tab of this.container.querySelectorAll('[data-practice-action="file"]')) tab.setAttribute('aria-selected',String(tab.dataset.file === name));
    }
    syncEditor() {
      const files = this.draft.snapshot().files;
      if (!Object.prototype.hasOwnProperty.call(files,this.currentFile)) this.currentFile = Object.keys(files)[0];
      this.query('.practice-file-tabs').innerHTML = Object.keys(files).map(name=>'<button class="practice-file-tab" type="button" role="tab" aria-selected="'+(name === this.currentFile)+'" data-practice-action="file" data-file="'+esc(name)+'">'+esc(name)+'</button>').join('');
      this.syncingModels = true;
      for (const [name,source] of Object.entries(files)) {
        let model = this.models.get(name);
        if (!model && this.editor) {
          model = root.monaco.editor.createModel(source,'java'); this.models.set(name,model);
          model.onDidChangeContent(()=>{ if (!this.syncingModels && this.alive) { this.draft.edit(name,model.getValue()); root.clearTimeout(this.saveTimer); this.saveTimer = root.setTimeout(()=>this.draft.flush(),900); } });
        }
        if (model && model.getValue() !== source) model.setValue(source);
      }
      this.syncingModels = false;
      this.switchFile(this.currentFile);
      for (const [name,model] of this.models) if (!Object.prototype.hasOwnProperty.call(files,name)) { model.dispose(); this.models.delete(name); this.modelViews.delete(name); }
    }
    async run(mode) {
      if (!this.ownerActive() || this.readOnly || this.busy || !this.draft || !(this.data.runner && this.data.runner.available) || this.draft.snapshot().locked) return;
      const files = this.draft.snapshot().files;
      this.busy = true; this.updateDraftStatus(); this.draft.flush();
      const target = this.query('[data-practice-result]');
      target.innerHTML = '<p class="practice-working">Компиляция и '+(mode === 'submit'?'полная проверка':'запуск примеров')+'…</p>';
      this.query('[data-practice-result-meta]').textContent = mode === 'submit'?'Полная проверка':'Примеры';
      try {
        const answer = await this.request(this.exercisePath()+'/attempts',{method:'POST',body:JSON.stringify({files,mode,exerciseRevision:this.exercise.revision})});
        if (!this.ownerActive()) return;
        this.exercise.attempts = [answer.attempt,...(this.exercise.attempts || []).filter(item=>item.id !== answer.attempt.id)];
        target.innerHTML = resultMarkup(answer.attempt.result,mode);
        if (!equal(files,this.draft.snapshot().files)) target.insertAdjacentHTML('afterbegin','<p class="practice-notice">Проверен код на момент запуска. После запуска вы изменили решение.</p>');
        this.query('[data-practice-history]').innerHTML = this.historyMarkup(this.exercise);
      } catch (failure) {
        if (this.ownerActive()) target.innerHTML = '<div class="practice-error" role="alert">'+esc(formatError(failure))+'<p>Код остался в редакторе. Если соединение прервалось, сохранённая попытка появится в истории после обновления страницы.</p></div>';
      } finally { this.busy = false; if (this.alive) this.updateDraftStatus(); }
    }
    attemptTarget(exerciseId) {
      if (!this.catalog) return this.query('[data-practice-attempt-detail]');
      return Array.from(this.container.querySelectorAll('[data-practice-attempt-detail]')).find(target=>target.dataset.exercise === exerciseId);
    }
    closeAttempt(restoreFocus = false) {
      ++this.attemptSequence;
      if (this.activeAttemptTarget) this.activeAttemptTarget.innerHTML = '';
      this.activeAttemptTarget = null; this.selectedAttempt = null;
      if (restoreFocus && this.attemptTrigger && this.container.contains(this.attemptTrigger) && this.attemptTrigger.focus) this.attemptTrigger.focus();
      this.attemptTrigger = null;
    }
    async openAttempt(exerciseId,attemptId,trigger) {
      if (!this.ownerActive()) return;
      if (this.catalog && !(this.data.exercises || []).some(exercise=>exercise.id === exerciseId)) return;
      this.closeAttempt();
      const sequence = this.attemptSequence, target = this.attemptTarget(exerciseId); if (!target) return;
      this.activeAttemptTarget = target; this.attemptTrigger = trigger;
      target.innerHTML = '<div class="practice-section-heading"><p class="practice-muted" role="status">Загружаем код попытки…</p>'+button('close-attempt','Закрыть')+'</div>';
      try {
        const answer = await this.request(this.exercisePath(exerciseId)+'/attempts/'+encodeURIComponent(attemptId),{signal:this.abort.signal});
        if (!this.ownerActive() || sequence !== this.attemptSequence || target !== this.attemptTarget(exerciseId)) return;
        this.selectedAttempt = answer.attempt;
        target.innerHTML = '<section class="practice-attempt-detail"><div class="practice-section-heading"><h3>Попытка · '+date(answer.attempt.createdAt)+'</h3>'+button('close-attempt','Закрыть')+'</div><p class="practice-muted">'+(answer.attempt.mode === 'submit'?'Полная проверка':'Запуск примеров')+' · версия '+esc(answer.attempt.exerciseRevision)+'</p>'+resultMarkup(answer.attempt.result,answer.attempt.mode)+'<h3>Код этой попытки</h3>'+button('export-attempt','↓ Скачать код попытки')+sourcesMarkup(answer.attempt.files)+'</section>';
        target.tabIndex = -1;
        if (target.focus) target.focus({preventScroll:true});
        if (target.scrollIntoView) target.scrollIntoView({block:'nearest'});
      } catch (failure) { if (this.ownerActive() && sequence === this.attemptSequence && target === this.attemptTarget(exerciseId)) target.innerHTML = '<div class="practice-section-heading"><p class="practice-error" role="alert">'+esc(formatError(failure))+'</p>'+button('close-attempt','Закрыть')+'</div>'; }
    }
    async compareConflict() {
      const target = this.query('[data-practice-conflict]'); if (!target) return;
      target.innerHTML = '<p role="status">Загружаем серверную версию…</p>';
      try {
        const data = await this.request(this.apiBase+'/practice',{signal:this.abort.signal}); if (!this.ownerActive()) return;
        const exercise = data.exercises.find(item=>item.id === this.exercise.id); if (!exercise) throw new Error('Упражнение больше не назначено этому занятию. Скачайте ваш код.');
        this.serverDraft = exercise.draft || {files:exercise.starterFiles,revision:0,exerciseRevision:exercise.revision};
        if (exercise.revision !== this.exercise.revision || this.serverDraft.outdated) { target.innerHTML = '<p>Упражнение обновилось. Скачайте свой код и обновите страницу.</p>'+button('export','↓ Скачать код'); return; }
        target.innerHTML = '<h3>Версия на сервере</h3>'+sourcesMarkup(this.serverDraft.files)+button('keep-local','Сохранить мой код поверх этой версии')+button('use-server','Использовать серверную версию');
      } catch (failure) { if (this.alive) target.innerHTML = '<p class="practice-error" role="alert">'+esc(formatError(failure))+'</p>'; }
    }
    async onClick(event) {
      const control = event.target.closest('[data-practice-action]'); if (!control || !this.container.contains(control) || control.disabled) return;
      const action = control.dataset.practiceAction;
      if (!this.ownerActive() && action !== 'export') return;
      if (action === 'retry-load') this.load();
      else if (action === 'file') this.switchFile(control.dataset.file);
      else if (action === 'save') this.draft && this.draft.flush();
      else if (action === 'export' && this.draft) exportFiles(this.draft.snapshot().files,this.exercise.id);
      else if (action === 'export-preview' && this.readOnly && this.exercise) exportFiles(this.exercise.draft && this.exercise.draft.files || this.exercise.starterFiles,this.exercise.id);
      else if (action === 'export-legacy' && this.readOnly && localPracticeHost()) exportLegacyRecovery();
      else if (action === 'run' || action === 'submit') this.run(action);
      else if (action === 'attempt') this.openAttempt(control.dataset.exercise,control.dataset.attempt,control);
      else if (action === 'close-attempt') this.closeAttempt(true);
      else if (action === 'export-attempt' && this.selectedAttempt) exportFiles(this.selectedAttempt.files,'attempt');
      else if (action === 'compare') this.compareConflict();
      else if (action === 'keep-local' && this.serverDraft) { this.draft.resolveConflict(this.serverDraft,true); this.draft.flush(); }
      else if (action === 'use-server' && this.serverDraft && root.confirm('Заменить код в редакторе серверной версией? Текущий код сначала будет скачан.')) { exportFiles(this.draft.snapshot().files,this.exercise.id); this.draft.resolveConflict(this.serverDraft,false); this.syncEditor(); }
      else if (action === 'reset' && root.confirm('Загрузить новую заготовку? Старый код сначала будет скачан.')) { exportFiles(this.draft.snapshot().files,this.exercise.id); if (await this.draft.reset()) { if (this.alive) this.syncEditor(); } }
    }
    async onSubmit(event) {
      const form = event.target.closest('[data-practice-form]'); if (!form || !this.container.contains(form)) return;
      event.preventDefault(); if (form.dataset.busy === 'true') return;
      const kind = form.dataset.practiceForm, status = form.querySelector('.practice-form-status'), submit = form.querySelector('[type="submit"]');
      if (!this.ownerActive() || kind === 'upload' && this.readOnly || (kind === 'assignments' || kind === 'review') && (!this.readOnly || this.options.presentation)) return;
      const fields = new FormData(form); let body, path, method = 'POST';
      const enabledControls = Array.from(form.elements).filter(control=>!control.disabled);
      try {
        if (kind === 'upload') {
          const file = fields.get('homeworkFile'), repositoryUrl = String(fields.get('repositoryUrl') || '').trim();
          const error = validateUpload(file,repositoryUrl); if (error) throw new Error(error);
          body = {filename:file.name,comment:String(fields.get('comment') || '').trim(),repositoryUrl}; path = this.apiBase+'/homework';
        } else if (kind === 'assignments') {
          body = {assignments:(this.catalog.exercises || []).filter(exercise=>fields.get(exercise.id)).map(exercise=>({exerciseId:exercise.id,placement:fields.get(exercise.id)}))}; path = this.apiBase+'/practice/assignments';
        } else if (kind === 'review') {
          body = {status:fields.get('status'),feedback:String(fields.get('feedback') || '').trim()};
          if (!body.feedback) throw new Error('Добавьте обратную связь для ученика.');
          path = this.apiBase+'/homework/'+encodeURIComponent(form.dataset.submission); method = 'PATCH';
        } else return;
        form.dataset.busy = 'true'; for (const control of enabledControls) control.disabled = true;
        status.className = 'practice-form-status'; status.textContent = kind === 'upload'?'Загружаем файл…':'Сохраняем…';
        if (kind === 'upload') body.contentBase64 = await new Promise((resolve,reject)=>{ const reader = new FileReader(); reader.onload = ()=>resolve(String(reader.result).split(',')[1]); reader.onerror = ()=>reject(new Error('Не удалось прочитать файл. Выберите его снова.')); reader.readAsDataURL(fields.get('homeworkFile')); });
        const answer = await this.request(path,{method,body:JSON.stringify(body)}); if (!this.ownerActive()) return;
        if (kind === 'assignments') {
          this.closeAttempt(); this.data = answer; this.query('[data-practice-teacher-tasks]').innerHTML = this.teacherTasks(); status.textContent = 'Назначения сохранены.';
        } else {
          this.data.submissions = [answer.submission,...(this.data.submissions || []).filter(item=>item.id !== answer.submission.id)].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
          if (kind === 'upload') { form.reset(); status.textContent = 'Работа отправлена. Обратная связь появится ниже.'; }
          if (kind === 'review') {
            // Replace only this review: another open feedback form may contain unsaved text.
            const template = root.document.createElement('template'); template.innerHTML = this.submissionsMarkup(true,[answer.submission]);
            const replacement = template.content.querySelector('[data-practice-submission-card]');
            form.closest('[data-practice-submission-card]').replaceWith(replacement);
            const note = root.document.createElement('p'); note.className = 'practice-feedback-saved'; note.setAttribute('role','status'); note.textContent = 'Ревью сохранено.'; replacement.append(note);
          } else this.query('[data-practice-submissions]').innerHTML = this.submissionsMarkup(false);
        }
      } catch (failure) { if (this.alive) { status.textContent = formatError(failure); status.className = 'practice-form-status practice-error'; } }
      finally { form.dataset.busy = 'false'; for (const control of enabledControls) control.disabled = false; submit.disabled = false; }
    }
    dispose({flush = true} = {}) {
      if (!this.alive) return;
      if (flush && this.draft && !this.sessionFrozen) this.draft.flush();
      this.alive = false; ++this.sequence; ++this.attemptSequence; this.abort.abort(); root.clearTimeout(this.saveTimer);
      if (this.unsubscribe) this.unsubscribe(); if (this.unsubscribeAuth) this.unsubscribeAuth();
      if (this.editor) this.editor.dispose(); for (const model of this.models.values()) model.dispose(); this.models.clear();
      this.container.removeEventListener('click',this.click); this.container.removeEventListener('submit',this.submit);
    }
  }
  function mount(container,options) { if (active) active.dispose(); active = new PracticeView(container,options); return active; }
  function dispose({clearAccountCache = false, accountId = null} = {}) {
    const ownerId = clearAccountCache ? accountId : null;
    if (active && (!clearAccountCache || active.accountId === ownerId)) { active.dispose({flush:!clearAccountCache}); active = null; }
    if (clearAccountCache && ownerId) {
      const prefix = encodeURIComponent(ownerId)+'.';
      for (const [key,draft] of drafts) if (key.startsWith(prefix)) { draft.discardRecovery(); drafts.delete(key); }
      logoutLocks.delete(ownerId); logoutPreparations.delete(ownerId);
      if (lastOwnerId === ownerId) lastOwnerId = null;
    }
  }
  function cancelLogout({accountId} = {}) {
    if (!accountId) return;
    logoutLocks.delete(accountId); logoutPreparations.delete(accountId);
    const prefix = encodeURIComponent(accountId)+'.';
    for (const [key,draft] of drafts) if (key.startsWith(prefix)) draft.unlockForLogout();
  }
  function beforeLogout() {
    const session = root.MENTOR_AUTH && root.MENTOR_AUTH.session();
    const ownerId = session && session.account && session.account.id || lastOwnerId;
    if (!ownerId) return Promise.resolve(true);
    if (logoutPreparations.has(ownerId)) return logoutPreparations.get(ownerId);
    logoutLocks.add(ownerId);
    const prefix = encodeURIComponent(ownerId)+'.';
    for (const [key,draft] of drafts) if (key.startsWith(prefix)) draft.lockForLogout();
    const preparation = (async () => {
      try {
        const pending = [...drafts].filter(([key,draft])=>key.startsWith(prefix) && draft.snapshot().dirty);
        if (!pending.length) return true;
        const saved = await Promise.all(pending.map(([,draft])=>draft.flush({allowDuringLogout:true})));
        if (saved.every(Boolean)) return true;
        const choice = root.prompt && root.prompt('Не удалось сохранить весь код на сервере. Введите «скачать», чтобы получить копию и выйти; «выйти без сохранения», чтобы явно отказаться от копии; или «остаться», чтобы отменить выход.', 'остаться');
        if (choice === 'скачать') { for (const [key,draft] of pending) if (draft.snapshot().dirty) exportFiles(draft.snapshot().files,key.split('/').pop().replace(/[^a-zA-Z0-9_-]/g,'_')); return true; }
        if (choice === 'выйти без сохранения') return true;
        cancelLogout({accountId:ownerId}); return false;
      } catch (failure) { cancelLogout({accountId:ownerId}); throw failure; }
    })();
    logoutPreparations.set(ownerId,preparation);
    return preparation;
  }
  const api = {mount,dispose,beforeLogout,cancelLogout};
  if (typeof module !== 'undefined' && module.exports) module.exports = {createDraftSession,getDraftSession,formatError,validateUpload,allowedFiles,resultMarkup,...api};
  else {
    root.MENTOR_PRACTICE = api;
    root.addEventListener('beforeunload',event=>{
      for (const draft of drafts.values()) if (draft.snapshot().dirty) {
        draft.flush();
        if (!draft.snapshot().localSaved) { event.preventDefault(); event.returnValue = ''; }
      }
    });
    root.addEventListener('pagehide',()=>{ for (const draft of drafts.values()) draft.flush(); });
    root.addEventListener('storage',event=>{
      if (active && active.draft && (!event.key || event.key.startsWith('mentor.practice.draft.'))) active.updateDraftStatus();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);

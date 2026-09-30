'use strict';
(function(){
 const main=document.getElementById('main');
 const listeners=new Set();
 let current=null,started=false,requestVersion=0,pendingNext=null,inviteToken=null,resetToken=null,busy=false,logoutOperation=null;
 let channel=null;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const error=(message,status,code)=>Object.assign(new Error(message),{status,code});
 const isRoute=hash=>/^#students(?:\/[a-zA-Z0-9_%~-]+)*$/.test(hash||'');
 const home=()=>current?.account.role==='student'&&current.account.studentId?'#students/'+encodeURIComponent(current.account.studentId):'#students';
 function routeSecret(){
  const match=/^#(register|reset-password)\/([^/?#]+)$/.exec(location.hash||'');
  if(!match)return;
  let token;try{token=decodeURIComponent(match[2])}catch{token=''}
  if(match[1]==='register')inviteToken=token;else resetToken=token;
  // One-time tokens must not remain in history, screenshots of the URL, or future referrers.
  history.replaceState(null,'',location.pathname+location.search+'#'+match[1]);
 }
 function update(value,broadcast=false,preserveRoute=true){
  const next=value?.account&&value.csrfToken?{account:value.account,csrfToken:value.csrfToken}:null;
  if(current?.account.id===next?.account.id&&current?.csrfToken===next?.csrfToken)return;
  if(current&&!next){
   if(preserveRoute&&isRoute(location.hash))pendingNext=location.hash;
   else if(!preserveRoute)pendingNext=null;
  }
  current=next;requestVersion++;
  for(const listener of [...listeners])listener(current);
  if(broadcast)channel?.postMessage({type:'session-changed'});
 }
 async function request(path,options={}){
  const {expectedAccountId,...fetchOptions}=options;
  const owner=current?.account.id||null,csrf=current?.csrfToken||null,version=requestVersion;
  if(expectedAccountId!==undefined&&expectedAccountId!==owner)throw error('Аккаунт изменился. Сохранение приостановлено.',409,'ACCOUNT_CHANGED');
  const supplied=fetchOptions.headers;
  const existing=typeof Headers==='function'&&supplied instanceof Headers?Object.fromEntries(supplied.entries()):Array.isArray(supplied)?Object.fromEntries(supplied):supplied||{};
  const headers={...(fetchOptions.body&&typeof fetchOptions.body==='string'?{'Content-Type':'application/json'}:{}),...existing,'X-Mentor-Client':'web'};
  if(owner)headers['X-Mentor-Account']=expectedAccountId||owner;
  if(current?.csrfToken)headers['X-CSRF-Token']=current.csrfToken;
  const response=await fetch(path,{...fetchOptions,headers,credentials:'same-origin',cache:'no-store'});
  let data=null;
  if(response.status!==204){try{data=await response.json()}catch{throw error('Сервер вернул некорректный ответ.',response.status||502,'INVALID_RESPONSE')}}
  if(version!==requestVersion)throw error('Аккаунт изменился. Повторите действие в текущем кабинете.',409,'ACCOUNT_CHANGED');
  if(!response.ok){
   const failure=error(data?.error||'Не удалось выполнить запрос.',response.status,data?.code||'REQUEST_FAILED');
   if(response.status===401&&failure.code!=='INVALID_CREDENTIALS'&&path!=='/api/auth/login')update(null);
   if(response.status===409&&failure.code==='ACCOUNT_CHANGED')update(null);
   throw failure;
  }
  if(owner&&(current?.account.id!==owner||current?.csrfToken!==csrf))throw error('Аккаунт изменился. Повторите действие в текущем кабинете.',409,'ACCOUNT_CHANGED');
  return data;
 }
 async function refresh(){
  const version=requestVersion;
  const data=await request('/api/auth/me');
  if(version===requestVersion)update(data);
  if(!current)render();
  return current;
 }
 function field(label,name,type,autocomplete){return `<label class="auth-field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" required ${type==='password'?'minlength="1"':''}></label>`}
 function password(label,name,autocomplete){return `<div class="auth-password">${field(label,name,'password',autocomplete)}<button type="button" data-auth-toggle aria-label="Показать пароль">Показать</button></div>`}
 function authCard(title,description,form,links=''){
  document.body.classList.toggle('auth-screen',true);
  main.innerHTML=`<section class="auth-layout"><div class="auth-card"><p class="eyebrow">КАБИНЕТ НАСТАВНИКА</p><h1>${title}</h1><p class="auth-description">${description}</p>${form}${links}</div></section>`;
  main.focus?.({preventScroll:true});
 }
 function render(){
  routeSecret();
  const hash=location.hash||'';
  if(hash==='#account'&&current){return showPasswordForm(false)}
  if(current)return;
  if(isRoute(hash))pendingNext=hash;
  if(hash==='#register'){
   authCard('Регистрация','Создайте аккаунт по приглашению преподавателя.',`<form data-auth-form="register">${field('Логин','login','text','username')}${password('Пароль','password','new-password')}<p class="auth-error" role="alert" aria-live="polite" hidden></p><button class="btn primary" type="submit">Создать аккаунт</button></form>`,`<p class="auth-links"><a href="#login">Уже есть аккаунт? Войти</a></p>`);return;
  }
  if(hash==='#reset-password'){
   authCard('Новый пароль','Введите новый пароль по полученной ссылке.',`<form data-auth-form="reset-password">${password('Новый пароль','newPassword','new-password')}<p class="auth-error" role="alert" aria-live="polite" hidden></p><button class="btn primary" type="submit">Сохранить пароль</button></form>`,`<p class="auth-links"><a href="#login">Вернуться ко входу</a></p>`);return;
  }
  authCard('Вход','Введите логин и пароль, чтобы открыть свой кабинет.',`<form data-auth-form="login">${field('Логин','login','text','username')}${password('Пароль','password','current-password')}<p class="auth-error" role="alert" aria-live="polite" hidden></p><button class="btn primary" type="submit">Войти</button></form>`);
 }
 function showLogin(){location.hash='#login';render()}
 function showPasswordForm(changeHash=true){
  if(!current){showLogin();return}
  if(changeHash)location.hash='#account';
  authCard('Смена пароля','Укажите текущий пароль и придумайте новый.',`<form data-auth-form="change-password">${password('Текущий пароль','currentPassword','current-password')}${password('Новый пароль','newPassword','new-password')}<p class="auth-error" role="alert" aria-live="polite" hidden></p><button class="btn primary" type="submit">Сменить пароль</button></form>`,`<p class="auth-links"><a href="${home()}">Вернуться в кабинет</a></p>`);
 }
 async function submit(event){
  const form=event.target;
  if(!form?.matches?.('form[data-auth-form]'))return;
  event.preventDefault();if(busy||!form.reportValidity?.())return;
  const mode=form.dataset.authForm,values=Object.fromEntries(new FormData(form));
  const alert=form.querySelector('[role="alert"]');
  busy=true;for(const button of form.querySelectorAll('button[type="submit"]'))button.disabled=true;
  try{
   if(mode==='register'&&!inviteToken)throw error('Ссылка на приглашение недействительна или срок её действия истёк.',400,'INVALID_TOKEN');
   if(mode==='reset-password'&&!resetToken)throw error('Ссылка на восстановление недействительна или срок её действия истёк.',400,'INVALID_TOKEN');
   let result;
   if(mode==='login')result=await request('/api/auth/login',{method:'POST',body:JSON.stringify(values)});
   else if(mode==='register')result=await request('/api/auth/register',{method:'POST',body:JSON.stringify({...values,token:inviteToken})});
   else if(mode==='reset-password')await request('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetToken,newPassword:values.newPassword})});
   else if(mode==='change-password')result=await request('/api/auth/change-password',{method:'POST',body:JSON.stringify(values),expectedAccountId:current?.account.id});
   else return;
   if(mode==='reset-password'){resetToken=null;showLogin();return}
   inviteToken=null;update(result,true);
   const next=mode==='change-password'?home():pendingNext&&isRoute(pendingNext)?pendingNext:home();
   pendingNext=null;location.hash=next;
  }catch(failure){
   if(alert){alert.textContent=failure.code==='INVALID_TOKEN'?'Ссылка недействительна или срок её действия истёк. Попросите новую ссылку.':failure.message;alert.hidden=false}
  }finally{busy=false;for(const button of form.querySelectorAll('button[type="submit"]'))button.disabled=false}
 }
 async function runLogout(owner,version){
  const practice=window.MENTOR_PRACTICE;
  try{
   const canLeave=practice?.beforeLogout?await practice.beforeLogout():true;
   if(version!==requestVersion||current?.account.id!==owner)throw error('Аккаунт изменился. Повторите действие в текущем кабинете.',409,'ACCOUNT_CHANGED');
   if(!canLeave){practice?.cancelLogout?.({accountId:owner});return false}
   await request('/api/auth/logout',{method:'POST',body:'{}',expectedAccountId:owner});
   if(version!==requestVersion||current?.account.id!==owner)throw error('Аккаунт изменился. Повторите действие в текущем кабинете.',409,'ACCOUNT_CHANGED');
  }catch(failure){practice?.cancelLogout?.({accountId:owner});throw failure}
  practice?.dispose?.({clearAccountCache:true,accountId:owner});
  update(null,true,false);showLogin();return true;
 }
 function logout(){
  if(!current)return Promise.resolve(true);
  const owner=current.account.id,version=requestVersion;
  if(logoutOperation?.owner===owner&&logoutOperation.version===version)return logoutOperation.promise;
  const operation={owner,version,promise:null};logoutOperation=operation;
  operation.promise=Promise.resolve().then(()=>runLogout(owner,version));
  const clear=()=>{if(logoutOperation===operation)logoutOperation=null};
  operation.promise.then(clear,clear);
  return operation.promise;
 }
 async function start(){
  if(started)return current;
  started=true;routeSecret();
  document.addEventListener('submit',submit);
  document.addEventListener('click',event=>{
   const toggle=event.target.closest?.('[data-auth-toggle]');
   if(toggle){const input=toggle.parentElement?.querySelector('input');if(input){input.type=input.type==='password'?'text':'password';toggle.textContent=input.type==='password'?'Показать':'Скрыть';toggle.setAttribute('aria-label',toggle.textContent+' пароль')}return}
   const action=event.target.closest?.('[data-auth-action]')?.dataset.authAction;
   if(action==='logout')logout().catch(failure=>{const alert=document.querySelector('.auth-action-error');if(alert)alert.textContent=failure.message});
   if(action==='password')showPasswordForm();
   if(action==='retry')refresh().catch(()=>{});
  });
  window.addEventListener('hashchange',render);
  window.addEventListener('focus',()=>refresh().catch(()=>{}));
  if(typeof window.BroadcastChannel==='function'){
   channel=new window.BroadcastChannel('mentor-session');
   channel.onmessage=()=>refresh().catch(()=>{});
  }
  try{await refresh()}catch(failure){main.innerHTML=`<div class="auth-layout"><div class="auth-card"><h1>Не удалось открыть кабинет</h1><p>${escape(failure.message)}</p><button class="btn" data-auth-action="retry">Повторить</button></div></div>`}
  return current;
 }
 function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}
 window.MENTOR_AUTH={start,session:()=>current,request,subscribe,logout,showLogin,showPasswordForm,refresh};
})();

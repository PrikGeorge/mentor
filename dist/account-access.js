(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function copyAccessLink(clipboard,url){try{if(!clipboard?.writeText)return false;await clipboard.writeText(url);return true;}catch{return false;}}
 function deadline(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(date);}
 function createAccessController({studentId,auth,onChange=()=>{}}){
  const account=auth.session()?.account,owner=account?.role==='teacher'?account.id:null;
  const base='/api/students/'+encodeURIComponent(studentId),abort=new AbortController();
  let disposed=false,state={busy:false,error:'',data:null,link:null};
  const snapshot=()=>structuredClone(state);
  function update(values){if(disposed)return;state={...state,...values};onChange(snapshot());}
  async function request(url,options={}){return auth.request(url,{...options,expectedAccountId:owner,signal:abort.signal});}
  async function run(action){
   if(disposed||!owner||state.busy)return false;
   update({busy:true,error:''});
   try{await action();return !disposed;}
   catch(error){if(!disposed)update({error:error.message||'Не удалось изменить доступ. Попробуйте ещё раз.'});return false;}
   finally{if(!disposed)update({busy:false});}
  }
  async function refresh(){const data=await request(base+'/access');update({data});}
  return {
   snapshot,
   load:()=>run(async()=>{update({link:null});await refresh();}),
   invite:()=>run(async()=>{if(!state.data||state.data.account)return;const link=await request(base+'/invitations',{method:'POST',body:'{}'});if(disposed)return;update({link:{...link,kind:'invite'}});await refresh();}),
   revoke:()=>run(async()=>{const id=state.data?.invitation?.id;if(!id)return;await request(base+'/invitations/'+encodeURIComponent(id)+'/revoke',{method:'POST',body:'{}'});if(disposed)return;update({link:null});await refresh();}),
   setDisabled:disabled=>run(async()=>{if(!state.data?.account)return;const data=await request(base+'/access',{method:'PATCH',body:JSON.stringify({disabled})});update({data,link:null});}),
   resetPassword:currentPassword=>run(async()=>{if(!state.data?.account)return;const link=await request(base+'/password-reset',{method:'POST',body:JSON.stringify({currentPassword})});update({link:{...link,kind:'reset'}});}),
   dispose(){disposed=true;abort.abort();state={busy:false,error:'',data:null,link:null};},
  };
 }
 function renderAccess(state){
  const {data,busy,error,link}=state,disabled=busy?' disabled':'';
  let content='';
  if(!data)content='<p class="subtitle">'+(busy?'Загружаем доступ…':'Данные доступа пока недоступны.')+'</p>';
  else if(data.account){
   const a=data.account;content=`<p>Логин: <strong>${escape(a.login)}</strong> · ${a.disabled?'Доступ приостановлен':'Доступ открыт'}</p><div class="doc-tools"><button class="btn" type="button" data-access="${a.disabled?'enable':'disable'}"${disabled}>${a.disabled?'Восстановить доступ':'Приостановить доступ'}</button><button class="btn" type="button" data-access="reset"${disabled}>Ссылка для смены пароля</button></div>`;
  }else{
   content=data.invitation?`<p>Приглашение действует до ${escape(deadline(data.invitation.expiresAt))}.</p><div class="doc-tools"><button class="btn" type="button" data-access="invite"${disabled}>Создать новое приглашение</button><button class="btn" type="button" data-access="revoke"${disabled}>Отозвать</button></div>`:`<p class="subtitle">Ученик создаст логин и пароль по вашей ссылке. Его занятия и работы сохранятся.</p><button class="btn primary" type="button" data-access="invite"${disabled}>Создать приглашение</button>`;
  }
  if(link)content+=`<div class="callout"><label class="form-field"><span>${link.kind==='reset'?'Ссылка для смены пароля':'Приглашение ученика'}</span><input data-access-link type="text" readonly value="${escape(link.url)}" aria-label="Одноразовая ссылка"></label><div class="doc-tools"><button class="btn" type="button" data-access="copy"${disabled}>Копировать ссылку</button></div><p class="subtitle">До ${escape(deadline(link.expiresAt))}. Передайте ученику лично. После ухода с этой страницы ссылка скрывается.</p><p data-copy-status role="status" aria-live="polite"></p></div>`;
  return `<section class="panel account-access"><p class="eyebrow">АККАУНТ УЧЕНИКА</p><h2>Доступ к кабинету</h2>${content}<p class="form-error" role="alert"${error?'':' hidden'}>${escape(error)}</p>${!data&&!busy?'<button class="btn" type="button" data-access="reload">Повторить</button>':''}<div data-reset-form></div></section>`;
 }
 let active=null;
 function mount(container,{studentId,auth}){
  dispose();if(auth.session()?.account.role!=='teacher'){container.innerHTML='';return null;}
  let live=true,resetOpen=false;const controller=createAccessController({studentId,auth,onChange:render});
  function render(state){
   if(!live)return;container.innerHTML=renderAccess(state);
   if(resetOpen&&state.data?.account){const area=container.querySelector('[data-reset-form]');area.innerHTML=`<form class="account-reset-form"><label class="form-field"><span>Ваш текущий пароль</span><input type="password" name="currentPassword" autocomplete="current-password" required${state.busy?' disabled':''}></label><div class="doc-tools"><button class="btn primary" type="submit"${state.busy?' disabled':''}>Создать ссылку</button><button class="btn" type="button" data-access="cancel-reset"${state.busy?' disabled':''}>Отмена</button></div></form>`;}
  }
  async function click(event){
   const button=event.target.closest('[data-access]');if(!button||!container.contains(button)||button.disabled)return;
   const action=button.dataset.access;
   if(action==='invite'){resetOpen=false;await controller.invite();}
   else if(action==='revoke')await controller.revoke();
   else if(action==='enable'||action==='disable'){resetOpen=false;await controller.setDisabled(action==='disable');}
   else if(action==='reload')await controller.load();
   else if(action==='reset'||action==='cancel-reset'){resetOpen=action==='reset';render(controller.snapshot());if(resetOpen)container.querySelector('[name=currentPassword]').focus();}
   else if(action==='copy'){
    const url=controller.snapshot().link?.url;if(!url)return;const copied=await copyAccessLink(root.navigator?.clipboard,url);
    if(!live||controller.snapshot().link?.url!==url)return;const status=container.querySelector('[data-copy-status]');if(!status)return;
    if(copied)status.textContent='Ссылка скопирована.';
    else{const input=container.querySelector('[data-access-link]');input?.focus();input?.select();status.textContent='Не удалось скопировать автоматически. Ссылка выделена: нажмите Ctrl+C или скопируйте её вручную.';}
   }
  }
  async function submit(event){
   if(!event.target.matches('.account-reset-form'))return;event.preventDefault();
   if(controller.snapshot().busy||!event.target.reportValidity())return;
   const input=event.target.elements.currentPassword,password=input.value;input.value='';resetOpen=false;
   await controller.resetPassword(password);
  }
  container.addEventListener('click',click);container.addEventListener('submit',submit);
  active={dispose(){live=false;controller.dispose();container.removeEventListener('click',click);container.removeEventListener('submit',submit);container.innerHTML='';}};
  render(controller.snapshot());controller.load();return active;
 }
 function dispose(){if(active){active.dispose();active=null;}}
 const api={mount,dispose,createAccessController,renderAccess,copyAccessLink};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MENTOR_ACCOUNT_ACCESS=api;
})(typeof window!=='undefined'?window:globalThis);

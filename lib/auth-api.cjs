'use strict';
const { timingSafeEqual } = require('node:crypto');
const BODY_LIMIT=16*1024;
function fail(message,status=400,code='INVALID_INPUT') { throw Object.assign(new Error(message),{status,code}); }
function cookieName(production) { return production?'__Host-mentor_session':'mentor_session'; }
function resolveAuth(request,auth,production=process.env.NODE_ENV==='production') {
  const name=cookieName(production);
  const values=(request.headers.cookie||'').split(';').map(item=>item.trim()).filter(item=>item.startsWith(`${name}=`));
  if(values.length!==1)return null;
  const token=values[0].slice(name.length+1);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  return auth.session(token);
}
function sessionToken(request,production) { const name=cookieName(production);return (request.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1); }
function requireMutation(request,session) {
  if(!session)fail('Войдите в аккаунт.',401,'UNAUTHORIZED');
  if(request.headers['x-mentor-account']!==session.principal.id)fail('Аккаунт изменился. Сохранение приостановлено.',409,'ACCOUNT_CHANGED');
  const supplied=request.headers['x-csrf-token'];
  if(typeof supplied!=='string'||typeof session.csrfToken!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(session.csrfToken)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(session.csrfToken)))fail('Не удалось подтвердить запрос.',403,'FORBIDDEN');
}
function readJson(request) {
  if(Number(request.headers['content-length'])>BODY_LIMIT){request.resume();fail('Запрос слишком большой.',413);}
  return new Promise((resolve,reject)=>{
    let size=0,failed=false;const chunks=[];
    request.on('data',chunk=>{size+=chunk.length;if(failed)return;if(size>BODY_LIMIT){failed=true;chunks.length=0;reject(Object.assign(new Error('Запрос слишком большой.'),{status:413,code:'INVALID_INPUT'}));}else chunks.push(chunk);});
    request.on('end',()=>{if(failed)return;try { const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!input||typeof input!=='object'||Array.isArray(input))fail('Передайте объект JSON.');resolve(input); }catch(e){reject(e.status?e:Object.assign(new Error('Некорректный JSON.'),{status:400,code:'INVALID_INPUT'}));}});
    request.on('aborted',()=>reject(Object.assign(new Error('Запрос прерван.'),{status:400,code:'INVALID_INPUT'})));
    request.on('error',()=>reject(Object.assign(new Error('Не удалось прочитать запрос.'),{status:400,code:'INVALID_INPUT'})));
  });
}
function fields(input,allowed) { if(Object.keys(input).some(key=>!allowed.includes(key)))fail('В запросе есть недопустимое поле.'); }
function send(response,status,value) {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(value===undefined?undefined:JSON.stringify(value));}
function setCookie(response,token,production,clear=false) {response.setHeader('Set-Cookie',`${cookieName(production)}=${clear?'':token}; Path=/; HttpOnly; SameSite=Lax${production?'; Secure':''}${clear?'; Max-Age=0':''}`);}
function createAuthApi({auth,security,originFor,production=process.env.NODE_ENV==='production'}) {
  return async function handle(request,response,pathname) {
    const authRoute=pathname.startsWith('/api/auth/');
    const student=pathname.match(/^\/api\/students\/([a-zA-Z0-9_-]+)\/(access|invitations|password-reset)(?:\/([a-zA-Z0-9_-]+)\/revoke)?$/);
    if(!authRoute&&!student)return false;
    const writing=!['GET','HEAD'].includes(request.method);
    security.check(request,request.socket.server,writing);
    security.limit(request,'other');
    const session=resolveAuth(request,auth,production);
    if(pathname==='/api/auth/me'&&request.method==='GET') {send(response,200,{account:session?publicAccount(session.principal):null,csrfToken:session?.csrfToken||null});return true;}
    if(student) {
      if(!session)fail('Войдите в аккаунт.',401,'UNAUTHORIZED');
      if(session.principal.role!=='teacher')fail('Доступ разрешён преподавателю.',403,'FORBIDDEN');
      auth.assertActive(session.principal);
      if(writing)requireMutation(request,session);
      const [,sid,kind,id]=student;
      if(kind==='access'&&!id&&request.method==='GET')send(response,200,auth.access(session.principal,sid));
      else if(kind==='access'&&!id&&request.method==='PATCH'){const input=await readJson(request);fields(input,['disabled']);if(typeof input.disabled!=='boolean')fail('Передайте disabled: boolean.');send(response,200,auth.setDisabled(session.principal,sid,input.disabled));}
      else if(kind==='invitations'&&request.method==='POST'){const input=await readJson(request);fields(input,[]);if(id){auth.revokeInvite(session.principal,sid,id);send(response,204);}else{const result=auth.invite(session.principal,sid);send(response,201,{id:result.id,url:`${originFor(request)}/#register/${result.token}`,expiresAt:result.expiresAt});}}
      else if(kind==='password-reset'&&!id&&request.method==='POST'){const input=await readJson(request);fields(input,['currentPassword']);const result=await auth.issueReset(session.principal,sid,input.currentPassword);send(response,201,{url:`${originFor(request)}/#reset-password/${result.token}`,expiresAt:result.expiresAt});}
      else fail('Этот способ запроса не поддерживается.',405,'INVALID_INPUT');
      return true;
    }
    if(request.method!=='POST')fail('Этот способ запроса не поддерживается.',405);
    if(!['/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/change-password','/api/auth/reset-password'].includes(pathname))fail('Раздел не найден.',404);
    const action=pathname.split('/').at(-1);
    if((action==='login'||action==='register')&&session)fail('Сначала выйдите из текущего аккаунта.',409,'ALREADY_AUTHENTICATED');
    if(action==='logout'||action==='change-password'||session)requireMutation(request,session);
    const input=await readJson(request);
    security.limit(request,action==='login'?'login':action==='register'?'register':action==='reset-password'?'reset':'other',action==='login'?input.login:undefined);
    if(action==='login'||action==='register') {
      fields(input,action==='login'?['login','password']:['token','login','password']);
      let result;
      try{result=await auth[action](input);}catch(e){if(action==='login'&&(e.code==='INVALID_CREDENTIALS'||e.status===401))fail('Неверный логин или пароль.',401,'INVALID_CREDENTIALS');throw e;}
      setCookie(response,result.token,production);send(response,action==='login'?200:201,{account:result.account,csrfToken:result.csrfToken});
    }else if(action==='logout'){fields(input,[]);auth.logout(sessionToken(request,production));setCookie(response,'',production,true);send(response,204);}
    else if(action==='change-password'){fields(input,['currentPassword','newPassword']);const result=await auth.changePassword(session.principal,input);setCookie(response,result.token,production);send(response,200,{account:result.account,csrfToken:result.csrfToken});}
    else{fields(input,['token','newPassword']);await auth.resetPassword(input);send(response,204);}
    return true;
  };
}
function publicAccount(principal) { return {id:principal.id,login:principal.login,role:principal.role,studentId:principal.studentId}; }
module.exports={createAuthApi,resolveAuth,requireMutation};

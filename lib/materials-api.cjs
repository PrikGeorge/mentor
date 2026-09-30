'use strict';
const fs=require('node:fs'),path=require('node:path');
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const PUBLIC_ASSETS=new Set(['index.html','style.css','portal.css','task-code.css','practice.css','auth.css','lesson-editor.css','app.js','portal-model.js','student-cabinet.js','document-navigation.js','practice.js','portal.js','auth.js','account-access.js','lesson-markdown.js','lesson-editor.js','vendor/markdown-it/markdown-it.min.js']);
function safeRelative(file){return typeof file==='string'&&file.length>0&&!/[\\\0:%]/.test(file)&&!file.startsWith('/')&&file.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');}
function contained(root,file){const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
// Return only a canonical, contained public file; caller serves it or returns 404.
// Legacy private files never enter this allowlist, even if left in staticRoot.
async function publicStaticFile(staticRoot,pathname){
 if(typeof pathname!=='string'||!pathname.startsWith('/')||/[\\\0%?#]/.test(pathname))return null;
 const name=pathname==='/'?'index.html':pathname.slice(1);
 const vendor=/^vendor\/monaco\/(?:[a-zA-Z0-9_@+-]+\/)*[a-zA-Z0-9_@+.-]+\.(?:js|css|json|woff2?|ttf|svg|png)$/.test(name)&&safeRelative(name);
 if(!PUBLIC_ASSETS.has(name)&&!vendor)return null;
 try{
  const realRoot=await fs.promises.realpath(staticRoot),file=await fs.promises.realpath(path.join(staticRoot,name));
  if(!contained(realRoot,file)||file!==path.join(realRoot,name)||!(await fs.promises.stat(file)).isFile())return null;
  if(vendor){const vendorRoot=await fs.promises.realpath(path.join(staticRoot,'vendor/monaco'));if(!contained(realRoot,vendorRoot)||!contained(vendorRoot,file))return null;}
  return file;
 }catch{return null;}
}
function createMaterialsApi({root,materialsDir,store,access}={}){
 const materialsRoot=path.resolve(materialsDir||path.join(root||path.join(__dirname,'..'),'private/materials'));
 const realRoot=fs.realpathSync(materialsRoot);
 function readConfig(name){const file=fs.realpathSync(path.join(materialsRoot,name));if(!contained(realRoot,file))throw new Error('Invalid materials manifest path');return JSON.parse(fs.readFileSync(file,'utf8'));}
 const manifest=readConfig('manifest.json');
 if(manifest.version!==1||manifest.snapshot!=='content.json'||!Array.isArray(manifest.materials))throw new Error('Invalid materials manifest');
 const records=new Map();
 for(const record of manifest.materials){
  if(!record||!ID.test(record.id)||records.has(record.id)||!safeRelative(record.file)||!ID.test(record.studentId)||!['student','teacher'].includes(record.audience)||!['doc','code','view','download'].includes(record.kind)||typeof record.filename!=='string'||/[\r\n\0\\/]/.test(record.filename)||typeof record.contentType!=='string'||/[\r\n]/.test(record.contentType))throw new Error('Invalid materials manifest path or record');
  if(record.lessonId!==undefined&&(!ID.test(record.lessonId)||!ID.test(record.bundleId)))throw new Error('Invalid materials manifest lesson');
  if(record.kind!=='download'&&record.file!=='content.json')throw new Error('Invalid materials manifest snapshot');
  records.set(record.id,Object.freeze({...record}));
 }
 const snapshot=readConfig('content.json');
 if(!snapshot||!snapshot.docs||!snapshot.code||!snapshot.viewData)throw new Error('Invalid private content snapshot');
 function stateFor(principal){
  if(!principal)fail(401,'AUTH_REQUIRED','Войдите в кабинет.');
  access?.assertActive?.(principal);
  if(!['teacher','student'].includes(principal.role))fail(403,'FORBIDDEN','Недостаточно прав.');
  const state=store.getState();
  if(principal.role==='student'&&!state.students.some(student=>student.id===principal.studentId))fail(404,'NOT_FOUND','Ученик не найден.');
  return state;
 }
 function allowed(principal,record,state){
  if(principal.role==='teacher')return true;
  if(!state.students.some(student=>student.id===record.studentId))return false;
  if(principal.role==='student'&&(record.audience==='teacher'||record.studentId!==principal.studentId))return false;
  if(record.lessonId&&!state.lessons.some(lesson=>lesson.id===record.lessonId&&lesson.studentId===record.studentId&&lesson.bundleId===record.bundleId&&lesson.status==='prepared'))return false;
  return true;
 }
 function contentFor(principal){
  const state=stateFor(principal),result={docs:{},code:{},viewData:{}};
  for(const record of records.values()){
   if(!allowed(principal,record,state))continue;
   if(record.kind==='doc'&&Object.hasOwn(snapshot.docs,record.key))result.docs[record.key]=structuredClone(snapshot.docs[record.key]);
   if(record.kind==='code'&&Object.hasOwn(snapshot.code,record.key)){
    const code=snapshot.code[record.key];if(principal.role==='student'&&code.teacher)continue;
    result.code[record.key]=structuredClone(code);
   }
   if(record.kind==='view'){
    const view=snapshot.viewData.students?.[record.key];
    if(view){if(principal.role==='teacher'){(result.viewData.students||={})[record.key]=structuredClone(view);}else Object.assign(result.viewData,structuredClone(view));}
   }
  }
  if(principal.role==='teacher')result.viewData.teacher=structuredClone(snapshot.viewData.teacher||{});
  // Private metadata belongs to authorized content, never an empty new cabinet.
  if(Object.keys(result.docs).length||Object.keys(result.code).length){if(snapshot.sha)result.sha=snapshot.sha;}
  if(principal.role==='student'){
   delete result.viewData.teacher;
   if(Object.keys(result.docs).length){
    result.viewData.descriptors=Object.fromEntries(Object.entries(snapshot.viewData.teacher?.descriptors||{}).filter(([key])=>Object.hasOwn(result.docs,key)).map(([key,value])=>[key,structuredClone(value)]));
    result.viewData.resources=(snapshot.viewData.teacher?.resources||[]).filter(resource=>Object.hasOwn(result.docs,resource[0])).map(resource=>structuredClone(resource));
   }
  }
  return result;
 }
 async function handle(request,response,pathname,principal){
  if(pathname!=='/api/content'&&!pathname.startsWith('/api/materials/'))return false;
  const state=stateFor(principal);
  if(!['GET','HEAD'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED','Этот способ запроса не поддерживается.');
  if(pathname==='/api/content'){
   const data=Buffer.from(JSON.stringify(contentFor(principal)));response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?null:data);return true;
  }
  const id=pathname.slice('/api/materials/'.length),record=ID.test(id)?records.get(id):null;
  if(!record||record.kind!=='download'||!allowed(principal,record,state))fail(404,'NOT_FOUND','Материал не найден.');
  let file,info;
  try{file=await fs.promises.realpath(path.join(materialsRoot,record.file));if(!contained(realRoot,file))fail(404,'NOT_FOUND','Материал не найден.');info=await fs.promises.stat(file);if(!info.isFile())fail(404,'NOT_FOUND','Материал не найден.');}catch{fail(404,'NOT_FOUND','Материал не найден.');}
  const data=request.method==='HEAD'?null:await fs.promises.readFile(file);
  // Recheck after asynchronous filesystem work: revocation cannot leak a response.
  const currentState=stateFor(principal);if(!allowed(principal,record,currentState))fail(404,'NOT_FOUND','Материал не найден.');
  const filename=record.filename.replace(/[^a-zA-Z0-9._-]/g,'_');
  response.writeHead(200,{'Content-Type':record.contentType,'Content-Length':info.size,'Content-Disposition':`attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(record.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(data);return true;
 }
 return {contentFor,handle};
}
module.exports={createMaterialsApi,publicStaticFile,PUBLIC_ASSETS};

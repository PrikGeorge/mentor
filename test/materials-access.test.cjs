'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const modulePath=path.join(__dirname,'../lib/materials-api.cjs');
test('prepared review belongs only to the explicit lesson and is revoked with that assignment',()=>{
 const root=path.join(__dirname,'..');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'private/materials/manifest.json'),'utf8'));
 const record=manifest.materials.find(material=>material.id==='doc-student-review');
 assert.equal(record.studentId,'michael');assert.equal(record.lessonId,'lesson-2026-09-27');assert.equal(record.bundleId,'library-2026-09-27');
 const snapshot=JSON.parse(fs.readFileSync(path.join(root,'private/materials/content.json'),'utf8'));
 const review=snapshot.docs['student-review'];
 assert.equal(review.studentId,'michael');assert.equal(review.lessonId,'lesson-2026-09-27');assert.equal(review.bundleId,'library-2026-09-27');
 const lesson={id:'lesson-2026-09-27',studentId:'michael',bundleId:'library-2026-09-27',status:'prepared'};
 const state={students:[{id:'michael'},{id:'another'}],lessons:[lesson,{...lesson,id:'other-lesson'}]};
 const api=require(modulePath).createMaterialsApi({root,store:{getState:()=>structuredClone(state)}});
 const principal={id:'account-michael',role:'student',studentId:'michael'};
 assert.equal(api.contentFor(principal).docs['student-review'].lessonId,'lesson-2026-09-27');
 assert.equal(api.contentFor({id:'other-account',role:'student',studentId:'another'}).docs['student-review'],undefined);
 for(const patch of [{bundleId:null},{bundleId:'wrong-bundle'},{studentId:'another'},{status:'planned'}]){
  state.lessons[0]={...lesson,...patch};assert.equal(api.contentFor(principal).docs['student-review'],undefined);
 }
 state.lessons=state.lessons.slice(1);
 assert.equal(api.contentFor(principal).docs['student-review'],undefined,'another lesson with the same bundle cannot grant this review');
 assert.equal(api.contentFor({id:'teacher',role:'teacher'}).docs['student-review'].lessonId,'lesson-2026-09-27');
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-materials-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'private/materials');fs.mkdirSync(dir,{recursive:true});
 const state={students:[{id:'a'},{id:'b'},{id:'new'}],lessons:[{id:'la',studentId:'a',bundleId:'bundle',status:'prepared'},{id:'lb',studentId:'b',bundleId:'bundle',status:'prepared'}]};
 const snapshot={docs:{a:{html:'A_PRIVATE'},b:{html:'B_PRIVATE'},guide:{html:'TEACHER_PRIVATE'}},code:{Starter:{text:'STARTER',teacher:false},Solution:{text:'SOLUTION',teacher:true}},viewData:{teacher:{reviewHtml:'TEACHER_REVIEW'},students:{a:{goalHtml:'A_GOAL'},b:{goalHtml:'B_GOAL'}}},sha:'private-sha'};
 fs.writeFileSync(path.join(dir,'content.json'),JSON.stringify(snapshot));
 fs.writeFileSync(path.join(dir,'student.zip'),'A_ZIP_PRIVATE');fs.writeFileSync(path.join(dir,'teacher.java'),'TEACHER_BYTES');
 const material=(id,kind,key,studentId,audience='student',extra={})=>({id,kind,key,studentId,audience,file:'content.json',contentType:'application/json',filename:'content.json',...extra});
 const materials=[material('doc-a','doc','a','a'),material('doc-b','doc','b','b'),material('doc-guide','doc','guide','a','teacher'),material('starter','code','Starter','a','student',{lessonId:'la',bundleId:'bundle'}),material('solution','code','Solution','a','teacher',{lessonId:'la',bundleId:'bundle'}),material('view-a','view','a','a'),material('view-b','view','b','b'),material('student-zip','download',null,'a','student',{file:'student.zip',lessonId:'la',bundleId:'bundle',filename:'student.zip',contentType:'application/zip'}),material('teacher-code','download',null,'a','teacher',{file:'teacher.java',filename:'Solution.java',contentType:'text/plain'})];
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:1,snapshot:'content.json',materials}));
 const principals={teacher:{id:'t',role:'teacher',studentId:null},a:{id:'aa',role:'student',studentId:'a'},b:{id:'bb',role:'student',studentId:'b'},new:{id:'nn',role:'student',studentId:'new'}};
 return {root,dir,state,principals,api(){assert.ok(fs.existsSync(modulePath),'private materials module must exist');return require(modulePath).createMaterialsApi({root,store:{getState:()=>structuredClone(state)},access:{assertActive(principal){if(!principal)throw Object.assign(new Error('session'),{status:401});}}});}};
}
test('materials snapshot filters documents, starter code, and view data for four principals',t=>{
 const f=fixture(t),api=f.api();
 assert.throws(()=>api.contentFor(null),{status:401});
 const a=api.contentFor(f.principals.a),b=api.contentFor(f.principals.b),fresh=api.contentFor(f.principals.new),teacher=api.contentFor(f.principals.teacher);
 assert.deepEqual(Object.keys(a.docs),['a']);assert.deepEqual(Object.keys(a.code),['Starter']);assert.equal(a.viewData.goalHtml,'A_GOAL');assert.equal(a.viewData.teacher,undefined);
 assert.doesNotMatch(JSON.stringify(a),/B_PRIVATE|B_GOAL|TEACHER|SOLUTION/);
 assert.deepEqual(Object.keys(b.docs),['b']);assert.deepEqual(b.code,{});
 assert.deepEqual(fresh,{docs:{},code:{},viewData:{}});
 assert.equal(teacher.docs.guide.html,'TEACHER_PRIVATE');assert.equal(teacher.code.Solution.text,'SOLUTION');assert.equal(teacher.viewData.teacher.reviewHtml,'TEACHER_REVIEW');
});
test('one matching bundle ID cannot authorize a mismatched or revoked lesson',t=>{
 const f=fixture(t),api=f.api();
 f.state.lessons[0].studentId='b';assert.deepEqual(api.contentFor(f.principals.a).code,{});
 f.state.lessons[0].studentId='a';f.state.lessons[0].status='planned';assert.deepEqual(api.contentFor(f.principals.a).code,{});
 f.state.lessons[0].status='prepared';f.state.lessons[0].bundleId=null;assert.deepEqual(api.contentFor(f.principals.a).code,{});
 assert.equal(api.contentFor(f.principals.teacher).code.Solution.text,'SOLUTION','teacher retains the teaching catalog after assignments change');
});
async function listen(t,api,principal){
 const server=http.createServer(async(req,res)=>{try{if(!await api.handle(req,res,new URL(req.url,'http://localhost').pathname,principal)){res.writeHead(404);res.end();}}catch(err){res.writeHead(err.status||500);res.end('DENIED');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return 'http://127.0.0.1:'+server.address().port;
}
test('downloads authorize before file access and support attachment GET/HEAD',async t=>{
 const f=fixture(t),api=f.api(),base=await listen(t,api,f.principals.a);
 const good=await fetch(base+'/api/materials/student-zip');assert.equal(good.status,200);assert.equal(await good.text(),'A_ZIP_PRIVATE');
 assert.match(good.headers.get('content-disposition'),/attachment/);assert.equal(good.headers.get('cache-control'),'no-store');assert.equal(good.headers.get('x-content-type-options'),'nosniff');
 const head=await fetch(base+'/api/materials/student-zip',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),'13');
 for(const id of ['teacher-code','does-not-exist','..%2Fteacher.java','%252e%252e%252fteacher.java']){const denied=await fetch(base+'/api/materials/'+id);assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/PRIVATE|TEACHER_BYTES/);}
 const foreign=await listen(t,api,f.principals.b),anon=await listen(t,api,null);
 assert.equal((await fetch(foreign+'/api/materials/student-zip')).status,404);assert.equal((await fetch(anon+'/api/materials/student-zip')).status,401);
});
test('manifest containment rejects traversal and symlink targets',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'outside.txt'),'OUTSIDE_PRIVATE');
 const manifest=JSON.parse(fs.readFileSync(path.join(f.dir,'manifest.json')));manifest.materials.find(m=>m.id==='student-zip').file='../../outside.txt';fs.writeFileSync(path.join(f.dir,'manifest.json'),JSON.stringify(manifest));
 assert.throws(()=>f.api(),/manifest|путь/i);
 manifest.materials.find(m=>m.id==='student-zip').file='student.zip';fs.writeFileSync(path.join(f.dir,'manifest.json'),JSON.stringify(manifest));
 fs.unlinkSync(path.join(f.dir,'student.zip'));
 try{fs.symlinkSync(path.join(f.root,'outside.txt'),path.join(f.dir,'student.zip'),'file');}catch(err){if(['EPERM','EACCES'].includes(err.code)){t.skip('Windows account cannot create file symlinks');return;}throw err;}
 const base=await listen(t,f.api(),f.principals.a),response=await fetch(base+'/api/materials/student-zip');assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/OUTSIDE_PRIVATE/);
});
test('static hook denies legacy private files even when bytes remain on disk',async t=>{
 const f=fixture(t),staticRoot=path.join(f.root,'dist');fs.mkdirSync(path.join(staticRoot,'downloads'),{recursive:true});
 for(const name of ['content.js','student.html','downloads/teacher-lesson-2026-09-27.zip','downloads/ListSolutions.java','downloads/student-lesson-2026-09-27.zip'])fs.writeFileSync(path.join(staticRoot,name),'OLD_PRIVATE_BYTES');
 fs.writeFileSync(path.join(staticRoot,'app.js'),'public template');
 assert.ok(fs.existsSync(modulePath),'static allowlist hook must exist');const {publicStaticFile}=require(modulePath);
 const server=http.createServer(async(req,res)=>{const file=await publicStaticFile(staticRoot,req.url);if(!file){res.writeHead(404);res.end();return;}res.writeHead(200);res.end(req.method==='HEAD'?null:fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 for(const name of ['content.js','student.html','downloads/teacher-lesson-2026-09-27.zip','downloads/ListSolutions.java','downloads/student-lesson-2026-09-27.zip','%63ontent.js','vendor/monaco/%2e%2e/%2e%2e/content.js'])for(const method of ['GET','HEAD']){const response=await fetch(base+'/'+name,{method});assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/OLD_PRIVATE_BYTES/);}
 assert.equal(await publicStaticFile(staticRoot,'/app.js'),path.join(staticRoot,'app.js'));
});

test('Markdown editor assets are public but the vendor directory is not a broad allowlist',async t=>{
 const f=fixture(t),staticRoot=path.join(f.root,'dist');
 const assets=['lesson-editor.css','lesson-editor.js','lesson-markdown.js','vendor/markdown-it/markdown-it.min.js'];
 for(const name of [...assets,'vendor/markdown-it/private.js']){
  const file=path.join(staticRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture asset');
 }
 const {publicStaticFile}=require(modulePath);
 for(const name of assets)assert.equal(await publicStaticFile(staticRoot,'/'+name),path.join(staticRoot,name));
 assert.equal(await publicStaticFile(staticRoot,'/vendor/markdown-it/private.js'),null);
 assert.equal(await publicStaticFile(staticRoot,'/vendor/markdown-it/../private.js'),null);
});
test('public templates contain no private profile, goals, lesson facts, or review markers',()=>{
 const root=path.join(__dirname,'..');const publicJs=['app.js','student-cabinet.js'].map(name=>fs.readFileSync(path.join(root,'dist',name),'utf8')).join('\n');
 assert.doesNotMatch(publicJs,/22 из 23 сценариев|13 из 22 сценариев|BorrowedBookStat|6 декабря 2026|5–9 часов|Пн \/ пт|12:53|Михаэль|1\. Исправить поиск|2\. Сведения по каждой книге/);
 assert.equal(fs.existsSync(path.join(root,'dist/content.js')),false);assert.equal(fs.existsSync(path.join(root,'dist/student.html')),false);
});
test('private downloads and public vendor junctions cannot point outside their roots',async t=>{
 const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.js'),'JUNCTION_PRIVATE_BYTES');
 const manifest=JSON.parse(fs.readFileSync(path.join(f.dir,'manifest.json')));manifest.materials.find(m=>m.id==='student-zip').file='linked/secret.js';fs.writeFileSync(path.join(f.dir,'manifest.json'),JSON.stringify(manifest));
 fs.symlinkSync(outside,path.join(f.dir,'linked'),process.platform==='win32'?'junction':'dir');
 const base=await listen(t,f.api(),f.principals.a),response=await fetch(base+'/api/materials/student-zip');assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/JUNCTION_PRIVATE_BYTES/);
 const staticRoot=path.join(f.root,'dist');fs.mkdirSync(path.join(staticRoot,'vendor'),{recursive:true});fs.symlinkSync(outside,path.join(staticRoot,'vendor/monaco'),process.platform==='win32'?'junction':'dir');
 assert.equal(await require(modulePath).publicStaticFile(staticRoot,'/vendor/monaco/secret.js'),null);
});

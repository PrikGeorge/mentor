const fs=require('node:fs'), path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'dist');
const dataContext={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),dataContext);
const data=dataContext.window.MENTOR_CONTENT;
const routes=new Set([...Object.keys(data.docs),'lesson','materials','source','answers','review','main']);
let links=0;
function checkLinks(html){for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){const href=m[1];links++;if(/^(https?:|data:)/.test(href))continue;if(href.startsWith('#')){assert(routes.has(href.slice(1).split('/')[0]),'Unknown route: '+href);continue}assert(!/^[A-Za-z]:/.test(href),'Local disk link: '+href);assert(fs.existsSync(path.join(root,href)),'Missing asset: '+href)}}
checkLinks(fs.readFileSync(path.join(root,'index.html'),'utf8'));
for(const doc of Object.values(data.docs)){checkLinks(doc.html);assert(doc.html.length>200)}
const guide=data.docs.guide;
assert(guide.raw.includes('12:00–13:00'));assert(guide.sections.length>=8);
assert(data.docs.roadmap.raw.includes('воскресенье 27.09'));
assert(data.docs.homework.raw.includes('3 часа 30 минут'));
const student=fs.readFileSync(path.join(root,'student.html'),'utf8');
assert(!student.includes('content.js'));assert(!student.includes('ListSolutions'));assert(!student.includes('GroupingSolution'));
for(const m of student.matchAll(/href="([^"]+)"/g)){const href=m[1];if(href.startsWith('#'))assert(student.includes('id="'+href.slice(1)+'"'),'Student anchor: '+href);else if(!href.startsWith('http'))assert(fs.existsSync(path.join(root,href)),'Student asset: '+href)}
for(const name of Object.keys(data.code))assert(fs.existsSync(path.join(root,'downloads',name+'.java')));
for(const role of ['student','teacher'])assert(fs.statSync(path.join(root,'downloads',role+'-lesson-2026-09-27.zip')).size>1000);
for(const name of ['app.js','content.js'])new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name});
console.log(`PASS: ${Object.keys(data.docs).length} documents, ${links} document/asset links, JavaScript syntax, lesson time, student/teacher separation and downloads`);

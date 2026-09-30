'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,dist=path.join(root,'dist'),privateRoot=path.join(root,'private/materials');
const data=JSON.parse(fs.readFileSync(path.join(privateRoot,'content.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(privateRoot,'manifest.json'),'utf8'));
const routes=new Set([...Object.keys(data.docs),'lesson','materials','source','answers','review','main','students']);
const materialIds=new Set(manifest.materials.filter(record=>record.kind==='download').map(record=>record.id));
let links=0;
function checkLinks(html){
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const href=match[1];links++;
  if(/^(https?:|data:)/.test(href))continue;
  if(href.startsWith('#')){assert(routes.has(href.slice(1).split('/')[0]),'Unknown route: '+href);continue;}
  if(href.startsWith('/api/materials/')){assert(materialIds.has(href.slice('/api/materials/'.length)),'Unknown material: '+href);continue;}
  assert(!/^[A-Za-z]:/.test(href),'Local disk link: '+href);assert(fs.existsSync(path.join(dist,href)),'Missing public asset: '+href);
 }
}
const index=fs.readFileSync(path.join(dist,'index.html'),'utf8');
assert(!index.includes('content.js'),'index must load authorized JSON after session check');checkLinks(index);
for(const doc of Object.values(data.docs)){checkLinks(doc.html);assert(doc.html.length>200);}
checkLinks(data.viewData.teacher.lessonHtml);checkLinks(data.viewData.teacher.reviewHtml);
assert(data.docs.guide.raw.includes('12:00–13:00'));assert(data.docs.guide.sections.length>=8);
assert(data.docs.roadmap.raw.includes('воскресенье 27.09'));assert(data.docs.homework.raw.includes('3 часа 30 минут'));
const student=fs.readFileSync(path.join(privateRoot,'student.html'),'utf8');
assert(!student.includes('content.js'));assert(!student.includes('ListSolutions'));assert(!student.includes('GroupingSolution'));
assert(!/<script|onclick=|<link |(?:href|src)="(?:\/api|downloads)/.test(student));
for(const match of student.matchAll(/href="([^"]+)"/g)){const href=match[1];if(href.startsWith('#'))assert(student.includes('id="'+href.slice(1)+'"'),'Student anchor: '+href);else assert(href.startsWith('https://'),'Offline private URL: '+href);}
for(const record of manifest.materials)assert(fs.existsSync(path.join(privateRoot,record.file)),'Missing private material: '+record.file);
for(const role of ['student','teacher'])assert(fs.statSync(path.join(privateRoot,'downloads',role+'-lesson-2026-09-27.zip')).size>1000);
for(const name of ['app.js','portal-model.js','student-cabinet.js','document-navigation.js','practice.js','portal.js','auth.js','account-access.js','lesson-markdown.js','lesson-editor.js'])if(fs.existsSync(path.join(dist,name)))new vm.Script(fs.readFileSync(path.join(dist,name),'utf8'),{filename:name});
assert(!fs.existsSync(path.join(dist,'content.js')));assert(!fs.existsSync(path.join(dist,'student.html')));
const templates=['app.js','student-cabinet.js'].map(name=>fs.readFileSync(path.join(dist,name),'utf8')).join('\n');
assert(!/22 из 23 сценариев|13 из 22 сценариев|BorrowedBookStat|6 декабря 2026|5–9 часов|Пн \/ пт|12:53|Михаэль/.test(templates));
assert(data.docs['student-roadmap'].raw.includes('5–9'));assert(data.docs['student-review'].raw.includes(data.sha));
console.log(`PASS: ${Object.keys(data.docs).length} private documents, ${links} links, manifest files, public template syntax and privacy markers`);

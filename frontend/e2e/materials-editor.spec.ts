import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import type { components } from '../src/app/api/schema';
type Material = components['schemas']['MaterialView'];
const student: components['schemas']['TeacherStudentView'] = { id:'s1',workspaceId:'w1',userId:'learner',revision:1,createdAt:'2026-10-01T00:00:00Z',name:'Синтетическая Анна',direction:'Java',goal:'Первая работа',schedule:'',notes:'PRIVATE_PROFILE',studentRoadmap:'',studentReview:'' };
const lesson: components['schemas']['TeacherLessonView'] = { id:'l1',workspaceId:'w1',studentId:'s1',title:'Безопасное чтение Java',date:'2026-10-02',time:'12:00',timeZone:'Europe/Moscow',duration:60,status:'prepared',bundleId:'b1',revision:1,createdAt:'2026-10-01T00:00:00Z',teacherNotes:'',studentNotes:'',reviewNotes:'' };
const root='/api/v1/workspaces/w1/students/s1', lessonBase='/teacher/students/s1/lessons/l1';
const meta={workspaceId:'w1',studentId:'s1',lessonId:'l1',bundleId:'b1',contentType:'text/markdown'};
const materials: Material[] = [
 { ...meta,id:'guide',kind:'doc',audience:'teacher',contentKey:'guide',filename:'guide.md',title:'Методичка преподавателя',document:{title:'Методичка преподавателя',intro:'<p>PRIVATE_GUIDE</p>',raw:'private raw',html:'',sections:[{id:'section-0',title:'Подготовка',html:'<details class="explanation-details"><summary>Методическое пояснение</summary><p>PRIVATE_METHOD</p></details>',studentParts:[0,1,9]},{id:'section-1',title:'Следующая часть',html:'<p>Обсуждение занятия</p>'}]} },
 { ...meta,id:'tasks',kind:'doc',audience:'student',contentKey:'student',filename:'tasks.md',title:'Задания ученика',document:{title:'Задания ученика',intro:'<p>Публичное вступление</p>',raw:'## Задания\n',html:'',sections:[{id:'section-0',title:'Коллекции',html:'<p>Прочитайте исходную заготовку.</p><div><!-- task-code:ListTask:practice --></div><details class="explanation-details"><summary>Пояснение ученику</summary><p>Публичная подсказка</p></details>'},{id:'section-1',title:'Следующая часть',html:'<p>Сравните результат</p>'}]} },
 { ...meta,id:'code',kind:'code',audience:'student',contentKey:'ListTask',filename:'ListTask.java',title:'Исходная заготовка',code:{text:'package synthetic;\n    class ListTask {}\n// end',teacher:false,materialId:'student-zip',excerpt:{start:1,end:2}} },
 { ...meta,id:'student-zip',kind:'download',audience:'student',contentKey:'student-bundle',filename:'synthetic-student.zip',title:'Комплект ученика',contentType:'application/zip',blob:{id:'blob1',size:4,sha256:'a'.repeat(64)},downloadUrl:'/api/v1/workspaces/w1/materials/student-zip/file' },
 { ...meta,id:'teacher-zip',kind:'download',audience:'teacher',contentKey:'teacher-bundle',filename:'synthetic-teacher.zip',title:'Комплект преподавателя',contentType:'application/zip',blob:{id:'blob2',size:4,sha256:'b'.repeat(64)},downloadUrl:'/api/v1/workspaces/w1/materials/teacher-zip/file' },
];
async function fixture(page: Page, role:'TEACHER'|'STUDENT'='TEACHER', conflict=false) {
 let source='  исходный  \n', revision=3, fail=conflict, writes=0; const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url()),publicView=role==='STUDENT'||url.searchParams.get('audience')==='student',path=url.pathname;
  if(path==='/api/v1/auth/session'){await route.fulfill({json:{account:{userId:role==='TEACHER'?'teacher':'learner',workspaceId:'w1',role,authVersion:1},csrfToken:'synthetic'}});return;}
  if(path===root){const {notes,...view}=student;await route.fulfill({json:publicView?view:student});return;}
  if(path===root+'/lessons/l1'){const {teacherNotes,...view}={...lesson,teacherNotes:source};await route.fulfill({json:publicView?view:{...lesson,teacherNotes:source}});return;}
  if(path.startsWith(root+'/lessons/l1/texts/')){
   const kind=path.split('/').at(-1);if(role!=='TEACHER'||publicView){await route.fulfill({status:404});return;}
   if(request.method()==='GET'){await route.fulfill({json:{kind,markdown:source,revision}});return;}
   expect(request.headers()['x-mentor-account']).toBe('teacher');expect(request.headers()['x-csrf-token']).toBe('synthetic');
   const body=request.postDataJSON();expect(Object.keys(body).sort()).toEqual(['markdown','revision']);expect(body.revision).toBe(revision);
   writes++;if(fail){fail=false;await route.fulfill({status:409,json:{message:'Ревизия устарела'}});return;}source=body.markdown;revision++;await route.fulfill({json:{kind,markdown:source,revision}});return;
  }
  if(path===root+'/lessons/l1/materials'){
   const visible=materials.filter(m=>!publicView||m.audience==='student');const items=visible.map(m=>{const {document,code,viewData,blob,downloadUrl,...summary}=m as Material & Record<string,unknown>;return summary;});await route.fulfill({json:{items,page:0,size:25,total:items.length}});return;
  }
  if(path.startsWith('/api/v1/workspaces/w1/materials/')){
   const id=path.split('/')[6],material=materials.find(m=>m.id===id);if(!material||publicView&&material.audience==='teacher'){await route.fulfill({status:404});return;}
   if(path.endsWith('/file')){await route.fulfill({body:Buffer.from('PK00'),contentType:'application/zip',headers:{'Content-Disposition':`attachment; filename="${material.filename}"`}});return;}
   await route.fulfill({json:material});return;
  }
  await route.fulfill({status:404});
 });
 return {errors,writes:()=>writes};
}
for(const width of [1280,390]){
 test(`exact Markdown import undo conflict and200000 units at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page,'TEACHER',true);await page.goto(lessonBase);
  await page.getByRole('button',{name:'Изменить сценарий',exact:true}).click();const textarea=page.locator('textarea[name="markdown"]');await expect(textarea).toHaveValue('  исходный  \n');
  await textarea.fill('до');await page.locator('input[type=file]').setInputFiles({name:'source.md',mimeType:'text/markdown',buffer:Buffer.from('  новый 😀  \n')});await page.getByRole('button',{name:'Добавить в конец',exact:true}).click();await expect(textarea).toHaveValue('до\n\n  новый 😀  \n');
  await page.getByRole('button',{name:'Отменить',exact:true}).click();await expect(textarea).toHaveValue('до');await page.locator('input[type=file]').setInputFiles({name:'source.md',mimeType:'text/markdown',buffer:Buffer.from('```java\n  class A {}  \n```')});await page.getByRole('button',{name:'Заменить текст',exact:true}).click();
  await page.getByRole('button',{name:'Рядом',exact:true}).click();await expect(page.locator('.md-preview-pane code')).toContainText('  class A {}');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Ревизия устарела');await expect(textarea).toHaveValue('```java\n  class A {}  \n```');const localDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать введённый .md',exact:true}).click();const local=await localDownload;expect(local.suggestedFilename()).toBe('teacherNotes-local.md');expect(readFileSync((await local.path())!,'utf8')).toBe('```java\n  class A {}  \n```');
  const exact='😀'.repeat(100000);await textarea.fill(exact);await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('mentor-markdown-editor')).toHaveCount(0);await page.getByRole('button',{name:'Изменить сценарий',exact:true}).click();await expect(textarea).toHaveValue(exact);expect(state.writes()).toBe(2);
  await textarea.fill('маленький текст');await page.getByRole('button',{name:'Текст',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:test.info().outputPath(`editor-${width}.png`),fullPage:true});expect(state.errors).toEqual([]);
 });
 test(`teacher/student document anchors bundles code and print at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page);await page.goto(lessonBase+'/teacher/guide');await expect(page.getByRole('heading',{name:'Методичка преподавателя',exact:true})).toBeVisible();await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('link',{name:/Открыть часть/})).toHaveCount(1);if(width===390)await page.getByText('Разделы материала',{exact:true}).click();await page.getByRole('link',{name:'Следующая часть',exact:true}).click();await expect(page).toHaveURL(/#section-1$/);await expect(page.locator('#section-1 h3')).toBeFocused();
  const detail=page.locator('.explanation-details');expect(await detail.evaluate((e:HTMLDetailsElement)=>e.open)).toBe(false);
  await page.evaluate(()=>{(window as any).printStates=[];window.addEventListener('beforeprint',()=>{(window as any).printStates.push(['before',...Array.from(document.querySelectorAll('details')).map(e=>e.open)]);});window.addEventListener('afterprint',()=>{(window as any).printStates.push(['after',...Array.from(document.querySelectorAll('details')).map(e=>e.open)]);});});
  await page.pdf({path:test.info().outputPath(`guide-${width}.pdf`),format:'A4'});expect(await detail.evaluate((e:HTMLDetailsElement)=>e.open)).toBe(false);const states=await page.evaluate(()=>(window as any).printStates);expect(states.some((s:unknown[])=>s[0]==='before'&&s.slice(1).every(Boolean))).toBe(true);expect(states.some((s:unknown[])=>s[0]==='after'&&s.slice(1).includes(false))).toBe(true);
  await expect(page.getByRole('link',{name:'Комплект преподавателя',exact:true})).toHaveAttribute('href','/api/v1/workspaces/w1/materials/teacher-zip/file');await page.screenshot({path:test.info().outputPath(`guide-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:'Открыть часть 1 ученика →',exact:true}).click();await expect(page).toHaveURL(/student\/tasks\?preview=student#section-0$/);await expect(page.getByRole('heading',{name:'Задания ученика',exact:true})).toBeVisible();await expect(page.locator('.task-code')).toContainText('class ListTask {}');await expect(page.locator('body')).not.toContainText('PRIVATE_');await expect(page.locator('body')).not.toContainText('Комплект преподавателя');await expect(page.getByRole('button',{name:/Изменить|Сохранить|Сдать/})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Комплект ученика',exact:true})).toHaveAttribute('href','/api/v1/workspaces/w1/materials/student-zip/file?audience=student');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:test.info().outputPath(`public-${width}.png`),fullPage:true});expect(state.errors).toEqual([]);
 });
}




import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { signIn, signOut } from '../testing/browser-session';
import type { components } from '../src/app/api/schema';
test.describe.configure({mode:'serial'});
type Session=components['schemas']['Session'];type Actor=components['schemas']['Actor'];type Student=components['schemas']['TeacherStudentView'];type Lesson=components['schemas']['TeacherLessonView'];type Issue=components['schemas']['InvitationIssue'];
const ready=JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!,'utf8')),runtime=path.dirname(process.env['MENTOR_BROWSER_FIXTURE']!),credentials=JSON.parse(readFileSync(ready.credentialsPath,'utf8'));
let teacher:{client:APIRequestContext;actor:Actor},learner:{client:APIRequestContext;actor:Actor},student:Student,lesson:Lesson;const clients:APIRequestContext[]=[];
const card=()=>`/workspaces/${teacher.actor.workspaceId}/students/${student.id}`;const base=()=>`/teacher/students/${student.id}/lessons/${lesson.id}`;
async function get<T>(client:APIRequestContext,route:string):Promise<T>{const response=await client.get('/api/v1'+route);expect(response.status(),`GET ${route}`).toBe(200);return response.json();}
async function write<T>(client:APIRequestContext,method:string,route:string,body:unknown,status:number):Promise<T>{const session=await get<Session>(client,'/auth/session');const headers:Record<string,string>={Origin:ready.browserOrigin,'X-Mentor-Client':'web','X-CSRF-TOKEN':session.csrfToken};if(session.account&&!['/auth/login','/auth/register'].includes(route))headers['X-Mentor-Account']=session.account.userId;const response=await client.fetch('/api/v1'+route,{method,headers,data:body});expect(response.status(),method+' '+route).toBe(status);return response.json();}
test.beforeAll(async({playwright})=>{
 async function client(){const c=await playwright.request.newContext({baseURL:ready.browserOrigin});clients.push(c);return c;}
 const admin=await client();await write(admin,'POST','/auth/login',credentials,200);
 async function register(issue:Issue,login:string){const c=await client();const token=new URL(issue.link,ready.browserOrigin).searchParams.get('token');const s=await write<Session>(c,'POST','/auth/register',{token,login,password:credentials.password},200);return{client:c,actor:s.account!};}
 teacher=await register(await write<Issue>(admin,'POST','/admin/teacher-invitations',{},200),'material-browser-teacher');
 student=await write<Student>(teacher.client,'POST',`/workspaces/${teacher.actor.workspaceId}/students`,{name:'Синтетическая Анна',direction:'Java',notes:'PRIVATE_PROFILE'},201);
 learner=await register(await write<Issue>(teacher.client,'POST',card()+'/invitations',{},200),'material-browser-student');
 lesson=await write<Lesson>(teacher.client,'POST',card()+'/lessons',{title:'Безопасное чтение Java',date:'2030-01-01',time:'12:00',duration:60},201);
 const temp=path.join(runtime,'material-seed-request.tmp');writeFileSync(temp,JSON.stringify({userId:teacher.actor.userId,workspaceId:teacher.actor.workspaceId,studentId:student.id,lessonId:lesson.id}));renameSync(temp,path.join(runtime,'material-seed-request.json'));
 await expect.poll(()=>existsSync(path.join(runtime,'material-seed-complete.json')),{timeout:20000}).toBe(true);
 const list=await get<{items:unknown[]}>(learner.client,card()+`/lessons/${lesson.id}/materials`);expect(list.items.length).toBe(3);
 const materialPath=`/workspaces/${teacher.actor.workspaceId}/materials`;
 expect((await learner.client.get('/api/v1'+materialPath+'/guide')).status()).toBe(404);expect((await teacher.client.get('/api/v1'+materialPath+'/guide?audience=student')).status()).toBe(404);
 expect((await learner.client.get('/api/v1'+materialPath+'/teacher-zip/file')).status()).toBe(404);
 const file=await learner.client.get('/api/v1'+materialPath+'/student-zip/file');expect(file.status()).toBe(200);expect((await file.body()).toString()).toBe('synthetic-student-bundle-bytes');expect(file.headers()['content-disposition']).toContain('synthetic-student.zip');
});
test.afterAll(async()=>{for(const client of clients)await client.dispose();});
async function login(page:Page,role:'teacher'|'student'){await signIn(page,{login:'material-browser-'+role,password:credentials.password},role==='student'?'/learn':'/teacher/students');}
async function capture(page:Page,name:string){await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur?.();window.scrollTo(0,0);});await page.screenshot({path:path.join(runtime,name)});}
for(const width of [1280,390])test(`real materials Markdown200000 print and learner boundaries at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await login(page,'teacher');await page.goto(base());
 await page.getByRole('button',{name:/^(Добавить|Изменить) сценарий$/}).click();const textarea=page.getByRole('textbox',{name:'Текст занятия',exact:true});const exact='😀'.repeat(100000);await textarea.fill(exact);const put=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/texts/teacherNotes'));await page.getByRole('button',{name:'Сохранить',exact:true}).click();expect((await put).status()).toBe(200);await expect(page.getByRole('region',{name:'Редактор Markdown',exact:true})).toHaveCount(0);await page.reload();await page.getByRole('button',{name:'Изменить сценарий',exact:true}).click();await expect(textarea).toHaveValue(exact);
 await textarea.fill('```java\n  class A {}  \n```');await page.getByRole('button',{name:'Рядом',exact:true}).click();await expect(page.getByRole('region',{name:'Предварительный просмотр',exact:true}).getByRole('code')).toContainText('  class A {}');await capture(page,`real-editor-${width}.png`);await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('region',{name:'Редактор Markdown',exact:true})).toHaveCount(0);
 await page.goto(base()+'/teacher/guide');await expect(page.getByRole('heading',{name:'Методичка преподавателя',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:/Открыть часть/})).toHaveCount(1);if(width===390)await page.getByText('Разделы материала',{exact:true}).click();await page.getByRole('link',{name:'Следующая часть',exact:true}).click();await expect(page).toHaveURL(/#section-1$/);await expect(page.locator('#section-1 h3')).toBeFocused();
 const details=page.locator('.explanation-details');expect(await details.evaluate((e:HTMLDetailsElement)=>e.open)).toBe(false);await page.evaluate(()=>{(window as any).printed=false;window.addEventListener('beforeprint',()=>{(window as any).printed=Array.from(document.querySelectorAll('details')).every(e=>e.open);});});await page.pdf({path:path.join(runtime,`real-guide-${width}.pdf`),format:'A4'});expect(await page.evaluate(()=>(window as any).printed)).toBe(true);expect(await details.evaluate((e:HTMLDetailsElement)=>e.open)).toBe(false);
 const teacherDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Комплект преподавателя',exact:true}).click();expect((await teacherDownload).suggestedFilename()).toBe('synthetic-teacher.zip');await capture(page,`real-guide-${width}.png`);
 await page.getByRole('link',{name:'Открыть часть 1 ученика →',exact:true}).click();await expect(page.getByRole('heading',{name:'Задания ученика',exact:true})).toBeVisible();await expect(page.locator('.task-code')).toContainText('class ListTask {}');await expect(page.locator('body')).not.toContainText('PRIVATE_');await expect(page.locator('body')).not.toContainText('Комплект преподавателя');await expect(page.getByRole('button',{name:/Изменить|Сохранить|Сдать/})).toHaveCount(0);
 await signOut(page);await expect(page).toHaveURL('/login');await login(page,'student');await page.goto(`/learn/students/${student.id}/lessons/${lesson.id}/student/tasks`);await expect(page.locator('.task-code')).toContainText('class ListTask {}');const studentDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Комплект ученика',exact:true}).click();expect((await studentDownload).suggestedFilename()).toBe('synthetic-student.zip');await expect(page.locator('body')).not.toContainText('PRIVATE_');await expect(page.locator('body')).not.toContainText('Комплект преподавателя');await expect(page.getByRole('button',{name:/Изменить|Сохранить|Сдать/})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await capture(page,`real-public-${width}.png`);expect(errors).toEqual([]);
});






import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { components } from '../src/app/api/schema';
import { signIn, signOut as logout } from '../testing/browser-session';
test.describe.configure({mode:'serial'});
type Session=components['schemas']['Session'];
type Actor=components['schemas']['Actor'];
type Student=components['schemas']['TeacherStudentView'];
type Lesson=components['schemas']['TeacherLessonView'];
type Submission=components['schemas']['Submission'];
type Issue=components['schemas']['InvitationIssue'];
type User={login:string;client:APIRequestContext;actor:Actor};
const ready=JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!,'utf8'));
const credentials=JSON.parse(readFileSync(ready.credentialsPath,'utf8'));
const runtime=path.dirname(process.env['MENTOR_BROWSER_FIXTURE']!);
const clients:APIRequestContext[]=[];
let teacher:User,learner:User,student:Student;
const card=()=>`/workspaces/${teacher.actor.workspaceId}/students/${student.id}`;
const lessonPath=(lesson:Lesson)=>card()+`/lessons/${lesson.id}`;
async function get<T>(client:APIRequestContext,route:string):Promise<T>{const response=await client.get('/api/v1'+route);expect(response.status(),`GET ${route}`).toBe(200);return response.json();}
async function write<T>(client:APIRequestContext,method:string,route:string,body:unknown,status:number):Promise<T>{const session=await get<Session>(client,'/auth/session');const headers:Record<string,string>={Origin:ready.browserOrigin,'X-Mentor-Client':'web','X-CSRF-TOKEN':session.csrfToken};if(session.account&&!['/auth/login','/auth/register'].includes(route))headers['X-Mentor-Account']=session.account.userId;const response=await client.fetch('/api/v1'+route,{method,headers,...(body===undefined?{}:{data:body})});expect(response.status(),`${method} ${route}`).toBe(status);return status===204?undefined as T:response.json();}
test.beforeAll(async({playwright})=>{
 async function client(){const client=await playwright.request.newContext({baseURL:ready.browserOrigin});clients.push(client);return client;}
 const admin=await client();await write(admin,'POST','/auth/login',credentials,200);
 async function register(issue:Issue,login:string){const clientContext=await client();const token=new URL(issue.link,ready.browserOrigin).searchParams.get('token');const session=await write<Session>(clientContext,'POST','/auth/register',{token,login,password:credentials.password},200);return{login,client:clientContext,actor:session.account!};}
 teacher=await register(await write<Issue>(admin,'POST','/admin/teacher-invitations',{},200),'homework-teacher');
 student=await write<Student>(teacher.client,'POST',`/workspaces/${teacher.actor.workspaceId}/students`,{name:'Синтетическая ученица ДЗ',direction:'Java'},201);
 learner=await register(await write<Issue>(teacher.client,'POST',card()+'/invitations',{},200),'homework-student');
});
test.afterAll(async()=>{for(const client of clients)await client.dispose();});
async function login(page:Page,user:User){await signIn(page,{login:user.login,password:credentials.password},user.actor.role==='STUDENT'?'/learn':'/teacher/students');}
async function createLesson(title:string){return write<Lesson>(teacher.client,'POST',card()+'/lessons',{title,date:'2030-01-01',time:'12:00',duration:60},201);}
const studentRoute=(lesson:Lesson,section='homework')=>`/learn/students/${student.id}/lessons/${lesson.id}/student/${section}`;
const teacherRoute=(lesson:Lesson,section='review')=>`/teacher/students/${student.id}/lessons/${lesson.id}/teacher/${section}`;
async function upload(page:Page,lesson:Lesson,name:string,body:Buffer,comment:string){await page.getByLabel('Файл работы').setInputFiles({name,mimeType:'application/octet-stream',buffer:body});await page.getByRole('textbox', { name: 'Комментарий к работе' }).fill(comment);const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(lessonPath(lesson)+'/homework'));const submit=page.getByRole('button',{name:'Отправить на ревью',exact:true});await expect(submit).toBeEnabled();await submit.focus();await page.keyboard.press('Enter');const created=await response;expect(created.status()).toBe(201);expect(created.request().headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/);expect(created.request().headers()['x-mentor-account']).toBe(learner.actor.userId);await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toBeVisible();const history=await get<components['schemas']['HomeworkPage']>(learner.client,lessonPath(lesson)+'/homework');const item=history.items.find(item=>item.filename===name);expect(item).toBeDefined();expect(item!.size).toBe(body.length);return item!;}
// The review form is open until the first feedback exists; a click on its summary would close it.
async function openReview(review: import('@playwright/test').Locator) { const details = review.locator('details'); await expect(details).toBeVisible(); if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await review.getByText(/^(Оставить|Изменить) ревью$/).click(); await expect(review.getByRole('textbox', { name: 'Ревью этой работы', exact: true })).toBeVisible(); }
for(const width of [1280,390])test(`real upload, needs revision, resubmit and review with unknown outcome at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const lesson=await createLesson(`Домашняя работа ${width}`);const other=await createLesson(`Другое занятие ${width}`);
 await write(teacher.client,'PUT',lessonPath(lesson)+'/texts/reviewNotes',{markdown:'Общий итог занятия отдельно от файлов.',revision:1},200);
 await login(page,learner);await page.goto(studentRoute(lesson));await expect(page.getByLabel('Файл работы')).toBeVisible();
 if(width===1280){let posts=0;const count=(request:import('@playwright/test').Request)=>{if(request.method()==='POST'&&request.url().endsWith(lessonPath(lesson)+'/homework'))posts++;};page.on('request',count);await page.getByLabel('Файл работы').setInputFiles({name:'oversized.java',mimeType:'text/plain',buffer:Buffer.alloc(20971521,65)});await page.getByRole('button',{name:'Отправить на ревью',exact:true}).click();await expect(page.getByText('Файл должен быть непустым и не больше 20 МиБ.',{exact:true})).toBeVisible();expect(posts).toBe(0);page.off('request',count);}
 const initial=width===1280?Buffer.alloc(20971520,65):Buffer.from('class Homework {}');const first=await upload(page,lesson,`first-${width}.java`,initial,'Первая версия');await expect(page.locator('.homework-submission')).toHaveCount(1);
 // Actual authenticated file transport; only the transient browser object URL is used to save it.
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать файл',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe(first.filename);const downloaded=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of downloaded!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).equals(initial)).toBe(true);
 await logout(page);await login(page,teacher);await page.goto(teacherRoute(lesson));
 await expect(page.getByText('Общий итог занятия отдельно от файлов.',{exact:true})).toBeVisible();const firstSubmission=page.getByRole('listitem').filter({has:page.getByRole('heading',{name:first.filename,level:3,exact:true})});const review=firstSubmission.locator('mentor-lesson-review');await openReview(review);await review.getByRole('textbox', { name: 'Ревью этой работы', exact: true }).fill('Добавьте проверку null.');await review.getByRole('combobox', { name: 'Результат ревью', exact: true }).selectOption('needs_revision');
 const reviewed=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(first.id+'/review'));await review.getByRole('button',{name:'Сохранить ревью',exact:true}).focus();await page.keyboard.press('Enter');expect((await reviewed).status()).toBe(200);await expect(firstSubmission.locator('header').getByText('Нужна доработка',{exact:true})).toBeVisible();if(!await review.getByRole('textbox', { name: 'Ревью этой работы', exact: true }).isVisible())await review.getByText(/^(Оставить|Изменить) ревью$/).click();
 // Real stale-CAS response keeps the teacher's unsaved feedback.
 await review.getByRole('textbox', { name: 'Ревью этой работы', exact: true }).fill('Сохранить введённый отзыв');await write(teacher.client,'PATCH',lessonPath(lesson)+`/homework/${first.id}/review`,{revision:2,status:'needs_revision',feedback:'Параллельный отзыв'},200);
 const conflict=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(first.id+'/review'));await review.getByRole('button',{name:'Сохранить ревью',exact:true}).click();expect((await conflict).status()).toBe(409);await expect(review.getByRole('textbox', { name: 'Ревью этой работы', exact: true })).toHaveValue('Сохранить введённый отзыв');
 await page.goto(teacherRoute(lesson));await expect(page.locator('.homework-submission')).toHaveCount(1);
 await logout(page);await login(page,learner);await page.goto(studentRoute(lesson));await expect(page.getByText('Параллельный отзыв',{exact:true})).toBeVisible();
 // Browser offline transport generates a real network error, not an API fixture or a fabricated response. The retry resends the same Idempotency-Key, so the server stores one work.
 await page.getByLabel('Файл работы').setInputFiles({name:`retry-${width}.java`,mimeType:'text/plain',buffer:Buffer.from('class Revised {}')});await page.getByRole('textbox', { name: 'Комментарий к работе' }).fill('Исправленная версия');await page.context().setOffline(true);await page.getByRole('button',{name:'Отправить на ревью',exact:true}).click();await expect(page.getByText('Ответ сервера не дошёл, поэтому неясно',{exact:false})).toBeVisible();await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Повторить отправку',exact:true})).toBeEnabled();await expect(page.getByRole('textbox', { name: 'Комментарий к работе' })).toHaveValue('Исправленная версия');
 await page.context().setOffline(false);const retried=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(lessonPath(lesson)+'/homework'));await page.getByRole('button',{name:'Повторить отправку',exact:true}).click();const retry=await retried;expect(retry.status()).toBe(201);expect(retry.request().headers()['idempotency-key']).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toBeVisible();await expect(page.locator('.homework-submission')).toHaveCount(2);await expect(page.getByRole('textbox', { name: 'Комментарий к работе' })).toHaveValue('');await expect(page.getByRole('button',{name:'Отправить на ревью',exact:true})).toBeEnabled();
 const second=(await get<components['schemas']['HomeworkPage']>(learner.client,lessonPath(lesson)+'/homework')).items[0];expect(second.id).not.toBe(first.id);expect(second.filename).toBe(`retry-${width}.java`);expect(second.comment).toBe('Исправленная версия');
 await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});await page.screenshot({path:path.join(runtime,`real-homework-upload-${width}.png`)});
 await logout(page);await login(page,teacher);await page.goto(teacherRoute(lesson));const secondSubmission=page.getByRole('listitem').filter({has:page.getByRole('heading',{name:second.filename,level:3,exact:true})});const revised=secondSubmission.locator('mentor-lesson-review');await openReview(revised);await revised.getByRole('textbox',{name:'Ревью этой работы',exact:true}).fill('Исправления приняты.');await revised.getByRole('combobox',{name:'Результат ревью',exact:true}).selectOption('reviewed');const done=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(second.id+'/review'));await revised.getByRole('button',{name:'Сохранить ревью',exact:true}).click();expect((await done).status()).toBe(200);await expect(secondSubmission.locator('header').getByText('Проверено',{exact:true})).toBeVisible();await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});await page.screenshot({path:path.join(runtime,`real-homework-review-${width}.png`)});
 // Preview retains TEACHER session and read access only.
 await page.goto(`/teacher/students/${student.id}/lessons/${lesson.id}/student/homework?preview=student`);await expect(page.getByRole('status').getByText('Предпросмотр кабинета ученика · только чтение',{exact:true})).toBeVisible();await expect(page.getByLabel('Файл работы')).toHaveCount(0);expect((await get<Session>(teacher.client,'/auth/session')).account?.role).toBe('TEACHER');
 await logout(page);await login(page,learner);await page.goto(studentRoute(lesson,'review'));await expect(page.getByText('Исправления приняты.',{exact:true})).toBeVisible();await expect(page.getByText('Общий итог занятия отдельно от файлов.',{exact:true})).toBeVisible();await page.locator('.homework-history').screenshot({path:path.join(runtime,`real-homework-history-${width}.png`)});await page.goto(studentRoute(other,'review'));await expect(page.getByRole('heading',{name:'Ревью пока нет',exact:true})).toBeVisible();await expect(page.locator('.homework-submission')).toHaveCount(0);await expect(page.getByText('Исправления приняты.',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 const history=await get<components['schemas']['HomeworkPage']>(learner.client,lessonPath(lesson)+'/homework');expect(history.items.map(item=>item.id)).toEqual([second.id,first.id]);expect(history.items[0].status).toBe('reviewed');expect(history.items[1].status).toBe('needs_revision');
});

 // T13: a typed answer is stored as one ordinary text file, so the real server keeps it and the code view opens it.
 test('real typed answer is stored as a Java file named after its class and opens as code',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const lesson=await createLesson('Ответ текстом');const answer='public class Solver {\n    int twice(int x) { return 2 * x; }\n}\n';
  await login(page,learner);await page.goto(studentRoute(lesson));await page.getByRole('button',{name:'Текстом',exact:true}).click();await expect(page.getByLabel('Файл работы')).toBeHidden();
  await page.getByLabel('Ответ',{exact:true}).fill(answer);await expect(page.getByText('Solver.java',{exact:true})).toBeVisible();
  const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(lessonPath(lesson)+'/homework'));await page.getByRole('button',{name:'Отправить на ревью',exact:true}).click();expect((await response).status()).toBe(201);
  await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toBeVisible();await expect(page.getByLabel('Ответ',{exact:true})).toHaveValue('');
  const history=await get<components['schemas']['HomeworkPage']>(learner.client,lessonPath(lesson)+'/homework');expect(history.items).toHaveLength(1);expect(history.items[0].filename).toBe('Solver.java');expect(history.items[0].size).toBe(Buffer.byteLength(answer));
  const text=await get<{filename:string;text:string}>(learner.client,lessonPath(lesson)+`/homework/${history.items[0].id}/text`);expect(text.text).toBe(answer);
  await page.getByRole('button',{name:'Открыть код',exact:true}).click();await expect(page.locator('.submission-code')).toContainText('return 2 * x;');
  await logout(page);expect(errors).toEqual([]);
 });
 // T09: the teacher sets a deadline in the lesson form; after it passes the student sees a gentle «Срок прошёл», late work is accepted and both roles read «Сдано после срока».
 test('real homework deadline: set in the form, overdue, accepted late',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const moscow=(ms:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
  const yesterday=moscow(Date.now()-86400000);const lesson=await write<Lesson>(teacher.client,'POST',card()+'/lessons',{title:'Срок сдачи',date:yesterday,time:'10:00',duration:60},201);
  await login(page,teacher);await page.goto(`/teacher/students/${student.id}/lessons/${lesson.id}`);
  await page.getByRole('button',{name:'Изменить занятие',exact:true}).click();
  await page.locator('input[name="dueDate"]').fill(yesterday);await page.locator('input[name="dueTime"]').fill('09:00');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByText('Срок не может быть раньше начала занятия.',{exact:true})).toBeVisible();
  await page.locator('input[name="dueTime"]').fill('11:30');
  const saved=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(lessonPath(lesson)));
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();const patch=await saved;expect(patch.status()).toBe(200);
  expect(patch.request().postDataJSON().homeworkDue).toEqual({date:yesterday,time:'11:30'});expect((await patch.json()).homeworkDue.state).toBe('overdue');
  await page.goto(`/teacher/students/${student.id}/lessons`);
  const teacherRow=page.getByRole('row',{name:/Срок сдачи/});await expect(teacherRow.getByText(/^Просрочено на \d+ дн\.$|^Срок прошёл$/)).toBeVisible();await expect(teacherRow).toContainText('ДЗ до '+yesterday.slice(8,10)+'.'+yesterday.slice(5,7)+', 11:30');
  await logout(page);
  await login(page,learner);await page.goto(`/learn/students/${student.id}/lessons`);
  await expect(page.getByRole('row',{name:/Срок сдачи/}).getByText('Срок прошёл',{exact:true})).toBeVisible();await expect(page.getByText(/Просрочено/)).toHaveCount(0);
  await page.goto(studentRoute(lesson));await expect(page.locator('.homework-upload .due-line')).toContainText('Сдай, когда будет готово — наставник посмотрит.');
  await upload(page,lesson,'Late.java',Buffer.from('class Late {}'),'Поздно, но сделал');
  await expect(page.locator('.homework-submission header')).toContainText('после срока');
  expect((await get<Lesson>(learner.client,lessonPath(lesson))).homeworkDue?.state).toBe('late');
  await page.goto(`/learn/students/${student.id}/lessons`);await expect(page.getByRole('row',{name:/Срок сдачи/}).getByText('Сдано после срока',{exact:true})).toBeVisible();
  await logout(page);expect(errors).toEqual([]);
 });
 test('real in-flight upload is cancelled on lesson navigation and account logout',async({page})=>{
  test.setTimeout(90000);const lesson=await createLesson('Отмена отправки'),other=await createLesson('Следующее занятие');
  await login(page,learner);await page.goto(studentRoute(lesson));const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:50,downloadThroughput:1048576,uploadThroughput:32768});
  async function start(lesson:Lesson){await expect(page.getByLabel('Файл работы')).toBeVisible();await page.getByLabel('Файл работы').setInputFiles({name:'slow.java',mimeType:'text/plain',buffer:Buffer.alloc(262144,65)});const post=page.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith(lessonPath(lesson)+'/homework'));await page.getByRole('button',{name:'Отправить на ревью',exact:true}).click();const request=await post;await expect(page.getByRole('button',{name:'Отправить на ревью',exact:true})).toBeDisabled();await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toHaveCount(0);return request;}
  const request=await start(lesson),cancelled=page.waitForEvent('requestfailed',event=>event===request);await page.getByRole('link',{name:'Все занятия',exact:true}).click();await cancelled;await expect(page).toHaveURL(`/learn/students/${student.id}/lessons`);await page.getByRole('link',{name:other.title,exact:true}).click();await expect(page.getByText('Работа отправлена на ревью.',{exact:true})).toHaveCount(0);
  await page.goto(studentRoute(other));const second=await start(other),accountCancelled=page.waitForEvent('requestfailed',event=>event===second);await logout(page);await accountCancelled;await expect(page.getByLabel('Файл работы')).toHaveCount(0);
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await cdp.detach();
  for(const target of [lesson,other])expect((await get<components['schemas']['HomeworkPage']>(learner.client,lessonPath(target)+'/homework')).total).toBe(0);
 });

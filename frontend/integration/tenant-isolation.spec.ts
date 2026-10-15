import {test, expect, APIRequestContext, Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import { signIn, signOut as logout } from '../testing/browser-session';
import type {components} from '../src/app/api/schema';

// Q-03: two real teacher workspaces and the admin never see each other's cards, files or screens; switching the account
// in one browser tab drops the previous session's pending requests and data (SessionStore.generation).
test.describe.configure({mode:'serial'});
const ready=JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!,'utf8'));
const credentials=JSON.parse(readFileSync(ready.credentialsPath,'utf8'));
const runtime=path.dirname(process.env['MENTOR_BROWSER_FIXTURE']!);
type Session=components['schemas']['Session'];
type Issue=components['schemas']['InvitationIssue'];
type Student=components['schemas']['TeacherStudentView'];
type Lesson=components['schemas']['TeacherLessonView'];
type User={login:string;client:APIRequestContext;session:Session};
const clients:APIRequestContext[]=[];
let admin:APIRequestContext,a:User,b:User,learner:User,learnerB:User,aCard:Student,bCard:Student,aRoot:string,bRoot:string,lesson:Lesson;
let newClient:()=>Promise<APIRequestContext>;
test.beforeAll(async({playwright})=>{newClient=async()=>{const value=await playwright.request.newContext({baseURL:ready.browserOrigin});clients.push(value);return value;};});
test.afterAll(async()=>{await Promise.all(clients.map(client=>client.dispose()));});
async function session(actor:APIRequestContext){const response=await actor.get('/api/v1/auth/session');expect(response.status()).toBe(200);return await response.json() as Session;}
async function send(actor:APIRequestContext,method:string,route:string,data?:unknown,multipart?:Record<string,unknown>){
    const current=await session(actor);
    const headers:Record<string,string>={Origin:ready.browserOrigin,'X-Mentor-Client':'web','X-CSRF-TOKEN':current.csrfToken};
    if(current.account&&!['/auth/login','/auth/register'].includes(route))headers['X-Mentor-Account']=current.account.userId;
    return actor.fetch('/api/v1'+route,{method,headers,...(multipart?{multipart:multipart as never}:data===undefined?{}:{data})});
}
async function write(actor:APIRequestContext,route:string,data:unknown,status=200){const response=await send(actor,'POST',route,data);expect(response.status(),route).toBe(status);return response.json();}
async function register(issue:Issue,login:string):Promise<User>{const actor=await newClient();const current=await write(actor,'/auth/register',{token:new URL(issue.link,ready.browserOrigin).searchParams.get('token'),login,password:credentials.password});return {login,client:actor,session:current};}
async function login(page:Page,login:string,home:string){await signIn(page,{login,password:credentials.password},home);}

test('real workspace A/B/admin boundaries and concurrent invitation/homework requests',async({page})=>{
    test.setTimeout(120000);
    admin=await newClient();await write(admin,'/auth/login',credentials);
    a=await register(await write(admin,'/admin/teacher-invitations',{}),'isolation-teacher-a');
    b=await register(await write(admin,'/admin/teacher-invitations',{}),'isolation-teacher-b');
    aRoot='/workspaces/'+a.session.account!.workspaceId;
    bRoot='/workspaces/'+b.session.account!.workspaceId;
    aCard=await write(a.client,aRoot+'/students',{name:'Изолированный ученик A',direction:'Java',notes:'PRIVATE_ISOLATION_A'},201);
    bCard=await write(b.client,bRoot+'/students',{name:'Изолированный ученик B',direction:'Java',notes:'PRIVATE_ISOLATION_B'},201);
    const card=aRoot+'/students/'+aCard.id;
    const invitation:Issue=await write(a.client,card+'/invitations',{});
    const token=new URL(invitation.link,ready.browserOrigin).searchParams.get('token');
    const contenders=await Promise.all([newClient(),newClient()]);
    const registrations=await Promise.all(contenders.map((actor,index)=>send(actor,'POST','/auth/register',{token,login:'isolation-student-a-'+index,password:credentials.password})));
    expect(registrations.filter(response=>response.status()===200)).toHaveLength(1);
    expect(registrations.filter(response=>response.status()>=400&&response.status()<500)).toHaveLength(1);
    const winner=registrations.findIndex(response=>response.status()===200);
    learner={login:'isolation-student-a-'+winner,client:contenders[winner],session:await registrations[winner].json()};
    learnerB=await register(await write(b.client,bRoot+'/students/'+bCard.id+'/invitations',{}),'isolation-student-b');
    lesson=await write(a.client,card+'/lessons',{title:'Проверка границ пространства',date:'2030-01-04',time:'12:00',duration:60},201);
    const route=card+'/lessons/'+lesson.id;
    for(const actor of [b.client,learnerB.client,admin]){
        expect((await actor.get('/api/v1'+route)).status()).toBe(404);
        expect((await actor.get('/api/v1'+route+'/homework')).status()).toBe(404);
        expect((await actor.get('/api/v1'+card+'/moves')).status()).toBe(404);
        expect((await actor.get('/api/v1'+card+'/roadmap')).status()).toBe(404);
        expect((await actor.get('/api/v1'+card+'/homework/turns')).status()).toBe(404);
    }
    expect((await learnerB.client.get('/api/v1'+aRoot+'/homework/turns')).status()).toBe(404);
    expect((await b.client.get('/api/v1'+aRoot+'/homework/turns')).status()).toBe(404);
    expect((await send(a.client,'POST',route+'/homework',undefined,{file:{name:'Teacher.java',mimeType:'text/plain',buffer:Buffer.from('synthetic preview must not submit')},comment:'Preview may not submit'})).status()).toBe(403);
    const payloads=['exact first synthetic source\r\n','exact second synthetic source\n'];
    const submitted=await Promise.all(payloads.map((source,index)=>send(learner.client,'POST',route+'/homework',undefined,{file:{name:'Main'+index+'.java',mimeType:'text/plain',buffer:Buffer.from(source)},comment:'Версия '+index})));
    expect(submitted.map(response=>response.status())).toEqual([201,201]);
    const records=await Promise.all(submitted.map(response=>response.json()));
    expect(new Set(records.map(record=>record.id)).size).toBe(2);
    for(const [index,record] of records.entries()){
        const file='/api/v1'+route+'/homework/'+record.id+'/file';
        const download=await a.client.get(file);expect(download.status()).toBe(200);expect(await download.body()).toEqual(Buffer.from(payloads[index]));
        for(const actor of [b.client,learnerB.client,admin]){expect((await actor.get(file)).status()).toBe(404);expect((await actor.head(file)).status()).toBe(404);}
        // Line comments and the text view of another workspace's work are equally invisible.
        expect((await b.client.get('/api/v1'+route+'/homework/'+record.id+'/text')).status()).toBe(404);
        expect((await send(b.client,'POST',route+'/code-comments',{targetKind:'homework',targetId:record.id,file:record.filename,line:1,body:'foreign'})).status()).toBe(404);
    }
    // T04: the schedule of one workspace belongs to its teacher only; B's own week with the same dates stays empty.
    const week='/schedule?from=2029-12-31&to=2030-01-06';
    const own=await (await a.client.get('/api/v1'+aRoot+week)).json();expect(own.items.map((item:{lesson:{id:string}})=>item.lesson.id)).toEqual([lesson.id]);
    for(const actor of [b.client,learner.client,learnerB.client,admin])expect((await actor.get('/api/v1'+aRoot+week)).status()).toBe(404);
    expect((await (await b.client.get('/api/v1'+bRoot+week)).json()).items).toEqual([]);
    await login(page,'isolation-teacher-b','/teacher/students');
    await page.getByRole('link',{name:'Расписание',exact:true}).first().click();await expect(page).toHaveURL('/teacher/schedule');
    await page.goto('/teacher/schedule?view=week&from=2030-01-04');await expect(page.getByText('31 декабря 2029 – 6 января 2030',{exact:true})).toBeVisible();
    await expect(page.getByText('На этой неделе занятий нет.',{exact:true})).toBeVisible();await expect(page.getByText('Проверка границ пространства',{exact:false})).toHaveCount(0);
    await logout(page);
    await login(page,'isolation-teacher-a','/teacher/students');await page.goto('/teacher/schedule?view=week&from=2030-01-04');
    const row=page.locator('.schedule-list > li').filter({hasText:'Проверка границ пространства'});await expect(row).toHaveCount(1);await expect(row).toContainText('Изолированный ученик A');await expect(row).toContainText('12:00–13:00');
    await row.getByRole('link',{name:/Проверка границ пространства/}).click();await expect(page).toHaveURL('/teacher/students/'+aCard.id+'/lessons/'+lesson.id);
    await logout(page);
    await login(page,credentials.login,'/admin/teachers');
    await page.goto('/teacher/students/'+aCard.id);await expect(page).toHaveURL('/not-found');
    await expect(page.getByText('Изолированный ученик A',{exact:true})).toHaveCount(0);
    await logout(page);
});

test('real account switch in one tab cancels the previous session\'s pending requests and shows no foreign data',async({page})=>{
    test.setTimeout(120000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const card=aRoot+'/students/'+aCard.id;
    await login(page,a.login,'/teacher/students');
    await page.goto('/teacher/students/'+aCard.id);
    await expect(page.getByRole('heading',{name:'Изолированный ученик A',exact:true})).toBeVisible();
    await expect(page.locator('body')).toContainText('PRIVATE_ISOLATION_A');
    // Hold the lesson list of card A at the network: the response is released only after another account owns the tab.
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});const heldUrls:string[]=[];
    await page.route(url=>url.pathname.endsWith(card+'/lessons'),async route=>{heldUrls.push(route.request().url());await held;await route.continue().catch(()=>{});});
    const failed:string[]=[];page.on('requestfailed',request=>{if(request.url().includes(card+'/lessons'))failed.push(request.failure()?.errorText??'failed');});
    await page.reload();
    await expect.poll(()=>heldUrls.length).toBe(1);
    await expect(page.getByText('Загружаем занятия…',{exact:true})).toBeVisible();
    await logout(page);
    await login(page,learnerB.login,'/learn');
    await expect(page.getByRole('heading',{name:'Изолированный ученик B',exact:true})).toBeVisible();
    release();
    await expect.poll(()=>failed.length,{message:'the pending request of the previous account was aborted'}).toBe(1);
    const body=page.locator('body');
    for(const foreign of ['PRIVATE_','Изолированный ученик A','Проверка границ пространства',a.login,'isolation-teacher'])await expect(body).not.toContainText(foreign);
    expect((await (await page.request.get('/api/v1/auth/session')).json()).account).toMatchObject({role:'STUDENT',workspaceId:b.session.account!.workspaceId});
    // A foreign card under the learner's own routes is an error without any of its data.
    await page.goto('/learn/students/'+aCard.id+'/lessons');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
    for(const foreign of ['Изолированный ученик A','Проверка границ пространства','PRIVATE_'])await expect(body).not.toContainText(foreign);
    await page.goto('/learn/students/'+bCard.id+'/lessons');
    await expect(page.getByRole('heading',{name:'Мои занятия',exact:true})).toBeVisible();
    await expect(body).not.toContainText('PRIVATE_');
    await page.screenshot({path:path.join(runtime,'real-tenant-switch.png'),fullPage:true});
    await page.unroute(url=>url.pathname.endsWith(card+'/lessons'));
    expect(errors).toEqual([]);
});

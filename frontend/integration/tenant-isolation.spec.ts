import {test, expect, APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {components} from '../src/app/api/schema';

const ready=JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!,'utf8'));
const credentials=JSON.parse(readFileSync(ready.credentialsPath,'utf8'));
type Session=components['schemas']['Session'];
type Issue=components['schemas']['InvitationIssue'];
const clients:APIRequestContext[]=[];
test.afterAll(async()=>{await Promise.all(clients.map(client=>client.dispose()));});

test('real workspace A/B/admin boundaries and concurrent invitation/homework requests',async({playwright,page})=>{
    test.setTimeout(120000);
    async function client(){const value=await playwright.request.newContext({baseURL:ready.browserOrigin});clients.push(value);return value;}
    async function session(actor:APIRequestContext){const response=await actor.get('/api/v1/auth/session');expect(response.status()).toBe(200);return await response.json() as Session;}
    async function send(actor:APIRequestContext,method:string,route:string,data?:unknown,multipart?:Record<string,unknown>){
        const current=await session(actor);
        const headers:Record<string,string>={Origin:ready.browserOrigin,'X-Mentor-Client':'web','X-CSRF-TOKEN':current.csrfToken};
        if(current.account&&!['/auth/login','/auth/register'].includes(route))headers['X-Mentor-Account']=current.account.userId;
        return actor.fetch('/api/v1'+route,{method,headers,...(multipart?{multipart:multipart as never}:data===undefined?{}:{data})});
    }
    async function write(actor:APIRequestContext,route:string,data:unknown,status=200){const response=await send(actor,'POST',route,data);expect(response.status(),route).toBe(status);return response.json();}
    async function register(issue:Issue,login:string){const actor=await client();await write(actor,'/auth/register',{token:new URL(issue.link,ready.browserOrigin).searchParams.get('token'),login,password:credentials.password});return actor;}
    const admin=await client();await write(admin,'/auth/login',credentials);
    const a=await register(await write(admin,'/admin/teacher-invitations',{}),'isolation-teacher-a');
    const b=await register(await write(admin,'/admin/teacher-invitations',{}),'isolation-teacher-b');
    const aRoot='/workspaces/'+(await session(a)).account!.workspaceId;
    const bRoot='/workspaces/'+(await session(b)).account!.workspaceId;
    const aCard=await write(a,aRoot+'/students',{name:'Изолированный ученик A',direction:'Java'},201);
    const bCard=await write(b,bRoot+'/students',{name:'Изолированный ученик B',direction:'Java'},201);
    const card=aRoot+'/students/'+aCard.id;
    const invitation:Issue=await write(a,card+'/invitations',{});
    const token=new URL(invitation.link,ready.browserOrigin).searchParams.get('token');
    const contenders=await Promise.all([client(),client()]);
    const registrations=await Promise.all(contenders.map((actor,index)=>send(actor,'POST','/auth/register',{token,login:'isolation-student-a-'+index,password:credentials.password})));
    expect(registrations.filter(response=>response.status()===200)).toHaveLength(1);
    expect(registrations.filter(response=>response.status()>=400&&response.status()<500)).toHaveLength(1);
    const learner=contenders[registrations.findIndex(response=>response.status()===200)];
    const learnerB=await register(await write(b,bRoot+'/students/'+bCard.id+'/invitations',{}),'isolation-student-b');
    const lesson=await write(a,card+'/lessons',{title:'Проверка границ пространства',date:'2030-01-04',time:'12:00',duration:60},201);
    const route=card+'/lessons/'+lesson.id;
    for(const actor of [b,learnerB,admin]){
        expect((await actor.get('/api/v1'+route)).status()).toBe(404);
        expect((await actor.get('/api/v1'+route+'/homework')).status()).toBe(404);
    }
    expect((await send(a,'POST',route+'/homework',undefined,{file:{name:'Teacher.java',mimeType:'text/plain',buffer:Buffer.from('synthetic preview must not submit')},comment:'Preview may not submit'})).status()).toBe(403);
    const payloads=['exact first synthetic source\r\n','exact second synthetic source\n'];
    const submitted=await Promise.all(payloads.map((source,index)=>send(learner,'POST',route+'/homework',undefined,{file:{name:'Main'+index+'.java',mimeType:'text/plain',buffer:Buffer.from(source)},comment:'Версия '+index})));
    expect(submitted.map(response=>response.status())).toEqual([201,201]);
    const records=await Promise.all(submitted.map(response=>response.json()));
    expect(new Set(records.map(record=>record.id)).size).toBe(2);
    for(const [index,record] of records.entries()){
        const file='/api/v1'+route+'/homework/'+record.id+'/file';
        const download=await a.get(file);expect(download.status()).toBe(200);expect(await download.body()).toEqual(Buffer.from(payloads[index]));
        for(const actor of [b,learnerB,admin]){expect((await actor.get(file)).status()).toBe(404);expect((await actor.head(file)).status()).toBe(404);}
    }
    await page.goto('/login');await page.locator('[name=login]').fill(credentials.login);await page.locator('[name=password]').fill(credentials.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page).toHaveURL('/admin/teachers');
    await page.goto('/teacher/students/'+aCard.id);await expect(page).toHaveURL('/not-found');
    await expect(page.getByText('Изолированный ученик A',{exact:true})).toHaveCount(0);
});

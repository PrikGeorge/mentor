// Test-only production-build server. The private runtime fixture is never served.
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const assets=path.join(root,'frontend/dist/mentor/browser');
const privatePath=process.env.MENTOR_PRACTICE_FIXTURE;
if(!privatePath)throw new Error('Private synthetic worker fixture path is required.');
let fixture;try{fixture=JSON.parse(await readFile(privatePath,'utf8'));}catch{throw new Error('Cannot read synthetic worker fixture metadata.');}
const origin=new URL(fixture.publicOrigin),backend=new URL(fixture.backendOrigin);
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.port==='4173'||backend.protocol!=='http:'||backend.hostname!=='127.0.0.1')throw new Error('Only isolated loopback browser/backend origins are allowed.');
const edge=await readFile(path.join(root,'infra/proxy/Caddyfile'),'utf8');
const csp=edge.match(/Content-Security-Policy "([^"]+)"/)?.[1],privatePattern=edge.match(/path_regexp private (.+)/)?.[1];
if(!csp||!privatePattern)throw new Error('Cannot read canonical edge policies.');
const blocked=new RegExp(privatePattern.replace(/^\(\?i\)/,''),'i');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==origin.host){res.writeHead(400);res.end();return;}
  const pathname=decodeURIComponent(new URL(req.url,origin).pathname);
  if(blocked.test(pathname)||pathname.startsWith('/api/')&&!pathname.startsWith('/api/v1/')){res.writeHead(404,{'Cache-Control':'no-store'});res.end('Not found');return;}
  if(pathname==='/api/v1'||pathname.startsWith('/api/v1/')){
   // Keep the browser's exact Host and Origin; strip caller-supplied forwarding headers.
   const headers={...req.headers};delete headers.forwarded;delete headers['x-forwarded-host'];
   const upstream=httpRequest(new URL(req.url,backend),{method:req.method,headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Synthetic backend unavailable');});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let file=path.resolve(assets,'.'+pathname);if(!file.startsWith(assets+path.sep)){res.writeHead(404);res.end();return;}
  try{if(!(await stat(file)).isFile())throw new Error('not file');}catch{
   if(pathname==='/'||/^\/(login|register|reset-password|account|teacher|learn|admin|not-found)(\/|$)/.test(pathname))file=path.join(assets,'index.html');else{res.writeHead(404);res.end();return;}
  }
  const info=await stat(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
});
server.listen(Number(origin.port),'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));

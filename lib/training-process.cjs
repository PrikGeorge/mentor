'use strict';
const {spawn} = require('node:child_process');

// Do not propagate Java option injection, classpaths, credentials, or unrelated app state.
function processEnvironment() {
  const allowed = new Set(['path','systemroot','windir','comspec','temp','tmp','home','userprofile','java_home','docker_host','docker_context','docker_config','docker_tls_verify','docker_cert_path']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore', env:processEnvironment()});
    killer.on('error', () => child.kill('SIGKILL'));
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}
function boundedProcess(command, args, {cwd, timeoutMs=15000, input='', outputLimit=65536, signal}={}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve({code:null,reason:'cancelled',stdout:'',stderr:''}); return; }
    let stdout=[], stderr=[], bytes=0, reason=null, finished=false;
    const child=spawn(command,args,{cwd,env:processEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],shell:false});
    const stop = why => { if (!reason) reason=why; killTree(child); };
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(() => stop('timeout'),Math.max(1,timeoutMs));
    function finish(code,error) {
      if(finished) return; finished=true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
      resolve({code,reason:reason||(error?'spawn_error':null),stdout:Buffer.concat(stdout).toString('utf8'),stderr:error?.message||Buffer.concat(stderr).toString('utf8')});
    }
    function collect(target,data) { const remaining=Math.max(0,outputLimit-bytes); target.push(data.subarray(0,remaining)); bytes+=data.length; if(bytes>outputLimit) stop('output_limit'); }
    child.stdout.on('data',data => collect(stdout,data)); child.stderr.on('data',data => collect(stderr,data));
    child.on('error',error => finish(null,error)); child.on('close',code => finish(code));
    child.stdin.on('error',() => {}); child.stdin.end(input);
  });
}
module.exports={boundedProcess};

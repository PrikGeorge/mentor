#Requires -Version 7.2
# Disposable HTTP/TLS smoke of the exact web image, also used as the private job gateway.
# Requires Docker and Node; all data is synthetic, ports are ephemeral, cleanup uses owned IDs only.
param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Image,
    [ValidateNotNullOrEmpty()][string]$NodeExecutable = 'node'
)
. (Join-Path $PSScriptRoot '../platform-common.ps1')
. (Join-Path $PSScriptRoot '../job-tls-common.ps1')
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$runId = [guid]::NewGuid().ToString('N')
$fixture = Join-Path $temporaryParent ('mentor-caddy-runtime-' + $runId)
New-Item -ItemType Directory -Path $fixture | Out-Null
$containers = [Collections.Generic.List[string]]::new()
$networkId = $null; $nodeProcess = $null; $certificate = $null; $failure = $null
$cleanupFailures = [Collections.Generic.List[string]]::new()
function New-OwnedContainer([string[]]$Arguments) {
    $containerId = (Invoke-MentorDocker $Arguments | Out-String).Trim()
    Require ($containerId -match '^[a-f0-9]{64}$') 'Expected one owned container ID.'
    $containers.Add($containerId)
    return $containerId
}
function Get-LoopbackPort([string]$ContainerId, [string]$ContainerPort) {
    $inspection = (Invoke-MentorDocker @('inspect',$ContainerId) | Out-String | ConvertFrom-Json)[0]
    Require ($inspection.Image -ceq $imageId) 'Container did not use the inspected image ID.'
    $bindings = @($inspection.NetworkSettings.Ports.$ContainerPort)
    Require ($bindings.Count -eq 1 -and $bindings[0].HostIp -ceq '127.0.0.1') 'Port must be published on loopback only.'
    $port = [int]$bindings[0].HostPort
    Require ($port -gt 0 -and $port -notin @(4173,4201)) 'A reserved port was allocated.'
    return $port
}
$nodeSource = @'
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [mode, directory, argument, gatewayArgument] = process.argv.slice(2);
const binary = Buffer.from(Array.from({length: 65537}, (_, i) => i % 251));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requestsFile = path.join(directory, 'requests.jsonl');
const countRequests = () => fs.readFileSync(requestsFile, 'utf8').trim().split('\n').filter(Boolean).length;
if (mode === 'serve') {
  fs.writeFileSync(requestsFile, '');
  const server = http.createServer(async (request, response) => {
    try {
      fs.appendFileSync(requestsFile, JSON.stringify({method: request.method, url: request.url}) + '\n');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (request.url === '/api/v1/download') {
        response.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="synthetic.bin"'});
        response.end(binary);
      } else {
        response.writeHead(200, {'Content-Type': 'application/json', 'Set-Cookie': 'synthetic_session=fixture-only; Path=/; HttpOnly; SameSite=Lax'});
        response.end(JSON.stringify({method: request.method, url: request.url, headers: request.headers,
          size: body.length, sha256: hash(body), text: body.toString('utf8')}));
      }
    } catch (error) { response.destroy(error); }
  });
  server.listen(0, argument, () => fs.writeFileSync(path.join(directory, 'mock-port.txt'), String(server.address().port)));
} else if (mode === 'check') {
  const webPort = Number(argument), gatewayPort = Number(gatewayArgument);
  const certificate = fs.readFileSync(path.join(directory, 'server.crt'));
  const checks = [];
  const pass = name => { checks.push(name); console.log('PASS ' + name); };
  const deadline = setTimeout(() => { console.error('Caddy HTTP/TLS smoke exceeded 90 seconds.'); process.exit(1); }, 90000);
  function request(options, body) {
    return new Promise((resolve, reject) => {
      const transport = options.protocol === 'https:' ? https : http;
      const outgoing = transport.request({hostname: '127.0.0.1', timeout: 10000, ...options}, response => {
        const chunks = [];
        const authorized = response.socket.authorized, alpn = response.socket.alpnProtocol;
        response.on('error', reject);
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks), authorized, alpn}));
      });
      outgoing.on('timeout', () => outgoing.destroy(new Error('HTTP request timed out')));
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }
  const web = (url, options = {}, body) => request({port: webPort, path: url, ...options}, body);
  const jobs = (url, options = {}, body) => request({protocol: 'https:', port: gatewayPort, path: url,
    servername: 'localhost', ca: certificate, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], ...options,
    headers: {Host: `localhost:${gatewayPort}`, ...options.headers}}, body);
  async function waitReady(operation) {
    let lastError;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { return await operation(); } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw lastError;
  }
  async function run() {
    const home = await waitReady(async () => { const response = await web('/'); assert.equal(response.status, 200); return response; });
    assert.match(home.body.toString(), /<html/);
    const deep = await web('/teacher/students');
    assert.equal(deep.status, 200); assert.equal(hash(deep.body), hash(home.body));
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.match(home.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(home.headers['referrer-policy'], 'no-referrer');
    assert.match(home.headers['permissions-policy'], /camera=\(\)/);
    pass('root/deep SPA content and security headers');
    assert.equal(home.headers['cache-control'], 'no-cache'); assert.equal(deep.headers['cache-control'], 'no-cache');
    const built = home.body.toString().match(/src="(main-[A-Za-z0-9_-]{8,}\.js)"/);
    assert.ok(built, 'Expected the hashed main bundle');
    const hashed = await web('/' + built[1]);
    assert.equal(hashed.status, 200); assert.equal(hashed.headers['cache-control'], 'public, max-age=31536000, immutable');
    const missing = await web('/chunk-MISSING1.js');
    assert.equal(missing.status, 404); assert.equal(missing.headers['cache-control'], 'no-store'); assert.doesNotMatch(missing.body.toString(), /<html/);
    const styles = home.body.toString().match(/href="(styles-[A-Za-z0-9_-]{8,}\.css)"/);
    assert.ok(styles, 'Expected the hashed stylesheet');
    const font = (await web('/' + styles[1])).body.toString().match(/url\("?(?:\.\/)?(media\/[^)"']+\.woff2)"?\)/);
    assert.ok(font, 'Expected a bundled font');
    const fontFile = await web('/' + font[1]);
    assert.equal(fontFile.status, 200); assert.equal(fontFile.headers['cache-control'], 'public, max-age=31536000, immutable');
    const worker = await web('/vendor/monaco/0.52.2/worker-bootstrap.js');
    assert.equal(worker.status, 200); assert.equal(worker.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(worker.headers['content-security-policy'], /default-src 'self'/);
    const unversioned = await web('/vendor/monaco/vs/loader.js');
    assert.equal(unversioned.status, 404); assert.equal(unversioned.headers['cache-control'], 'no-store');
    pass('FE-13 cache: hashed assets and versioned Monaco immutable, app shell revalidated, stale paths 404');
    const probe = await web('/api/v1/auth/session', {headers: {Host: `synthetic.mentor.invalid:${webPort}`,
      Forwarded: 'for=198.51.100.9;proto=https', 'X-Forwarded-Host': 'forged.invalid', 'X-Mentor-Client-Proto': 'forged'}});
    assert.equal(probe.status, 200);
    const echoed = JSON.parse(probe.body);
    assert.equal(echoed.url, '/api/v1/auth/session'); assert.equal(echoed.headers.host, `synthetic.mentor.invalid:${webPort}`);
    assert.equal(echoed.headers.forwarded, undefined); assert.equal(echoed.headers['x-forwarded-host'], undefined);
    assert.equal(echoed.headers['x-mentor-client-proto'], 'http'); assert.ok(echoed.headers['x-mentor-client-ip']);
    assert.deepEqual(probe.headers['set-cookie'], ['synthetic_session=fixture-only; Path=/; HttpOnly; SameSite=Lax']);
    const cookie = await web('/api/v1/cookie', {headers: {Cookie: probe.headers['set-cookie'][0].split(';')[0]}});
    assert.equal(JSON.parse(cookie.body).headers.cookie, 'synthetic_session=fixture-only');
    pass('API Host, cookie roundtrip and spoofed-header sanitation');
    const uploaded = await web('/api/v1/upload', {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}}, binary);
    assert.equal(uploaded.status, 200);
    const upload = JSON.parse(uploaded.body);
    assert.equal(upload.method, 'POST'); assert.equal(upload.size, binary.length); assert.equal(upload.sha256, hash(binary));
    const download = await web('/api/v1/download');
    assert.equal(download.status, 200); assert.equal(hash(download.body), hash(binary));
    assert.equal(download.headers['content-disposition'], 'attachment; filename="synthetic.bin"');
    pass('65537-byte upload/download and Content-Disposition');
    const beforePrivate = countRequests();
    for (const url of ['/internal/v1/jobs/claim', '/actuator/health', '/private/probe', '/data/probe', '/.git/config',
      '/.runtime/probe', '/api/materials/probe', '/api/downloads/probe', '/api/unknown']) {
      const denied = await web(url); assert.equal(denied.status, 404, url); assert.equal(denied.headers['cache-control'], 'no-store', url);
    }
    assert.equal(countRequests(), beforePrivate, 'A private web route reached upstream');
    pass('nine private/legacy web paths rejected without upstream access');
    await waitReady(async () => { assert.equal((await jobs('/')).status, 404); });
    await assert.rejects(() => jobs('/', {ca: []}), /self.signed|certificate|issuer/i);
    const jobBody = Buffer.from(JSON.stringify({worker: 'synthetic-worker', message: 'Проверка TLS'}));
    const markers = {Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json', Origin: 'https://synthetic.invalid',
      Cookie: 'mentor_session=synthetic-only', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors'};
    const first = await jobs('/internal/v1/jobs/claim', {method: 'POST', headers: markers}, jobBody);
    assert.equal(first.status, 200); assert.equal(first.authorized, true); assert.equal(first.alpn, 'http/1.1');
    function verifyJob(responseBody) {
      const echoed = JSON.parse(responseBody);
      assert.equal(echoed.method, 'POST'); assert.equal(echoed.url, '/internal/v1/jobs/claim');
      assert.equal(echoed.sha256, hash(jobBody)); assert.equal(echoed.size, jobBody.length);
      for (const [name, value] of Object.entries(markers)) assert.equal(echoed.headers[name.toLowerCase()], value, name);
    }
    verifyJob(first.body);
    pass('gateway verified TLS/HTTP1, untrusted-certificate rejection, Bearer/body/browser markers');
    const connection = http2.connect(`https://127.0.0.1:${gatewayPort}`, {servername: 'localhost', ca: certificate, rejectUnauthorized: true});
    connection.setTimeout(10000, () => connection.destroy(new Error('HTTP2 timeout')));
    try {
      await new Promise((resolve, reject) => { connection.once('connect', resolve); connection.once('error', reject); });
      assert.equal(connection.socket.authorized, true); assert.equal(connection.alpnProtocol, 'h2');
      const second = await new Promise((resolve, reject) => {
        const stream = connection.request({':method': 'POST', ':path': '/internal/v1/jobs/claim', ':authority': `localhost:${gatewayPort}`,
          ...Object.fromEntries(Object.entries(markers).map(([name, value]) => [name.toLowerCase(), value]))});
        const chunks = []; let status;
        stream.on('response', headers => { status = headers[':status']; });
        stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
        stream.on('end', () => resolve({status, body: Buffer.concat(chunks)})); stream.end(jobBody);
      });
      assert.equal(second.status, 200); verifyJob(second.body);
    } finally { connection.destroy(); }
    pass('gateway verified TLS/HTTP2 and request fidelity');
    const beforeGatewayDenied = countRequests();
    const asset = home.body.toString().match(/(?:src|href)="([^"?#]+\.(?:js|css))"/);
    assert.ok(asset, 'Expected an actual Angular asset');
    for (const url of ['/', '/index.html', '/api/v1/auth/session', '/internal/v1/other', '/private/probe', '/' + asset[1].replace(/^\//, '')]) {
      assert.equal((await jobs(url)).status, 404, url);
    }
    assert.equal(countRequests(), beforeGatewayDenied, 'A denied gateway route reached upstream');
    pass('gateway denies root/index/API/actual static asset without upstream access');
    fs.writeFileSync(path.join(directory, 'http-result.json'), JSON.stringify({completed: true, checks}));
  }
  run().then(() => clearTimeout(deadline), error => { console.error(error); process.exitCode = 1; clearTimeout(deadline); });
} else { throw new Error('Unknown fixture mode'); }
'@
try {
    $imageId = (Invoke-MentorDocker @('image','inspect',$Image,'--format','{{.Id}}') | Out-String).Trim()
    Require ($imageId -match '^sha256:[a-f0-9]{64}$') 'Expected one existing image ID; the smoke never pulls images.'
    $nodeCommand = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop).Source
    $nodeScript = Join-Path $fixture 'fixture.cjs'
    [IO.File]::WriteAllText($nodeScript, $nodeSource)
    $networkId = (Invoke-MentorDocker @('network','create','--label',('mentor.qa.caddy-runtime=' + $runId),('mentor-caddy-' + $runId)) | Out-String).Trim()
    Require ($networkId -match '^[a-f0-9]{64}$') 'Expected an owned network ID.'
    $mockBind = '127.0.0.1'; $upstreamAddress = 'host.docker.internal'
    if (-not $IsWindows) {
        $network = (Invoke-MentorDocker @('network','inspect',$networkId) | Out-String | ConvertFrom-Json)[0]
        $mockBind = [string]$network.IPAM.Config[0].Gateway
        $parsedAddress = $null
        Require ([Net.IPAddress]::TryParse($mockBind, [ref]$parsedAddress)) 'Owned bridge gateway is not an IP address.'
        $upstreamAddress = $mockBind
    }
    $start = [Diagnostics.ProcessStartInfo]::new($nodeCommand)
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    foreach ($argument in @($nodeScript,'serve',$fixture,$mockBind)) { $start.ArgumentList.Add($argument) }
    $nodeProcess = [Diagnostics.Process]::Start($start)
    $mockPortPath = Join-Path $fixture 'mock-port.txt'
    for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $mockPortPath); $attempt++) {
        Require (-not $nodeProcess.HasExited) 'Synthetic Node upstream exited before becoming ready.'
        Start-Sleep -Milliseconds 100
    }
    Require (Test-Path -LiteralPath $mockPortPath) 'Synthetic Node upstream did not become ready.'
    $mockPort = [int](Get-Content -LiteralPath $mockPortPath -Raw)
    Require ($mockPort -gt 0 -and $mockPort -notin @(4173,4201)) 'Mock allocated a reserved port.'
    $sharedArguments = @('--detach','--pull=never','--label',('mentor.qa.caddy-runtime=' + $runId),'--network',$networkId,
        '--read-only','--tmpfs','/data','--tmpfs','/config','--env',("MENTOR_BACKEND_UPSTREAM=${upstreamAddress}:$mockPort"))
    $webId = New-OwnedContainer (@('run') + $sharedArguments + @('--name',('mentor-caddy-web-' + $runId),
        '--publish','127.0.0.1::80','--env','MENTOR_SITE_ADDRESS=:80',$imageId))
    $webPort = Get-LoopbackPort $webId '80/tcp'
    $certificate = New-MentorSelfSignedServerCertificate -Hostnames @('localhost') -IpAddresses @('127.0.0.1') -ValidityDays 1 -KeyBits 2048
    [IO.File]::WriteAllText((Join-Path $fixture 'server.crt'), $certificate.CertificatePem)
    [IO.File]::WriteAllText((Join-Path $fixture 'server.key'), $certificate.PrivateKeyPem)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../proxy/Jobs.Caddyfile') -Destination (Join-Path $fixture 'Jobs.Caddyfile')
    $dockerFixture = ConvertTo-MentorDockerPath $fixture
    $jobsId = New-OwnedContainer (@('run') + $sharedArguments + @('--name',('mentor-caddy-jobs-' + $runId),
        '--publish','127.0.0.1::8443','--env','MENTOR_JOB_ADDRESS=https://localhost:8443',
        '--mount',("type=bind,source=$dockerFixture,target=/run/mentor-tls,readonly"),
        '--mount',("type=bind,source=$dockerFixture/Jobs.Caddyfile,target=/etc/caddy/Caddyfile,readonly"),$imageId))
    $jobsPort = Get-LoopbackPort $jobsId '8443/tcp'
    & $nodeCommand $nodeScript check $fixture $webPort $jobsPort
    Require ($LASTEXITCODE -eq 0) 'Caddy HTTP/TLS assertions failed.'
    $httpResult = Get-Content -LiteralPath (Join-Path $fixture 'http-result.json') -Raw | ConvertFrom-Json
    Require ($httpResult.completed -eq $true -and @($httpResult.checks).Count -eq 8) 'Incomplete HTTP/TLS smoke result.'
    $health = (Invoke-MentorDocker @('exec',$webId,'wget','-qO-','http://127.0.0.1:8080/healthz') | Out-String).Trim()
    Require ($health -ceq 'ok') 'Internal readiness failed.'
    Write-Output 'PASS internal loopback readiness'
    Invoke-MentorDocker @('exec',$webId,'caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile') | Out-Null
    $adapted = Invoke-MentorDocker @('exec',$jobsId,'caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile','--validate') | Out-String | ConvertFrom-Json
    Require ($null -ne $adapted.apps.http) 'Jobs adapt did not produce HTTP configuration.'
    Write-Output 'PASS web validate and Jobs adapt/validate'
    $version = (Invoke-MentorDocker @('exec',$webId,'caddy','version') | Out-String).Trim()
    $buildInfo = (Invoke-MentorDocker @('exec',$webId,'caddy','build-info') | Out-String).Trim()
    $modules = (Invoke-MentorDocker @('exec',$webId,'caddy','list-modules','--packages','--versions') | Out-String).Trim()
    $nonStandardModules = (Invoke-MentorDocker @('exec',$webId,'caddy','list-modules','--skip-standard') | Out-String).Trim()
    Require ($version -match '^v2\.' -and $buildInfo -match 'go1\.' -and $buildInfo -match 'golang.org/x/net') 'Caddy version/build metadata is missing.'
    Require ($modules -match '(?m)^\s*Standard modules:\s*[1-9][0-9]*\s*$' -and [string]::IsNullOrWhiteSpace($nonStandardModules)) 'Unexpected non-standard/unknown Caddy modules.'
    $capabilities = (Invoke-MentorDocker @('exec',$webId,'getcap','/usr/bin/caddy') | Out-String).Trim()
    Require ($capabilities -match 'cap_net_bind_service=ep') 'Caddy low-port capability is missing.'
    Write-Output 'PASS standard modules, binary version/build metadata and low-port capability'
    [ordered]@{imageId=$imageId; version=$version; buildInfo=$buildInfo; modules=$modules; httpChecks=@($httpResult.checks)} | ConvertTo-Json -Depth 4
} catch { $failure = $_ } finally {
    foreach ($containerId in $containers) {
        if ($failure) { try { Invoke-MentorDocker @('logs',$containerId) 2>&1 | Write-Output } catch { Write-Warning "Cannot read owned container log: $_" } }
        try {
            Invoke-MentorDocker @('rm','--force',$containerId) | Out-Null
        } catch { $cleanupFailures.Add("Container $containerId : $_") }
    }
    if ($networkId -and $networkId -match '^[a-f0-9]{64}$') {
        try { Invoke-MentorDocker @('network','rm',$networkId) | Out-Null } catch { $cleanupFailures.Add("Network $networkId : $_") }
    }
    if ($nodeProcess) {
        try { if (-not $nodeProcess.HasExited) { $nodeProcess.Kill($true); $nodeProcess.WaitForExit() }; $nodeProcess.Dispose() }
        catch { $cleanupFailures.Add("Synthetic Node process: $_") }
    }
    if ($certificate) { $certificate.Certificate.Dispose() }
    try {
        $resolved = [IO.Path]::GetFullPath($fixture)
        Require ((Split-Path -Parent $resolved) -ceq $temporaryParent -and (Split-Path -Leaf $resolved) -ceq ('mentor-caddy-runtime-' + $runId)) 'Refusing cleanup outside the owned fixture directory.'
        Remove-MentorOwnedDirectory $resolved $temporaryParent
    } catch { $cleanupFailures.Add("Synthetic files: $_") }
}
foreach ($cleanupFailure in $cleanupFailures) { Write-Warning $cleanupFailure }
if ($failure) { throw $failure }
Require ($cleanupFailures.Count -eq 0) 'Owned resource cleanup failed.'
Write-Output 'PASS Caddy runtime smoke; all owned resources removed.'

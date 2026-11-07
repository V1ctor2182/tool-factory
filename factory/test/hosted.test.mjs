import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { KINDS } from '../lib/registry.mjs';
import { copyRepo, REPO } from './repo.mjs';

const TOKEN = 'test-push-token-that-is-long-enough-to-pass';
const SECRET = 'SECRET-form-value-555-0100';
const LONG_ATTEMPT = '0123456789abcdef0123456789abcdef';
const MINUTE = 60_000;
const SOURCES = 'game-studio,tools';

const ALLOWED_KEYS = new Set([
  'sources', 'source', 'label', 'flows', 'loop', 'error', 'lastPush', 'stale',
  'id', 'title', 'subtitle', 'state', 'startedAt', 'endedAt', 'lastAt', 'agents', 'working', 'loops', 'backEdges', 'stages',
  'from', 'to', 'count',
  'name', 'role', 'traced',
  'live', 'root', 'kind', 'category', 'start', 'end', 'outcome', 'children',
]);

const base = mkdtempSync(join(tmpdir(), 'factory-hosted-'));
const root = join(base, 'repo');
const studio = join(base, 'studio');
const production = join(studio, '.studio-local', 'production');
const originHome = join(base, 'origin-home');
const factory = join(root, 'factory', 'bin', 'factory.mjs');
const hostedEntry = join(root, 'factory', 'dashboard', 'hosted.mjs');
const running = [];
let shape;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });
const when = (min) => Date.parse(`2026-10-01T10:${String(min).padStart(2, '0')}:00Z`) / 1000;
const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
const use = (at, id, name, input) => ({ type: 'assistant', timestamp: at, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } });
const answered = (at, id) => ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: SECRET }] } });

function events(id, records) {
  mkdirSync(join(production, 'attempts', `${id}.control`), { recursive: true });
  writeFileSync(join(production, 'attempts', `${id}.control`, 'events.jsonl'), jsonl(records));
}

function seedStudio() {
  mkdirSync(join(production, 'agent-runs'), { recursive: true });
  writeFileSync(join(production, 'agent-runs', 'done1.json'), JSON.stringify({ cost_usd: 1.25, ended_at: when(11) }));
  const db = new DatabaseSync(join(production, 'production.sqlite3'));
  db.exec(`CREATE TABLE tasks (id TEXT, logical_key TEXT, spec TEXT, current INTEGER, state TEXT, revision INTEGER, error TEXT, review_id TEXT);
    CREATE TABLE attempts (id TEXT, task_id TEXT, kind TEXT, role TEXT, runtime TEXT, state TEXT, started REAL, ended_at REAL, heartbeat_at REAL, generation INTEGER, process TEXT, result TEXT);
    CREATE TABLE plans (id TEXT, created REAL, body TEXT);
    CREATE TABLE publications (operation_id TEXT, task_id TEXT, review TEXT, created_at REAL);
    CREATE TABLE events (at REAL, kind TEXT, body TEXT);`);
  const task = db.prepare('INSERT INTO tasks (id, logical_key, spec, current, state, revision, error, review_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  task.run('t-done', 'battle/implementation', SECRET, 1, 'accepted', 1, null, null);
  task.run('t-live', 'night/implementation', SECRET, 1, 'ready', 1, SECRET, null);
  task.run('t-gate', 'gate/model3d', SECRET, 1, 'awaiting_review', 1, null, 'review-1');
  const attempt = db.prepare('INSERT INTO attempts (id, task_id, kind, role, runtime, state, started, ended_at, generation, process, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
  attempt.run('plan1', '@planner', 'planner', 'planner', 'claude', 'completed', when(0), when(1), null, null);
  attempt.run('done1', 't-done', 'worker', 'worker', 'claude', 'completed', when(10), when(11), null, JSON.stringify({ result: { note: SECRET } }));
  attempt.run(LONG_ATTEMPT, 't-done', 'verifier', 'verifier', 'claude', 'completed', when(12), when(13), null, null);
  attempt.run('live1', 't-live', 'worker', 'worker', 'claude', 'active', when(20), null, JSON.stringify({ pid: process.pid }), null);
  attempt.run('gate1', 't-gate', 'worker', 'worker', 'claude', 'completed', when(30), when(31), null, null);
  db.prepare('INSERT INTO plans VALUES (?, ?, ?)').run('p1', when(1), SECRET);
  db.prepare('INSERT INTO publications VALUES (?, ?, ?, ?)').run('op1', 't-gate', JSON.stringify({ id: 'review-1', text: SECRET }), when(32));
  db.close();
  events('done1', [
    use('2026-10-01T10:10:10Z', 'b1', 'Bash', { command: `API_KEY="${SECRET} two words" /usr/bin/git push ${SECRET}` }),
    answered('2026-10-01T10:10:20Z', 'b1'),
    use('2026-10-01T10:10:21Z', 'toolu_01JCvhyLLT5qbuF3nDAMSLc6', 'Read', { file_path: '/Users/someone/private/notes.txt' }),
    answered('2026-10-01T10:10:22Z', 'toolu_01JCvhyLLT5qbuF3nDAMSLc6'),
    use('2026-10-01T10:10:23Z', 'p1', '/Users/someone/private/odd-tool.sh', {}),
    answered('2026-10-01T10:10:24Z', 'p1'),
    use('2026-10-01T10:10:25Z', 'u1', 'https://internal.example.com/hook', {}),
    answered('2026-10-01T10:10:26Z', 'u1'),
    { type: 'result', subtype: 'success', result: SECRET },
  ]);
  events('live1', [use('2026-10-01T10:20:05Z', 'g1', 'Grep', { pattern: SECRET })]);
}

const atomCall = (name, at, extra) => ({ type: 'atom', name, verb: 'run', kind: 'observe', startedAt: at, ms: 1000, ok: true, cacheHit: false, costUsd: 0.5, caller: 'podcast', ...extra });

function seedTools() {
  mkdirSync(originHome, { recursive: true });
  writeFileSync(join(originHome, 'runs.jsonl'), jsonl([atomCall('page-record', '2026-10-03T10:00:01Z'), atomCall('ui-draft', '2026-10-03T10:00:03Z', { ok: false, error: `over_budget in /Users/someone/${SECRET}` })]));
}

function startProcess(argv, env) {
  const child = spawn(process.execPath, argv, { env: { ...process.env, ...env } });
  running.push(child);
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const port = out.match(/:(\d+)\//)?.[1];
      if (port) resolve({ url: `http://127.0.0.1:${port}`, port, child });
    });
    child.on('close', (code) => reject(new Error(`the server exited ${code}`)));
  });
}

const startServer = (args, env) => startProcess([factory, 'dashboard', ...args], env);
const startHosted = (env) => startProcess([hostedEntry], env);

async function hosted(name) {
  const home = join(base, name);
  mkdirSync(home, { recursive: true });
  const { url, port } = await startHosted({ FACTORY_PUSH_TOKEN: TOKEN, TOOL_FACTORY_HOME: home, PORT: '0' });
  return { home, url, port };
}

function pushHomeFrom(name) {
  const pushHome = join(base, name);
  cpSync(originHome, pushHome, { recursive: true });
  return pushHome;
}

function factoryRun(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [factory, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const pushTo = (url, pushHome, sources = SOURCES, extra = []) => factoryRun(['push', url, '--sources', sources, ...extra], { TOOL_FACTORY_HOME: pushHome, FACTORY_PUSH_TOKEN: TOKEN });
const scanOf = (pushHome, sources = SOURCES) => factoryRun(['push', '--scan', '--sources', sources], { TOOL_FACTORY_HOME: pushHome, FACTORY_PUSH_TOKEN: '' });

const flatten = (node) => (node.kind === 'group' ? [node, ...node.children.flatMap(flatten)] : [node]);
const get = (url, path, headers = {}) => fetch(`${url}${path}`, { headers, redirect: 'manual' });
const getJson = async (url, path) => (await get(url, path)).json();
const putBlob = (url, body, name = sha(body), headers = bearer()) => fetch(`${url}/ingest/blob/${name}`, { method: 'PUT', headers, body });
const putManifest = (url, source, manifest) => fetch(`${url}/ingest/source/${source}`, { method: 'PUT', headers: bearer(), body: JSON.stringify(manifest) });
const hostedFile = (home, ...parts) => join(home, 'hosted', ...parts);
const flowPath = (id) => `/api/flows/${encodeURIComponent(id)}`;
const tracePath = (id, agent) => `${flowPath(id)}/agents/${encodeURIComponent(agent)}`;
const sourceOf = async (url, name) => (await getJson(url, '/api/flows')).sources.find((s) => s.source === name);

const flowBlob = (extra) => ({ id: 'tools:a', source: 'tools', title: 'A run', subtitle: 'run', state: 'done', startedAt: '2026-10-03T10:00:01.000Z', endedAt: null, lastAt: null, agents: 0, working: 0, loops: 0, ...extra });
const listBlob = (source, label, flows = []) => ({ source, label, flows, error: null });
const traceBlob = (extra) => ({ title: 'A run', subtitle: 'run', startedAt: '2026-10-03T10:00:01.000Z', live: false, root: { kind: 'group', id: 'flow', name: 'A run', role: 'coordinator', start: 0, end: 1, children: [] }, ...extra });
const manifestFor = (source, label, list, extra) => ({ source, label, error: null, list, flows: {}, traces: {}, ...extra });

function everyKey(value, seen = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => everyKey(item, seen));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      seen.add(key);
      everyKey(item, seen);
    }
  }
  return seen;
}

async function everyPublicAnswer(url) {
  const answers = [await getJson(url, '/api/flows')];
  for (const source of answers[0].sources) {
    for (const id of [...(source.loop ? [source.loop.id] : []), ...source.flows.map((f) => f.id)]) {
      const flow = await getJson(url, flowPath(id));
      answers.push(flow);
      for (const agent of flow.stages.flatMap((s) => s.agents)) answers.push(await getJson(url, tracePath(id, agent.id)));
    }
  }
  return answers;
}

// Rewinds what the server recorded as its last receipt from this source, the way a machine that went away would leave it.
function loseMachine(home, source, ago = 6 * MINUTE) {
  writeFileSync(hostedFile(home, 'sources', `${source}.heartbeat.json`), JSON.stringify({ source, at: new Date(Date.now() - ago).toISOString() }));
}

before(async () => {
  copyRepo(root);
  seedStudio();
  seedTools();
  writeFileSync(join(root, 'external.json'), JSON.stringify([
    { name: 'game-studio', description: 'd', where: studio, flows: 'game-studio' },
    { name: 'job-applier', description: 'd', where: 'http://127.0.0.1:9', flows: 'job-applier' },
  ]));
  shape = await import(join(root, 'factory', 'lib', 'public-flows.mjs'));
});

after(() => {
  for (const child of running) child.kill();
  rmSync(base, { recursive: true, force: true });
});

test('the public server refuses to start without a push token of at least 32 characters, and never prints it', () => {
  const boot = (env) => spawnSync(process.execPath, [hostedEntry], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, FACTORY_PUSH_TOKEN: '', TOOL_FACTORY_HOME: join(base, 'refused'), ...env } });
  for (const env of [{}, { FACTORY_PUSH_TOKEN: 'x'.repeat(31) }]) {
    const done = boot(env);
    assert.equal(done.status, 1, JSON.stringify(env));
    assert.match(done.stderr, /FACTORY_PUSH_TOKEN.*32/);
    assert.equal(done.stdout, '');
    assert.equal(done.stderr.includes('xxxxx'), false);
  }
});

test('a 32-character token boots, on PORT, for any Host, and the flows open with no login', async () => {
  const home = join(base, 'port-home');
  const free = await new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  const { url, port } = await startHosted({ FACTORY_PUSH_TOKEN: 'y'.repeat(32), FACTORY_PASSWORD: '', TOOL_FACTORY_HOME: home, PORT: String(free) });
  assert.equal(Number(port), free);
  const status = await new Promise((resolve) => request({ port: free, host: '127.0.0.1', path: '/healthz', headers: { host: 'something.up.railway.app' } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
  assert.equal(status, 200);
  for (const path of ['/flows', '/flows/tools:a', '/flows/tools:a/call-0', '/api/flows']) {
    const res = await get(url, path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('www-authenticate'), null, path);
  }
  assert.equal((await get(url, '/')).status, 200);
  assert.equal((await (await get(url, '/healthz')).text()), 'ok\n');
});

test('ingest refuses no token and a wrong token on every route', async () => {
  const { url } = await hosted('auth-home');
  const body = JSON.stringify(listBlob('tools', 'Factory tools'));
  const calls = [
    (headers) => fetch(`${url}/ingest/missing`, { method: 'POST', headers, body: JSON.stringify({ shas: [] }) }),
    (headers) => putBlob(url, body, sha(body), headers),
    (headers) => fetch(`${url}/ingest/source/tools`, { method: 'PUT', headers, body: JSON.stringify(manifestFor('tools', 'Factory tools', sha(body))) }),
    (headers) => fetch(`${url}/ingest/heartbeat/tools`, { method: 'POST', headers }),
  ];
  for (const call of calls) {
    assert.equal((await call({})).status, 401);
    assert.equal((await call(bearer('wrong-token-that-is-also-long-enough-to-pass'))).status, 401);
    assert.equal((await call({ authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}` })).status, 401);
  }
  assert.equal((await sourceOf(url, 'tools')).lastPush, null, 'none of them wrote');
  assert.equal((await calls[0](bearer())).status, 200);
  assert.equal((await calls[1](bearer())).status, 200);
});

test('only the public pages answer: runs and repo files are 404, and nothing but ingest writes', async () => {
  const { url } = await hosted('pages-home');
  const paths = ['/external.json', '/flows.html', '/factory/lib/runs.mjs', '/hosted.mjs', '/%2e%2e/external.json', '/api/status', '/api/flows/x/y/z', '/run/youtube/transcript'];
  for (const path of paths) {
    const res = await get(url, path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'Not found.\n', path);
  }
  for (const path of ['/run/youtube/transcript', '/flows', '/api/flows', '/healthz']) {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"input":"x"}' });
    assert.equal(res.status, 404, `POST ${path}`);
  }
  const page = await get(url, '/flows');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /<body data-hosted>/);
  const api = await get(url, '/api/flows');
  assert.match(api.headers.get('cache-control'), /^public, max-age=\d$/);
  assert.equal((await get(url, '/ingest/missing')).status, 401);
});

test('a blob must hash to its name, fit the limit, and carry a clean name', async () => {
  const { url, home } = await hosted('blob-home');
  const body = JSON.stringify(flowBlob());
  assert.equal((await putBlob(url, body, sha('something else'))).status, 400);
  assert.equal((await putBlob(url, body)).status, 200);
  assert.equal(readFileSync(hostedFile(home, 'blobs', `${sha(body)}.json`), 'utf8'), body);
  assert.equal((await putBlob(url, 'not json')).status, 400);

  const big = `"${'x'.repeat(8 * 1024 * 1024)}"`;
  assert.equal((await putBlob(url, big)).status, 413);
  assert.equal(existsSync(hostedFile(home, 'blobs', `${sha(big)}.json`)), false);
  assert.equal((await fetch(`${url}/ingest/missing`, { method: 'POST', headers: bearer(), body: big })).status, 413);

  const missing = await fetch(`${url}/ingest/missing`, { method: 'POST', headers: bearer(), body: JSON.stringify({ shas: [sha(body), sha('absent')] }) });
  assert.deepEqual(await missing.json(), { missing: [sha('absent')] });
  assert.equal((await fetch(`${url}/ingest/missing`, { method: 'POST', headers: bearer(), body: JSON.stringify({ shas: ['../../etc/passwd'] }) })).status, 400);
});

test('names that could leave the store are refused', async () => {
  const { url, home } = await hosted('traversal-home');
  writeFileSync(join(home, 'outside.json'), 'keep');
  const body = JSON.stringify(flowBlob());
  for (const name of ['..%2F..%2Foutside', '..%2f..%2foutside.json', sha(body).toUpperCase(), `${sha(body)}%2F`, 'short']) {
    assert.equal((await fetch(`${url}/ingest/blob/${name}`, { method: 'PUT', headers: bearer(), body })).status, 400, name);
  }
  for (const name of ['..%2F..%2Foutside', '.hidden', 'nosuchsource', 'tools%2F..%2F..%2Foutside', 'TOOLS']) {
    assert.equal((await fetch(`${url}/ingest/source/${name}`, { method: 'PUT', headers: bearer(), body: '{}' })).status, 403, name);
    assert.equal((await fetch(`${url}/ingest/heartbeat/${name}`, { method: 'POST', headers: bearer() })).status, 403, name);
  }
  assert.equal(readFileSync(join(home, 'outside.json'), 'utf8'), 'keep');
  for (const path of ['/api/flows/..%2F..%2Foutside', '/api/flows/tools:..%2F..%2Foutside/agents/x', '/api/flows/__proto__:x']) {
    assert.equal((await get(url, path)).status, 404, path);
  }
});

test('a request the URL parser rejects costs that request, not the server', async () => {
  const { url, port } = await hosted('badurl-home');
  assert.equal((await get(url, '/api/flows/%E0%A4%A')).status, 400);
  const raw = await new Promise((resolve) => {
    const socket = connect(Number(port), '127.0.0.1', () => socket.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let text = '';
    socket.on('data', (c) => (text += c));
    socket.on('close', () => resolve(text));
  });
  assert.match(raw, /^HTTP\/1\.1 400/);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});

test('a server fault names no path in its answer', async () => {
  const { url, home } = await hosted('fault-home');
  const list = JSON.stringify(listBlob('tools', 'Factory tools'));
  await putBlob(url, list);
  await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(list)));
  writeFileSync(hostedFile(home, 'sources', 'tools.json'), 'not json');
  const res = await get(url, '/api/flows');
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(text, 'The request failed.\n');
  assert.equal(text.includes(home), false);
});

test('a manifest cannot name a blob the server does not hold, another source\'s list, or an extra field', async () => {
  const { url } = await hosted('manifest-home');
  const list = JSON.stringify(listBlob('tools', 'Factory tools'));
  await putBlob(url, list);
  const absent = sha('never sent');
  const answer = await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(list), { flows: { 'tools:a': absent } }));
  assert.equal(answer.status, 400);
  assert.deepEqual(await answer.json(), { missing: [absent] });
  assert.equal((await putManifest(url, 'tools', manifestFor('game-studio', 'Game Studio', sha(list)))).status, 400, 'a manifest for another source');
  assert.equal((await putManifest(url, 'tools', { source: 'tools' })).status, 400, 'an incomplete manifest');
  assert.equal((await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(list), { where: '/Users/someone' }))).status, 400, 'an old pusher\'s where');
  assert.equal((await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(list), { error: `ENOENT ${SECRET}` }))).status, 400, 'a raw exception as the error');
  assert.equal((await putManifest(url, 'game-studio', manifestFor('game-studio', 'Game Studio', sha(list)))).status, 400, 'another source\'s list');
  assert.equal((await fetch(`${url}/ingest/heartbeat/tools`, { method: 'POST', headers: bearer() })).status, 404, 'nothing stored yet');
  const { sources } = await getJson(url, '/api/flows');
  assert.deepEqual(sources.map((s) => s.source), ['game-studio', 'job-applier', 'tools']);
  for (const source of sources) assert.deepEqual([source.error, source.flows, source.lastPush, source.stale], ['No data pushed yet.', [], null, true], source.source);
  assert.equal((await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(list)))).status, 200);
  assert.ok((await sourceOf(url, 'tools')).lastPush);
});

test('a job leaves with only its number, state, times, roles, and categories', () => {
  const step = { kind: 'step', id: 'f1', name: 'Open Schonfeld careers', category: 'browser', start: 2, end: 3, outcome: 'ok', meta: 'Schonfeld' };
  const trace = shape.shapeTrace({
    source: 'job-applier', title: 'Software Engineer at Schonfeld', subtitle: 'Software Engineer at Schonfeld · Claude Applier', startedAt: '2026-10-02T09:00:00.000Z', live: false, state: 'done',
    root: { kind: 'group', id: 'worker', name: 'Schonfeld', role: 'worker', start: 0, end: 3, children: [{ kind: 'group', id: 'applier-1', name: 'Schonfeld', role: 'applier', start: 1, end: 3, children: [step] }] },
  });
  const flow = shape.shapeFlow({
    id: 'job-applier:829', source: 'job-applier', title: 'Job #829', subtitle: 'Software Engineer at Schonfeld · Claude Applier', state: 'done', startedAt: '2026-10-02T09:00:00.000Z',
    stages: [{ id: 'you', title: 'You', state: 'done', loops: 0, agents: [{ id: 'request-0', name: 'Schonfeld salary', role: 'you', state: 'done', traced: true }] }],
  });
  for (const answer of [trace, flow]) assert.equal(JSON.stringify(answer).includes('Schonfeld'), false);
  assert.deepEqual([trace.title, trace.subtitle, trace.root.name, trace.root.children[0].name, trace.root.children[0].children[0].name], ['Job', 'Claude Applier', 'Job', 'Applier', 'Browser']);
  assert.deepEqual([flow.title, flow.subtitle, flow.stages[0].agents[0].name], ['Job #829', 'Claude Applier', 'Ask Victor']);
  assert.deepEqual(shape.shapeTrace(trace), trace, 'shaping a shaped trace gives the same bytes');
  assert.deepEqual(shape.shapeFlow(flow), flow, 'shaping a shaped flow gives the same bytes');
  assert.equal(shape.shapeFlow({ id: 'tools:a', source: 'tools', subtitle: 'kept' }).subtitle, 'kept', 'other sources keep their words');
});

test('job-applier is pushed through the status-only shape', async () => {
  const runs = [{ job_id: 829, company: 'Schonfeld', title: 'Software Engineer', state: 'finished', started_at: '2026-10-02T09:00:00+00:00', is_live: false, session_count: 1 }];
  const raw = {
    job_id: 829, started_at: '2026-10-02T09:00:00+00:00', is_live: false, title: 'Job #829', subtitle: 'Software Engineer at Schonfeld · Claude Applier · finished',
    root: { kind: 'group', id: 'worker', name: 'Worker', meta: 'Schonfeld', role: 'worker', start: 0, end: 10, children: [
      { kind: 'step', id: 'launch', name: 'Launch Applier', category: 'shell', start: 0, end: 1, outcome: 'ok' },
      { kind: 'group', id: 'applier-1', name: 'Applier', role: 'applier', start: 1, end: 9, children: [
        { kind: 'step', id: 'f1', name: 'Open Schonfeld careers', category: 'browser', start: 2, end: 3, outcome: 'ok' },
        { kind: 'step', id: 'request-0', name: 'Ask you', meta: 'missing_answer · Salary', note: SECRET, category: 'human', start: 4, end: 5, outcome: 'ok' },
      ] },
      { kind: 'step', id: 'submit', name: 'Submit', category: 'backend', start: 9, end: 10, outcome: 'ok' },
    ] },
  };
  const jobfeed = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/applier-runs') return res.end(JSON.stringify({ runs, autopilot_enabled: false }));
    if (req.url.startsWith('/api/runs')) return res.end(JSON.stringify({ runs: [{ run_id: '320009a8-3f4e-4a1b-9c21-0d6e8f7a1b2c', source: 'evaluate', status: 'failed', started_at: '2026-10-02T08:00:00Z', finished_at: '2026-10-02T08:30:00Z', jobs_scored: 7, verdict_counts: { apply: 1 }, total_llm_cost_usd: 1.5, failure_message: 'Schonfeld timed out' }] }));
    return res.end(JSON.stringify(raw));
  });
  await new Promise((resolve) => jobfeed.listen(0, '127.0.0.1', resolve));
  const external = join(root, 'external.json');
  const kept = readFileSync(external, 'utf8');
  writeFileSync(external, JSON.stringify([{ name: 'job-applier', description: 'd', where: `http://127.0.0.1:${jobfeed.address().port}`, flows: 'job-applier' }]));
  try {
    const { url } = await hosted('job-status-home');
    const pushed = await pushTo(url, pushHomeFrom('job-status-push'), 'job-applier', ['--flows-only']);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.equal(pushed.stdout.includes('status pages'), false, '--flows-only leaves the status pages alone');
    const listed = await sourceOf(url, 'job-applier');
    const inLoop = (id) => listed.loop.stages.find((s) => s.id === id);
    assert.deepEqual([listed.loop.title, listed.loop.subtitle, inLoop('apply').agents[0].name], ['Applier loop', '1 jobs, 1 done, autopilot paused', 'Job #829']);
    assert.deepEqual(inLoop('evaluate').agents.map((a) => [a.name, a.role, a.state, a.traced]), [['Oct 2 · 7 scored', 'model', 'failed', false]]);
    assert.match(inLoop('evaluate').agents[0].id, /^x[0-9a-f]{16}$/);
    assert.equal(JSON.stringify(listed).includes('Schonfeld'), false);
    assert.equal(JSON.stringify(listed).includes('consider'), false);
    const loopTrace = await getJson(url, `/api/flows/job-applier:loop/agents/${inLoop('apply').agents[0].id}`);
    assert.equal(loopTrace.title, 'Job #829');
    assert.equal(JSON.stringify(loopTrace).includes('Schonfeld'), false);
    const passChip = inLoop('evaluate').agents[0];
    const passTrace = await getJson(url, `/api/flows/job-applier:loop/agents/${passChip.id}`);
    assert.deepEqual([passTrace.title, passTrace.subtitle, passTrace.root.name, passTrace.root.children], ['Applier loop', 'Claude Applier', passChip.name, []]);
    assert.equal(JSON.stringify(passTrace).includes('consider'), false);
    assert.deepEqual(listed.flows.map((f) => [f.id, f.title, f.subtitle, f.state, f.startedAt]), [['job-applier:829', 'Job #829', 'Claude Applier', 'done', '2026-10-02T09:00:00.000Z']]);
    const flow = await getJson(url, '/api/flows/job-applier:829');
    assert.deepEqual(flow.stages.map((s) => s.title), ['Launch', 'Apply', 'You', 'Submit']);
    assert.deepEqual(flow.stages.flatMap((s) => s.agents).map((a) => [a.name, a.role]), [['Launch', 'coordinator'], ['Applier', 'applier'], ['Ask Victor', 'you'], ['Submit', 'act']]);
    const trace = await getJson(url, '/api/flows/job-applier:829/agents/applier-1');
    const everything = JSON.stringify([listed, flow, trace]);
    for (const banned of ['Schonfeld', 'Software Engineer', 'Salary', 'missing_answer', SECRET]) assert.equal(everything.includes(banned), false, banned);
  } finally {
    writeFileSync(external, kept);
    jobfeed.close();
  }
});

test('every unlisted source is refused at both ends', async () => {
  const { url, home } = await hosted('job-home');
  const pushHome = pushHomeFrom('job-push-home');
  const seen = [];
  const recorder = createServer((req, res) => { seen.push(req.url); res.writeHead(500); res.end(); });
  await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));
  try {
    for (const sources of ['ui-clone', 'tools,ui-clone', 'site-clone']) {
      const pushed = await pushTo(`http://127.0.0.1:${recorder.address().port}`, pushHome, sources);
      assert.equal(pushed.code, 1, sources);
      assert.match(pushed.stderr, /not on the public allowlist/);
      assert.match(pushed.stderr, /nothing was sent/);
    }
    assert.deepEqual(seen, [], 'not one request left the Mac');
  } finally {
    recorder.close();
  }
  const scanned = await scanOf(pushHome, 'ui-clone');
  assert.equal(scanned.code, 1);
  assert.match(scanned.stderr, /not on the public allowlist/);

  const list = JSON.stringify(listBlob('ui-clone', 'UI Clone'));
  assert.equal((await putBlob(url, list)).status, 403);
  assert.equal((await putBlob(url, JSON.stringify(flowBlob({ id: 'ui-clone:card', source: 'ui-clone' })))).status, 403);
  const tools = JSON.stringify(listBlob('tools', 'Factory tools'));
  await putBlob(url, tools);
  assert.equal((await putManifest(url, 'ui-clone', manifestFor('ui-clone', 'UI Clone', sha(tools)))).status, 403);
  assert.equal((await fetch(`${url}/ingest/heartbeat/ui-clone`, { method: 'POST', headers: bearer() })).status, 403);
  assert.equal((await get(url, '/api/flows/ui-clone:card')).status, 404);
  assert.equal(existsSync(hostedFile(home, 'sources', 'ui-clone.json')), false);
  assert.deepEqual((await getJson(url, '/api/flows')).sources.map((s) => s.source), ['game-studio', 'job-applier', 'tools']);
});

test('an injected unknown field is refused at ingest and cannot reach /api/flows even from the store', async () => {
  const { url, home } = await hosted('inject-home');
  const stageWith = (agent) => [{ id: 'run', title: 'Run', state: 'done', loops: 0, agents: [{ id: 'a', name: 'a', role: 'worker', state: 'done', startedAt: null, endedAt: null, traced: false, ...agent }] }];
  const injected = [
    flowBlob({ injected: SECRET }),
    flowBlob({ costUsd: 3 }),
    flowBlob({ stages: stageWith({ where: SECRET }) }),
    flowBlob({ stages: stageWith({ meta: SECRET }) }),
    flowBlob({ stages: stageWith({ role: `"><img src=x onerror=${SECRET}>` }) }),
    { ...listBlob('tools', 'Factory tools'), where: SECRET },
    listBlob('tools', 'Factory tools', [flowBlob({ note: SECRET })]),
    { ...listBlob('tools', 'Factory tools'), error: `ENOENT ${SECRET}` },
    { ...listBlob('tools', 'Forged label') },
    traceBlob({ note: SECRET }),
    traceBlob({ root: { kind: 'group', id: 'f', name: 'x', start: 0, end: 1, meta: SECRET, children: [] } }),
    traceBlob({ root: { kind: 'step', id: 'f', name: 'x', start: 0, end: 1, outcome: 'ok', fieldsFilled: 3 } }),
    { anything: SECRET },
    [SECRET],
  ];
  for (const value of injected) {
    const res = await putBlob(url, JSON.stringify(value));
    assert.equal(res.status, 400, JSON.stringify(value));
    assert.equal((await res.text()).includes(SECRET), false);
  }
  assert.deepEqual(readdirSync(hostedFile(home, 'blobs')), [], 'nothing was stored');

  // A blob written under an older allowlist, already on the volume when this version deploys.
  const write = (value) => {
    const body = JSON.stringify(value);
    writeFileSync(hostedFile(home, 'blobs', `${sha(body)}.json`), body);
    return sha(body);
  };
  const flow = flowBlob({ id: 'tools:old', where: SECRET, costUsd: 9, stages: stageWith({ meta: SECRET, costUsd: 9, id: 'a' }) });
  const list = write({ ...listBlob('tools', 'Factory tools', [flow]), where: SECRET });
  const stored = manifestFor('tools', 'Factory tools', list, { flows: { 'tools:old': write(flow) }, traces: { 'tools:old/a': write(traceBlob({ note: SECRET })) } });
  writeFileSync(hostedFile(home, 'sources', 'tools.json'), JSON.stringify(stored));
  writeFileSync(hostedFile(home, 'sources', 'tools.heartbeat.json'), JSON.stringify({ source: 'tools', at: new Date().toISOString() }));
  for (const answer of [await getJson(url, '/api/flows'), await getJson(url, flowPath('tools:old')), await getJson(url, tracePath('tools:old', 'a'))]) {
    assert.equal(JSON.stringify(answer).includes(SECRET), false);
    for (const key of everyKey(answer)) assert.ok(ALLOWED_KEYS.has(key), key);
  }
});

const GUARD_CASES = [
  ['home-path', 'see /Users/someone/project', 'someone'],
  ['home-path', 'see /home/someone/project', 'someone'],
  ['tilde-path', 'see ~/project', 'project'],
  ['windows-path', 'see C:\\Users\\someone', 'someone'],
  ['email', 'mail someone@example.com today', 'someone'],
  ['url', 'see http://example.net/a', 'example.net'],
  ['url', 'see https://example.net/a', 'example.net'],
  ['ipv4', 'on 192.168.1.20 now', '192.168'],
  ['tailnet', 'on box.tail1234.ts.net now', 'tail1234'],
  ['token-prefix', 'key sk-abc123', 'abc123'],
  ['token-prefix', 'key ghp_abc123', 'abc123'],
  ['token-prefix', 'key AKIAIOSFODNN7', 'IOSFODNN7'],
  ['token-prefix', 'key xoxb-1234', '1234'],
  ['long-secret', `hex ${'a1b2c3d4'.repeat(5)}`, 'a1b2c3d4'],
  ['long-secret', `b64 ${'Q2xhdWRlIGlz'.repeat(4)}==`, 'Q2xhdWRlIGlz'],
  ['long-secret', 'b64url Ab9kLm2Qx7Rt4Vz8Wn3Yp_c5Hs1Jd6Fg0-eUi', 'Ab9kLm2Qx7'],
];

test('the guard rejects each rule at ingest, naming the field and rule without the value', async () => {
  const { url, home } = await hosted('guard-home');
  for (const [rule, value, fragment] of GUARD_CASES) {
    const res = await putBlob(url, JSON.stringify(flowBlob({ subtitle: value })));
    assert.equal(res.status, 422, value);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { field: 'blob.subtitle', rule }, value);
    assert.equal(text.includes(fragment), false, value);
  }
  const nested = await putBlob(url, JSON.stringify(traceBlob({ root: { kind: 'group', id: 'f', name: 'x', start: 0, end: 1, children: [{ kind: 'step', id: 'c', name: 'odd someone@example.com', start: 0, end: 1 }] } })));
  assert.equal(nested.status, 422);
  assert.deepEqual(await nested.json(), { field: 'blob.root.children[0].name', rule: 'email' });
  assert.deepEqual(readdirSync(hostedFile(home, 'blobs')), [], 'no rejected blob was stored');
  const hiddenKey = JSON.stringify(listBlob('tools', 'Factory tools'));
  await putBlob(url, hiddenKey);
  const keyed = await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', sha(hiddenKey), { flows: { 'tools:someone@example.com': sha(hiddenKey) } }));
  assert.equal(keyed.status, 422, 'a manifest key is scanned too');
  assert.equal((await keyed.text()).includes('someone'), false);

  const benign = ['a-very-long-feature-slug-with-many-short-words-in-it', 'tools:youtube-20261102T201946Z/call-0', 'version 1.2.3', '2026-10-03T10:00:01.000Z', 'task-sk-free', 'and/or', 'a~b', 'desk-lamp · image', 'Read file', 'first-practice-battle/keeper-ground-interactions/x'];
  for (const value of benign) assert.equal((await putBlob(url, JSON.stringify(flowBlob({ subtitle: value })))).status, 200, value);
});

test('the pusher\'s guard stops a leaking source before its first byte, names the field and rule, and lets the others through', async () => {
  const pushHome = pushHomeFrom('leak-push-home');
  writeFileSync(join(pushHome, 'runs.jsonl'), jsonl([atomCall('page-record', '2026-10-03T10:00:01Z', { caller: 'someone@example.com' })]));
  const { url } = await hosted('leak-home');
  const seen = [];
  const recorder = createServer((req, res) => {
    seen.push(req.url);
    const up = request(`${url}${req.url}`, { method: req.method, headers: req.headers }, (answer) => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
    req.pipe(up);
  });
  await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));
  try {
    const pushed = await pushTo(`http://127.0.0.1:${recorder.address().port}`, pushHome, 'tools');
    assert.equal(pushed.code, 1);
    assert.match(pushed.stderr, /tools rejected by the publish guard/);
    assert.match(pushed.stderr, /tools list\.flows\[0\]\.title broke rule email/);
    assert.equal(`${pushed.stdout}${pushed.stderr}`.includes('someone'), false, 'the matched value stays out of the report');
    assert.deepEqual(seen.filter((path) => path !== '/ingest/status'), [], 'nothing was sent for that source');

    const both = await pushTo(`http://127.0.0.1:${recorder.address().port}`, pushHome, 'tools,game-studio');
    assert.equal(both.code, 1);
    assert.match(both.stdout, /game-studio: \d+ flows/);
    assert.ok(seen.some((path) => path === '/ingest/source/game-studio'));
    assert.equal(seen.includes('/ingest/source/tools'), false);
    assert.equal((await sourceOf(url, 'tools')).lastPush, null);
    assert.ok((await sourceOf(url, 'game-studio')).lastPush);
  } finally {
    recorder.close();
  }

  const scanned = await scanOf(pushHome, 'tools');
  assert.equal(scanned.code, 1, scanned.stderr);
  assert.match(scanned.stdout, /email: \d+/);
  assert.match(scanned.stdout, /tools list\.flows\[\]\.title: email 1/);
  assert.equal(scanned.stdout.includes('someone'), false);
});

test('--scan shapes everything, sends nothing, needs no URL or token, and previews only title, subtitle, and name', async () => {
  const pushHome = pushHomeFrom('scan-push-home');
  const scanned = await scanOf(pushHome);
  assert.equal(scanned.code, 0, scanned.stderr);
  for (const rule of ['home-path', 'tilde-path', 'windows-path', 'email', 'url', 'ipv4', 'tailnet', 'token-prefix', 'long-secret']) assert.match(scanned.stdout, new RegExp(`${rule}: 0`));
  assert.match(scanned.stdout, /0 hits in all/);
  assert.match(scanned.stdout, /flows\[\] stages\[\]\.agents\[\]\.id: \d+/);
  assert.match(scanned.stdout, /^ {2}Battle$/m, 'a title is previewed');
  assert.equal(scanned.stdout.includes('2026-10-01T10:'), false, 'a time is counted, not printed');
  assert.equal(scanned.stdout.includes(SECRET), false);
  assert.equal(existsSync(join(pushHome, 'push-state.json')), false);
  assert.equal((await factoryRun(['push', 'http://127.0.0.1:9', '--scan', '--sources', 'tools'], { TOOL_FACTORY_HOME: pushHome })).code, 2, '--scan takes no URL');
});

test('factory push leaves an origin answer shaped by the allowlist on the hosted server, end to end', async () => {
  const pushHome = pushHomeFrom('e2e-push-home');
  const { url } = await hosted('e2e-home');
  const origin = await startServer(['--port', '0'], { TOOL_FACTORY_HOME: pushHome });
  const pushed = await pushTo(url, pushHome);
  assert.equal(pushed.code, 0, pushed.stderr);
  assert.equal(`${pushed.stdout}${pushed.stderr}`.includes(TOKEN), false);

  const answer = await getJson(url, '/api/flows');
  const before = await getJson(origin.url, '/api/flows');
  const pushedNames = SOURCES.split(',');
  const originPublic = before.sources.filter((s) => pushedNames.includes(s.source));
  const received = answer.sources.filter((s) => pushedNames.includes(s.source));
  assert.equal(received.length, 2);
  assert.ok(originPublic.every((s) => s.error === null && s.flows.length), 'the fixture exercises both sources');
  for (const [mine, theirs] of received.map((s) => [s, originPublic.find((o) => o.source === s.source)])) {
    const { lastPush, stale, ...listed } = mine;
    assert.deepEqual(listed, shape.shapeSourceList(theirs));
    assert.equal(stale, false);
    assert.ok(Date.now() - Date.parse(lastPush) < MINUTE, 'lastPush is this server\'s clock');
  }

  for (const source of originPublic) {
    const ids = [...(source.loop ? [source.loop.id] : []), ...source.flows.map((f) => f.id)];
    for (const id of ids) {
      const flow = await getJson(origin.url, flowPath(id));
      const shaped = shape.shapeFlow(flow);
      assert.deepEqual(await getJson(url, flowPath(shaped.id)), shaped, id);
      const agents = flow.stages.flatMap((s) => s.agents);
      const publics = shaped.stages.flatMap((s) => s.agents);
      for (const [i, agent] of agents.entries()) {
        const trace = await getJson(origin.url, tracePath(id, agent.id));
        assert.deepEqual(await getJson(url, tracePath(shaped.id, publics[i].id)), shape.shapeTrace(trace), `${id} ${agent.id}`);
      }
    }
  }
  assert.equal((await get(url, '/api/flows/game-studio:nope')).status, 404);
  assert.equal((await get(url, '/api/flows/game-studio:battle/agents/nope')).status, 404);
  assert.equal((await get(url, '/api/flows/nope:x')).status, 404);
  assert.equal(existsSync(join(pushHome, 'push-state.json')), true);
});

test('no cost, path, note, meta, or raw id survives anywhere in a public answer or a stored file', async () => {
  const pushHome = pushHomeFrom('secret-push-home');
  const { url, home } = await hosted('secret-home');
  const pushed = await pushTo(url, pushHome);
  assert.equal(pushed.code, 0, pushed.stderr);

  const answers = await everyPublicAnswer(url);
  assert.ok(answers.length > 10);
  for (const answer of answers) {
    for (const key of everyKey(answer)) assert.ok(ALLOWED_KEYS.has(key), `${key} is not on the allowlist`);
    const text = JSON.stringify(answer);
    for (const banned of ['costUsd', '"where"', '"meta"', '"note"', 'fieldsFilled', 'runsTitle', SECRET, LONG_ATTEMPT, 'toolu_', '/Users/', 'studio-local']) assert.equal(text.includes(banned), false, banned);
  }
  const stored = [hostedFile(home, 'blobs'), hostedFile(home, 'sources')].flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)));
  assert.ok(stored.length > 10);
  for (const path of stored) {
    const text = readFileSync(path, 'utf8');
    for (const banned of ['costUsd', '"where"', SECRET, LONG_ATTEMPT, '/Users/']) assert.equal(text.includes(banned), false, `${banned} in ${path}`);
  }

  const trace = await getJson(url, tracePath('game-studio:battle', 'done1'));
  const names = flatten(trace.root).map((n) => n.name);
  assert.ok(names.includes('Run command') && names.includes('Read file'), `tool labels stay readable, saw ${names}`);
  assert.ok(names.includes('odd-tool.sh'), `a tool named by a path keeps its last segment, saw ${names}`);
  assert.ok(names.includes('link'), `a tool named by a URL reads as a link, saw ${names}`);
});

test('a second push reads no finished trace and sends one heartbeat per unchanged source', async () => {
  const pushHome = pushHomeFrom('second-push-home');
  const { url, home } = await hosted('second-home');
  const seen = [];
  const recorder = createServer((req, res) => {
    seen.push(`${req.method} ${new URL(req.url, url).pathname.replace(/[0-9a-f]{64}/, '<sha>')}`);
    const up = request(`${url}${req.url}`, { method: req.method, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    req.pipe(up);
  });
  await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));
  const through = `http://127.0.0.1:${recorder.address().port}`;
  try {
    const first = await pushTo(through, pushHome, 'tools');
    assert.equal(first.code, 0, first.stderr);
    assert.ok(seen.includes('PUT /ingest/source/tools') && seen.includes('PUT /ingest/blob/<sha>'));

    const beforeBeat = (await sourceOf(url, 'tools')).lastPush;
    const manifest = hostedFile(home, 'sources', 'tools.json');
    const stamp = statSync(manifest).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    seen.length = 0;
    const second = await pushTo(through, pushHome, 'tools');
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(seen, ['POST /ingest/heartbeat/tools']);
    assert.equal(statSync(manifest).mtimeMs, stamp, 'the manifest was not rewritten');
    assert.ok(Date.parse((await sourceOf(url, 'tools')).lastPush) > Date.parse(beforeBeat), 'the receipt time moved');
    assert.match(second.stdout, /tools: .*\b0 traces read/);
  } finally {
    recorder.close();
  }
});

test('a finished trace is not read again, a live one is, and a new destination gets everything', async () => {
  const pushHome = pushHomeFrom('finished-push-home');
  const { url } = await hosted('finished-home');
  const path = tracePath('game-studio:battle', 'done1');
  const livePath = tracePath('game-studio:night', 'live1');
  const original = readFileSync(join(production, 'attempts', 'done1.control', 'events.jsonl'), 'utf8');
  const liveOriginal = readFileSync(join(production, 'attempts', 'live1.control', 'events.jsonl'), 'utf8');
  try {
    assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
    const first = await getJson(url, path);
    const firstLive = await getJson(url, livePath);
    const changed = jsonl([use('2026-10-01T10:10:40Z', 'w9', 'WebSearch', {}), answered('2026-10-01T10:10:41Z', 'w9')]);
    writeFileSync(join(production, 'attempts', 'done1.control', 'events.jsonl'), changed);
    writeFileSync(join(production, 'attempts', 'live1.control', 'events.jsonl'), `${liveOriginal}${jsonl([use('2026-10-01T10:20:50Z', 'g2', 'Glob', {})])}`);
    assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
    assert.deepEqual(await getJson(url, path), first, 'a finished trace keeps its first answer, because it was not read');
    const live = await getJson(url, livePath);
    assert.notDeepEqual(live, firstLive, 'a live trace follows its transcript');
    assert.equal(live.live, true);

    const other = await hosted('finished-other-home');
    assert.equal((await pushTo(other.url, pushHome, 'game-studio')).code, 0);
    assert.notDeepEqual(await getJson(other.url, path), first, 'a new destination reads everything again');
    assert.deepEqual(await getJson(url, path), first, 'the first destination keeps its own memory');
  } finally {
    writeFileSync(join(production, 'attempts', 'done1.control', 'events.jsonl'), original);
    writeFileSync(join(production, 'attempts', 'live1.control', 'events.jsonl'), liveOriginal);
  }
});

test('a state file from another shape version re-sends, and --state keeps the data home clean', async () => {
  const pushHome = pushHomeFrom('shape-push-home');
  const statePath = join(base, 'elsewhere', 'state.json');
  const { url } = await hosted('shape-home');
  const flags = ['--state', statePath];
  assert.equal((await pushTo(url, pushHome, 'tools', flags)).code, 0);
  assert.equal(existsSync(join(pushHome, 'push-state.json')), false);
  assert.match((await pushTo(url, pushHome, 'tools', flags)).stdout, /\b0 traces read.*heartbeat sent/);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(Object.keys(state.destinations), [url]);
  state.destinations[url].version = shape.SHAPE_VERSION - 1;
  writeFileSync(statePath, JSON.stringify(state));
  assert.match((await pushTo(url, pushHome, 'tools', flags)).stdout, /\b1 traces read.*manifest sent/);
});

test('a finished call\'s trace still follows a tools flow that grows', async () => {
  const pushHome = pushHomeFrom('grow-push-home');
  const { url } = await hosted('grow-home');
  assert.equal((await pushTo(url, pushHome, 'tools')).code, 0);
  const [{ id }] = (await sourceOf(url, 'tools')).flows;
  const path = tracePath(id, 'call-0');
  assert.equal((await getJson(url, path)).root.children.length, 2);
  const grown = readFileSync(join(pushHome, 'runs.jsonl'), 'utf8') + jsonl([atomCall('page-diff', '2026-10-03T10:00:09Z')]);
  writeFileSync(join(pushHome, 'runs.jsonl'), grown);
  assert.equal((await pushTo(url, pushHome, 'tools')).code, 0);
  assert.equal((await getJson(url, path)).root.children.length, 3);
});

test('a machine gone for five minutes reads as stalled, and a question to Victor stays open', async () => {
  const pushHome = pushHomeFrom('stale-push-home');
  const { url, home } = await hosted('stale-home');
  assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
  const studioOf = () => sourceOf(url, 'game-studio');

  const fresh = await studioOf();
  assert.equal(fresh.stale, false);
  assert.ok(fresh.loop.working > 0, 'the fixture has a live agent');
  assert.equal(fresh.flows.find((f) => f.id === 'game-studio:night').state, 'running');
  const nightPath = flowPath('game-studio:night');
  const liveTrace = tracePath('game-studio:night', 'live1');
  const freshTrace = await getJson(url, liveTrace);
  assert.equal(freshTrace.live, true);
  assert.equal(freshTrace.state, 'running');
  assert.ok(flatten(freshTrace.root).some((n) => n.end === null));

  loseMachine(home, 'game-studio', 4 * MINUTE);
  assert.equal((await studioOf()).stale, false, 'under five minutes is still fresh');

  loseMachine(home, 'game-studio');
  const stale = await studioOf();
  assert.equal(stale.stale, true);
  assert.equal(JSON.stringify(stale).includes('"running"'), false);
  assert.equal(stale.loop.working, 0);
  assert.ok(stale.flows.every((f) => f.working === 0));
  const night = stale.flows.find((f) => f.id === 'game-studio:night');
  assert.equal(night.state, 'stalled');
  assert.equal(stale.flows.find((f) => f.id === 'game-studio:gate').state, 'blocked');
  assert.equal(stale.flows.find((f) => f.id === 'game-studio:battle').state, 'done');
  assert.equal(stale.loop.stages.find((s) => s.id === 'you').state, 'blocked');

  const flow = await getJson(url, nightPath);
  assert.equal(flow.state, 'stalled');
  assert.equal(flow.working, 0);
  assert.equal(flow.stages.flatMap((s) => s.agents).find((a) => a.id === 'live1').state, 'stalled');
  assert.equal((await getJson(url, flowPath('game-studio:gate'))).state, 'blocked');

  const trace = await getJson(url, liveTrace);
  assert.equal(trace.live, false);
  assert.equal(trace.state, 'stalled');
  assert.equal(/running|stalled/.test(trace.subtitle), false, 'the state is a field, not words in the subtitle');
  assert.ok(flatten(trace.root).every((n) => n.end !== null), 'no open span is left for the page to animate');

  assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
  const back = await studioOf();
  assert.equal(back.stale, false, 'the next push, even a heartbeat, brings it back');
  assert.equal(back.flows.find((f) => f.id === 'game-studio:night').state, 'running');
});

const statusIn = async (url, path = '/') => JSON.parse((await (await get(url, path)).text()).match(/<script id="status" type="application\/json">(.*?)<\/script>/s)[1]);

test('a push fills every status page from the manifests, with no cost, path, or run route', async () => {
  const pushHome = pushHomeFrom('status-push-home');
  const { url, home } = await hosted('status-home');
  assert.equal(await statusIn(url), null, 'before a push the page has no model');
  const first = await pushTo(url, pushHome);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /status pages: \d+ tools sent/);
  for (const path of ['/', '/try', '/wiring', '/docs', '/docs/youtube', '/docs/youtube/get', '/elsewhere']) {
    const res = await get(url, path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /<body data-hosted>/, path);
  }
  const status = await statusIn(url);
  const raw = JSON.stringify(status);
  const keys = new Set();
  JSON.stringify(status, (key, value) => (keys.add(key), value));
  assert.ok(status.microservices.some((row) => row.name === 'youtube' && row.verbs.some((verb) => verb.name === 'get' && verb.input.properties.input.description)));
  assert.ok(status.atoms.length > 0);
  for (const banned of ['spentUsd', 'spentTodayUsd', 'budget', 'capUsd', 'home', 'links', 'where', 'x-flag']) assert.equal(keys.has(banned), false, banned);
  for (const banned of ['/Users', 'job-applier']) assert.equal(raw.includes(banned), false, banned);
  assert.equal((await fetch(`${url}/run/youtube/get`, { method: 'POST', body: '{}' })).status, 404);
  const repeat = await pushTo(url, pushHome);
  assert.match(repeat.stdout, /status pages: nothing changed/, 'an unchanged status is not sent again');
  const page = await get(url, '/try');
  assert.equal((await fetch(`${url}/try`, { headers: { 'if-none-match': page.headers.get('etag') } })).status, 304);
  rmSync(hostedFile(home, 'status.json'));
  for (const name of readdirSync(hostedFile(home, 'sources'))) rmSync(hostedFile(home, join('sources', name)));
  assert.equal(await statusIn(url), null);
  assert.equal((await pushTo(url, pushHome)).code, 0);
  assert.deepEqual((await statusIn(url)).microservices, status.microservices, 'the next push after a lost volume restores the status');
});

test('the public status keeps every kind and type the registry knows, and is the same when shaped twice', () => {
  for (const [kind, { type }] of Object.entries(KINDS)) {
    const once = shape.shapeStatus({ microservices: [{ kind, type }] });
    assert.equal(once.microservices[0].kind, kind);
    assert.equal(once.microservices[0].type, type);
    assert.deepEqual(shape.shapeStatus(once), once);
  }
});

test('the public status drops example addresses and every external entry outside its list', () => {
  const param = { type: 'string', description: 'URL of the rebuild, such as http://localhost:4400/.', default: 'http://localhost:5173' };
  const verb = { name: 'get', input: { properties: { clone: param, depth: { type: 'integer', default: 2 } }, required: ['clone'] } };
  const shaped = shape.shapeStatus({ microservices: [{ name: 'a', verbs: [verb] }], external: [{ name: 'job-applier', description: 'x', where: 'http://127.0.0.1:8765' }, { name: 'art-desk', description: 'y', where: '~/victor/art-desk' }] });
  const { clone, depth } = shaped.microservices[0].verbs[0].input.properties;
  assert.equal(clone.description, 'URL of the rebuild.');
  assert.equal(JSON.stringify(clone).includes('localhost'), false);
  assert.equal(depth.default, 2);
  assert.deepEqual(shaped.external, [{ name: 'art-desk', description: 'y' }]);
  assert.deepEqual(shape.scanPublic(shaped, 'status'), []);
});

test('the status ingest needs the token and refuses extra fields and anything the guard catches', async () => {
  const { url } = await hosted('status-ingest-home');
  const put = (body, headers = bearer()) => fetch(`${url}/ingest/status`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const good = shape.shapeStatus({ microservices: [{ name: 'a', type: 'atom', kind: 'transform', description: 'Does one thing.' }] });
  assert.equal((await put(good, {})).status, 401);
  assert.equal((await put({ ...good, budget: { spentTodayUsd: 1 } })).status, 400);
  assert.equal((await put({ ...good, microservices: [{ ...good.microservices[0], spentUsd: 1 }] })).status, 400);
  assert.equal((await put({ ...good, microservices: [{ ...good.microservices[0], description: 'see /Users/someone/project' }] })).status, 422);
  assert.equal(await statusIn(url), null);
  assert.equal((await put(good)).status, 200);
  assert.deepEqual(await statusIn(url), good);
});

test('a repeat read of the flows API with its ETag answers 304 and no body', async () => {
  const { url } = await hosted('etag-home');
  const first = await fetch(`${url}/api/flows`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const same = await fetch(`${url}/api/flows`, { headers: { 'if-none-match': etag } });
  assert.equal(same.status, 304);
  assert.equal(await same.text(), '');
  const other = await fetch(`${url}/api/flows`, { headers: { 'if-none-match': '"old"' } });
  assert.equal(other.status, 200);
  assert.deepEqual(await other.json(), await first.json());
});

test('collection removes old orphans and leaves referenced and recent blobs', async () => {
  const { url, home } = await hosted('gc-home');
  const put = async (value) => {
    const body = JSON.stringify(value);
    assert.equal((await putBlob(url, body)).status, 200);
    return sha(body);
  };
  const list = await put(listBlob('tools', 'Factory tools'));
  const referencedOld = await put(flowBlob({ title: 'kept' }));
  const orphanOld = await put(flowBlob({ title: 'gone' }));
  const orphanNew = await put(flowBlob({ title: 'in flight' }));
  const asked = await put(flowBlob({ title: 'asked about' }));
  const path = (name) => hostedFile(home, 'blobs', `${name}.json`);
  const hoursAgo = new Date(Date.now() - 2 * 60 * MINUTE);
  for (const name of [referencedOld, orphanOld, asked, list]) utimesSync(path(name), hoursAgo, hoursAgo);
  await fetch(`${url}/ingest/missing`, { method: 'POST', headers: bearer(), body: JSON.stringify({ shas: [asked] }) });

  assert.equal((await putManifest(url, 'tools', manifestFor('tools', 'Factory tools', list, { flows: { 'tools:a': referencedOld } }))).status, 200);
  assert.equal(existsSync(path(referencedOld)), true, 'a referenced blob stays');
  assert.equal(existsSync(path(list)), true, 'a list blob stays');
  assert.equal(existsSync(path(orphanOld)), false, 'an old orphan goes');
  assert.equal(existsSync(path(orphanNew)), true, 'a recent orphan may belong to a push in flight');
  assert.equal(existsSync(path(asked)), true, 'a blob a pusher was just told exists stays');
});

test('a source that fails sends only a generic error, keeps its history, and leaves the others up', async () => {
  const pushHome = pushHomeFrom('error-push-home');
  const { url, home } = await hosted('error-home');
  assert.equal((await pushTo(url, pushHome)).code, 0);
  const historic = tracePath('game-studio:battle', 'done1');
  const db = join(production, 'production.sqlite3');
  const saved = readFileSync(db);
  rmSync(db);
  try {
    const failed = await pushTo(url, pushHome);
    assert.equal(failed.code, 0, failed.stderr);
    assert.match(failed.stdout, /game-studio: read failed.*no Game Studio database/, 'the Mac still sees the cause');
    const { sources } = await getJson(url, '/api/flows');
    const gone = sources.find((s) => s.source === 'game-studio');
    assert.equal(gone.error, 'This source could not be read on the Mac.');
    assert.equal(JSON.stringify(gone).includes(studio), false);
    assert.deepEqual(gone.flows, []);
    assert.ok(gone.lastPush);
    assert.ok(sources.find((s) => s.source === 'tools').flows.length > 0);
    assert.equal((await get(url, historic)).status, 200, 'one bad minute does not orphan the traces');
    const manifest = JSON.parse(readFileSync(hostedFile(home, 'sources', 'game-studio.json'), 'utf8'));
    assert.ok(Object.keys(manifest.traces).length > 0);
  } finally {
    writeFileSync(db, saved);
  }
  assert.equal((await pushTo(url, pushHome)).code, 0);
  assert.equal((await sourceOf(url, 'game-studio')).error, null);
});

test('a server that lost its data heals: the next pushes re-send what it lost', async () => {
  const pushHome = pushHomeFrom('wipe-push-home');
  const { url, home } = await hosted('wipe-home');
  assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
  const historic = tracePath('game-studio:battle', 'done1');
  const first = await getJson(url, historic);
  for (const dir of ['blobs', 'sources']) {
    for (const name of readdirSync(hostedFile(home, dir))) rmSync(hostedFile(home, dir, name));
  }
  const noticed = await pushTo(url, pushHome, 'game-studio');
  assert.equal(noticed.code, 1);
  assert.match(noticed.stderr, /lost \d+ blobs/);
  assert.equal((await pushTo(url, pushHome, 'game-studio')).code, 0);
  assert.deepEqual(await getJson(url, historic), first);
});

test('push refuses a plain http destination, an unknown source, and a missing token, and never prints the token', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [factory, 'push', ...args], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, TOOL_FACTORY_HOME: join(base, 'refused-push-home'), FACTORY_PUSH_TOKEN: TOKEN, ...env } });
  const plain = run(['http://example.com', '--sources', 'tools']);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /not https/);
  const unknown = run(['http://127.0.0.1:9', '--sources', 'nope']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /nope is not on the public allowlist/);
  assert.equal(run(['http://127.0.0.1:9']).status, 2);
  const down = run(['http://127.0.0.1:9', '--sources', 'tools']);
  assert.equal(down.status, 1);
  assert.match(down.stderr, /failed/);
  for (const done of [plain, unknown, down]) assert.equal(`${done.stdout}${done.stderr}`.includes(TOKEN), false);
  if (process.platform !== 'darwin') {
    const tokenless = run(['http://127.0.0.1:9', '--sources', 'tools'], { FACTORY_PUSH_TOKEN: '' });
    assert.equal(tokenless.status, 1);
    assert.match(tokenless.stderr, /no push token/);
  }
});

test('the files the Dockerfile copies are enough to boot, serve the page, and take a push', async () => {
  const image = join(base, 'image');
  const dockerfile = readFileSync(join(REPO, 'Dockerfile'), 'utf8');
  const copies = dockerfile.split('\n').filter((line) => line.startsWith('COPY '));
  assert.ok(copies.length > 0);
  for (const line of copies) {
    const parts = line.split(/\s+/).slice(1);
    const to = parts.pop();
    for (const from of parts) {
      mkdirSync(join(image, to), { recursive: true });
      cpSync(join(REPO, from), join(image, to, from.split('/').at(-1)));
    }
  }
  const cmd = dockerfile.match(/node (factory\/\S+?)"\]/)[1];
  const data = join(base, 'image-data');
  const child = spawn(process.execPath, [cmd], { cwd: image, env: { PATH: process.env.PATH, FACTORY_PUSH_TOKEN: TOKEN, TOOL_FACTORY_HOME: data, PORT: '0' } });
  running.push(child);
  const url = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => { out += c; const port = out.match(/:(\d+)\//)?.[1]; if (port) resolve(`http://127.0.0.1:${port}`); });
    child.on('close', (code) => reject(new Error(`the image exited ${code}`)));
  });
  assert.equal((await get(url, '/healthz')).status, 200);
  assert.match(await (await get(url, '/flows')).text(), /<body data-hosted>/);
  const pushHome = pushHomeFrom('image-push-home');
  assert.equal((await pushTo(url, pushHome)).code, 0);
  assert.ok((await sourceOf(url, 'game-studio')).flows.length > 0);
  assert.equal(existsSync(join(image, 'external.json')), false);
  assert.equal(existsSync(join(image, 'factory', 'lib', 'flows')), false);
});

test('default local mode is unchanged: localhost only, no ingest, runs answered, and cost and where still shown', async () => {
  const dir = join(base, 'local-home');
  mkdirSync(dir);
  cpSync(join(originHome, 'runs.jsonl'), join(dir, 'runs.jsonl'));
  const { url, port } = await startServer(['--port', '0'], { TOOL_FACTORY_HOME: dir, FACTORY_PUSH_TOKEN: '' });
  assert.equal((await fetch(`${url}/`, { redirect: 'manual' })).status, 200);
  assert.equal((await fetch(`${url}/wiring`)).status, 200);
  const html = await (await fetch(`${url}/flows`)).text();
  assert.match(html, /<body>/);
  assert.match(html, /\['Spent', usd\(cost\)\]/, 'the local page still draws spend');
  const embedded = await statusIn(url);
  assert.ok('budget' in embedded);
  const rebound = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: attacker.example', `${url}/`], { encoding: 'utf8' });
  assert.equal(rebound.stdout, '421');
  assert.equal((await fetch(`${url}/healthz`)).status, 404);
  assert.equal((await fetch(`${url}/ingest/missing`, { method: 'POST', headers: bearer(), body: '{"shas":[]}' })).status, 405);
  const refused = await fetch(`${url}/run/youtube/transcript`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 403);
  const sameOrigin = await fetch(`${url}/run/youtube/nope`, { method: 'POST', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(sameOrigin.status, 404);
  const listed = await (await fetch(`${url}/api/flows`)).json();
  const studioSource = listed.sources.find((s) => s.source === 'game-studio');
  assert.equal(studioSource.where, studio);
  assert.equal(studioSource.runsTitle, 'Features');
  assert.ok(listed.sources.some((s) => s.source === 'job-applier'));
  assert.equal(studioSource.flows.find((f) => f.id === 'game-studio:battle').costUsd, 1.25);
  const flow = await (await fetch(`${url}${flowPath('game-studio:battle')}`)).json();
  assert.equal(flow.stages.flatMap((s) => s.agents).find((a) => a.id === 'done1').costUsd, 1.25);
  assert.ok(flow.stages.flatMap((s) => s.agents).some((a) => a.id === LONG_ATTEMPT), 'local mode keeps raw ids');
  assert.equal('lastPush' in listed.sources[0], false);
  assert.equal(existsSync(join(dir, 'hosted')), false);
});

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { copyRepo, manifest } from './repo.mjs';

const root = mkdtempSync(join(tmpdir(), 'factory-status-'));
const home = join(root, 'home');
const project = join(root, 'project');
const day = (back) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const env = { ...process.env, TOOL_FACTORY_HOME: home };
delete env.TOOL_FACTORY_BUDGET_USD;

const line = (name, type, at, extra) => ({ type, name, verb: 'get', kind: 'x', startedAt: at, ms: 1000, ok: true, cacheHit: false, costUsd: 0, caller: 'factory', ...extra });
const RUNS = [
  line('youtube', 'microservice', `${day(0)}T00:00:00Z`, { ms: 9000 }),
  line('digest', 'atom', `${day(0)}T00:00:00Z`, { ms: 7000, costUsd: 0.0085, caller: 'youtube' }),
  line('see', 'atom', `${day(0)}T00:00:00Z`, { ms: 3000, costUsd: 0.0025, caller: 'youtube' }),
  line('digest', 'atom', `${day(0)}T00:00:00Z`, { ms: 50, ok: false, caller: 'meeting-notes' }),
  line('meeting-notes', 'microservice', `${day(0)}T00:00:00Z`, { ok: false }),
  line('digest', 'atom', `${day(3)}T12:00:00Z`, { ms: 5000, costUsd: 0.004, caller: 'podcast' }),
  line('transcribe', 'atom', `${day(3)}T12:00:00Z`, { ms: 1500 }),
  line('digest', 'atom', `${day(10)}T12:00:00Z`, { costUsd: 9, caller: 'youtube' }),
  line('captions', 'atom', `${day(1)}T08:00:00Z`, { ms: 800, ok: false, caller: 'youtube' }),
  line('digest', 'atom', `${day(1)}T09:00:00Z`, { ms: 4000, costUsd: 0.002, caller: 'youtube' }),
  line('find-url', 'atom', `${day(2)}T09:00:00Z`, { ms: 600, caller: 'youtube' }),
];

function status(dir) {
  const done = spawnSync('node', [join(root, 'factory', 'bin', 'factory.mjs'), 'status', '--json'], { encoding: 'utf8', env: { ...env, TOOL_FACTORY_HOME: dir } });
  return { code: done.status, model: JSON.parse(done.stdout), stderr: done.stderr };
}

function seed(dir, runs, links) {
  mkdirSync(dir);
  writeFileSync(join(dir, 'runs.jsonl'), runs);
  if (links !== undefined) writeFileSync(join(dir, 'links.json'), links);
}

async function serve(dir) {
  const server = spawn('node', [join(root, 'factory', 'bin', 'factory.mjs'), 'dashboard', '--port', '0'], { env: { ...env, TOOL_FACTORY_HOME: dir } });
  const url = await new Promise((resolve) => server.stdout.on('data', (c) => resolve(String(c).match(/http:\/\/\S+\//)[0])));
  return { url, stop: () => server.kill() };
}

let model;
before(() => {
  copyRepo(root);
  cpSync(join(root, 'microservices', 'meeting-notes'), join(root, 'microservices', 'clipper'), { recursive: true });
  manifest(root, 'microservices/clipper', (m) => Object.assign(m, { name: 'clipper', uses: ['frames', 'see'] }));
  writeFileSync(join(root, 'external.json'), JSON.stringify([{ name: 'art-desk', description: 'Art dataroom.', where: '~/victor/art-desk' }]));
  const path = join(project, '.claude', 'skills', 'youtube');
  seed(home, RUNS.map((r) => JSON.stringify(r)).join('\n'), JSON.stringify([{ name: 'youtube', socket: 'into', path, target: join(root, 'microservices', 'youtube'), linkedAt: `${day(0)}T00:00:00Z` }]));
  const done = status(home);
  assert.equal(done.code, 0, done.stderr);
  model = done.model;
});

after(() => rmSync(root, { recursive: true, force: true }));

const row = (name) => [...model.microservices, ...model.atoms].find((r) => r.name === name);

test('every verb carries its CLI usage, and each output names a contract with its fields', () => {
  assert.equal(row('captions').verbs.find((v) => v.name === 'get').usage, 'captions get <url> [--lang <lang>]');
  assert.equal(row('youtube').verbs.find((v) => v.name === 'transcript').usage.split(' ').slice(0, 3).join(' '), 'youtube transcript <input>');
  assert.deepEqual(model.contracts['ui-source'].fields.map((f) => [f.name, f.type, f.required]), [['source', 'string', true], ['exposed', 'boolean', true], ['item', 'object or null', true], ['cacheHit', 'boolean', true]]);
  assert.ok([...model.microservices, ...model.atoms].every((r) => r.verbs.every((v) => v.output in model.contracts)));
});

test('microservices come first, the microservice with the most atoms leading', () => {
  assert.deepEqual(model.microservices.map((t) => t.name), ['youtube', 'ui-clone', 'podcast', 'clipper', 'meeting-notes', 'writing-style']);
  assert.deepEqual(row('youtube').uses, ['find-url', 'captions', 'download', 'transcribe', 'frames', 'see', 'digest']);
});

test('each atom lists the microservices whose uses name it', () => {
  assert.deepEqual(Object.fromEntries(model.atoms.map((a) => [a.name, a.usedBy])), {
    captions: ['youtube'],
    digest: ['youtube', 'podcast', 'meeting-notes'],
    download: ['youtube', 'podcast'],
    'find-url': ['youtube', 'podcast'],
    frames: ['youtube', 'clipper'],
    see: ['youtube', 'clipper'],
    transcribe: ['youtube', 'podcast', 'meeting-notes'],
    'ui-catalog': ['ui-clone'],
    'page-diff': ['ui-clone'],
    'page-links': [],
    'page-record': ['ui-clone'],
    'ui-draft': ['ui-clone'],
    'ui-source': ['ui-clone'],
    'ui-steps': [],
  });
});

test('spend counts today against the budget and charges atom spend to the calling microservice', () => {
  assert.deepEqual(model.budget, { capUsd: 3, spentTodayUsd: 0.011 });
  assert.deepEqual(
    ['youtube', 'podcast', 'meeting-notes', 'digest', 'see', 'transcribe'].map((n) => [n, row(n).spentUsd]),
    [['youtube', 0.013], ['podcast', 0.004], ['meeting-notes', 0], ['digest', 0.0145], ['see', 0.0025], ['transcribe', 0]],
  );
});

test('runs, failures, and the median of ok runs cover seven days', () => {
  const digest = row('digest');
  assert.deepEqual([digest.runs, digest.failed, digest.medianMs], [4, 1, 5000]);
  assert.deepEqual(row('meeting-notes').perDay.at(-1), { day: day(0), runs: 1, failed: 1, atomCalls: 0, atomFailed: 0 });
});

test('a microservice run outside the factory shows as its atom calls, and a factory run is not counted twice', () => {
  const activity = (name) => {
    const t = row(name);
    return [t.runs, t.failed, t.atomCalls, t.atomFailed, t.lastRunAt];
  };
  assert.deepEqual(activity('youtube'), [1, 0, 3, 1, `${day(0)}T00:00:00Z`]);
  assert.deepEqual(activity('podcast'), [0, 0, 1, 0, `${day(3)}T12:00:00Z`]);
  assert.deepEqual(activity('meeting-notes'), [1, 1, 0, 0, `${day(0)}T00:00:00Z`]);
  assert.deepEqual(
    row('youtube').perDay.map((d) => [d.runs, d.failed, d.atomCalls, d.atomFailed]),
    [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 2, 1], [1, 0, 0, 0]],
  );
  assert.deepEqual(model.calls, { runs: 7, failed: 2 });
});

test('linked projects and external microservices appear', () => {
  assert.deepEqual(row('youtube').links, [{ socket: 'into', where: project }]);
  assert.deepEqual(model.external, [{ name: 'art-desk', description: 'Art dataroom.', where: '~/victor/art-desk' }]);
  assert.deepEqual(model.problems, []);
});

test('a corrupt run-log line is skipped and reported, and today\'s spend stays unknown', () => {
  const dir = join(root, 'corrupt');
  const lines = RUNS.map((r) => JSON.stringify(r));
  lines.splice(2, 0, '{"type":"atom",');
  seed(dir, lines.join('\n'));
  const { code, model: broken } = status(dir);
  assert.equal(code, 1);
  assert.deepEqual(model.log, { lines: RUNS.length, unreadable: 0, firstUnreadable: null });
  assert.deepEqual(broken.log, { lines: RUNS.length, unreadable: 1, firstUnreadable: 3 });
  assert.equal(broken.budget.spentTodayUsd, null);
  assert.deepEqual(broken.problems.map((p) => p.path), [join(dir, 'runs.jsonl')]);
  assert.match(broken.problems[0].message, /\bline 3\b/);
  const history = (m) => [...m.microservices, ...m.atoms].map((r) => [r.name, r.runs, r.failed, r.medianMs, r.spentUsd]);
  assert.deepEqual(history(broken), history(model));
  assert.deepEqual(broken.calls, model.calls);
});

test('a run-log line written before the rename, with type tool, still counts as a microservice run', () => {
  const dir = join(root, 'old-type');
  seed(dir, RUNS.map((r) => JSON.stringify(r.type === 'microservice' ? { ...r, type: 'tool' } : r)).join('\n'));
  const { code, model: old } = status(dir);
  assert.equal(code, 0);
  const history = (m) => [...m.microservices, ...m.atoms].map((r) => [r.name, r.runs, r.failed, r.atomCalls, r.spentUsd]);
  assert.deepEqual(history(old), history(model));
  assert.deepEqual([row('youtube').runs, old.microservices.find((t) => t.name === 'youtube').runs], [1, 1]);
});

test('a run log that cannot be read leaves every count unknown, not zero', () => {
  const dir = join(root, 'noread');
  mkdirSync(join(dir, 'runs.jsonl'), { recursive: true });
  const { code, model: blind } = status(dir);
  assert.equal(code, 1);
  assert.deepEqual([blind.log, blind.calls, blind.budget.spentTodayUsd], [{ lines: null, unreadable: null, firstUnreadable: null }, null, null]);
  assert.deepEqual([...new Set([...blind.microservices, ...blind.atoms].flatMap((r) => [r.runs, r.failed, r.spentUsd, r.lastRunAt]))], [null]);
  assert.deepEqual(row('youtube').uses, blind.microservices.find((t) => t.name === 'youtube').uses);
});

test('the dashboard serves the same model on 127.0.0.1 and refuses writes, framing, and other hosts', async () => {
  const { url, stop } = await serve(home);
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(url);
    assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'");
    const html = await res.text();
    const embedded = JSON.parse(html.match(/<script id="status" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.deepEqual(embedded.microservices.map((t) => [t.name, t.spentUsd]), model.microservices.map((t) => [t.name, t.spentUsd]));
    assert.deepEqual(embedded.atoms.map((a) => a.usedBy), model.atoms.map((a) => a.usedBy));
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(new URL('status.json', url))).status, 404);
    for (const path of ['try', 'wiring', 'docs', 'docs/ui-source', 'docs/ui-source/registry', 'elsewhere']) assert.equal((await fetch(new URL(path, url))).status, 200, path);
    assert.equal((await fetch(new URL('docs/a/b/c', url))).status, 404);
    const rebound = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: attacker.example', url], { encoding: 'utf8' });
    assert.equal(rebound.stdout, '421');
  } finally {
    stop();
  }
});

test('the dashboard runs a microservice or atom verb only for its own page, and logs the run as the dashboard', async () => {
  const dir = join(root, 'tryhome');
  seed(dir, '');
  const { url, stop } = await serve(dir);
  const origin = new URL(url).origin;
  const post = (path, body, headers = {}) => fetch(new URL(path, url), { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('run/youtube/transcript', { input: 'x' }, { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await post('run/youtube/transcript', { input: 'x' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('run/youtube/nope', { input: 'x' })).status, 404);
    assert.equal((await post('run/captions/nope', { url: 'x' })).status, 404);
    assert.equal((await post('run/youtube/transcript', { input: 'x', extra: true })).status, 400);
    assert.equal((await fetch(new URL('run/youtube/transcript', url))).status, 405);

    const res = await post('run/youtube/transcript', { input: 'not a url' });
    assert.equal(res.status, 200);
    const last = (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert.equal(last.code, 1);
    assert.equal(last.output.error.code, 'invalid_source');
    const logged = readFileSync(join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(logged.filter((r) => r.type === 'microservice').map((r) => [r.name, r.verb, r.caller, r.ok]), [['youtube', 'transcript', 'dashboard', false]]);

    const atom = await post('run/ui-source/parse', { path: join(dir, 'missing.json') });
    assert.equal(atom.status, 200);
    assert.equal((await atom.text()).trim().split('\n').map((l) => JSON.parse(l)).at(-1).output.error.code, 'invalid_source');
  } finally {
    stop();
  }
});

test('a links.json that is not an array is reported, and every row shows its links as unknown', async () => {
  const dir = join(root, 'badlinks');
  seed(dir, RUNS.map((r) => JSON.stringify(r)).join('\n'), '{}');
  const { code, model: broken } = status(dir);
  assert.equal(code, 1);
  assert.deepEqual(broken.problems.map((p) => p.path), [join(dir, 'links.json')]);
  assert.deepEqual([...new Set([...broken.microservices, ...broken.atoms].map((r) => r.links))], [null]);
  const { url, stop } = await serve(dir);
  try {
    assert.equal((await fetch(url)).status, 200);
  } finally {
    stop();
  }
});

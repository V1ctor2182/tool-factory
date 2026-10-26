import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  line('youtube', 'tool', `${day(0)}T00:00:00Z`, { ms: 9000 }),
  line('digest', 'atom', `${day(0)}T00:00:00Z`, { ms: 7000, costUsd: 0.0085, caller: 'youtube' }),
  line('see', 'atom', `${day(0)}T00:00:00Z`, { ms: 3000, costUsd: 0.0025, caller: 'youtube' }),
  line('digest', 'atom', `${day(0)}T00:00:00Z`, { ms: 50, ok: false, caller: 'meeting-notes' }),
  line('meeting-notes', 'tool', `${day(0)}T00:00:00Z`, { ok: false }),
  line('digest', 'atom', `${day(3)}T12:00:00Z`, { ms: 5000, costUsd: 0.004, caller: 'podcast' }),
  line('transcribe', 'atom', `${day(3)}T12:00:00Z`, { ms: 1500 }),
  line('digest', 'atom', `${day(10)}T12:00:00Z`, { costUsd: 9, caller: 'youtube' }),
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

let model;
before(() => {
  copyRepo(root);
  cpSync(join(root, 'tools', 'meeting-notes'), join(root, 'tools', 'clipper'), { recursive: true });
  manifest(root, 'tools/clipper', (m) => Object.assign(m, { name: 'clipper', uses: ['frames', 'see'] }));
  writeFileSync(join(root, 'external.json'), JSON.stringify([{ name: 'art-desk', description: 'Art dataroom.', where: '~/victor/art-desk' }]));
  const path = join(project, '.claude', 'skills', 'youtube');
  seed(home, RUNS.map((r) => JSON.stringify(r)).join('\n'), JSON.stringify([{ name: 'youtube', socket: 'into', path, target: join(root, 'tools', 'youtube'), linkedAt: `${day(0)}T00:00:00Z` }]));
  const done = status(home);
  assert.equal(done.code, 0, done.stderr);
  model = done.model;
});

after(() => rmSync(root, { recursive: true, force: true }));

const row = (name) => [...model.tools, ...model.atoms].find((r) => r.name === name);

test('tools come first, the tool with the most atoms leading', () => {
  assert.deepEqual(model.tools.map((t) => t.name), ['youtube', 'podcast', 'clipper', 'meeting-notes', 'writing-style']);
  assert.deepEqual(row('youtube').uses, ['find-url', 'captions', 'download', 'transcribe', 'frames', 'see', 'digest']);
});

test('each atom lists the tools whose uses name it', () => {
  assert.deepEqual(Object.fromEntries(model.atoms.map((a) => [a.name, a.usedBy])), {
    captions: ['youtube'],
    digest: ['youtube', 'podcast', 'meeting-notes'],
    download: ['youtube', 'podcast'],
    'find-url': ['youtube', 'podcast'],
    frames: ['youtube', 'clipper'],
    see: ['youtube', 'clipper'],
    transcribe: ['youtube', 'podcast', 'meeting-notes'],
  });
});

test('spend counts today against the budget and charges atom spend to the calling tool', () => {
  assert.deepEqual(model.budget, { capUsd: 3, spentTodayUsd: 0.011 });
  assert.deepEqual(
    ['youtube', 'podcast', 'meeting-notes', 'digest', 'see', 'transcribe'].map((n) => [n, row(n).spentUsd]),
    [['youtube', 0.011], ['podcast', 0.004], ['meeting-notes', 0], ['digest', 0.0125], ['see', 0.0025], ['transcribe', 0]],
  );
});

test('runs, failures, and the median of ok runs cover seven days', () => {
  const digest = row('digest');
  assert.deepEqual([digest.runs, digest.failed, digest.medianMs], [3, 1, 6000]);
  assert.deepEqual(row('youtube').perDay.map((d) => [d.runs, d.failed]), [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 0]]);
  assert.deepEqual(row('meeting-notes').perDay.at(-1), { day: day(0), runs: 1, failed: 1 });
  assert.deepEqual(model.calls, { runs: 3, failed: 1 });
});

test('linked projects and external tools appear', () => {
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
  const history = (m) => [...m.tools, ...m.atoms].map((r) => [r.name, r.runs, r.failed, r.medianMs, r.spentUsd]);
  assert.deepEqual(history(broken), history(model));
  assert.deepEqual(broken.calls, model.calls);
});

test('the dashboard serves the same model on 127.0.0.1 and refuses writes and other hosts', async () => {
  const server = spawn('node', [join(root, 'factory', 'bin', 'factory.mjs'), 'dashboard', '--port', '0'], { env });
  try {
    const url = await new Promise((resolve) => server.stdout.on('data', (c) => resolve(String(c).match(/http:\/\/\S+\//)[0])));
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const html = await (await fetch(url)).text();
    const embedded = JSON.parse(html.match(/<script id="status" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.deepEqual(embedded.tools.map((t) => [t.name, t.spentUsd]), model.tools.map((t) => [t.name, t.spentUsd]));
    assert.deepEqual(embedded.atoms.map((a) => a.usedBy), model.atoms.map((a) => a.usedBy));
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(new URL('status.json', url))).status, 404);
    const rebound = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: attacker.example', url], { encoding: 'utf8' });
    assert.equal(rebound.stdout, '421');
  } finally {
    server.kill();
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { getFlow, getTrace, listFlows } from '../lib/flows/index.mjs';
import { declaredLoop } from '../lib/flows/loop.mjs';
import { REPO } from './repo.mjs';

const SECRET = 'SECRET-form-value-555-0100';
const base = mkdtempSync(join(tmpdir(), 'factory-flows-'));
const root = join(base, 'repo');
const studio = join(base, 'studio');
const production = join(studio, '.studio-local', 'production');
const claude = join(base, 'claude');
let jobfeedServer;
const DEAD_PID = 2 ** 22 + 7;
const saved = {};

const unix = (at) => Date.parse(at) / 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const jsonl = (records) => `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
const use = (at, id, name, input, parent = null) => ({ type: 'assistant', timestamp: at, parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (at, id, is_error = false) => ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: SECRET }] } });

const flat = (node) => (node.kind === 'group' ? [node, ...node.children.flatMap(flat)] : [node]);
const source = async (name) => (await listFlows(root)).sources.find((s) => s.source === name);

function seedStudio() {
  mkdirSync(join(production, 'attempts'), { recursive: true });
  mkdirSync(join(production, 'agent-runs'), { recursive: true });
  const db = new DatabaseSync(join(production, 'production.sqlite3'));
  db.exec(`CREATE TABLE tasks (id TEXT, logical_key TEXT, spec TEXT, current INTEGER, state TEXT, revision INTEGER, error TEXT, review_id TEXT);
    CREATE TABLE attempts (id TEXT, task_id TEXT, kind TEXT, role TEXT, runtime TEXT, state TEXT, started REAL, ended_at REAL, heartbeat_at REAL, generation INTEGER, process TEXT, result TEXT);
    CREATE TABLE plans (id TEXT, created REAL, body TEXT);
    CREATE TABLE publications (operation_id TEXT, task_id TEXT, review TEXT, created_at REAL);
    CREATE TABLE events (at REAL, kind TEXT, body TEXT);`);
  const task = db.prepare('INSERT INTO tasks (id, logical_key, spec, current, state, revision, error, review_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  task.run('t-impl', 'battle/implementation', SECRET, 1, 'accepted', 2, null, null);
  task.run('t-art', 'battle/hud/concept2d', SECRET, 1, 'ready', 1, null, null);
  task.run('t-next', 'battle/interaction', SECRET, 1, 'waiting_dependencies', 1, null, null);
  task.run('t-live', 'night/implementation', SECRET, 1, 'ready', 1, null, null);
  task.run('t-gate', 'gate/bell/model3d', SECRET, 1, 'awaiting_review', 3, null, 'review-new');
  const attempt = db.prepare('INSERT INTO attempts (id, task_id, kind, role, runtime, state, started, ended_at, generation, process, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
  const when = (min) => unix(`2026-10-01T10:${String(min).padStart(2, '0')}:00Z`);
  attempt.run('plan-old', '@planner', 'planner', 'planner', 'claude', 'completed', when(0), when(1), null);
  attempt.run('plan-new', '@planner', 'planner', 'planner', 'claude', 'completed', when(5), when(6), null);
  attempt.run('art1', 't-art', 'worker', 'image', 'codex', 'active', when(10), null, JSON.stringify({ pid: DEAD_PID }));
  attempt.run('impl1', 't-impl', 'worker', 'worker', 'claude', 'completed', when(20), when(21), null);
  attempt.run('impl2', 't-impl', 'worker_continuation', 'worker', 'claude', 'completed', when(22), when(23), null);
  attempt.run('live1', 't-live', 'worker', 'worker', 'claude', 'active', when(40), null, JSON.stringify({ pid: process.pid }));
  attempt.run('plan-now', '@planner', 'planner', 'planner', 'claude', 'active', Date.now() / 1000, null, JSON.stringify({ pid: DEAD_PID }));
  attempt.run('gate1', 't-gate', 'worker', 'worker', 'claude', 'completed', when(50), when(51), null);
  attempt.run('check-no', 't-gate', 'verifier', 'verifier', 'claude', 'completed', when(52), when(53), null, JSON.stringify({ result: { accepted: 0 } }));
  attempt.run('gate2', 't-gate', 'worker', 'worker', 'claude', 'completed', when(54), when(55), null);
  attempt.run('check-yes', 't-gate', 'verifier', 'verifier', 'claude', 'completed', when(56), when(57), null, JSON.stringify({ result: { accepted: 1 } }));
  const plan = db.prepare('INSERT INTO plans VALUES (?, ?, ?)');
  plan.run('p1', when(1), '{}');
  plan.run('p2', when(6), '{}');
  plan.run('p3', when(9), '{}');
  const publication = db.prepare('INSERT INTO publications VALUES (?, ?, ?, ?)');
  publication.run('op-old', 't-gate', JSON.stringify({ id: 'review-old' }), when(53));
  publication.run('op-new', 't-gate', JSON.stringify({ id: 'review-new' }), when(58));
  db.prepare('INSERT INTO events VALUES (?, ?, ?)').run(when(54), 'revision_requested', JSON.stringify({ review: 'review-old', feedback: SECRET }));
  db.close();
  writeFileSync(join(production, 'agent-runs', 'impl1.json'), JSON.stringify({ cost_usd: 2.5 }));
  writeFileSync(join(production, 'agent-runs', 'impl2.json'), JSON.stringify({ cost_usd: 'unknown' }));
  const events = (id, content) => {
    mkdirSync(join(production, 'attempts', `${id}.control`), { recursive: true });
    writeFileSync(join(production, 'attempts', `${id}.control`, 'events.jsonl'), content);
  };
  events('impl1', jsonl([
    { type: 'system', subtype: 'init' },
    'not json {',
    use('2026-10-01T10:20:10Z', 'b1', 'Bash', { command: `API_KEY=${SECRET} /usr/bin/git push ${SECRET}` }),
    result('2026-10-01T10:20:20Z', 'b1'),
    use('2026-10-01T10:20:30Z', 'r1', 'Read', { file_path: `/private/${SECRET}/notes.md` }),
    result('2026-10-01T10:20:31Z', 'r1', true),
    use('2026-10-01T10:20:40Z', 'a1', 'Agent', { description: 'Check the build', prompt: SECRET }),
    use('2026-10-01T10:20:41Z', 'n1', 'mcp__claude-in-chrome__navigate', { url: `https://jobs.example.com/${SECRET}?q=${SECRET}` }, 'a1'),
    result('2026-10-01T10:20:42Z', 'n1'),
    use('2026-10-01T10:20:43Z', 'x1', 'mcp__vendor__do_thing', { value: SECRET }, 'a1'),
    result('2026-10-01T10:20:44Z', 'x1'),
    result('2026-10-01T10:20:50Z', 'a1'),
    use('2026-10-01T10:20:55Z', 'o1', 'Write', { file_path: '/tmp/out.txt', content: SECRET }),
    { type: 'result', subtype: 'success', result: SECRET },
  ]));
  events('art1', jsonl([{ type: 'thread.started', thread_id: 'x' }, { type: 'item.started', item: { command: SECRET } }]));
  events('live1', jsonl([use('2026-10-01T10:40:05Z', 'g1', 'Grep', { pattern: SECRET })]));
}

const JOB_TRACE = {
  job_id: 829, started_at: '2026-10-02T09:00:00+00:00', is_live: false, title: 'Job #829', subtitle: 'Software Engineer at Schonfeld · Claude Applier · finished', fieldsTotal: null,
  root: { kind: 'group', id: 'worker', name: 'Worker', meta: 'job #829', role: 'worker', start: 0, end: 300, children: [
    { kind: 'step', id: 'launch', name: 'Launch Applier', meta: 'claude --bg', category: 'shell', start: 0, end: 1, outcome: 'ok', fieldsFilled: null, note: null },
    { kind: 'group', id: 'applier-1', name: 'Applier', meta: 'Claude CLI', role: 'applier', start: 1, end: 100, children: [
      { kind: 'step', id: 'f1', name: 'Fill field', meta: 'form_input', category: 'browser', start: 2, end: 3, outcome: 'failed', fieldsFilled: 1, note: 'The tool returned an error.' },
      { kind: 'step', id: 'request-0', name: 'Ask you', meta: 'missing_answer · Salary', category: 'human', start: 5, end: 9, outcome: 'ok', fieldsFilled: null, note: `My expected salary is ${SECRET}` },
    ] },
    { kind: 'group', id: 'applier-2', name: 'Applier', meta: 'Claude CLI', role: 'applier', start: 120, end: 200, children: [] },
    { kind: 'step', id: 'submit', name: 'Submit', meta: 'submitted · attempt 1', category: 'backend', start: 190, end: 195, outcome: 'ok', fieldsFilled: null, note: null },
  ] },
};
const liveTrace = (jobId, age = jobId === 830 ? 3600 : 100) => ({
  job_id: jobId, started_at: ago(age * 1000), is_live: true, title: `Job #${jobId}`, subtitle: 'x · running', fieldsTotal: null,
  root: { kind: 'group', id: 'worker', name: 'Worker', meta: '', role: 'worker', start: 0, end: age, children: [
    { kind: 'step', id: 'launch', name: 'Launch Applier', meta: '', category: 'shell', start: 0, end: 1, outcome: 'ok' },
    { kind: 'group', id: 'applier-1', name: 'Applier', meta: '', role: 'applier', start: 1, end: age, children: [
      { kind: 'step', id: 'n1', name: 'Open page', meta: '', category: 'browser', start: 2, end: 3, outcome: 'ok' },
      ...(jobId >= 831 ? [{ kind: 'step', id: 'request-0', name: 'Ask you', meta: 'captcha', category: 'human', start: 50, end: age, outcome: 'ok', note: SECRET }] : []),
    ] },
  ] },
});

const PIPELINE_RUNS = [
  { run_id: '320009a8-3f4e-4a1b-9c21-0d6e8f7a1b2c', source: 'evaluate', status: 'succeeded', started_at: '2026-11-07T07:58:38.538601Z', finished_at: '2026-11-07T08:28:04.386854Z', jobs_scored: 578, verdict_counts: { apply: 88, consider: 98, skip: 3 }, total_llm_cost_usd: 1.5 },
  { run_id: 'scan-new', source: 'all', status: 'succeeded', started_at: '2026-11-07T07:37:00.000000Z', finished_at: '2026-11-07T07:50:00.000000Z', jobs_discovered: 2617, jobs_inserted: 1196, verdict_counts: {}, total_llm_cost_usd: 0 },
  { run_id: 'scan-old', source: 'all', status: 'failed', started_at: '2026-11-05T07:37:00.000000Z', finished_at: '2026-11-05T07:38:00.000000Z', jobs_discovered: 0, jobs_inserted: 0, verdict_counts: {}, total_llm_cost_usd: 0 },
];

function serveJobfeed() {
  const runs = [
    { job_id: 829, company: 'Schonfeld', title: 'Software Engineer', state: 'finished', started_at: '2026-10-02T09:00:00+00:00', updated_at: '2026-10-02T09:05:00+00:00', is_live: false, session_count: 2 },
    { job_id: 830, company: null, title: null, state: 'running', started_at: ago(3_600_000), updated_at: ago(1_000), is_live: true, session_count: 1 },
    { job_id: 831, company: null, title: null, state: 'running', started_at: ago(1_000), updated_at: ago(1_000), is_live: true, session_count: 1 },
    { job_id: 832, company: null, title: null, state: 'running', started_at: ago(2_000), updated_at: ago(3_600_000), is_live: true, session_count: 1 },
    { job_id: 833, company: null, title: null, state: 'failed', started_at: '2026-10-02T08:00:00+00:00', updated_at: '2026-10-02T08:05:00+00:00', is_live: false, session_count: 1 },
  ];
  jobfeedServer = createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/applier-runs') return send(200, { runs });
    if (req.url === '/api/runs?limit=100') return send(200, { runs: PIPELINE_RUNS });
    const id = Number(req.url.match(/^\/api\/applier-runs\/(\d+)\/trace$/)?.[1]);
    if (id === 829) return send(200, JOB_TRACE);
    if (id === 830 || id === 831 || id === 832) return send(200, liveTrace(id));
    if (id === 833) return send(200, { ...JOB_TRACE, job_id: 833 });
    return send(404, { detail: 'none' });
  });
  return new Promise((resolve) => jobfeedServer.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${jobfeedServer.address().port}`)));
}

function seedTools() {
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  process.env.TOOL_FACTORY_HOME = home;
  const atom = (name, verb, kind, at, extra) => ({ type: 'atom', name, verb, kind, startedAt: at, ms: 1000, ok: true, cacheHit: false, costUsd: 0, caller: 'podcast', ...extra });
  writeFileSync(join(home, 'runs.jsonl'), jsonl([
    { type: 'microservice', name: 'podcast', verb: 'clone', kind: 'pipeline', startedAt: '2026-10-03T10:00:00Z', ms: 60000, ok: true, caller: 'factory' },
    atom('page-record', 'capture', 'observe', '2026-10-03T10:00:01Z'),
    atom('ui-draft', 'write', 'model', '2026-10-03T10:00:03Z', { costUsd: 0.5 }),
    atom('page-diff', 'compare', 'transform', '2026-10-03T10:00:05Z', { cacheHit: true }),
    atom('ui-draft', 'write', 'model', '2026-10-03T10:00:07Z', { costUsd: 0.25, ok: false, error: 'over_budget' }),
    atom('page-diff', 'compare', 'transform', '2026-10-03T10:00:09Z'),
    atom('stray', 'run', 'act', '2026-10-03T10:00:09Z', { caller: null }),
    atom('page-record', 'capture', 'observe', '2026-10-03T11:00:00Z'),
    atom('digest', 'summarize', 'model', '2026-10-03T12:00:00Z', { caller: 'youtube' }),
  ]));
}

const at = (time) => `2026-10-05T${time}Z`;
const logAtom = (caller, name, verb, kind, startedAt, ms, extra) => ({ type: 'atom', name, verb, kind, startedAt, ms, ok: true, cacheHit: false, costUsd: 0, caller, ...extra });

function dated(path, body, when) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  const stamp = new Date(when);
  utimesSync(path, stamp, stamp);
}

function seedRebuild(home, name, n, draftAt, score, diffAt) {
  const dir = join(home, 'microservices', 'ui-clone', 'rebuild', name, `round-${n}`);
  dated(join(dir, 'draft.json'), { model: 'test-model', item: SECRET, demo: SECRET, notes: SECRET, costUsd: 0.25, cacheHit: false }, draftAt);
  if (diffAt) dated(join(dir, 'diff.json'), { score, states: SECRET }, diffAt);
}

function seedCompare(home, name, n, planAt, diffAt, major, minor) {
  const dir = join(home, 'microservices', 'site-clone', name, `round-${n}`);
  dated(join(dir, 'plan.json'), { url: SECRET }, planAt);
  if (diffAt) dated(join(dir, 'diff.json'), { summary: { major, minor, departures: 0, runsCompared: 3 }, differences: SECRET }, diffAt);
}

function seedStudy(home, name, url, start, end) {
  const dir = join(home, 'microservices', 'site-clone', name);
  dated(join(dir, 'bundle.json'), { body: SECRET }, start);
  dated(join(dir, 'facts.json'), { body: SECRET }, start);
  dated(join(dir, 'plan.json'), { url }, start);
  dated(join(dir, 'brief.md'), SECRET, end);
}

const SESSION = '11111111-2222-3333-4444-555555555555';
const LOGGED_SESSION = '66666666-7777-8888-9999-000000000000';

function seedClones(home) {
  seedRebuild(home, 'card-rebuild', 1, at('10:01:00'), 0.71, at('10:01:30'));
  seedRebuild(home, 'card-rebuild', 2, at('10:03:00'));
  seedRebuild(home, 'card-rebuild', 3, at('10:05:00'), 0.94123, at('10:05:30'));
  seedRebuild(home, 'low-rebuild', 1, at('11:00:30'), 0.5, at('11:01:00'));
  seedRebuild(home, 'rerun-rebuild', 1, at('12:00:30'), 0.8, at('09:00:00'));
  dated(join(home, 'microservices', 'ui-clone', 'site', 'kobra', 'button', 'steps.json'), { url: SECRET }, at('09:30:00'));
  const ui = (name, verb, kind, startedAt, ms, extra) => logAtom('ui-clone', name, verb, kind, startedAt, ms, extra);
  const site = (name, verb, kind, startedAt, ms, extra) => logAtom('site-clone', name, verb, kind, startedAt, ms, extra);
  appendFileSync(join(home, 'runs.jsonl'), jsonl([
    ui('ui-catalog', 'registry', 'observe', at('08:00:00'), 500),
    ui('ui-source', 'registry', 'observe', at('08:00:01'), 500),
    ui('ui-source', 'registry', 'observe', at('08:00:01'), 400),
    ui('ui-source', 'registry', 'observe', at('08:00:02'), 300, { ok: false, error: 'unavailable' }),
    ui('ui-source', 'registry', 'observe', at('09:00:00'), 300),
    ui('ui-draft', 'write', 'model', at('10:00:40'), 20_000, { costUsd: 0.25 }),
    ui('page-record', 'capture', 'observe', at('10:01:01'), 5000),
    ui('page-diff', 'compare', 'transform', at('10:01:06'), 20_000),
    ui('ui-draft', 'write', 'model', at('10:02:40'), 20_000, { costUsd: 0.25 }),
    ui('page-record', 'capture', 'observe', at('10:03:02'), 4000, { ok: false, error: 'invalid_source' }),
    ui('ui-draft', 'write', 'model', at('10:04:40'), 20_000, { costUsd: 0.25 }),
    ui('page-record', 'capture', 'observe', at('10:05:01'), 5000),
    ui('page-diff', 'compare', 'transform', at('10:05:06'), 20_000),
    ui('ui-draft', 'write', 'model', at('12:00:10'), 20_000, { costUsd: 0.25 }),
    site('page-bundle', 'fetch', 'observe', at('13:00:01'), 1000),
    site('page-read', 'facts', 'observe', at('13:00:03'), 1000),
    site('page-sweep', 'capture', 'observe', at('14:00:30'), 20_000),
    site('motion-diff', 'compare', 'transform', at('14:00:55'), 1000),
    site('page-read', 'facts', 'observe', at('16:00:30'), 1000, { session: LOGGED_SESSION }),
  ]));

  seedStudy(home, 'shop', 'https://shop.example.com/fall', at('13:00:00'), at('13:30:00'));
  seedCompare(home, 'shop', 1, at('14:00:00'), at('14:01:00'), 2, 3);
  seedCompare(home, 'shop', 2, at('14:10:00'), at('14:11:00'), 1, 6);
  seedCompare(home, 'shop', 3, at('14:20:00'), null);
  seedStudy(home, 'empty', 'https://empty.example.com/', at('13:00:00'), at('13:30:00'));
  seedStudy(home, 'clean', 'http://localhost:4300/', at('15:00:00'), at('15:10:00'));
  seedCompare(home, 'clean', 1, at('15:20:00'), at('15:21:00'), 0, 1);
  seedStudy(home, 'restudied', 'https://again.example.com/', at('19:00:00'), at('19:30:00'));
  dated(join(home, 'microservices', 'site-clone', 'restudied', 'map.json'), {}, at('15:50:00'));
  seedCompare(home, 'restudied', 1, at('16:00:00'), at('16:01:00'), 1, 0);
  seedStudy(home, 'logged', 'https://logged.example.com/', at('16:00:00'), at('16:10:00'));
  seedCompare(home, 'logged', 1, at('16:20:00'), at('16:21:00'), 1, 0);

  const projects = join(claude, 'projects', '-some-project');
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, `${SESSION}.jsonl`), jsonl([
    use(at('14:00:10'), 'early', 'Read', { file_path: `/private/${SECRET}/before.tsx` }),
    result(at('14:00:11'), 'early'),
    use(at('14:05:00'), 'e1', 'Edit', { file_path: `/work/${SECRET}/hero.tsx`, new_string: SECRET }),
    result(at('14:05:10'), 'e1'),
    use(at('14:09:58'), 'c2', 'Bash', { command: 'S=x microservices/site-clone/run compare shop --clone http://localhost:4400/' }),
    result(at('14:11:00'), 'c2'),
    use(at('14:12:00'), 'later', 'Read', { file_path: '/work/after.tsx' }),
    result(at('14:12:01'), 'later'),
  ]));
  writeFileSync(join(projects, `${LOGGED_SESSION}.jsonl`), jsonl([
    use(at('16:11:00'), 'w1', 'Write', { file_path: '/work/page.tsx', content: SECRET }),
    result(at('16:11:05'), 'w1'),
  ]));
}

function withHome(seed, work) {
  const home = mkdtempSync(join(base, 'home-'));
  const previous = process.env.TOOL_FACTORY_HOME;
  process.env.TOOL_FACTORY_HOME = home;
  seed(home);
  return work(home).finally(() => {
    process.env.TOOL_FACTORY_HOME = previous;
  });
}

before(async () => {
  for (const name of ['TOOL_FACTORY_HOME', 'CLAUDE_CONFIG_DIR']) saved[name] = process.env[name];
  process.env.CLAUDE_CONFIG_DIR = claude;
  mkdirSync(root, { recursive: true });
  const api = await serveJobfeed();
  writeFileSync(join(root, 'external.json'), JSON.stringify([
    { name: 'art-desk', description: 'd', where: '~/x' },
    { name: 'game-studio', description: 'd', where: studio, flows: 'game-studio' },
    { name: 'job-applier', description: 'd', where: api, flows: 'job-applier' },
  ]));
  seedStudio();
  seedTools();
  seedClones(join(base, 'home'));
});

after(() => {
  jobfeedServer.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(base, { recursive: true, force: true });
});

test('a source that fails reports its error and the others still list', async () => {
  const broken = join(base, 'broken');
  mkdirSync(broken);
  writeFileSync(join(broken, 'external.json'), JSON.stringify([{ name: 'game-studio', description: 'd', where: join(base, 'absent'), flows: 'game-studio' }]));
  const { sources } = await listFlows(broken);
  assert.deepEqual(sources.map((s) => s.source), ['game-studio', 'job-applier', 'ui-clone', 'site-clone', 'tools']);
  assert.match(sources[0].error, /no Game Studio database/);
  assert.deepEqual(sources[0].flows, []);
  assert.match(sources[1].error, /no entry with "flows": "job-applier"/);
  assert.equal(sources[4].error, null);
  assert.ok(sources[4].flows.length > 0);
  assert.equal((await listFlows(join(base, 'no-repo'))).sources[0].error.length > 0, true);
});

test('a Game Studio feature reads as a plan stage, then stages in start order, then unstarted stages', async () => {
  const flow = await getFlow(root, 'game-studio:battle');
  assert.deepEqual(flow.stages.map((s) => s.id), ['plan', 'concept2d', 'implementation', 'interaction']);
  assert.deepEqual(flow.stages[0].agents.map((a) => a.id), ['plan-new']);
  assert.equal(flow.title, 'Battle');
  assert.equal(flow.subtitle, '3 tasks, 1 accepted');
  assert.equal(flow.startedAt, '2026-10-01T10:10:00.000Z');
  assert.deepEqual(flow.stages[2].agents.map((a) => [a.name, a.role, a.state, a.costUsd, a.traced]), [
    ['worker', 'worker', 'done', 2.5, true],
    ['continuation 1', 'worker', 'done', null, false],
  ]);
  assert.equal(flow.stages[2].state, 'done');
  assert.equal(flow.stages[2].loops, 2);
  assert.deepEqual(flow.backEdges, [{ from: 'implementation', to: 'implementation', count: 2 }]);
  assert.deepEqual(flow.stages[3].agents.map((a) => [a.role, a.state, a.startedAt, a.traced]), [['worker', 'pending', null, false]]);
  assert.equal(flow.costUsd, 2.5);
  assert.equal(flow.agents, 5);
  assert.equal(flow.loops, 2);
});

test('an active attempt is running only while its process lives', async () => {
  const battle = await getFlow(root, 'game-studio:battle');
  const art = battle.stages.find((s) => s.id === 'concept2d');
  assert.deepEqual(art.agents.map((a) => [a.name, a.role, a.state, a.meta, a.traced]), [['image', 'image', 'stalled', 'hud', false]]);
  assert.equal(art.state, 'stalled');
  assert.equal(battle.state, 'stalled');
  assert.equal(battle.working, 0);
  const night = await getFlow(root, 'game-studio:night');
  assert.equal(night.state, 'running');
  assert.equal(night.working, 1);
  assert.equal(night.endedAt, null);
});

test('the Studio loop lays every phase on one rail and counts each way back', async () => {
  const loop = await getFlow(root, 'game-studio:loop');
  assert.deepEqual(loop.stages.map((s) => s.title), ['Plan', 'Concept', 'Model', 'Animation', 'Code', 'Interaction', 'Verify', 'You review']);
  assert.deepEqual(loop.backEdges, [
    { from: 'model3d', to: 'model3d', count: 1 },
    { from: 'implementation', to: 'implementation', count: 1 },
    { from: 'verify', to: 'model3d', count: 1, label: 'rejected' },
    { from: 'you', to: 'model3d', count: 2, label: 'rework' },
    { from: 'you', to: 'implementation', count: 1, label: 'rework' },
    { from: 'you', to: 'plan', count: 2, label: 'replan' },
  ]);
  const stage = (id) => loop.stages.find((s) => s.id === id);
  assert.deepEqual(stage('plan').agents.map((a) => a.id), ['plan-now', 'plan-new', 'plan-old']);
  assert.equal(stage('plan').state, 'stalled');
  assert.deepEqual(stage('model3d').agents.map((a) => a.name), ['bell · worker', 'bell · worker']);
  assert.equal(stage('model3d').state, 'done');
  assert.deepEqual(stage('verify').agents.map((a) => a.id), ['check-yes', 'check-no']);
  assert.equal(stage('verify').state, 'done');
  assert.deepEqual(stage('you').agents.map((a) => [a.id, a.role, a.state, a.meta]), [['op-new', 'you', 'blocked', 'waiting on you'], ['op-old', 'you', 'done', 'changes requested']]);
  assert.equal(stage('you').state, 'blocked');
  assert.equal(loop.state, 'running');
  assert.equal(loop.subtitle, '3 features, 1 of 5 tasks accepted');
  assert.equal(JSON.stringify(loop).includes(SECRET), false);
});

test('a source with a loop lists it beside its features, and planners live only in the loop', async () => {
  const studioSource = await source('game-studio');
  assert.equal(studioSource.loop.id, 'game-studio:loop');
  assert.equal(studioSource.loop.working, 1);
  assert.equal(studioSource.flows.some((f) => f.id === 'game-studio:loop' || f.id === 'game-studio:planning'), false);
  assert.equal(studioSource.flows.find((f) => f.id === 'game-studio:gate').state, 'blocked');
  assert.equal((await source('tools')).loop, undefined);
  assert.equal(await getFlow(root, 'game-studio:planning'), null);
  const trace = await getTrace(root, 'game-studio:loop', 'impl1');
  assert.ok(trace.root.children[0].children.length > 0);
});

test('a flow summary carries the contract fields, newest first', async () => {
  const { flows, where, label } = (await source('game-studio'));
  assert.equal(where, studio);
  assert.equal(label, 'Game Studio');
  const dates = flows.map((f) => f.startedAt);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.deepEqual(Object.keys(flows[0]).sort(), ['agents', 'costUsd', 'endedAt', 'id', 'lastAt', 'loops', 'source', 'startedAt', 'state', 'subtitle', 'title', 'working']);
});

test('a trace nests subagent calls and shows only allowlisted details', async () => {
  const trace = await getTrace(root, 'game-studio:battle', 'impl1');
  assert.equal(trace.startedAt, '2026-10-01T10:20:00.000Z');
  assert.equal(trace.live, false);
  assert.equal(trace.root.role, 'coordinator');
  const [attempt] = trace.root.children;
  assert.deepEqual([attempt.name, attempt.role, attempt.start], ['worker', 'worker', 0]);
  const [bash, read, agent, write] = attempt.children;
  assert.deepEqual([bash.name, bash.meta, bash.category, bash.start, bash.end, bash.outcome], ['Run command', 'Bash · git', 'shell', 10, 20, 'ok']);
  assert.deepEqual([read.meta, read.category, read.outcome, read.note], ['Read · notes.md', 'file', 'failed', 'The tool returned an error.']);
  assert.deepEqual([agent.kind, agent.name, agent.meta, agent.start, agent.end], ['group', 'Subagent', 'Check the build', 40, 50]);
  assert.deepEqual(agent.children.map((c) => [c.name, c.category, c.meta]), [['Open page', 'browser', 'navigate · jobs.example.com'], ['do_thing', 'backend', 'do_thing']]);
  assert.equal(write.end, attempt.end);
  assert.ok(write.end !== null, 'an ended attempt leaves no call open');
  assert.equal(flat(trace.root).some((n) => n.category === 'model'), false);
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
  assert.equal(JSON.stringify(await getFlow(root, 'game-studio:battle')).includes(SECRET), false);
});

test('a live attempt keeps its open call open, and Codex events give an empty group', async () => {
  const live = await getTrace(root, 'game-studio:night', 'live1');
  assert.equal(live.live, true);
  assert.equal(live.root.end, null);
  const [grep] = live.root.children[0].children;
  assert.deepEqual([grep.name, grep.end, grep.category], ['Search files', null, 'file']);
  const codex = await getTrace(root, 'game-studio:battle', 'art1');
  assert.deepEqual(codex.root.children[0].children, []);
  assert.equal(JSON.stringify(codex).includes(SECRET), false);
  assert.equal(await getTrace(root, 'game-studio:battle', 'nope'), null);
  assert.equal(await getFlow(root, 'game-studio:nope'), null);
  assert.equal(await getFlow(root, 'nope:x'), null);
  assert.equal(await getFlow(root, 'nope'), null);
});

test('a job reads as launch, apply, you, and submit stages', async () => {
  const flow = await getFlow(root, 'job-applier:829');
  assert.equal(flow.title, 'Job #829');
  assert.equal(flow.state, 'done');
  assert.deepEqual(flow.stages.map((s) => [s.id, s.agents.length, s.loops]), [['launch', 1, 0], ['apply', 2, 1], ['you', 1, 0], ['submit', 1, 0]]);
  assert.deepEqual(flow.backEdges, [{ from: 'apply', to: 'apply', count: 1 }]);
  assert.equal(await getFlow(root, 'job-applier:999'), null);
  assert.equal(await getFlow(root, 'job-applier:../../x'), null);
});

test('scans and evaluations open the Applier loop, and only the newest run sets a phase\'s state', async () => {
  const { loop } = await source('job-applier');
  const stage = (id) => loop.stages.find((s) => s.id === id);
  assert.deepEqual(stage('scan').agents.map((a) => [a.name, a.state, a.meta, a.traced]), [['Nov 7 · 2617 found', 'done', '1196 new', false], ['Nov 5 · 0 found', 'failed', '0 new', false]]);
  assert.equal(stage('scan').state, 'done');
  assert.deepEqual(stage('evaluate').agents.map((a) => [a.name, a.role, a.meta, a.costUsd]), [['Nov 7 · 578 scored', 'model', '88 apply, 98 consider, 3 skip', 1.5]]);
  assert.equal(loop.startedAt, '2026-10-02T08:00:00.000Z');
  const chip = loop.stages.find((s) => s.id === 'scan').agents[0];
  const opened = await getTrace(root, 'job-applier:loop', chip.id);
  assert.deepEqual([opened.title, opened.subtitle, opened.root.children], ['Applier loop', `Scan · ${chip.name}`, []]);
});

test('every loop the sources build follows the loop contract and declares only what it measures', async () => {
  const spec = JSON.parse(readFileSync(join(REPO, 'factory', 'lib', 'loops.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'loop-contract-'));
  const contract = (name, value) => {
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(value));
    const done = spawnSync(join(REPO, 'contracts', 'check'), [name, file], { encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
  };
  contract('loop-spec', spec);
  for (const [name, loop] of Object.entries(spec)) {
    const ids = loop.stages.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, name);
    for (const edge of loop.edges) assert.ok(ids.includes(edge.from) && ids.includes(edge.to), `${name} ${edge.from} to ${edge.to}`);
  }
  for (const name of ['game-studio', 'job-applier', 'ui-clone', 'site-clone']) {
    const { key, title, subtitle, startedAt, state, stages, backEdges } = await getFlow(root, `${name}:loop`);
    assert.deepEqual(stages.map((s) => s.id), spec[name].stages.map((s) => s.id));
    contract('loop', { key: 'loop', title, subtitle, startedAt, state, stages: stages.map(({ id, title: t, state: s, loops, agents }) => ({ id, title: t, state: s, loops, agents })), backEdges });
  }
  rmSync(dir, { recursive: true, force: true });
  assert.throws(() => declaredLoop('site-clone', { subtitle: '', startedAt: '', stages: { ship: { agents: [] } } }), /does not declare stage ship/);
  assert.throws(() => declaredLoop('site-clone', { subtitle: '', startedAt: '', stages: {}, edges: [{ from: 'build', to: 'study', count: 1 }] }), /does not declare edge build to study/);
});

test('every job folds into one loop, and a chip opens that job\'s trace', async () => {
  const { loop } = await source('job-applier');
  assert.equal(loop.id, 'job-applier:loop');
  assert.equal(loop.title, 'Applier loop');
  assert.equal(loop.subtitle, '5 jobs, 1 done');
  assert.deepEqual(loop.stages.map((s) => s.title), ['Scan', 'Evaluate', 'Apply', 'You', 'Submit']);
  const jobChips = loop.stages.filter((s) => !['scan', 'evaluate'].includes(s.id)).flatMap((s) => s.agents);
  assert.ok(jobChips.every((a) => /^Job #\d+$/.test(a.name) && a.id.startsWith(a.name.slice(5))));
  assert.deepEqual(loop.backEdges, [{ from: 'apply', to: 'apply', count: 2 }]);
  assert.equal((await getFlow(root, 'job-applier:loop')).agents, loop.agents);
  assert.deepEqual(await getTrace(root, 'job-applier:loop', '829.launch'), await getTrace(root, 'job-applier:829', 'launch'));
  assert.equal(await getTrace(root, 'job-applier:loop', '829.nope'), null);
  assert.equal(await getTrace(root, 'job-applier:loop', 'launch'), null);
});

test('an ended job ends at its last call, not at Jobfeed\'s last sweep', async () => {
  const trace = await getTrace(root, 'job-applier:829', 'launch');
  assert.equal(trace.root.end, 195);
  assert.equal(flat(trace.root).find((n) => n.id === 'applier-1').end, 9);
  assert.equal((await getFlow(root, 'job-applier:829')).endedAt, '2026-10-02T09:03:15.000Z');
  const listed = (await source('job-applier')).flows.find((f) => f.id === 'job-applier:829');
  assert.equal(listed.lastAt, '2026-10-02T09:03:15.000Z');
  assert.equal(listed.subtitle, 'Software Engineer at Schonfeld · Claude Applier');
});

test('a job trace passes the tree through without a request\'s free text', async () => {
  const trace = await getTrace(root, 'job-applier:829', 'launch');
  assert.deepEqual(trace, await getTrace(root, 'job-applier:829', 'submit'));
  assert.equal(trace.live, false);
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
  assert.equal(flat(trace.root).find((n) => n.id === 'f1').note, 'The tool returned an error.');
  assert.equal(await getTrace(root, 'job-applier:829', 'nope'), null);
});

test('a live job leaves its open spans open, stalls when silent, and blocks on an open request', async () => {
  const flows = (await source('job-applier')).flows;
  assert.deepEqual(flows.map((f) => [f.id, f.state]).sort(), [['job-applier:829', 'done'], ['job-applier:830', 'stalled'], ['job-applier:831', 'blocked'], ['job-applier:832', 'blocked'], ['job-applier:833', 'failed']]);
  const silent = await getFlow(root, 'job-applier:830');
  assert.equal(silent.state, 'stalled');
  assert.equal(silent.working, 0);
  assert.equal(silent.stages.find((s) => s.id === 'apply').agents[0].state, 'stalled');
  const quiet = await getTrace(root, 'job-applier:830', 'launch');
  assert.equal(quiet.live, false);
  assert.equal(quiet.root.end, 3);
  const blocked = await getFlow(root, 'job-applier:831');
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.stages.find((s) => s.id === 'you').agents[0].state, 'blocked');
  assert.equal(blocked.stages.find((s) => s.id === 'apply').agents[0].state, 'blocked');
  assert.equal(blocked.working, 0);
  assert.equal((await getFlow(root, 'job-applier:832')).state, 'blocked');
  assert.equal((await getFlow(root, 'job-applier:833')).state, 'failed');
  const trace = await getTrace(root, 'job-applier:831', 'request-0');
  const nodes = flat(trace.root);
  assert.deepEqual(nodes.filter((n) => n.end === null).map((n) => n.id), ['worker', 'applier-1', 'request-0']);
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
});

test('an unreachable Jobfeed is that source\'s error alone', async () => {
  const away = join(base, 'away');
  mkdirSync(away);
  writeFileSync(join(away, 'external.json'), JSON.stringify([{ name: 'game-studio', description: 'd', where: studio, flows: 'game-studio' }, { name: 'job-applier', description: 'd', where: 'http://127.0.0.1:9/', flows: 'job-applier' }]));
  const { sources } = await listFlows(away);
  assert.equal(sources[1].where, 'http://127.0.0.1:9');
  assert.match(sources[1].error, /can't reach Jobfeed at http:\/\/127\.0\.0\.1:9/);
  assert.equal(sources[0].error, null);
});

test('factory calls become flows split by caller and gap, and a re-run atom counts a back edge', async () => {
  const { flows, where } = (await source('tools'));
  assert.equal(where, join(base, 'home', 'runs.jsonl'));
  assert.deepEqual(flows.map((f) => f.title), ['youtube', 'podcast', 'podcast']);
  assert.ok(flows.every((f) => /^[A-Za-z0-9._:-]+$/.test(f.id)));
  const id = flows[2].id;
  assert.equal(id, 'tools:podcast-20261003T100000Z');
  const flow = await getFlow(root, id);
  assert.equal(flow.startedAt, '2026-10-03T10:00:00.000Z');
  assert.equal(flow.endedAt, '2026-10-03T10:00:10.000Z');
  assert.equal(flow.subtitle, 'capture, write, compare');
  assert.deepEqual(flow.stages.map((s) => [s.id, s.state, s.loops]), [['page-record', 'done', 0], ['ui-draft', 'failed', 1], ['page-diff', 'done', 0]]);
  assert.deepEqual(flow.backEdges, [{ from: 'page-diff', to: 'ui-draft', count: 1 }]);
  assert.equal(flow.state, 'failed');
  assert.equal(flow.costUsd, 0.75);
  const [draft] = flow.stages[1].agents;
  assert.deepEqual([draft.name, draft.role, draft.traced], ['ui-draft write', 'model', false]);
  assert.equal(flow.stages[2].agents[0].meta, 'cached');
  const trace = await getTrace(root, id, draft.id);
  assert.equal(trace.root.end, 60);
  assert.deepEqual(trace.root.children.map((s) => [s.name, s.category, s.start, s.end, s.outcome]), [
    ['page-record capture', 'browser', 1, 2, 'ok'],
    ['ui-draft write', 'model', 3, 4, 'ok'],
    ['page-diff compare', 'shell', 5, 6, 'ok'],
    ['ui-draft write', 'model', 7, 8, 'failed'],
    ['page-diff compare', 'shell', 9, 10, 'ok'],
  ]);
  assert.equal(trace.root.children[3].note, 'over_budget');
  assert.equal(await getTrace(root, id, 'nope'), null);
});

test('reading never changes the pipelines\' databases', async () => {
  const paths = [join(production, 'production.sqlite3')];
  const before = paths.map((p) => statSync(p).mtimeMs);
  await listFlows(root);
  await getFlow(root, 'game-studio:battle');
  assert.deepEqual(paths.map((p) => statSync(p).mtimeMs), before);
});

const stageOf = (flow, id) => flow.stages.find((s) => s.id === id);
const chip = (flow, stageId, agentId) => stageOf(flow, stageId).agents.find((a) => a.id === agentId);

test('the UI Clone loop lays every component on one rail and counts revisions apart from errors', async () => {
  const loop = await getFlow(root, 'ui-clone:loop');
  assert.equal(loop.title, 'UI Clone');
  assert.deepEqual(loop.stages.map((s) => [s.title, s.agents.length, s.loops]), [['Collect', 2, 0], ['Steps', 1, 0], ['Draft', 5, 1], ['Judge', 5, 1]]);
  assert.deepEqual(loop.backEdges, [{ from: 'judge', to: 'draft', count: 1, label: 'revise' }, { from: 'draft', to: 'draft', count: 1, label: 'error' }]);
  assert.equal(loop.loops, 2);
  assert.equal(loop.costUsd, 1.25);
  assert.deepEqual(stageOf(loop, 'collect').agents.map((a) => a.meta), ['1 components', '2 components']);
  assert.deepEqual(stageOf(loop, 'steps').agents.map((a) => [a.name, a.role, a.traced]), [['button', 'transform', false]]);
  const third = chip(loop, 'judge', 'judge:card-rebuild:3');
  assert.deepEqual([third.name, third.role, third.meta, third.state], ['card-rebuild r3', 'observe', '0.9412', 'done']);
  const draft = chip(loop, 'draft', 'draft:card-rebuild:1');
  assert.deepEqual([draft.name, draft.role, draft.costUsd, draft.startedAt, draft.endedAt], ['card-rebuild r1', 'model', 0.25, '2026-10-05T10:00:40.000Z', '2026-10-05T10:01:00.000Z']);
});

test('a round the judge never scored reads failed, and so does one holding only an older run\'s diff', async () => {
  const loop = await getFlow(root, 'ui-clone:loop');
  const unscored = chip(loop, 'judge', 'judge:card-rebuild:2');
  assert.deepEqual([unscored.state, unscored.meta, unscored.startedAt, unscored.endedAt], ['failed', 'no score', '2026-10-05T10:03:00.000Z', '2026-10-05T10:03:06.000Z']);
  assert.equal(chip(loop, 'judge', 'judge:rerun-rebuild:1').state, 'failed');
  assert.equal((await source('ui-clone')).flows.find((f) => f.title === 'rerun-rebuild').state, 'failed');
});

test('a component card names its best score and stays done below the target', async () => {
  const { flows, loop, runsTitle } = await source('ui-clone');
  assert.equal(runsTitle, 'Components');
  assert.equal(loop.id, 'ui-clone:loop');
  const card = flows.find((f) => f.title === 'card-rebuild');
  assert.deepEqual([card.subtitle, card.state, card.loops], ['best 0.94 · 3 rounds', 'done', 2]);
  const low = flows.find((f) => f.title === 'low-rebuild');
  assert.deepEqual([low.subtitle, low.state], ['best 0.50 · 1 round · below 0.9', 'done']);
  const flow = await getFlow(root, 'ui-clone:card-rebuild');
  assert.deepEqual(flow.stages.map((s) => s.title), ['Draft', 'Judge']);
  assert.deepEqual(flow.backEdges, [{ from: 'judge', to: 'draft', count: 1, label: 'revise' }, { from: 'draft', to: 'draft', count: 1, label: 'error' }]);
});

test('a clone chip\'s trace holds its window\'s log calls, under its card and under the loop', async () => {
  for (const key of ['card-rebuild', 'loop']) {
    const judge = await getTrace(root, `ui-clone:${key}`, 'judge:card-rebuild:1');
    assert.deepEqual(judge.root.children.map((s) => [s.name, s.category, s.start, s.end]), [['page-record capture', 'browser', 1, 6], ['page-diff compare', 'shell', 6, 26]]);
    const draft = await getTrace(root, `ui-clone:${key}`, 'draft:card-rebuild:1');
    assert.deepEqual(draft.root.children.map((s) => [s.name, s.category, s.start, s.end]), [['ui-draft write', 'model', 0, 20]]);
  }
  const failed = await getTrace(root, 'ui-clone:card-rebuild', 'judge:card-rebuild:2');
  assert.deepEqual(failed.root.children.map((s) => [s.name, s.outcome, s.note]), [['page-record capture', 'failed', 'invalid_source']]);
  const collect = await getTrace(root, 'ui-clone:loop', stageOf(await getFlow(root, 'ui-clone:loop'), 'collect').agents.at(-1).id);
  assert.deepEqual(collect.root.children.map((s) => s.name), ['ui-catalog registry', 'ui-source registry', 'ui-source registry', 'ui-source registry']);
  assert.deepEqual((await getTrace(root, 'ui-clone:loop', 'steps:kobra/button')).root.children, []);
  assert.equal(await getTrace(root, 'ui-clone:card-rebuild', 'collect:nope'), null);
});

test('no draft body, diff body, or study file leaves through the clone sources', async () => {
  for (const name of ['ui-clone', 'site-clone']) {
    const { flows, loop } = await source(name);
    assert.equal(JSON.stringify([flows, loop]).includes(SECRET), false);
    for (const { id } of [...flows, loop]) {
      const flow = await getFlow(root, id);
      assert.equal(JSON.stringify(flow).includes(SECRET), false);
      for (const agent of flow.stages.flatMap((s) => s.agents)) assert.equal(JSON.stringify(await getTrace(root, id, agent.id)).includes(SECRET), false);
    }
  }
});

test('a site card reads as study, build, and compare, with a way back per repeat', async () => {
  const flow = await getFlow(root, 'site-clone:shop');
  assert.deepEqual(flow.stages.map((s) => [s.title, s.agents.map((a) => a.name)]), [['Study', ['Study']], ['Build', ['Build r1', 'Build r2', 'Build r3']], ['Compare', ['round-1', 'round-2', 'round-3']]]);
  assert.deepEqual(flow.backEdges, [{ from: 'compare', to: 'build', count: 2, label: 'differs' }]);
  assert.equal(flow.loops, 2);
  const build = chip(flow, 'build', 'build:shop:2');
  assert.deepEqual([build.role, build.startedAt, build.endedAt], ['worker', '2026-10-05T14:01:00.000Z', '2026-10-05T14:10:00.000Z']);
  assert.deepEqual(chip(flow, 'build', 'build:shop:1').startedAt, '2026-10-05T13:30:00.000Z');
  const compare = chip(flow, 'compare', 'compare:shop:2');
  assert.deepEqual([compare.role, compare.meta, compare.state], ['observe', '1 major · 6 minor', 'done']);
  const unfinished = chip(flow, 'compare', 'compare:shop:3');
  assert.deepEqual([unfinished.state, unfinished.meta], ['failed', 'no diff']);
  const sweep = await getTrace(root, 'site-clone:shop', 'compare:shop:1');
  assert.deepEqual(sweep.root.children.map((s) => s.name), ['page-sweep capture', 'motion-diff compare']);
  assert.deepEqual((await getTrace(root, 'site-clone:shop', 'study:shop')).root.children.map((s) => s.name), ['page-bundle fetch', 'page-read facts']);
});

test('a site is done at zero major, stalled otherwise, and stalled with no rounds at all', async () => {
  const { flows, runsTitle } = await source('site-clone');
  assert.equal(runsTitle, 'Sites');
  const card = (title) => flows.find((f) => f.title === title);
  assert.deepEqual([card('clean').state, card('clean').subtitle], ['done', 'localhost:4300 · 1 round · 0 major']);
  assert.deepEqual([card('empty').state, card('empty').subtitle], ['stalled', 'empty.example.com · 0 rounds']);
  const empty = await getFlow(root, 'site-clone:empty');
  assert.deepEqual(empty.stages.map((s) => [s.title, s.agents.length]), [['Study', 1], ['Build', 0], ['Compare', 0]]);
  assert.deepEqual(empty.backEdges, []);
  assert.equal(empty.endedAt, null);
});

test('a re-study does not move the first study past the round it led to', async () => {
  const flow = await getFlow(root, 'site-clone:restudied');
  const study = stageOf(flow, 'study').agents[0];
  assert.equal(study.endedAt, '2026-10-05T15:50:00.000Z');
  const build = stageOf(flow, 'build').agents[0];
  assert.deepEqual([build.startedAt, build.endedAt], ['2026-10-05T15:50:00.000Z', '2026-10-05T16:00:00.000Z']);
});

test('the Site Clone loop sums its sites', async () => {
  const loop = await getFlow(root, 'site-clone:loop');
  assert.equal(loop.title, 'Site Clone');
  assert.deepEqual(loop.stages.map((s) => [s.title, s.agents.length, s.loops]), [['Study', 5, 0], ['Build', 6, 0], ['Compare', 6, 2]]);
  assert.deepEqual(loop.backEdges, [{ from: 'compare', to: 'build', count: 2, label: 'differs' }]);
  assert.equal(loop.loops, 2);
  assert.equal(loop.state, 'stalled', 'a site with differences left keeps the loop from reading done');
  assert.equal(chip(loop, 'compare', 'compare:shop:2').name, 'shop r2');
  assert.equal(chip(loop, 'build', 'build:shop:2').name, 'shop r2');
});

test('a Build chip opens the session that ran the compare, cut to its window, with no tool result in it', async () => {
  for (const key of ['shop', 'loop']) {
    const trace = await getTrace(root, `site-clone:${key}`, 'build:shop:2');
    assert.deepEqual(trace.root.children.map((s) => [s.name, s.meta, s.start, s.end]), [
      ['Edit file', 'Edit · hero.tsx', 240, 250],
      ['Run command', 'Bash · run', 538, 540],
    ]);
    assert.equal(trace.root.end, 540);
    assert.equal(JSON.stringify(trace).includes(SECRET), false);
  }
});

test('a logged session wins over the scan, and a Build chip with no session stops claiming a trace', async () => {
  const logged = await getTrace(root, 'site-clone:logged', 'build:logged:1');
  assert.deepEqual(logged.root.children.map((s) => s.name), ['Write file']);
  assert.equal(chip(await getFlow(root, 'site-clone:logged'), 'build', 'build:logged:1').traced, true);
  await withHome((home) => {
    seedStudy(home, 'nobody', 'https://nobody.example.com/', at('15:00:00'), at('15:10:00'));
    seedCompare(home, 'nobody', 1, at('15:20:00'), at('15:21:00'), 1, 0);
  }, async () => {
    assert.equal(chip(await getFlow(root, 'site-clone:nobody'), 'build', 'build:nobody:1').traced, true);
    const quiet = await getTrace(root, 'site-clone:nobody', 'build:nobody:1');
    assert.deepEqual(quiet.root.children, []);
    assert.equal(chip(await getFlow(root, 'site-clone:nobody'), 'build', 'build:nobody:1').traced, false);
  });
});

test('the component being worked on shows its next step running, and only that one', async () => {
  const recent = (ms) => new Date(Date.now() - ms).toISOString();
  await withHome((home) => {
    seedRebuild(home, 'older-rebuild', 1, recent(200_000), 0.5, recent(190_000));
    seedRebuild(home, 'between-rebuild', 1, recent(120_000), 0.5, recent(110_000));
    seedRebuild(home, 'finished-rebuild', 1, recent(600_000 * 3), 0.95, recent(600_000 * 3));
    writeFileSync(join(home, 'runs.jsonl'), jsonl([logAtom('ui-clone', 'page-diff', 'compare', 'transform', recent(100_000), 500)]));
  }, async () => {
    const { flows, loop } = await source('ui-clone');
    assert.deepEqual(flows.filter((f) => f.state === 'running').map((f) => f.title), ['between-rebuild']);
    assert.equal(loop.working, 1);
    const flow = await getFlow(root, 'ui-clone:between-rebuild');
    const next = chip(flow, 'draft', 'draft:between-rebuild:2');
    assert.deepEqual([next.state, next.endedAt, next.name], ['running', null, 'r2']);
    const open = await getTrace(root, 'ui-clone:between-rebuild', next.id);
    assert.deepEqual([open.live, open.root.end], [true, null]);
    seedRebuild(process.env.TOOL_FACTORY_HOME, 'between-rebuild', 2, recent(5000));
    const judging = chip(await getFlow(root, 'ui-clone:between-rebuild'), 'judge', 'judge:between-rebuild:2');
    assert.deepEqual([judging.state, judging.endedAt, judging.meta], ['running', null, 'judging']);
  });
});

test('old files or a quiet log leave nothing running', async () => {
  const recent = (ms) => new Date(Date.now() - ms).toISOString();
  await withHome((home) => {
    seedRebuild(home, 'quiet-rebuild', 1, recent(60_000), 0.5, recent(50_000));
    seedStudy(home, 'quiet-site', 'https://q.example.com/', recent(90_000), recent(80_000));
    seedCompare(home, 'quiet-site', 1, recent(70_000), null);
    writeFileSync(join(home, 'runs.jsonl'), jsonl([logAtom('ui-clone', 'page-diff', 'compare', 'transform', recent(3_600_000), 500), logAtom('site-clone', 'motion-diff', 'compare', 'transform', recent(3_600_000), 500)]));
  }, async () => {
    assert.equal((await source('ui-clone')).flows[0].state, 'done');
    assert.equal((await source('site-clone')).flows[0].state, 'stalled');
    assert.equal(chip(await getFlow(root, 'site-clone:quiet-site'), 'compare', 'compare:quiet-site:1').state, 'failed');
  });
});

test('a live site shows the compare running, then the next build', async () => {
  const recent = (ms) => new Date(Date.now() - ms).toISOString();
  await withHome((home) => {
    seedStudy(home, 'busy', 'https://busy.example.com/', recent(500_000), recent(400_000));
    seedCompare(home, 'busy', 1, recent(60_000), null);
    writeFileSync(join(home, 'runs.jsonl'), jsonl([logAtom('site-clone', 'page-read', 'facts', 'observe', recent(30_000), 500)]));
  }, async () => {
    const running = await getFlow(root, 'site-clone:busy');
    assert.equal(running.state, 'running');
    assert.deepEqual([chip(running, 'compare', 'compare:busy:1').state, chip(running, 'compare', 'compare:busy:1').endedAt], ['running', null]);
    seedCompare(process.env.TOOL_FACTORY_HOME, 'busy', 1, recent(60_000), recent(5000), 1, 0);
    const building = await getFlow(root, 'site-clone:busy');
    assert.deepEqual([chip(building, 'build', 'build:busy:2').state, chip(building, 'build', 'build:busy:2').endedAt], ['running', null]);
    assert.equal((await source('site-clone')).loop.working, 1);
  });
});

test('clone calls show under their own sources, not again under Factory tools', async () => {
  const titles = (await source('tools')).flows.map((f) => f.title);
  assert.equal(titles.includes('ui-clone'), false);
  assert.equal(titles.includes('site-clone'), false);
  assert.ok(titles.includes('podcast'));
});

test('a broken clone folder is that source\'s error alone, and an empty home draws no loop', async () => {
  await withHome((home) => {
    dated(join(home, 'microservices', 'ui-clone', 'rebuild'), 'not a folder', at('10:00:00'));
  }, async () => {
    const { sources } = await listFlows(root);
    const by = (name) => sources.find((s) => s.source === name);
    assert.match(by('ui-clone').error, /rebuild/);
    assert.deepEqual(by('ui-clone').flows, []);
    assert.equal(by('site-clone').error, null);
    assert.equal(by('site-clone').loop, undefined);
    assert.equal(by('game-studio').error, null);
  });
});

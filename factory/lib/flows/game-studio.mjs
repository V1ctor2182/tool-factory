import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildNodes, iso, parseTranscript, rollup, seconds } from './transcript.mjs';
import { findChip } from './workspace.mjs';

const LOOP_KEY = 'loop';
const WORK_STAGES = [['concept2d', 'Concept'], ['model3d', 'Model'], ['animation', 'Animation'], ['implementation', 'Code'], ['interaction', 'Interaction']];
const WORK_FINISHED = new Set(['awaiting_verification', 'awaiting_review', 'publication_unknown']);
const CONTINUATION = 'worker_continuation';
const ENDED_AS_FAILED = new Set(['failed', 'invalid', 'cancelled', 'released']);
const ROLE_BY_KIND = { planner: 'planner', worker: 'worker', [CONTINUATION]: 'worker', verifier: 'verifier', amendment: 'coordinator' };
const ROLES = new Set(['planner', 'worker', 'verifier', 'image', 'coordinator']);

const production = (where) => join(where, '.studio-local', 'production');
const prettify = (slug) => {
  const words = slug.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const featureOf = (key) => key.split('/')[0];
const stageOf = (key) => key.split('/').at(-1);
const middleOf = (key) => key.split('/').slice(1, -1).join('/');

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function runRecord(where, id) {
  try {
    const run = JSON.parse(readFileSync(join(production(where), 'agent-runs', `${id}.json`), 'utf8'));
    return { cost: Number.isFinite(run.cost_usd) ? run.cost_usd : null, ended: Number.isFinite(run.ended_at) ? run.ended_at : null };
  } catch {
    return { cost: null, ended: null };
  }
}

function load(where) {
  const path = join(production(where), 'production.sqlite3');
  if (!existsSync(path)) throw new Error(`no Game Studio database at ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 250');
    const tasks = db.prepare('SELECT id, logical_key AS key, current, state, revision, error, review_id AS reviewId FROM tasks ORDER BY rowid').all();
    const attempts = db.prepare(`SELECT id, task_id AS taskId, kind, role, runtime, state, started, ended_at AS endedAt, heartbeat_at AS heartbeatAt,
      CASE WHEN json_valid(process) THEN json_extract(process, '$.pid') END AS pid,
      CASE WHEN kind = 'verifier' AND json_valid(result) THEN json_extract(result, '$.result.accepted') END AS accepted FROM attempts ORDER BY started`).all();
    const { at: latestPlan, count: plans } = db.prepare('SELECT max(created) AS at, count(*) AS count FROM plans').get();
    const publications = db.prepare(`SELECT operation_id AS id, task_id AS taskId, created_at AS createdAt,
      CASE WHEN json_valid(review) THEN json_extract(review, '$.id') END AS reviewId FROM publications ORDER BY rowid`).all();
    const decisions = db.prepare(`SELECT kind, at, json_extract(body, '$.review') AS reviewId FROM events WHERE kind IN ('review_approved', 'revision_requested') AND json_valid(body)`).all();
    return { tasks, attempts: attempts.map((a) => ({ ...a, alive: processAlive(a.pid), run: runRecord(where, a.id) })), latestPlan, plans, publications, decisions };
  } finally {
    db.close();
  }
}

function attemptState(attempt, isLast) {
  if (attempt.state === 'active') return attempt.alive ? 'running' : 'stalled';
  if (attempt.state === 'blocked') return isLast ? 'blocked' : 'failed';
  return ENDED_AS_FAILED.has(attempt.state) ? 'failed' : 'done';
}

function toAgent(attempt, { name, meta, isLast }) {
  const state = attemptState(attempt, isLast);
  const ended = state === 'running' ? null : (attempt.endedAt ?? attempt.heartbeatAt ?? attempt.run.ended);
  return {
    id: attempt.id,
    name,
    role: ROLES.has(attempt.role) ? attempt.role : (ROLE_BY_KIND[attempt.kind] ?? 'worker'),
    state,
    startedAt: iso(attempt.started * 1000),
    endedAt: ended == null ? null : iso(ended * 1000),
    meta,
    costUsd: attempt.run.cost,
    traced: false,
  };
}

function attemptName(attempt, continuation) {
  if (attempt.kind === CONTINUATION) return `continuation ${continuation}`;
  if (attempt.kind === 'worker') return attempt.role === 'image' ? 'image' : 'worker';
  return attempt.kind;
}

function taskAgents(task, attempts) {
  let continuation = 0;
  return attempts.map((attempt, i) => {
    if (attempt.kind === CONTINUATION) continuation += 1;
    return toAgent(attempt, {
      name: attemptName(attempt, continuation),
      meta: middleOf(task.key) || attempt.runtime || attempt.kind,
      isLast: i === attempts.length - 1,
    });
  });
}

function taskState(task, agents) {
  if (task.state === 'accepted') return 'done';
  if (task.state === 'awaiting_review') return 'blocked';
  const live = agents.find((agent) => agent.state === 'running' || agent.state === 'stalled');
  if (live) return live.state;
  if (agents.at(-1)?.state === 'blocked') return 'blocked';
  return task.error ? 'failed' : 'pending';
}

function pendingAgent(task) {
  return { id: `pending-${task.id.slice(0, 12)}`, name: 'waiting', role: 'worker', state: 'pending', startedAt: null, endedAt: null, meta: middleOf(task.key) || 'not started', costUsd: null, traced: false };
}

function stagesFor(tasks, attemptsByTask) {
  const stages = new Map();
  for (const task of tasks) {
    const taskAttempts = attemptsByTask.get(task.id) ?? [];
    if (!task.current && taskAttempts.length === 0) continue;
    const id = stageOf(task.key);
    if (!stages.has(id)) stages.set(id, { id, title: prettify(id), agents: [], states: [], loops: 0, earliest: Infinity });
    const stage = stages.get(id);
    const agents = taskAgents(task, taskAttempts);
    stage.agents.push(...agents);
    if (task.current) {
      stage.states.push(taskState(task, agents));
      if (agents.length === 0) stage.agents.push(pendingAgent(task));
    }
    stage.loops += taskAttempts.filter((a) => a.kind === CONTINUATION).length + Math.max(0, task.revision - 1);
    stage.earliest = Math.min(stage.earliest, ...taskAttempts.map((a) => a.started));
  }
  const byStart = (a, b) => (a.startedAt ?? '~').localeCompare(b.startedAt ?? '~');
  return [...stages.values()]
    .sort((a, b) => (a.earliest === b.earliest ? 0 : a.earliest - b.earliest))
    .map(({ id, title, agents, states, loops }) => ({ id, title, state: states.length ? rollup(states) : 'done', loops, agents: agents.sort(byStart) }));
}

function plannerAgent(attempt) {
  return toAgent(attempt, { name: 'planner', meta: attempt.runtime ?? attempt.kind, isLast: true });
}

function buildFlows({ tasks, attempts, latestPlan }, now = Date.now()) {
  const planners = attempts.filter((a) => a.kind === 'planner');
  const attemptsByTask = Map.groupBy(attempts.filter((a) => a.kind !== 'planner'), (a) => a.taskId);
  return [...Map.groupBy(tasks, (task) => featureOf(task.key))].map(([key, group]) => {
    const started = group.flatMap((task) => attemptsByTask.get(task.id) ?? []).map((a) => a.started);
    const first = started.length ? Math.min(...started) : null;
    const planner = first === null ? null : planners.findLast((a) => a.state === 'completed' && a.started < first);
    const stages = stagesFor(group, attemptsByTask);
    const plan = planner && plannerAgent(planner);
    const current = group.filter((task) => task.current);
    return {
      key,
      title: prettify(key),
      subtitle: `${current.length} tasks, ${current.filter((task) => task.state === 'accepted').length} accepted`,
      startedAt: iso((first ?? latestPlan ?? now / 1000) * 1000),
      stages: [...(plan ? [{ id: 'plan', title: 'Plan', state: plan.state, loops: 0, agents: [plan] }] : []), ...stages],
      backEdges: stages.filter((stage) => stage.loops > 0).map((stage) => ({ from: stage.id, to: stage.id, count: stage.loops })),
    };
  });
}

const newestFirst = (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '');
const taskLabel = (key) => middleOf(key) || featureOf(key);

function reviewAgent(publication, task, decision) {
  const waiting = !decision && task?.reviewId === publication.reviewId && task?.state === 'awaiting_review';
  const outcome = decision?.kind === 'review_approved' ? 'approved' : decision ? 'changes requested' : waiting ? 'waiting on you' : 'superseded';
  const startedAt = publication.createdAt == null ? null : iso(publication.createdAt * 1000);
  return {
    id: publication.id,
    name: task ? `${taskLabel(task.key)} · ${stageOf(task.key)}` : 'review',
    role: 'you',
    state: waiting ? 'blocked' : 'done',
    startedAt,
    endedAt: waiting ? null : decision ? iso(decision.at * 1000) : startedAt,
    meta: outcome,
    costUsd: null,
    traced: false,
  };
}

// The whole production system as one flow. Every attempt ever made sits in its phase, and a back
// edge counts how often the work really went backward: a replan, a verifier's rejection, or rework after review.
function loopFlow({ tasks, attempts, plans, publications, decisions }) {
  const columns = new Map(WORK_STAGES.map(([id, title]) => [id, { id, title, agents: [], states: [], loops: 0, rejected: 0, rework: 0 }]));
  const attemptsByTask = Map.groupBy(attempts, (a) => a.taskId);
  const verify = [];
  const verifyStates = [];
  let waiting = 0;
  for (const task of tasks) {
    const stage = stageOf(task.key);
    if (!columns.has(stage)) columns.set(stage, { id: stage, title: prettify(stage), agents: [], states: [], loops: 0, rejected: 0, rework: 0 });
    const column = columns.get(stage);
    const list = attemptsByTask.get(task.id) ?? [];
    const named = taskAgents(task, list).map((agent, i) => ({
      ...agent,
      name: `${taskLabel(task.key)} · ${agent.name}`,
      meta: middleOf(task.key) ? featureOf(task.key) : (list[i].runtime ?? list[i].kind),
    }));
    const worked = named.filter((_, i) => list[i].kind !== 'verifier');
    const checked = named.filter((_, i) => list[i].kind === 'verifier');
    column.agents.push(...worked);
    verify.push(...checked);
    column.loops += Math.max(0, worked.length - 1);
    column.rejected += list.filter((a) => a.kind === 'verifier' && a.accepted === 0).length;
    column.rework += Math.max(0, task.revision - 1);
    if (!task.current) continue;
    column.states.push(WORK_FINISHED.has(task.state) ? 'done' : taskState(task, worked));
    verifyStates.push(...checked.map((agent) => agent.state).filter((state) => state === 'running' || state === 'stalled'));
    if (task.state === 'awaiting_verification') verifyStates.push('pending');
    if (task.state === 'awaiting_review') waiting += 1;
  }
  const work = [...columns.values()];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const decided = new Map(decisions.map((d) => [d.reviewId, d]));
  const reviews = publications.map((p) => reviewAgent(p, byId.get(p.taskId), decided.get(p.reviewId)));
  const planners = attempts.filter((a) => a.kind === 'planner').map((a, i, all) => toAgent(a, { name: 'planner', meta: a.runtime ?? a.kind, isLast: i === all.length - 1 }));
  const replans = Math.max(0, plans - 1);
  const rework = work.reduce((sum, s) => sum + s.rework, 0);
  const rejected = work.reduce((sum, s) => sum + s.rejected, 0);
  const current = tasks.filter((task) => task.current);
  const accepted = current.filter((task) => task.state === 'accepted').length;
  const features = new Set(current.map((task) => featureOf(task.key))).size;
  const started = attempts.length ? attempts[0].started : Date.now() / 1000;
  return {
    key: LOOP_KEY,
    title: 'Studio loop',
    subtitle: `${features} features, ${accepted} of ${current.length} tasks accepted`,
    startedAt: iso(started * 1000),
    stages: [
      { id: 'plan', title: 'Plan', state: planners.at(-1)?.state ?? 'pending', loops: replans, agents: planners.toSorted(newestFirst) },
      ...work.map(({ id, title, states, loops, agents }) => ({ id, title, state: states.length ? rollup(states) : 'done', loops, agents: agents.toSorted(newestFirst) })),
      { id: 'verify', title: 'Verify', state: verifyStates.length ? rollup(verifyStates) : 'done', loops: rejected, agents: verify.toSorted(newestFirst) },
      { id: 'you', title: 'You review', state: waiting ? 'blocked' : 'done', loops: rework, agents: reviews.toSorted(newestFirst) },
    ],
    backEdges: [
      ...work.filter((s) => s.loops).map((s) => ({ from: s.id, to: s.id, count: s.loops })),
      ...work.filter((s) => s.rejected).map((s) => ({ from: 'verify', to: s.id, count: s.rejected, label: 'rejected' })),
      ...work.filter((s) => s.rework).map((s) => ({ from: 'you', to: s.id, count: s.rework, label: 'rework' })),
      ...(replans ? [{ from: 'you', to: 'plan', count: replans, label: 'replan' }] : []),
    ],
  };
}

const eventsPath = (where, id) => [`${id}.control`, id].map((dir) => join(production(where), 'attempts', dir, 'events.jsonl')).find(existsSync) ?? null;

// Codex writes thread.* events. Only Claude's stream-json has the tool calls the parser reads.
function isClaudeStream(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(256);
    const size = readSync(fd, head, 0, head.length, 0);
    return /^\s*\{\s*"type"\s*:\s*"(system|assistant|user)"/.test(head.toString('utf8', 0, size));
  } finally {
    closeSync(fd);
  }
}

function tracedPath(where, id) {
  const path = eventsPath(where, id);
  return path && isClaudeStream(path) ? path : null;
}

export function list(where) {
  return buildFlows(load(where));
}

export function loop(where) {
  return loopFlow(load(where));
}

export function flow(where, key) {
  const found = key === LOOP_KEY ? loop(where) : buildFlows(load(where)).find((f) => f.key === key);
  if (!found) return null;
  for (const stage of found.stages) {
    for (const agent of stage.agents) {
      if (agent.startedAt) agent.traced = tracedPath(where, agent.id) !== null;
    }
  }
  return found;
}

export function trace(where, key, agentId) {
  const found = flow(where, key);
  const chip = findChip(found, agentId);
  if (!chip) return null;
  const { stage, agent } = chip;
  const started = Date.parse(agent.startedAt ?? found.startedAt);
  const live = agent.state === 'running';
  const parsed = agent.traced ? parseTranscript(readFileSync(tracedPath(where, agent.id), 'utf8')) : { first: null, last: null, calls: [] };
  const origin = Math.min(started, parsed.first ?? started);
  const ended = agent.endedAt ? Date.parse(agent.endedAt) : null;
  const horizon = live ? null : Math.max(parsed.last ?? origin, ended ?? origin);
  const end = horizon === null ? null : seconds(horizon, origin);
  return {
    title: found.title,
    subtitle: `${stage.title} · ${agent.name} · ${agent.meta} · ${agent.state}`,
    startedAt: iso(origin),
    live,
    root: {
      kind: 'group',
      id: 'coordinator',
      name: 'Coordinator',
      meta: found.title,
      role: 'coordinator',
      start: 0,
      end,
      children: [{
        kind: 'group',
        id: agent.id,
        name: agent.name,
        meta: agent.meta,
        role: agent.role,
        start: seconds(started, origin),
        end,
        children: buildNodes(parsed.calls, origin, horizon),
      }],
    },
  };
}

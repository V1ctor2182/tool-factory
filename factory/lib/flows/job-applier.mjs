import { iso, parseTime, TOOL_ERROR_NOTE } from './transcript.mjs';

const FLOW_LIMIT = 100;
const RUNS_TIMEOUT_MS = 5000;
const TRACE_TIMEOUT_MS = 10_000;
const PARALLEL_TRACES = 8;
const STALL_AFTER_MS = 10 * 60_000;
const LIST_TTL_MS = 5000;
const STEP_FIELDS = ['kind', 'id', 'name', 'meta', 'category', 'start', 'end', 'outcome', 'fieldsFilled'];
const GROUP_FIELDS = ['kind', 'id', 'name', 'meta', 'role', 'start', 'end', 'outcome'];
const LAUNCH_STATE = { finished: 'done', failed: 'failed', launch_failed: 'failed', duplicate: 'failed', stopped: 'stalled', unknown: 'stalled' };

async function get(api, path, timeout) {
  let res;
  try {
    res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new Error(`can't reach Jobfeed at ${api}. Its machine or SSH tunnel may be down.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jobfeed at ${api} answered ${res.status} for ${path}`);
  return res.json();
}

const steps = (node) => (node.kind === 'group' ? node.children.flatMap(steps) : [node]);
const isOpen = (node, end) => node.end >= end - 0.01;

const pick = (node, fields) => Object.fromEntries(fields.filter((field) => field in node).map((field) => [field, node[field]]));

// Jobfeed's tree comes from another program and leaves this machine, so only named fields pass. A request's
// note and the words after its type are the agent's free prose, which can quote personal data.
function scrub(node) {
  if (node.kind === 'group') return { ...pick(node, GROUP_FIELDS), children: node.children.map(scrub) };
  const step = pick(node, STEP_FIELDS);
  if (node.category === 'human') step.meta = /^[\w-]+/.exec(node.meta ?? '')?.[0] ?? '';
  if (node.note === TOOL_ERROR_NOTE) step.note = TOOL_ERROR_NOTE;
  return step;
}

// Jobfeed ends open spans at its own clock. The shape says an open span has a null end.
function reopen(node, end) {
  if (!isOpen(node, end)) return;
  if (node.kind === 'group') node.children.forEach((child) => reopen(child, end));
  node.end = null;
}

// Jobfeed's background sweep keeps touching updated_at, and a trace's horizon follows it, so a
// session that went quiet would read as hours of model time. Its last call is when it stopped.
function settle(node, last) {
  if (node.kind === 'step') {
    node.end = Math.min(node.end, Math.max(node.start, last));
    return node.end;
  }
  const ends = node.children.map((child) => settle(child, last));
  node.end = Math.max(node.start, ...ends);
  return node.end;
}

function readLiveness(raw, now) {
  const { root } = raw;
  const all = steps(root);
  const last = Math.max(0, ...all.filter((step) => !isOpen(step, root.end)).map((step) => step.end));
  const waiting = all.some((step) => step.category === 'human' && isOpen(step, root.end));
  if (!raw.is_live) return { last, state: null };
  if (waiting) return { last, state: 'blocked' };
  return { last, state: now - parseTime(raw.started_at) - last * 1000 > STALL_AFTER_MS ? 'stalled' : 'running' };
}

async function readTrace(api, key, now = Date.now()) {
  const raw = await get(api, `/api/applier-runs/${key}/trace`, TRACE_TIMEOUT_MS);
  if (!raw) return null;
  raw.root = scrub(raw.root);
  const { last, state } = readLiveness(raw, now);
  const live = state === 'blocked' || state === 'running';
  if (live) reopen(raw.root, raw.root.end);
  else settle(raw.root, last);
  return { title: raw.title, subtitle: raw.subtitle.replace(/ · [^·]*$/, ''), startedAt: raw.started_at, live, ...(state && { state }), root: raw.root };
}

function agentOf(node, role, startedAt, state) {
  const at = (seconds) => iso(parseTime(startedAt) + seconds * 1000);
  const open = node.end === null;
  return {
    id: node.id,
    name: node.name,
    role,
    state: state ?? (open ? (role === 'you' ? 'blocked' : 'running') : node.outcome === 'failed' ? 'failed' : 'done'),
    startedAt: at(node.start),
    endedAt: open ? null : at(node.end),
    meta: node.meta,
    costUsd: null,
    traced: true,
  };
}

const stageState = (agents) => ['blocked', 'running', 'stalled', 'failed'].find((state) => agents.some((a) => a.state === state)) ?? 'done';
const stage = (id, title, agents, loops = 0) => ({ id, title, loops, agents, state: stageState(agents) });

function stagesOf(trace) {
  const { root, startedAt } = trace;
  const all = steps(root);
  const sessions = root.children.filter((node) => node.kind === 'group');
  const asked = all.filter((node) => node.category === 'human');
  const pick = (id, role) => all.filter((node) => node.id === id).map((node) => agentOf(node, role, startedAt));
  const waits = (node) => steps(node).some((step) => step.category === 'human' && step.end === null);
  const session = (node, i) => agentOf(node, 'applier', startedAt, waits(node) ? 'blocked' : trace.state === 'stalled' && i === sessions.length - 1 ? 'stalled' : undefined);
  return [
    stage('launch', 'Launch', pick('launch', 'coordinator')),
    stage('apply', 'Apply', sessions.map(session), Math.max(0, sessions.length - 1)),
    stage('you', 'You', asked.map((node) => agentOf(node, 'you', startedAt))),
    stage('submit', 'Submit', pick('submit', 'act')),
  ].filter((s) => s.agents.length);
}

const lastEnd = (trace) => iso(parseTime(trace.startedAt) + trace.root.end * 1000);
let runsMemo = null;
const endedMemo = new Map();

async function runsOf(api, now = Date.now()) {
  if (runsMemo?.api === api && now - runsMemo.at < LIST_TTL_MS) return runsMemo.runs;
  const answer = await get(api, '/api/applier-runs', RUNS_TIMEOUT_MS);
  const runs = [...(answer?.runs ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, FLOW_LIMIT);
  runsMemo = { api, at: now, runs };
  return runs;
}

// An ended run's trace never changes, so a dashboard reads it once. A live run's state comes from its trace.
async function shape(api, run, now) {
  const state = LAUNCH_STATE[run.state] ?? 'stalled';
  const memoKey = `${api}/${run.job_id}/${run.state}`;
  let found = run.is_live ? null : endedMemo.get(memoKey);
  if (!found) {
    const trace = await readTrace(api, run.job_id, now);
    found = !trace ? { state: 'stalled', endedAt: null }
      : run.is_live ? { state: trace.state, endedAt: trace.live ? null : lastEnd(trace) }
        : { state, endedAt: lastEnd(trace) };
    if (!run.is_live && trace) endedMemo.set(memoKey, found);
  }
  const agent = { costUsd: null, endedAt: found.endedAt, state: found.state };
  return {
    key: String(run.job_id),
    title: `Job #${run.job_id}`,
    subtitle: [[run.title, run.company].filter(Boolean).join(' at '), 'Claude Applier'].filter(Boolean).join(' · '),
    state: found.state,
    startedAt: run.started_at,
    backEdges: [],
    stages: [{ loops: Math.max(0, run.session_count - 1), agents: Array.from({ length: run.session_count }, () => agent) }],
  };
}

let listMemo = null;

export async function list(api, now = Date.now()) {
  if (listMemo?.api === api && now - listMemo.at < LIST_TTL_MS) return listMemo.flows;
  const runs = await runsOf(api, now);
  const flows = [];
  for (let i = 0; i < runs.length; i += PARALLEL_TRACES) {
    flows.push(...await Promise.all(runs.slice(i, i + PARALLEL_TRACES).map((run) => shape(api, run, now))));
  }
  listMemo = { api, at: now, flows };
  return flows;
}

export async function flow(api, key) {
  if (!/^[1-9]\d*$/.test(key)) return null;
  const trace = await readTrace(api, key);
  if (!trace) return null;
  const run = (await runsOf(api)).find((r) => String(r.job_id) === key);
  const stages = stagesOf(trace);
  const apply = stages.find((s) => s.id === 'apply');
  return {
    key,
    title: trace.title,
    subtitle: trace.subtitle,
    startedAt: trace.startedAt,
    ...(trace.state ? { state: trace.state } : !trace.live && run && { state: LAUNCH_STATE[run.state] ?? 'stalled' }),
    stages,
    backEdges: apply?.loops ? [{ from: 'apply', to: 'apply', count: apply.loops }] : [],
  };
}

export async function trace(api, key, agentId) {
  if (!/^[1-9]\d*$/.test(key)) return null;
  const found = await readTrace(api, key);
  if (!found || !stagesOf(found).some((s) => s.agents.some((a) => a.id === agentId))) return null;
  return found;
}

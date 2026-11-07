import { declaredLoop, LOOP_KEY, newestFirst } from './loop.mjs';
import { iso, parseTime, TOOL_ERROR_NOTE } from './transcript.mjs';
import { chipTrace, findChip } from './workspace.mjs';

const FLOW_LIMIT = 100;
const RUNS_TIMEOUT_MS = 5000;
const TRACE_TIMEOUT_MS = 10_000;
const PARALLEL_TRACES = 8;
const STALL_AFTER_MS = 10 * 60_000;
const LIST_TTL_MS = 5000;
const STEP_FIELDS = ['kind', 'id', 'name', 'meta', 'category', 'start', 'end', 'outcome', 'fieldsFilled'];
const GROUP_FIELDS = ['kind', 'id', 'name', 'meta', 'role', 'start', 'end', 'outcome'];
const LAUNCH_STATE = { finished: 'done', failed: 'failed', launch_failed: 'failed', duplicate: 'failed', stopped: 'stalled', unknown: 'stalled' };
const RUN_STATE = { succeeded: 'done', running: 'running', failed: 'failed' };

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
  return { source: 'job-applier', title: raw.title, subtitle: raw.subtitle.replace(/ · [^·]*$/, ''), startedAt: iso(parseTime(raw.started_at)), live, ...(state && { state }), root: raw.root };
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
    // Nothing acts on a submit while its job waits for an answer, so an open one waits with the job.
    stage('submit', 'Submit', all.filter((node) => node.id === 'submit').map((node) => agentOf(node, 'act', startedAt, node.end === null && trace.state === 'blocked' ? 'blocked' : undefined))),
  ].filter((s) => s.agents.length);
}

const lastEnd = (trace) => iso(parseTime(trace.startedAt) + trace.root.end * 1000);
let runsMemo = null;
let passesMemo = null;
const traceMemo = new Map();

// An ended run's trace never changes, so one process reads it once.
async function traceOf(api, run, now) {
  if (run.is_live) return readTrace(api, run.job_id, now);
  const key = `${api}/${run.job_id}/${run.state}`;
  const found = traceMemo.get(key) ?? await readTrace(api, run.job_id, now);
  if (found) traceMemo.set(key, found);
  return found;
}

async function traceByKey(api, key) {
  const run = (await runsOf(api)).find((r) => String(r.job_id) === key);
  return run ? traceOf(api, run, Date.now()) : readTrace(api, key);
}

async function inBatches(items, read) {
  const done = [];
  for (let i = 0; i < items.length; i += PARALLEL_TRACES) done.push(...await Promise.all(items.slice(i, i + PARALLEL_TRACES).map(read)));
  return done;
}

async function runsOf(api, now = Date.now()) {
  if (runsMemo?.api === api && now - runsMemo.at < LIST_TTL_MS) return runsMemo.runs;
  const answer = await get(api, '/api/applier-runs', RUNS_TIMEOUT_MS);
  const runs = [...(answer?.runs ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, FLOW_LIMIT);
  runsMemo = { api, at: now, runs };
  return runs;
}

async function passesOf(api, now = Date.now()) {
  if (passesMemo?.api === api && now - passesMemo.at < LIST_TTL_MS) return passesMemo.passes;
  const answer = await get(api, `/api/runs?limit=${FLOW_LIMIT}`, RUNS_TIMEOUT_MS);
  const passes = answer?.runs ?? [];
  passesMemo = { api, at: now, passes };
  return passes;
}

// A live run's state comes from its trace.
async function shape(api, run, now) {
  const state = LAUNCH_STATE[run.state] ?? 'stalled';
  const trace = await traceOf(api, run, now);
  const found = !trace ? { state: 'stalled', endedAt: null }
    : run.is_live ? { state: trace.state, endedAt: trace.live ? null : lastEnd(trace) }
      : { state, endedAt: lastEnd(trace) };
  const agent = { costUsd: null, endedAt: found.endedAt, state: found.state };
  return {
    key: String(run.job_id),
    title: `Job #${run.job_id}`,
    subtitle: [[run.title, run.company].filter(Boolean).join(' at '), 'Claude Applier'].filter(Boolean).join(' · '),
    state: found.state,
    startedAt: iso(parseTime(run.started_at)),
    backEdges: [],
    stages: [{ loops: Math.max(0, run.session_count - 1), agents: Array.from({ length: run.session_count }, () => agent) }],
  };
}

// A scan or an evaluation is one Jobfeed run across many jobs. Its chip's name holds only a date and a count.
function runChip(run) {
  const evaluated = run.source === 'evaluate';
  const verdicts = run.verdict_counts ?? {};
  const day = new Date(parseTime(run.started_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return {
    id: run.run_id,
    name: evaluated ? `${day} · ${run.jobs_scored ?? 0} scored` : `${day} · ${run.jobs_discovered ?? 0} found`,
    role: evaluated ? 'model' : 'observe',
    state: RUN_STATE[run.status] ?? 'stalled',
    startedAt: iso(parseTime(run.started_at)),
    endedAt: run.finished_at ? iso(parseTime(run.finished_at)) : null,
    meta: evaluated ? `${verdicts.apply ?? 0} apply, ${verdicts.consider ?? 0} consider, ${verdicts.skip ?? 0} skip` : `${run.jobs_inserted ?? 0} new`,
    costUsd: run.total_llm_cost_usd ?? null,
    traced: false,
  };
}

// An old failed scan stays in the list, so only the newest run says how the phase is doing now.
const runStage = (chips) => {
  const agents = chips.map(runChip).toSorted(newestFirst);
  return { agents, state: agents[0]?.state ?? 'pending' };
};

const passStages = (passes) => ({
  scan: runStage(passes.filter((run) => run.source !== 'evaluate')),
  evaluate: runStage(passes.filter((run) => run.source === 'evaluate')),
});

// A scan or an evaluation has no calls to show, so its trace is its chip alone.
async function passTrace(api, agentId) {
  const found = declaredLoop('job-applier', { stages: passStages(await passesOf(api)) });
  const chip = findChip(found, agentId);
  if (!chip) return null;
  const { stage: inStage, agent } = chip;
  return { source: 'job-applier', ...chipTrace(found, inStage, agent, parseTime(agent.startedAt), agent.endedAt ? parseTime(agent.endedAt) : null, []) };
}

// One loop across every job, so a chip is one job's part in a stage and opens that job's trace.
export async function loop(api, now = Date.now()) {
  const [runs, passes] = await Promise.all([runsOf(api, now), passesOf(api, now)]);
  if (!runs.length && !passes.length) return null;
  const jobs = await inBatches(runs, async (run) => ({ run, trace: await traceOf(api, run, now) }));
  const staged = jobs.filter(({ trace: found }) => found).map(({ run, trace: found }) => ({ jobId: run.job_id, stages: stagesOf(found) }));
  // A job whose launch failed never reached a session, so its launch stands for it in Apply.
  const inStage = (id, fallback) => staged.flatMap(({ jobId, stages }) => ((stages.find((s) => s.id === id) ?? stages.find((s) => s.id === fallback))?.agents ?? []).map((agent) => ({ ...agent, id: `${jobId}.${agent.id}`, name: `Job #${jobId}` })));
  const restarts = staged.reduce((sum, { stages }) => sum + (stages.find((s) => s.id === 'apply')?.loops ?? 0), 0);
  const jobStage = (agents, loops = 0) => ({ agents, loops, state: agents.length ? stageState(agents) : 'pending' });
  return declaredLoop('job-applier', {
    subtitle: `${runs.length} jobs, ${runs.filter((run) => LAUNCH_STATE[run.state] === 'done').length} done`,
    startedAt: iso(Math.min(...[...runs, ...passes].map((run) => parseTime(run.started_at)))),
    stages: {
      ...passStages(passes),
      apply: jobStage(inStage('apply', 'launch'), restarts),
      you: jobStage(inStage('you')),
      submit: jobStage(inStage('submit')),
    },
    edges: [{ from: 'apply', to: 'apply', count: restarts }],
  });
}

let listMemo = null;

export async function list(api, now = Date.now()) {
  if (listMemo?.api === api && now - listMemo.at < LIST_TTL_MS) return listMemo.flows;
  const runs = await runsOf(api, now);
  const flows = await inBatches(runs, (run) => shape(api, run, now));
  listMemo = { api, at: now, flows };
  return flows;
}

export async function flow(api, key) {
  if (key === LOOP_KEY) return loop(api);
  if (!/^[1-9]\d*$/.test(key)) return null;
  const trace = await traceByKey(api, key);
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
  if (key === LOOP_KEY) {
    const [, jobId, id] = /^(\d+)\.(.+)$/.exec(agentId) ?? [];
    return jobId ? trace(api, jobId, id) : passTrace(api, agentId);
  }
  if (!/^[1-9]\d*$/.test(key)) return null;
  const found = await traceByKey(api, key);
  if (!found || !stagesOf(found).some((s) => s.agents.some((a) => a.id === agentId))) return null;
  return found;
}

import { logPath, readLog } from '../runs.mjs';
import { iso, parseTime, rollup, seconds } from './transcript.mjs';
import { callName, callStep } from './workspace.mjs';

const FLOW_LIMIT = 50;
const SPLIT_GAP_MS = 30 * 60_000;
const ROLES = new Set(['model', 'observe', 'transform', 'act']);
const OWN_SOURCE = new Set(['ui-clone', 'site-clone']);

// Every agent of a flow answers with the same trace, and a finished call's trace grows as the flow does.
export const wholeFlowTrace = true;

const flowCaller = (record) => (record.type === 'microservice' ? record.name : record.type === 'atom' ? record.caller : null);
const endOf = (record, start) => start + (record.ms ?? 0);
const keyFor = (caller, startedAt) => `${caller.replace(/[^A-Za-z0-9._-]/g, '-')}-${startedAt.replace(/[^0-9TZ]/g, '')}`;

function segments(records) {
  const open = new Map();
  const all = [];
  const timed = records.map((record) => ({ record, start: parseTime(record.startedAt) })).filter(({ start }) => start !== null);
  timed.sort((a, b) => a.start - b.start);
  for (const { record, start } of timed) {
    const caller = flowCaller(record);
    if (!caller || OWN_SOURCE.has(caller)) continue;
    let run = open.get(caller);
    if (!run || start - run.end > SPLIT_GAP_MS) {
      run = { caller, startedAt: record.startedAt, end: start, calls: [], services: [] };
      open.set(caller, run);
      all.push(run);
    }
    run.end = Math.max(run.end, endOf(record, start));
    (record.type === 'atom' ? run.calls : run.services).push({ record, start });
  }
  return all.filter((run) => run.calls.length > 0);
}

function toFlow(run) {
  const stages = new Map();
  const edges = new Map();
  let previous = null;
  run.calls.forEach(({ record, start }, i) => {
    if (!stages.has(record.name)) stages.set(record.name, { id: record.name, title: record.name, loops: 0, agents: [], index: stages.size });
    const stage = stages.get(record.name);
    if (previous && previous.index > stage.index) {
      stage.loops += 1;
      const edge = `${previous.id}\n${stage.id}`;
      edges.set(edge, { from: previous.id, to: stage.id, count: (edges.get(edge)?.count ?? 0) + 1 });
    }
    previous = stage;
    stage.agents.push({
      id: `call-${i}`,
      name: callName(record),
      role: ROLES.has(record.kind) ? record.kind : 'transform',
      state: record.ok === false ? 'failed' : 'done',
      startedAt: iso(start),
      endedAt: iso(endOf(record, start)),
      meta: record.cacheHit ? 'cached' : '',
      costUsd: Number.isFinite(record.costUsd) ? record.costUsd : null,
      traced: false,
    });
  });
  const shaped = [...stages.values()].map(({ id, title, loops, agents }) => ({ id, title, state: agents.at(-1).state, loops, agents }));
  const failedService = run.services.some(({ record }) => record.ok === false);
  return {
    key: keyFor(run.caller, run.startedAt),
    title: run.caller,
    subtitle: [...new Set(run.calls.map(({ record }) => record.verb ?? record.name))].join(', '),
    startedAt: iso(parseTime(run.startedAt)),
    state: failedService ? 'failed' : rollup(shaped.map((stage) => stage.state)),
    stages: shaped,
    backEdges: [...edges.values()],
    endMs: run.end,
    calls: run.calls,
  };
}

function allFlows() {
  const { records } = readLog();
  return segments(records).map(toFlow).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const strip = ({ endMs, calls, ...flow }) => flow;

export function where() {
  return logPath();
}

export function list() {
  return allFlows().slice(0, FLOW_LIMIT).map(strip);
}

export function flow(_where, key) {
  const found = allFlows().find((f) => f.key === key);
  return found ? strip(found) : null;
}

export function trace(_where, key, agentId) {
  const found = allFlows().find((f) => f.key === key);
  if (!found) return null;
  const known = found.stages.some((stage) => stage.agents.some((agent) => agent.id === agentId));
  if (!known) return null;
  const origin = Date.parse(found.startedAt);
  const children = found.calls.map(({ record, start }, i) => callStep({ record, start, end: endOf(record, start) }, origin, `call-${i}`));
  return {
    title: found.title,
    subtitle: found.subtitle,
    startedAt: found.startedAt,
    live: false,
    root: { kind: 'group', id: 'flow', name: found.title, meta: `${children.length} calls`, role: 'coordinator', start: 0, end: seconds(found.endMs, origin), children },
  };
}

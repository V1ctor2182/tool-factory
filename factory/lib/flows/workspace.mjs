import { readdirSync, readFileSync, statSync } from 'node:fs';
import { logPath, readLog } from '../runs.mjs';
import { iso, NOTE_LIMIT, parseTime, seconds } from './transcript.mjs';

const LIVE_MS = 10 * 60_000;
const CATEGORY_BY_KIND = { model: 'model', observe: 'browser', transform: 'shell', act: 'human' };
export const callName = (record) => (record.verb ? `${record.name} ${record.verb}` : record.name);

export const mtime = (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null;

export function dirNames(path) {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function roundNumbers(path) {
  return dirNames(path).flatMap((name) => {
    const found = name.match(/^round-(\d+)$/);
    return found ? [Number(found[1])] : [];
  }).sort((a, b) => a - b);
}

const fields = new Map();

// A file caught mid-write reads as present with no fields, and its next mtime reads it again.
export function fieldsOf(path, pick) {
  const at = mtime(path);
  if (at === null) return null;
  const memo = fields.get(path);
  if (memo?.at === at) return memo;
  try {
    const entry = { at, ...pick(JSON.parse(readFileSync(path, 'utf8'))) };
    fields.set(path, entry);
    return entry;
  } catch {
    return { at };
  }
}

let logMemo = null;

export function callerRecords(caller) {
  const path = logPath();
  const stat = statSync(path, { throwIfNoEntry: false });
  if (logMemo?.path !== path || logMemo.at !== stat?.mtimeMs || logMemo.size !== stat?.size) {
    const timed = readLog().records.flatMap((record) => {
      const start = parseTime(record.startedAt);
      return record.type === 'atom' && start !== null ? [{ record, start, end: start + (record.ms ?? 0) }] : [];
    });
    timed.sort((a, b) => a.start - b.start);
    logMemo = { path, at: stat?.mtimeMs, size: stat?.size, byCaller: Map.groupBy(timed, ({ record }) => record.caller) };
  }
  return logMemo.byCaller.get(caller) ?? [];
}

// Log times are whole seconds and neighbouring calls touch, so a call belongs to the window holding its middle.
export const inWindow = ({ start, end }, from, to) => (start + end) / 2 >= from && (start + end) / 2 <= to;

export function lastEndIn(records, from, to) {
  return Math.max(from, ...records.filter((call) => inWindow(call, from, to)).map(({ end }) => end));
}

// Nothing logs which item a call was for, and these services run one item at a time, so at most the newest is live.
export function newestLive(items, fileAt, records, now) {
  const newest = items.reduce((best, item) => (best === null || fileAt(item) > fileAt(best) ? item : best), null);
  const logged = Math.max(0, ...records.map(({ end }) => end));
  return newest && now - fileAt(newest) < LIVE_MS && now - logged < LIVE_MS ? newest : null;
}

export function stage(id, title, agents, loops = 0, lastCounts = false) {
  const state = !agents.length ? 'pending'
    : agents.some((agent) => agent.state === 'running') ? 'running'
      : lastCounts && agents.at(-1).state === 'failed' ? 'failed' : 'done';
  return { id, title, state, loops, agents };
}

export function callStep({ record, start, end }, origin, id) {
  return {
    kind: 'step',
    id,
    name: callName(record),
    meta: record.cacheHit ? 'cached' : (record.kind ?? ''),
    category: CATEGORY_BY_KIND[record.kind] ?? 'shell',
    start: seconds(start, origin),
    end: seconds(end, origin),
    outcome: record.ok === false ? 'failed' : 'ok',
    ...(typeof record.error === 'string' && { note: record.error.slice(0, NOTE_LIMIT) }),
  };
}

export function chipTrace(found, stageOfChip, agent, origin, end, children, metaWord = 'calls') {
  return {
    title: found.title,
    subtitle: `${stageOfChip.title} · ${agent.name}`,
    startedAt: iso(origin),
    live: agent.state === 'running',
    root: { kind: 'group', id: agent.id, name: agent.name, meta: `${children.length} ${metaWord}`, role: agent.role, start: 0, end: end === null ? null : seconds(end, origin), children },
  };
}

export function logTrace(found, stageOfChip, agent, records) {
  const from = Date.parse(agent.startedAt);
  const to = agent.endedAt ? Date.parse(agent.endedAt) : Date.now();
  const calls = records.filter((call) => inWindow(call, from, to));
  const origin = Math.min(from, calls[0]?.start ?? from);
  const last = Math.max(to, ...calls.map(({ end }) => end));
  return chipTrace(found, stageOfChip, agent, origin, agent.endedAt ? last : null, calls.map((call, i) => callStep(call, origin, `call-${i}`)));
}

export function findChip(flow, agentId) {
  const inStage = flow?.stages.find((s) => s.agents.some((agent) => agent.id === agentId));
  return inStage ? { stage: inStage, agent: inStage.agents.find((a) => a.id === agentId) } : null;
}

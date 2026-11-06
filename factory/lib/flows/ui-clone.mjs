import { join } from 'node:path';
import { home } from '../home.mjs';
import { iso } from './transcript.mjs';
import { callerRecords, chipTrace, dirNames, fieldsOf, findChip, lastEndIn, logTrace, mtime, newestLive, roundNumbers, stage } from './workspace.mjs';

const CALLER = 'ui-clone';
const LOOP_KEY = 'loop';
const TARGET = 0.9;
const ATOMS_OF_STAGE = { collect: new Set(['ui-catalog', 'ui-source']), draft: new Set(['ui-draft']), judge: new Set(['page-record', 'page-diff']) };
const SPLIT_GAP_MS = 30 * 60_000;
const DRAFT_MATCH_MS = 3000;
const JUDGE_LIMIT_MS = 10 * 60_000;

const draftFields = ({ model, costUsd }) => ({ model, costUsd });
const diffFields = ({ score }) => ({ score });

function readRound(dir, n, drafts, judging) {
  const draft = fieldsOf(join(dir, 'draft.json'), draftFields);
  if (!draft) return null;
  const written = fieldsOf(join(dir, 'diff.json'), diffFields);
  // A rerun rewrites draft.json and only a passing judge rewrites diff.json, so an older diff scored an earlier draft.
  const diff = written && written.at >= draft.at ? written : null;
  const logged = drafts.filter(({ end }) => Math.abs(end - draft.at) <= DRAFT_MATCH_MS).sort((a, b) => Math.abs(a.end - draft.at) - Math.abs(b.end - draft.at))[0];
  const next = drafts.find(({ end }) => end > draft.at + DRAFT_MATCH_MS)?.start ?? Infinity;
  return {
    n,
    draftStart: Math.min(logged?.start ?? draft.at, draft.at),
    draftAt: draft.at,
    costUsd: Number.isFinite(draft.costUsd) ? draft.costUsd : null,
    model: typeof draft.model === 'string' ? draft.model : '',
    score: Number.isFinite(diff?.score) ? diff.score : null,
    diffAt: diff?.at ?? null,
    judgeEnd: diff?.at ?? lastEndIn(judging, draft.at, Math.min(next, draft.at + JUDGE_LIMIT_MS)),
  };
}

const fileAt = (round) => round.diffAt ?? round.draftAt;
// A rerun that stops early leaves later rounds of the run before it, so the highest number need not be the newest.
const current = (rounds) => rounds.reduce((newest, round) => (fileAt(round) >= fileAt(newest) ? round : newest));

function read(where, now = Date.now()) {
  const calls = callerRecords(CALLER);
  const drafts = calls.filter(({ record }) => ATOMS_OF_STAGE.draft.has(record.name));
  const judging = calls.filter(({ record }) => ATOMS_OF_STAGE.judge.has(record.name));
  const rebuilt = join(where, 'rebuild');
  const components = dirNames(rebuilt).flatMap((name) => {
    const dir = join(rebuilt, name);
    const rounds = roundNumbers(dir).flatMap((n) => readRound(join(dir, `round-${n}`), n, drafts, judging) ?? []);
    return rounds.length ? [{ name, rounds }] : [];
  });
  const newest = newestLive(components, ({ rounds }) => fileAt(current(rounds)), calls, now);
  return { calls, components, liveName: newest && (current(newest.rounds).score ?? 0) < TARGET ? newest.name : null };
}

function chips({ name, rounds }, label, live) {
  const latest = current(rounds);
  const drafting = live && latest.diffAt !== null ? latest.n + 1 : null;
  const runningDraft = () => ({ id: `draft:${name}:${drafting}`, name: label(drafting), role: 'model', state: 'running', startedAt: iso(latest.diffAt), endedAt: null, meta: 'drafting', costUsd: null, traced: true });
  const draft = rounds.map((round) => (round.n === drafting ? runningDraft() : {
    id: `draft:${name}:${round.n}`,
    name: label(round.n),
    role: 'model',
    state: 'done',
    startedAt: iso(round.draftStart),
    endedAt: iso(round.draftAt),
    meta: round.model,
    costUsd: round.costUsd,
    traced: true,
  }));
  if (drafting !== null && !rounds.some((round) => round.n === drafting)) draft.push(runningDraft());
  const judge = rounds.map((round) => {
    const running = live && round.diffAt === null && round === latest;
    return {
      id: `judge:${name}:${round.n}`,
      name: label(round.n),
      role: 'observe',
      state: running ? 'running' : round.diffAt === null ? 'failed' : 'done',
      startedAt: iso(round.draftAt),
      endedAt: running ? null : iso(round.judgeEnd),
      meta: round.score !== null ? round.score.toFixed(4) : running ? 'judging' : 'no score',
      costUsd: null,
      traced: true,
    };
  });
  return { draft, judge };
}

function ways({ rounds }) {
  const followed = rounds.slice(0, -1);
  const revise = followed.filter((round) => round.score !== null).length;
  return { revise, error: followed.length - revise };
}

const edges = ({ revise, error }) => [
  ...(revise ? [{ from: 'judge', to: 'draft', count: revise, label: 'revise' }] : []),
  ...(error ? [{ from: 'draft', to: 'draft', count: error, label: 'error' }] : []),
];

function card(component, liveName) {
  const { name, rounds } = component;
  const { draft, judge } = chips(component, (n) => `r${n}`, name === liveName);
  const way = ways(component);
  const scores = rounds.map((round) => round.score).filter((score) => score !== null);
  const best = scores.length ? Math.max(...scores) : null;
  const count = `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
  return {
    key: name,
    title: name,
    subtitle: [best === null ? 'no score' : `best ${best.toFixed(2)}`, count, best !== null && best < TARGET ? 'below 0.9' : null].filter(Boolean).join(' · '),
    startedAt: iso(rounds[0].draftStart),
    stages: [stage('draft', 'Draft', draft, way.error, true), stage('judge', 'Judge', judge, way.revise, true)],
    backEdges: edges(way),
  };
}

function collectAgents(calls) {
  const bursts = [];
  for (const call of calls.filter(({ record }) => ATOMS_OF_STAGE.collect.has(record.name))) {
    const open = bursts.at(-1);
    if (open && call.start - open.end <= SPLIT_GAP_MS) {
      open.end = Math.max(open.end, call.end);
      open.calls.push(call);
    } else bursts.push({ start: call.start, end: call.end, calls: [call] });
  }
  return bursts.map(({ start, end, calls: burst }) => {
    const at = iso(start);
    const count = burst.filter(({ record }) => record.name === 'ui-source' && record.ok !== false).length;
    return { id: `collect:${at}`, name: `collect ${at.slice(5, 16).replace('T', ' ')}`, role: 'observe', state: 'done', startedAt: at, endedAt: iso(end), meta: `${count} components`, costUsd: null, traced: true };
  });
}

function stepsAgents(where) {
  const site = join(where, 'site');
  return dirNames(site).flatMap((host) => dirNames(join(site, host)).flatMap((component) => {
    const at = mtime(join(site, host, component, 'steps.json'));
    return at === null ? [] : [{ id: `steps:${host}/${component}`, name: component, role: 'transform', state: 'done', startedAt: iso(at), endedAt: iso(at), meta: host, costUsd: null, traced: false }];
  }));
}

const newestFirst = (a, b) => b.startedAt.localeCompare(a.startedAt);

function loopFlow(where, { calls, components, liveName }) {
  const collect = collectAgents(calls);
  const steps = stepsAgents(where);
  const rounds = components.flatMap((component) => chips(component, (n) => `${component.name} r${n}`, component.name === liveName));
  const way = components.map(ways).reduce((sum, one) => ({ revise: sum.revise + one.revise, error: sum.error + one.error }), { revise: 0, error: 0 });
  const draft = rounds.flatMap((r) => r.draft);
  const judge = rounds.flatMap((r) => r.judge);
  const all = [...collect, ...steps, ...draft];
  if (!all.length) return null;
  const finished = components.flatMap(({ rounds: done }) => done);
  return {
    key: LOOP_KEY,
    title: 'UI Clone',
    subtitle: `${components.length} components, ${finished.length} rounds, ${finished.filter((round) => round.score !== null).length} scored`,
    startedAt: all.map((agent) => agent.startedAt).sort()[0],
    stages: [
      stage('collect', 'Collect', collect.toSorted(newestFirst)),
      stage('steps', 'Steps', steps.toSorted(newestFirst)),
      stage('draft', 'Draft', draft.toSorted(newestFirst), way.error),
      stage('judge', 'Judge', judge.toSorted(newestFirst), way.revise),
    ],
    backEdges: edges(way),
  };
}

export function where() {
  return join(home(), 'microservices', CALLER);
}

export function list(folder) {
  const { components, liveName } = read(folder);
  return components.map((component) => card(component, liveName));
}

export function loop(folder) {
  return loopFlow(folder, read(folder));
}

export function flow(folder, key) {
  if (key === LOOP_KEY) return loop(folder);
  const { components, liveName } = read(folder);
  const found = components.find((component) => component.name === key);
  return found ? card(found, liveName) : null;
}

export function trace(folder, key, agentId) {
  const found = flow(folder, key);
  const chip = findChip(found, agentId);
  if (!chip) return null;
  const { stage: inStage, agent } = chip;
  if (!agent.traced) {
    const at = Date.parse(agent.startedAt);
    return chipTrace(found, inStage, agent, at, at, []);
  }
  return logTrace(found, inStage, agent, callerRecords(CALLER).filter(({ record }) => ATOMS_OF_STAGE[inStage.id].has(record.name)));
}

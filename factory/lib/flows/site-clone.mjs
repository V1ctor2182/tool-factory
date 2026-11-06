import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { home } from '../home.mjs';
import { buildNodes, iso, parseTranscript } from './transcript.mjs';
import { callerRecords, chipTrace, dirNames, fieldsOf, findChip, inWindow, lastEndIn, logTrace, mtime, newestLive, roundNumbers, stage } from './workspace.mjs';

const CALLER = 'site-clone';
const LOOP_KEY = 'loop';
const COMMAND_NEEDLE = Buffer.from('site-clone/run');
const COMPARE_LIMIT_MS = 30 * 60_000;
const SESSION_NEAR_MS = 30 * 60_000;
const SCAN_CHUNK = 4 * 1024 * 1024;

const urlField = ({ url }) => ({ url });
const summaryFields = ({ summary }) => ({ major: summary?.major, minor: summary?.minor });
const earliest = (...times) => {
  const known = times.filter((at) => at !== null);
  return known.length ? Math.min(...known) : null;
};
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function readRound(root, n) {
  const dir = join(root, `round-${n}`);
  const planAt = mtime(join(dir, 'plan.json'));
  if (planAt === null) return null;
  const diff = fieldsOf(join(dir, 'diff.json'), summaryFields);
  return { n, planAt, diffAt: diff?.at ?? null, major: diff?.major ?? null, minor: diff?.minor ?? null };
}

// A later re-study rewrites bundle, facts and brief. The first walk's folder and map.json keep the first study's times,
// and no study outlasts the round it led to.
function readWorkspace(where, name) {
  const root = join(where, name);
  const rounds = roundNumbers(root).flatMap((n) => readRound(root, n) ?? []);
  const end = earliest(mtime(join(root, 'brief.md')), mtime(join(root, 'map.json')), rounds[0]?.planAt ?? null);
  const start = earliest(mtime(join(root, 'bundle.json')), mtime(join(root, 'facts.json')), mtime(join(root, 'first-walk')), end);
  if (start === null) return null;
  const files = [start, end ?? start, ...rounds.flatMap(({ planAt, diffAt }) => [planAt, diffAt ?? planAt])];
  return { name, url: fieldsOf(join(root, 'plan.json'), urlField)?.url ?? null, start, end, rounds, newestFile: Math.max(...files) };
}

function read(where, now = Date.now()) {
  const calls = callerRecords(CALLER);
  const workspaces = dirNames(where).flatMap((name) => readWorkspace(where, name) ?? []);
  return { calls, workspaces, liveName: newestLive(workspaces, ({ newestFile }) => newestFile, calls, now)?.name ?? null };
}

const noSession = new Set();

function chips(workspace, calls, labels, live) {
  const { name, rounds, start, end } = workspace;
  const lastRound = rounds.at(-1);
  const studying = live && end === null;
  const study = [{
    id: `study:${name}`,
    name: labels.study,
    role: 'observe',
    state: studying ? 'running' : end === null ? 'failed' : 'done',
    startedAt: iso(start),
    endedAt: studying ? null : iso(end ?? start),
    meta: '',
    costUsd: null,
    traced: true,
  }];
  const buildChip = (n, from, to) => {
    const id = `build:${name}:${n}`;
    return { id, name: labels.build(n), role: 'worker', state: to === null ? 'running' : 'done', startedAt: iso(from), endedAt: iso(to), meta: '', costUsd: null, traced: !noSession.has(id) };
  };
  const build = rounds.map((round, i) => {
    const previous = rounds[i - 1];
    return buildChip(round.n, previous ? (previous.diffAt ?? previous.planAt) : (end ?? start), round.planAt);
  });
  if (live && end !== null && (!lastRound || lastRound.diffAt !== null)) build.push(buildChip((lastRound?.n ?? 0) + 1, lastRound?.diffAt ?? end, null));
  const compare = rounds.map((round, i) => {
    const running = live && round.diffAt === null && i === rounds.length - 1;
    const until = Math.min(rounds[i + 1]?.planAt ?? Infinity, round.planAt + COMPARE_LIMIT_MS);
    return {
      id: `compare:${name}:${round.n}`,
      name: labels.compare(round.n),
      role: 'observe',
      state: running ? 'running' : round.diffAt === null ? 'failed' : 'done',
      startedAt: iso(round.planAt),
      endedAt: running ? null : iso(round.diffAt ?? lastEndIn(calls, round.planAt, until)),
      meta: round.diffAt === null ? (running ? 'comparing' : 'no diff') : `${round.major ?? '?'} major · ${round.minor ?? '?'} minor`,
      costUsd: null,
      traced: true,
    };
  });
  return { study, build, compare };
}

const differs = ({ rounds }) => Math.max(0, rounds.length - 1);
const edges = (count) => (count ? [{ from: 'compare', to: 'build', count, label: 'differs' }] : []);

function card(workspace, calls, liveName) {
  const { name, url, rounds, start } = workspace;
  const live = name === liveName;
  const { study, build, compare } = chips(workspace, calls, { study: 'Study', build: (n) => `Build r${n}`, compare: (n) => `round-${n}` }, live);
  const last = rounds.at(-1);
  const count = differs(workspace);
  return {
    key: name,
    title: name,
    subtitle: [hostOf(url), plural(rounds.length, 'round'), last?.major != null ? `${last.major} major` : null].filter(Boolean).join(' · '),
    startedAt: iso(start),
    state: live ? 'running' : last?.major === 0 ? 'done' : 'stalled',
    stages: [stage('study', 'Study', study), stage('build', 'Build', build), stage('compare', 'Compare', compare, count, true)],
    backEdges: edges(count),
  };
}

const newestFirst = (a, b) => b.startedAt.localeCompare(a.startedAt);

function loopFlow({ calls, workspaces, liveName }) {
  if (!workspaces.length) return null;
  const parts = workspaces.map((workspace) => chips(workspace, calls, { study: `${workspace.name} study`, build: (n) => `${workspace.name} r${n}`, compare: (n) => `${workspace.name} r${n}` }, workspace.name === liveName));
  const pick = (field) => parts.flatMap((part) => part[field]).toSorted(newestFirst);
  const count = workspaces.reduce((sum, workspace) => sum + differs(workspace), 0);
  const rounds = workspaces.reduce((sum, workspace) => sum + workspace.rounds.length, 0);
  return {
    key: LOOP_KEY,
    title: 'Site Clone',
    subtitle: `${plural(workspaces.length, 'site')}, ${plural(rounds, 'round')}`,
    startedAt: iso(Math.min(...workspaces.map((workspace) => workspace.start))),
    state: liveName ? 'running' : workspaces.every(({ rounds: done }) => done.at(-1)?.major === 0) ? 'done' : 'stalled',
    stages: [stage('study', 'Study', pick('study')), stage('build', 'Build', pick('build')), stage('compare', 'Compare', pick('compare'), count)],
    backEdges: edges(count),
  };
}

const projectsRoot = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

function transcriptFiles() {
  const root = projectsRoot();
  return dirNames(root).flatMap((project) => readdirSync(join(root, project)).filter((name) => name.endsWith('.jsonl')).map((name) => join(root, project, name)));
}

// Whole-chunk search first, so gigabytes of transcripts cost a read and only the rare matching chunk gets decoded.
async function commandsIn(path) {
  const found = [];
  let tail = Buffer.alloc(0);
  const take = (region) => {
    if (!region.includes(COMMAND_NEEDLE)) return;
    for (const line of region.toString('utf8').split('\n')) {
      if (!line.includes('site-clone/run') || !line.includes('tool_use')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== 'assistant' || !Array.isArray(record.message?.content)) continue;
      for (const block of record.message.content) {
        if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string' && block.input.command.includes('site-clone/run')) {
          found.push({ path, at: Date.parse(record.timestamp), command: block.input.command });
        }
      }
    }
  };
  for await (const chunk of createReadStream(path, { highWaterMark: SCAN_CHUNK })) {
    const cut = chunk.lastIndexOf(10);
    if (cut < 0) {
      tail = Buffer.concat([tail, chunk]);
      continue;
    }
    take(Buffer.concat([tail, chunk.subarray(0, cut)]));
    tail = chunk.subarray(cut + 1);
  }
  take(tail);
  return found;
}

let scanned = null;

// One scan answers every workspace, and it stays good until a chip asks about something newer than the scan.
function allCommands(since, target) {
  if (scanned?.root === projectsRoot() && scanned.at > target && scanned.since <= since) return scanned.commands;
  const at = Date.now();
  const commands = (async () => {
    const found = [];
    for (const path of transcriptFiles()) {
      if (mtime(path) >= since) found.push(...await commandsIn(path).catch(() => []));
    }
    return found;
  })();
  scanned = { root: projectsRoot(), at, since, commands };
  return commands;
}

function namesWorkspace(command, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`site-clone/run compare ${safe}(?![\\w.-])`).test(command)
    || (/site-clone\/run study\b/.test(command) && new RegExp(`--name[= ]${safe}(?![\\w.-])`).test(command));
}

function loggedSession(workspace, calls, target) {
  const windows = [[workspace.start, workspace.end ?? workspace.start], ...workspace.rounds.map(({ planAt, diffAt }) => [planAt, diffAt ?? planAt + COMPARE_LIMIT_MS])];
  const nearest = calls
    .filter((call) => call.record.session && windows.some(([from, to]) => inWindow(call, from, to)))
    .sort((a, b) => Math.abs(a.start - target) - Math.abs(b.start - target))[0];
  const session = nearest?.record.session;
  if (typeof session !== 'string' || !/^[\w-]+$/.test(session)) return null;
  const root = projectsRoot();
  for (const project of dirNames(root)) {
    const path = join(root, project, `${session}.jsonl`);
    if (mtime(path) !== null) return path;
  }
  return null;
}

async function transcriptNear(workspace, calls, target) {
  const logged = loggedSession(workspace, calls, target);
  if (logged) return logged;
  const commands = await allCommands(workspace.start, target);
  const [nearest] = commands
    .filter(({ command, at }) => Math.abs(at - target) <= SESSION_NEAR_MS && namesWorkspace(command, workspace.name))
    .sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target));
  return nearest?.path ?? null;
}

let parsedMemo = null;

function parsedTranscript(path) {
  const at = mtime(path);
  if (parsedMemo?.path !== path || parsedMemo.at !== at) parsedMemo = { path, at, calls: parseTranscript(readFileSync(path, 'utf8')).calls };
  return parsedMemo.calls;
}

// A closed window's calls never change, while a session still running moves its transcript's mtime on every poll.
const closedWindows = new Map();

function callsIn(path, from, to, open) {
  const key = `${path}|${from}|${to}`;
  if (!open && closedWindows.has(key)) return closedWindows.get(key);
  const calls = parsedTranscript(path)
    .filter((call) => call.start >= from && call.start <= to)
    .map((call) => (call.end === null || open ? call : { ...call, end: Math.min(call.end, to) }));
  if (!open) closedWindows.set(key, calls);
  return calls;
}

async function buildTrace(found, inStage, agent, workspace, calls) {
  const open = agent.endedAt === null;
  const from = Date.parse(agent.startedAt);
  const to = open ? Date.now() : Date.parse(agent.endedAt);
  const path = await transcriptNear(workspace, calls, open ? from : to);
  if (!path) {
    noSession.add(agent.id);
    return chipTrace(found, inStage, agent, from, open ? null : to, [], 'steps');
  }
  noSession.delete(agent.id);
  return chipTrace(found, inStage, agent, from, open ? null : to, buildNodes(callsIn(path, from, to, open), from, open ? null : to), 'steps');
}

export function where() {
  return join(home(), 'microservices', CALLER);
}

export function list(folder) {
  const { calls, workspaces, liveName } = read(folder);
  return workspaces.map((workspace) => card(workspace, calls, liveName));
}

export function loop(folder) {
  return loopFlow(read(folder));
}

function flowOf(model, key) {
  if (key === LOOP_KEY) return loopFlow(model);
  const found = model.workspaces.find((workspace) => workspace.name === key);
  return found ? card(found, model.calls, model.liveName) : null;
}

export function flow(folder, key) {
  return flowOf(read(folder), key);
}

export async function trace(folder, key, agentId) {
  const model = read(folder);
  const found = flowOf(model, key);
  const chip = findChip(found, agentId);
  if (!chip) return null;
  const { stage: inStage, agent } = chip;
  if (inStage.id !== 'build') return logTrace(found, inStage, agent, model.calls);
  const name = agentId.split(':')[1];
  return buildTrace(found, inStage, agent, model.workspaces.find((workspace) => workspace.name === name), model.calls);
}

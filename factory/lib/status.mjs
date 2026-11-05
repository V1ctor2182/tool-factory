import { join } from 'node:path';
import { health } from './doctor.mjs';
import { ledger, ledgerPath, linkedTo } from './links.mjs';
import { readJson } from './manifest.mjs';
import { cliArgs, usage } from './registry.mjs';
import { budget, home, lastDays, logPath, readLog, spend, today } from './runs.mjs';

const WINDOW = 7;
const dollars = (usd) => Math.round(usd * 1e6) / 1e6;

function median(values) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const failures = (lines) => lines.filter((r) => !r.ok).length;
const latest = (lines) => lines.reduce((last, r) => (r.startedAt > last ? r.startedAt : last), '') || null;

function outsideRuns(runs, calls) {
  const timeline = [...runs, ...calls].map((r) => [Date.parse(r.startedAt), r]).sort(([a, x], [b, y]) => a - b || (y.type === 'microservice') - (x.type === 'microservice'));
  let coveredUntil = -Infinity;
  return timeline.filter(([at, r]) => {
    if (r.type !== 'microservice') return at >= coveredUntil;
    // startedAt drops milliseconds, so a run covers up to one second past its ms.
    coveredUntil = Math.max(coveredUntil, at + (r.ms ?? 0) + 1000);
    return false;
  }).map(([, r]) => r);
}

function attempt(problems, path, work, fallback) {
  try {
    return work();
  } catch (e) {
    if (e.code !== 'ENOENT') problems.push({ path, message: e.message });
    return fallback;
  }
}

function external(root, problems) {
  const list = attempt(problems, 'external.json', () => readJson(join(root, 'external.json')), []);
  const good = Array.isArray(list) ? list.filter((t) => ['name', 'description', 'where'].every((f) => typeof t?.[f] === 'string')) : [];
  if (!Array.isArray(list) || good.length < list.length) problems.push({ path: 'external.json', message: 'every entry needs name, description, and where as strings' });
  return good.map(({ name, description, where }) => ({ name, description, where }));
}

// The top-level fields of each contract a verb returns, so the dashboard documents output without a second copy of the schema.
function contracts(root, entries, problems) {
  const names = new Set(entries.flatMap((e) => (e.manifest.verbs ?? []).map((v) => v.output)));
  return Object.fromEntries([...names].sort().map((name) => {
    const path = `contracts/${name}.schema.json`;
    const schema = attempt(problems, path, () => readJson(join(root, path)), null);
    if (!schema) return [name, null];
    const required = schema.required ?? [];
    const fields = Object.entries(schema.properties ?? {}).map(([field, p]) => ({ name: field, type: p.type ? [p.type].flat().join(' or ') : 'const' in p ? JSON.stringify(p.const) : p.enum ? p.enum.map((v) => JSON.stringify(v)).join(' or ') : 'any', required: required.includes(field), description: p.description ?? null }));
    return [name, { description: schema.description ?? null, fields }];
  }));
}

export function statusModel(registry) {
  const problems = [...registry.problems];
  const days = lastDays(WINDOW);
  const log = attempt(problems, logPath(), readLog, null);
  if (log?.bad.length) {
    const [first] = log.bad;
    problems.push({ path: logPath(), message: `has ${log.bad.length} unreadable line${log.bad.length === 1 ? '' : 's'}, the first at line ${first.line}, which ${first.problem}. The history leaves out unreadable lines, and today's spend is unknown.` });
  }
  const records = log?.records ?? null;
  const links = attempt(problems, ledgerPath(), ledger, null);
  const checked = new Map(health(registry.entries).map((r) => [r.name, r]));
  const capUsd = attempt(problems, 'TOOL_FACTORY_BUDGET_USD', budget, null);

  const all = [...registry.entries.values()];
  const microservices = all.filter((e) => e.type === 'microservice').sort((a, b) => b.manifest.uses.length - a.manifest.uses.length || a.name.localeCompare(b.name));
  const microserviceNames = new Set(microservices.map((t) => t.name));
  const window = (records ?? []).filter((r) => days.includes(r.startedAt?.slice(0, 10)));
  const byName = Map.groupBy(window, (r) => r.name);
  const byCaller = Map.groupBy(window.filter((r) => microserviceNames.has(r.caller)), (r) => r.caller);
  const direct = new Map([...byCaller].map(([name, lines]) => [name, outsideRuns(byName.get(name) ?? [], lines)]));
  const calls = [...window.filter((r) => !microserviceNames.has(r.caller)), ...[...direct.values()].flat()];

  const row = (entry) => {
    const { status, notes } = checked.get(entry.name);
    const microservice = entry.type === 'microservice';
    const known = {
      name: entry.name,
      type: entry.type,
      kind: entry.kind,
      status: entry.manifest.status,
      description: entry.manifest.description,
      health: status,
      notes,
      links: links && links.filter((l) => l.name === entry.name).map((l) => ({ socket: l.socket, where: linkedTo(l) })),
      guard: entry.info.guard,
      adapters: entry.manifest.adapters ?? [],
      verbs: (entry.manifest.verbs ?? []).map((verb) => ({ name: verb.name, usage: usage(entry, verb), cli: cliArgs(verb), description: verb.description, input: verb.input, output: verb.output })),
      ...(microservice ? { uses: entry.manifest.uses } : { usedBy: microservices.filter((t) => t.manifest.uses.includes(entry.name)).map((t) => t.name) }),
    };
    if (!records) return { ...known, runs: null, failed: null, medianMs: null, lastRunAt: null, spentUsd: null, ...(microservice && { atomCalls: null, atomFailed: null, perDay: null }) };
    const mine = byName.get(entry.name) ?? [];
    const activity = { runs: mine.length, failed: failures(mine), medianMs: median(mine.filter((r) => r.ok && Number.isFinite(r.ms)).map((r) => r.ms)) };
    if (!microservice) return { ...known, ...activity, lastRunAt: latest(mine), spentUsd: dollars(spend(mine)) };
    const outside = direct.get(entry.name) ?? [];
    const onDay = (lines) => Map.groupBy(lines, (r) => r.startedAt.slice(0, 10));
    const runsOn = onDay(mine);
    const callsOn = onDay(outside);
    return {
      ...known,
      ...activity,
      atomCalls: outside.length,
      atomFailed: failures(outside),
      lastRunAt: latest([...mine, ...outside]),
      spentUsd: dollars(spend([...mine, ...(byCaller.get(entry.name) ?? [])])),
      perDay: days.map((day) => {
        const runs = runsOn.get(day) ?? [];
        const calls = callsOn.get(day) ?? [];
        return { day, runs: runs.length, failed: failures(runs), atomCalls: calls.length, atomFailed: failures(calls) };
      }),
    };
  };

  return {
    days,
    home: home(),
    log: { lines: records?.length ?? null, unreadable: log?.bad.length ?? null, firstUnreadable: log?.bad[0]?.line ?? null },
    calls: records && { runs: calls.length, failed: failures(calls) },
    budget: { capUsd: capUsd === Infinity ? 'none' : capUsd, spentTodayUsd: log && !log.bad.length ? dollars(spend(today(records))) : null },
    microservices: microservices.map(row),
    atoms: all.filter((e) => e.type === 'atom').map(row),
    contracts: contracts(registry.root, all, problems),
    external: external(registry.root, problems),
    problems,
  };
}

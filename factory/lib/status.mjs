import { join } from 'node:path';
import { health } from './doctor.mjs';
import { ledger, ledgerPath, linkedTo } from './links.mjs';
import { readJson } from './manifest.mjs';
import { budget, home, lastDays, readLog, spend, today } from './runs.mjs';

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
  const at = (r) => Date.parse(r.startedAt);
  const timeline = [...runs, ...calls].sort((a, b) => at(a) - at(b) || (b.type === 'tool') - (a.type === 'tool'));
  let coveredUntil = -Infinity;
  return timeline.filter((r) => {
    if (r.type !== 'tool') return at(r) >= coveredUntil;
    // startedAt drops milliseconds, so a run covers up to one second past its ms.
    coveredUntil = Math.max(coveredUntil, at(r) + (r.ms ?? 0) + 1000);
    return false;
  });
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

export function statusModel(registry) {
  const problems = [...registry.problems];
  const days = lastDays(WINDOW);
  const logPath = join(home(), 'runs.jsonl');
  const log = attempt(problems, logPath, readLog, null);
  if (log?.bad.length) {
    const [first] = log.bad;
    problems.push({ path: logPath, message: `has ${log.bad.length} unreadable line${log.bad.length === 1 ? '' : 's'}, the first at line ${first.line}, which ${first.problem}. The history skips them, and today's spend is unknown.` });
  }
  const records = log?.records ?? null;
  const links = attempt(problems, ledgerPath(), ledger, []);
  const checked = new Map(health(registry.entries).map((r) => [r.name, r]));
  const capUsd = attempt(problems, 'TOOL_FACTORY_BUDGET_USD', budget, null);

  const all = [...registry.entries.values()];
  const tools = all.filter((e) => e.type === 'tool').sort((a, b) => b.manifest.uses.length - a.manifest.uses.length || a.name.localeCompare(b.name));
  const toolNames = new Set(tools.map((t) => t.name));
  const window = (records ?? []).filter((r) => days.includes(r.startedAt?.slice(0, 10)));
  const byName = Map.groupBy(window, (r) => r.name);
  const byCaller = Map.groupBy(window.filter((r) => toolNames.has(r.caller)), (r) => r.caller);
  const direct = new Map([...byCaller].map(([name, lines]) => [name, outsideRuns(byName.get(name) ?? [], lines)]));
  const calls = [...window.filter((r) => !toolNames.has(r.caller)), ...[...direct.values()].flat()];

  const row = (entry) => {
    const mine = byName.get(entry.name) ?? [];
    const { status, notes } = checked.get(entry.name);
    const shared = {
      name: entry.name,
      type: entry.type,
      kind: entry.kind,
      status: entry.manifest.status,
      description: entry.manifest.description,
      health: status,
      notes,
      runs: mine.length,
      failed: failures(mine),
      medianMs: median(mine.filter((r) => r.ok && Number.isFinite(r.ms)).map((r) => r.ms)),
      lastRunAt: latest(mine),
      links: links.filter((l) => l.name === entry.name).map((l) => ({ socket: l.socket, where: linkedTo(l) })),
    };
    if (entry.type === 'atom') {
      return { ...shared, spentUsd: dollars(spend(mine)), usedBy: tools.filter((t) => t.manifest.uses.includes(entry.name)).map((t) => t.name) };
    }
    const outside = direct.get(entry.name) ?? [];
    const onDay = (lines) => Map.groupBy(lines, (r) => r.startedAt.slice(0, 10));
    const [runsOn, callsOn] = [onDay(mine), onDay(outside)];
    return {
      ...shared,
      atomCalls: outside.length,
      atomFailed: failures(outside),
      lastRunAt: latest([...mine, ...outside]),
      spentUsd: dollars(spend([...mine, ...(byCaller.get(entry.name) ?? [])])),
      uses: entry.manifest.uses,
      perDay: days.map((day) => {
        const [runs, calls] = [runsOn.get(day) ?? [], callsOn.get(day) ?? []];
        return { day, runs: runs.length, failed: failures(runs), atomCalls: calls.length, atomFailed: failures(calls) };
      }),
    };
  };

  return {
    days,
    home: home(),
    log: { lines: records?.length ?? null, unreadable: log?.bad.length ?? null, firstUnreadable: log?.bad[0]?.line ?? null },
    calls: { runs: calls.length, failed: failures(calls) },
    budget: { capUsd, spentTodayUsd: log && !log.bad.length ? dollars(spend(today(records))) : null },
    tools: tools.map(row),
    atoms: all.filter((e) => e.type === 'atom').map(row),
    external: external(registry.root, problems),
    problems,
  };
}

import { join } from 'node:path';
import { health } from './doctor.mjs';
import { ledger, ledgerPath, linkedTo } from './links.mjs';
import { readJson } from './manifest.mjs';
import { budget, home, lastDays, read, spend, today } from './runs.mjs';

const WINDOW = 7;
const dollars = (usd) => Math.round(usd * 1e6) / 1e6;

function median(values) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  const records = attempt(problems, join(home(), 'runs.jsonl'), read, null);
  const links = attempt(problems, ledgerPath(), ledger, []);
  const checked = new Map(health(registry.entries).map((r) => [r.name, r]));
  const capUsd = attempt(problems, 'TOOL_FACTORY_BUDGET_USD', budget, null);

  const all = [...registry.entries.values()];
  const tools = all.filter((e) => e.type === 'tool').sort((a, b) => b.manifest.uses.length - a.manifest.uses.length || a.name.localeCompare(b.name));
  const toolNames = new Set(tools.map((t) => t.name));
  const window = (records ?? []).filter((r) => days.includes(r.startedAt?.slice(0, 10)));
  const byName = Map.groupBy(window, (r) => r.name);
  const byCaller = Map.groupBy(window.filter((r) => toolNames.has(r.caller)), (r) => r.caller);
  const calls = window.filter((r) => !toolNames.has(r.caller));

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
      failed: mine.filter((r) => !r.ok).length,
      medianMs: median(mine.filter((r) => r.ok && Number.isFinite(r.ms)).map((r) => r.ms)),
      lastRunAt: mine.reduce((last, r) => (r.startedAt > last ? r.startedAt : last), '') || null,
      links: links.filter((l) => l.name === entry.name).map((l) => ({ socket: l.socket, where: linkedTo(l) })),
    };
    if (entry.type === 'atom') {
      return { ...shared, spentUsd: dollars(spend(mine)), usedBy: tools.filter((t) => t.manifest.uses.includes(entry.name)).map((t) => t.name) };
    }
    const perDay = Map.groupBy(mine, (r) => r.startedAt.slice(0, 10));
    return {
      ...shared,
      spentUsd: dollars(spend([...mine, ...(byCaller.get(entry.name) ?? [])])),
      uses: entry.manifest.uses,
      perDay: days.map((day) => ({ day, runs: perDay.get(day)?.length ?? 0, failed: perDay.get(day)?.filter((r) => !r.ok).length ?? 0 })),
    };
  };

  return {
    days,
    home: home(),
    logLines: records?.length ?? null,
    calls: { runs: calls.length, failed: calls.filter((r) => !r.ok).length },
    budget: { capUsd, spentTodayUsd: records && dollars(spend(today(records))) },
    tools: tools.map(row),
    atoms: all.filter((e) => e.type === 'atom').map(row),
    external: external(registry.root, problems),
    problems,
  };
}

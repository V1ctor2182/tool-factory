import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { doctor } from './doctor.mjs';
import { ledger } from './links.mjs';
import { budget, home, lastDays, median, read, spend } from './runs.mjs';

const WINDOW = 7;
const dollars = (usd) => Math.round(usd * 1e6) / 1e6;

function external(root, problems) {
  const path = join(root, 'external.json');
  let list;
  try {
    list = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') problems.push({ path: 'external.json', message: e.message });
    return [];
  }
  const fields = ['name', 'description', 'where'];
  const good = Array.isArray(list) ? list.filter((t) => fields.every((f) => typeof t?.[f] === 'string')) : [];
  if (!Array.isArray(list) || good.length < list.length) problems.push({ path: 'external.json', message: `every entry needs ${fields.join(', ')} as strings` });
  return good.map((t) => Object.fromEntries(fields.map((f) => [f, t[f]])));
}

function attempt(problems, path, work, fallback) {
  try {
    return work();
  } catch (e) {
    problems.push({ path, message: e.message });
    return fallback;
  }
}

export function statusModel(registry) {
  const problems = [...registry.problems];
  const days = lastDays(WINDOW);
  const window = new Set(days);
  const records = attempt(problems, join(home(), 'runs.jsonl'), read, null);
  const links = attempt(problems, join(home(), 'links.json'), ledger, []);
  const health = new Map(doctor(registry.entries).map((r) => [r.name, r]));
  const capUsd = attempt(problems, 'TOOL_FACTORY_BUDGET_USD', budget, null);

  const all = [...registry.entries.values()];
  const tools = all.filter((e) => e.type === 'tool').sort((a, b) => b.manifest.uses.length - a.manifest.uses.length || a.name.localeCompare(b.name));
  const toolNames = new Set(tools.map((t) => t.name));
  const calls = { runs: 0, failed: 0 };
  const byName = new Map();
  const byCaller = new Map();
  const file = (map, key, r) => (map.get(key) ?? map.set(key, []).get(key)).push(r);
  for (const r of records ?? []) {
    if (!window.has(r.startedAt?.slice(0, 10))) continue;
    file(byName, r.name, r);
    if (toolNames.has(r.caller)) {
      file(byCaller, r.caller, r);
    } else {
      calls.runs += 1;
      calls.failed += r.ok ? 0 : 1;
    }
  }

  const row = (entry) => {
    const mine = byName.get(entry.name) ?? [];
    const checked = health.get(entry.name);
    return {
      name: entry.name,
      type: entry.type,
      kind: entry.kind,
      status: entry.manifest.status,
      description: entry.manifest.description,
      health: checked.status,
      notes: checked.notes,
      ...(entry.type === 'tool'
        ? { uses: entry.manifest.uses }
        : { usedBy: tools.filter((t) => t.manifest.uses.includes(entry.name)).map((t) => t.name) }),
      runs: mine.length,
      failed: mine.filter((r) => !r.ok).length,
      medianMs: median(mine.filter((r) => r.ok && Number.isFinite(r.ms)).map((r) => r.ms)),
      lastRunAt: mine.reduce((last, r) => (r.startedAt > last ? r.startedAt : last), '') || null,
      perDay: days.map((day) => {
        const on = mine.filter((r) => r.startedAt.startsWith(day));
        return { day, runs: on.length, failed: on.filter((r) => !r.ok).length };
      }),
      spentUsd: dollars(spend(entry.type === 'tool' ? [...mine, ...(byCaller.get(entry.name) ?? [])] : mine)),
      links: links.filter((l) => l.name === entry.name).map((l) => ({ socket: l.socket, where: l.socket === 'into' ? dirname(dirname(dirname(l.path))) : l.path })),
    };
  };

  const today = days.at(-1);
  return {
    day: today,
    days,
    home: home(),
    logLines: records?.length ?? null,
    calls,
    budget: { capUsd, spentTodayUsd: records && dollars(spend(records.filter((r) => r.startedAt?.startsWith(today)))) },
    tools: tools.map(row),
    atoms: all.filter((e) => e.type === 'atom').map(row),
    external: external(registry.root, problems),
    problems,
  };
}

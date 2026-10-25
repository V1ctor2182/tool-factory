#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { doctor } from '../lib/doctor.mjs';
import { ledger, link, SOCKETS, unlink } from '../lib/links.mjs';
import { serve } from '../lib/mcp.mjs';
import { load } from '../lib/registry.mjs';
import { check } from '../lib/rules.mjs';
import { invoke, read, today } from '../lib/runs.mjs';
import { existsSync } from 'node:fs';

class UsageError extends Error {}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

function ordered(registry) {
  const all = [...registry.entries.values()];
  return [...all.filter((e) => e.type === 'tool'), ...all.filter((e) => e.type === 'atom')];
}

function pick(registry, names) {
  if (!names.length) throw new UsageError('Name at least one tool or atom.');
  return names.map((name) => {
    const entry = registry.entries.get(name);
    if (!entry) throw new UsageError(`No tool or atom is named ${name}. Run factory list.`);
    return entry;
  });
}

function reportProblems(registry) {
  for (const { path, message } of registry.problems) console.error(`invalid ${path}: ${message}`);
  return registry.problems.length ? 1 : 0;
}

function socketOf(args) {
  const found = Object.keys(SOCKETS).filter((s) => args.includes(`--${s}`));
  if (found.length > 1) throw new UsageError(`Pick one of --into, --global, or --bin, not ${found.join(' and ')}.`);
  const socket = found[0];
  const project = socket === 'into' ? args[args.indexOf('--into') + 1] : undefined;
  if (socket === 'into' && (!project || project.startsWith('--'))) throw new UsageError('--into needs a project folder.');
  const names = args.filter((a, i) => !a.startsWith('--') && !(socket === 'into' && args[i - 1] === '--into'));
  return { socket, project, names };
}

function runScript(entry) {
  const started = performance.now();
  return new Promise((done) => {
    const child = spawn('sh', [join(entry.dir, 'test', 'test.sh')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('close', (code) => done({ entry, ok: code === 0, output, sec: (performance.now() - started) / 1000 }));
  });
}

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      results.push(await work(item));
    }
  });
  await Promise.all(lanes);
  return results;
}

const COMMANDS = {
  list(registry) {
    const rows = ordered(registry).map((e) => [e.name, e.type, e.kind, e.manifest.status, e.manifest.uses?.join(' ') ?? '']);
    console.log(table([['name', 'type', 'kind', 'status', 'uses'], ...rows]));
    return reportProblems(registry);
  },

  status(registry) {
    const runs = read().filter((r) => r.startedAt?.startsWith(today()));
    const links = ledger();
    const rows = ordered(registry).map((e) => {
      const mine = runs.filter((r) => r.name === e.name);
      const spent = mine.reduce((sum, r) => sum + (r.costUsd || 0), 0);
      return [e.name, mine.length, mine.filter((r) => !r.ok).length, `$${spent.toFixed(4)}`, mine.at(-1)?.startedAt ?? '', links.filter((l) => l.name === e.name).map((l) => l.socket).join(' ')];
    });
    console.log(table([['name', 'runs today', 'failed', 'spent', 'last run', 'links'], ...rows]));
    return reportProblems(registry);
  },

  doctor(registry) {
    const rows = doctor(registry.entries);
    console.log(table(rows.map((r) => [r.status, r.name, r.notes.join('. ')])));
    return Math.max(reportProblems(registry), rows.some((r) => r.status === 'red') ? 1 : 0);
  },

  async test(registry, args) {
    const failures = check(registry);
    for (const f of failures) console.log(`FAIL rule ${f.rule}: ${f.message}`);
    if (!failures.length) console.log('PASS rules');
    if (args.includes('--rules')) return failures.length ? 1 : 0;
    const names = args.filter((a) => !a.startsWith('--'));
    const entries = (names.length ? pick(registry, names) : ordered(registry)).filter((e) => existsSync(join(e.dir, 'test', 'test.sh')));
    const results = await pool(entries, Math.max(2, Math.floor(availableParallelism() / 2)), async (entry) => {
      const result = await runScript(entry);
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${entry.rel}/test/test.sh in ${result.sec.toFixed(1)} s`);
      if (!result.ok) console.log(result.output.trimEnd().split('\n').slice(-15).map((l) => `  ${l}`).join('\n'));
      return result;
    });
    return failures.length || results.some((r) => !r.ok) ? 1 : 0;
  },

  async run(registry, args) {
    const [entry] = pick(registry, args.slice(0, 1));
    if (!entry.entry) throw new UsageError(`${entry.name} is a skill and has no CLI.`);
    const rest = args.slice(1);
    const verbs = entry.manifest.verbs;
    const verb = verbs.find((v) => v.name === rest[0]) ?? (verbs.length === 1 ? verbs[0] : null);
    const { code } = await invoke(entry, verb, rest, process.env.TOOL_FACTORY_CALLER || 'factory', { interactive: true });
    return code;
  },

  link(registry, args) {
    const { socket, project, names } = socketOf(args);
    if (!socket) throw new UsageError('Pass --into <project>, --global, or --bin.');
    for (const entry of pick(registry, names)) {
      if (socket === 'bin' && !entry.entry) throw new UsageError(`${entry.name} is a skill and has no CLI to put on PATH.`);
      const l = link(entry, socket, project);
      console.log(`linked ${l.path} -> ${l.target}`);
    }
    return 0;
  },

  unlink(registry, args) {
    const { socket, project, names } = socketOf(args);
    for (const entry of pick(registry, names)) {
      const gone = unlink(entry, socket, project);
      if (!gone.length) console.log(`${entry.name} had no matching link`);
      for (const l of gone) console.log(`unlinked ${l.path}`);
    }
    return 0;
  },

  async mcp(registry, args) {
    const entries = pick(registry, args);
    const closed = entries.filter((e) => !e.manifest.adapters.includes('mcp') || !e.entry);
    if (closed.length) throw new UsageError(`${closed.map((e) => e.name).join(', ')} does not offer the mcp adapter.`);
    await serve(entries);
    return 0;
  },
};

const USAGE = `usage: factory <command>
  list                      every tool and atom with its type and kind
  status                    runs, failures, spend, and links today
  doctor                    binaries, secrets, and budget
  test [names...] [--rules] the rules, then every test/test.sh
  run <name> [args...]      run a CLI and log the call
  link <names...> --into <project> | --global | --bin
  unlink <names...> [--into <project> | --global | --bin]
  mcp <names...>            stdio MCP server with one tool per verb`;

const [command, ...args] = process.argv.slice(2);
try {
  if (!COMMANDS[command]) throw new UsageError(command ? `Unknown command ${command}.` : 'Name a command.');
  process.exitCode = await COMMANDS[command](load(), args);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`factory: ${e.message}\n${USAGE}`);
  process.exitCode = 2;
}

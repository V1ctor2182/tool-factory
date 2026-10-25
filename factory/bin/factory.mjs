#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { doctor } from '../lib/doctor.mjs';
import { ledger, link, SOCKETS, unlink } from '../lib/links.mjs';
import { serve } from '../lib/mcp.mjs';
import { load } from '../lib/registry.mjs';
import { check } from '../lib/rules.mjs';
import { invoke, spend, today } from '../lib/runs.mjs';

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

function options(args, extra = {}) {
  try {
    return parseArgs({ args, allowPositionals: true, options: extra });
  } catch (e) {
    throw new UsageError(e.message);
  }
}

function socketOf(args) {
  const { values, positionals } = options(args, { into: { type: 'string' }, global: { type: 'boolean' }, bin: { type: 'boolean' } });
  const found = Object.keys(SOCKETS).filter((s) => values[s] !== undefined);
  if (found.length > 1) throw new UsageError(`Pick one of --into, --global, or --bin, not ${found.join(' and ')}.`);
  return { socket: found[0], project: values.into, names: positionals };
}

function runCheck({ label, argv }) {
  const started = performance.now();
  return new Promise((done) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('close', (code) => done({ label, ok: code === 0, output, sec: (performance.now() - started) / 1000 }));
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
    const runs = today();
    const links = ledger();
    const rows = ordered(registry).map((e) => {
      const mine = runs.filter((r) => r.name === e.name);
      return [e.name, mine.length, mine.filter((r) => !r.ok).length, `$${spend(mine).toFixed(4)}`, mine.at(-1)?.startedAt ?? '', links.filter((l) => l.name === e.name).map((l) => l.socket).join(' ')];
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
    const { values, positionals } = options(args, { rules: { type: 'boolean' } });
    const failures = check(registry);
    for (const f of failures) console.log(`FAIL rule ${f.rule}: ${f.message}`);
    if (failures.length) {
      if (!values.rules) console.log('SKIP test scripts, since a rule failed');
      return 1;
    }
    console.log('PASS rules');
    if (values.rules) return 0;
    const checks = (positionals.length ? pick(registry, positionals) : ordered(registry))
      .filter((e) => existsSync(join(e.dir, 'test', 'test.sh')))
      .map((e) => ({ label: `${e.rel}/test/test.sh`, argv: ['sh', join(e.dir, 'test', 'test.sh')] }));
    if (!positionals.length) checks.unshift({ label: 'factory/test', argv: [process.execPath, '--test', join(registry.root, 'factory', 'test')] });
    const results = await pool(checks, Math.max(2, Math.floor(availableParallelism() / 2)), async (item) => {
      const result = await runCheck(item);
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label} in ${result.sec.toFixed(1)} s`);
      if (!result.ok) console.log(result.output.trimEnd().split('\n').slice(-15).map((l) => `  ${l}`).join('\n'));
      return result;
    });
    return results.some((r) => !r.ok) ? 1 : 0;
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
  test [names...] [--rules] the rules, then factory/test and every test/test.sh
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

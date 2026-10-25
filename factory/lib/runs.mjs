import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function home() {
  const raw = process.env.TOOL_FACTORY_HOME || join(homedir(), '.local', 'share', 'tool-factory');
  return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}

export function append(record) {
  mkdirSync(home(), { recursive: true });
  appendFileSync(join(home(), 'runs.jsonl'), `${JSON.stringify(record)}\n`);
}

export function read() {
  const path = join(home(), 'runs.jsonl');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      throw new Error(`${path} line ${i + 1} is not JSON, so today's spend is unknown`);
    }
  });
}

function parseLines(text) {
  return text.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

export function today(records = read()) {
  const day = new Date().toISOString().slice(0, 10);
  return records.filter((r) => r.startedAt?.startsWith(day));
}

export function spend(records) {
  return records.reduce((sum, r) => sum + (r.costUsd || 0), 0);
}

export function spentToday() {
  return spend(today());
}

const DECIMAL = /^[+-]?(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/;

export function budget() {
  const raw = process.env.TOOL_FACTORY_BUDGET_USD ?? '3';
  const text = raw.trim();
  const value = DECIMAL.test(text) ? Number(text.replaceAll('_', '')) : NaN;
  if (!(value >= 0 && value < Infinity)) throw new Error(`TOOL_FACTORY_BUDGET_USD is not a finite number of dollars, 0 or more: ${raw}`);
  return value;
}

function stamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function outcome(code, stdout) {
  const objects = parseLines(stdout);
  const failed = objects.find((o) => o?.error);
  return {
    ok: code === 0 && !failed,
    cacheHit: objects.length > 0 && objects.every((o) => o?.cacheHit === true),
    ...(failed && { error: failed.error.code }),
  };
}

export function invoke(entry, verb, args, caller, { interactive = false } = {}) {
  const started = new Date();
  const clock = performance.now();
  return new Promise((done) => {
    const child = spawn(entry.entry, args, {
      env: { ...process.env, TOOL_FACTORY_CALLER: caller },
      stdio: [interactive ? 'inherit' : 'ignore', 'pipe', interactive ? 'inherit' : 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (interactive) process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    const finish = (code) => {
      if (entry.type === 'tool') {
        append({
          type: 'tool',
          name: entry.name,
          verb: verb?.name ?? null,
          kind: entry.kind,
          startedAt: stamp(started),
          ms: Math.round(performance.now() - clock),
          ...outcome(code, stdout),
          caller,
        });
      }
      done({ code, stdout, stderr });
    };
    child.on('error', (e) => (stderr += `${entry.entry}: ${e.message}\n`));
    child.on('close', (code) => finish(Number.isInteger(code) && code >= 0 ? code : 1));
  });
}

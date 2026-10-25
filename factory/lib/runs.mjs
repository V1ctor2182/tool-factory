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
  let text;
  try {
    text = readFileSync(join(home(), 'runs.jsonl'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return text.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function spentToday(records = read()) {
  return records.filter((r) => r.startedAt?.startsWith(today())).reduce((sum, r) => sum + (r.costUsd || 0), 0);
}

export function budget() {
  const raw = process.env.TOOL_FACTORY_BUDGET_USD ?? '3';
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new Error(`TOOL_FACTORY_BUDGET_USD is not a number of dollars at or above 0: ${raw}`);
  }
  return value;
}

function stamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function outcome(code, stdout) {
  const objects = stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
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
          costUsd: null,
          caller,
        });
      }
      done({ code, stdout, stderr });
    };
    child.on('error', (e) => (stderr += `${entry.entry}: ${e.message}\n`));
    child.on('close', (code) => finish(code > 0 ? code : code === 0 ? 0 : 1));
  });
}

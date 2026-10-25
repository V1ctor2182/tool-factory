import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { RUNTIMES } from './registry.mjs';
import { budget, spentToday } from './runs.mjs';

function which(bin) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return join(dir, bin);
    } catch {}
  }
  return null;
}

function version(path) {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.match(/\d+(?:\.\d+)*/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function atLeast(found, wanted) {
  const a = found.split('.').map(Number);
  const b = wanted.split('.').map(Number);
  for (let i = 0; i < b.length; i++) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  return true;
}

function binProblem(spec) {
  const [bin, wanted] = spec.split('>=');
  const path = which(bin);
  if (!path) return `${bin} is not on PATH`;
  if (!wanted) return null;
  const found = version(path);
  if (!found) return `${bin} did not print a version, and ${spec} needs one`;
  return atLeast(found, wanted) ? null : `${bin} is ${found}, and ${spec} needs ${wanted} or later`;
}

function secretProblem(name) {
  if (process.env[name]) return null;
  try {
    execFileSync('security', ['find-generic-password', '-s', 'tool-factory', '-a', name], { stdio: 'ignore', timeout: 5000 });
    return null;
  } catch {
    return `secret ${name} is in neither the environment nor the keychain service tool-factory`;
  }
}

function ownProblems(entry) {
  const { needs, runtime } = entry.manifest;
  return [
    ...(runtime ? [binProblem(RUNTIMES[runtime])] : []),
    ...needs.bin.map(binProblem),
    ...needs.secrets.map(secretProblem),
  ].filter(Boolean);
}

export function doctor(entries) {
  const own = new Map([...entries.values()].map((entry) => [entry.name, ownProblems(entry)]));
  const rows = [...entries.values()].map((entry) => {
    const problems = own.get(entry.name);
    const red = (entry.manifest.uses ?? []).filter((name) => own.get(name)?.length);
    const notes = [...problems, ...red.map((name) => `uses ${name}, which is red`)];
    if (entry.manifest.needs.models?.length) notes.push(`downloads on first use: ${entry.manifest.needs.models.join('; ')}`);
    if (entry.manifest.needs.paid.length) notes.push(`paid: ${entry.manifest.needs.paid.join(', ')}`);
    return { name: entry.name, status: problems.length ? 'red' : red.length ? 'warn' : 'ok', notes };
  });
  let spend;
  try {
    const cap = budget();
    const spent = spentToday();
    spend = { name: 'budget', status: spent >= cap ? 'red' : 'ok', notes: [`spent $${spent.toFixed(4)} of the $${cap.toFixed(2)} daily cap today`] };
  } catch (e) {
    spend = { name: 'budget', status: 'red', notes: [e.message] };
  }
  return [...rows, spend];
}

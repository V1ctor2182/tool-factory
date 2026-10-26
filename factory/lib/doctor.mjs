import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
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

function probe(spec) {
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

function hubCache() {
  const env = process.env;
  return env.HF_HUB_CACHE || env.HUGGINGFACE_HUB_CACHE || join(env.HF_HOME || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'huggingface'), 'hub');
}

function cached(spec) {
  const [, repo, file] = spec.match(/^huggingface\.co\/([\w.-]+\/[\w.-]+) ([\w.-]+)$/) ?? [];
  if (!repo) return null;
  const snapshots = join(hubCache(), `models--${repo.replace('/', '--')}`, 'snapshots');
  return existsSync(snapshots) && readdirSync(snapshots).some((rev) => existsSync(join(snapshots, rev, file)));
}

function ownProblems(entry, probed) {
  const { needs, runtime } = entry.manifest;
  const binProblem = (spec) => {
    if (!probed.has(spec)) probed.set(spec, probe(spec));
    return probed.get(spec);
  };
  return [
    ...(runtime ? [binProblem(runtime)] : []),
    ...needs.bin.map(binProblem),
    ...needs.secrets.map(secretProblem),
  ].filter(Boolean);
}

export function health(entries) {
  const probed = new Map();
  const own = new Map([...entries.values()].map((entry) => [entry.name, ownProblems(entry, probed)]));
  return [...entries.values()].map((entry) => {
    const problems = own.get(entry.name);
    const red = (entry.manifest.uses ?? []).filter((name) => own.get(name)?.length);
    const models = (entry.manifest.needs.models ?? []).map((spec) => ({ spec, cached: cached(spec) }));
    const missing = models.filter((m) => m.cached === false);
    const notes = [
      ...problems,
      ...red.map((name) => `uses ${name}, which is red`),
      ...missing.map((m) => `${m.spec} is not in the Hugging Face cache, so it downloads on first use`),
      ...models.filter((m) => m.cached === null).map((m) => `downloads on first use: ${m.spec}`),
    ];
    if (entry.manifest.needs.paid.length) notes.push(`paid: ${entry.manifest.needs.paid.join(', ')}`);
    return { name: entry.name, status: problems.length ? 'red' : red.length || missing.length ? 'warn' : 'ok', notes };
  });
}

export function doctor(entries) {
  let spend;
  try {
    const cap = budget();
    const spent = spentToday();
    spend = { name: 'budget', status: spent >= cap ? 'red' : 'ok', notes: [`spent $${spent.toFixed(4)} of the $${cap.toFixed(2)} daily cap today`] };
  } catch (e) {
    spend = { name: 'budget', status: 'red', notes: [e.message] };
  }
  return [...health(entries), spend];
}

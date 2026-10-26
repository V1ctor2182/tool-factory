import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { home } from './runs.mjs';

export const SOCKETS = {
  into: (entry, project) => ({ path: join(resolve(project), '.claude', 'skills', entry.name), target: entry.dir }),
  global: (entry) => ({ path: join(process.env.FACTORY_SKILLS_DIR || join(homedir(), '.claude', 'skills'), entry.name), target: entry.dir }),
  bin: (entry) => ({ path: join(process.env.FACTORY_BIN_DIR || join(homedir(), '.local', 'bin'), entry.name), target: entry.entry }),
};

export const ledgerPath = () => join(home(), 'links.json');

export function linkedTo(record) {
  return record.socket === 'into' ? resolve(record.path, '..', '..', '..') : record.path;
}

export function ledger() {
  let links;
  try {
    links = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  if (!Array.isArray(links) || !links.every((l) => typeof l?.name === 'string' && typeof l.path === 'string')) {
    throw new Error(`${ledgerPath()} is not a JSON array of links with a name and a path, so the links are unknown`);
  }
  return links;
}

function save(links) {
  mkdirSync(home(), { recursive: true });
  const tmp = `${ledgerPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(links, null, 2)}\n`);
  renameSync(tmp, ledgerPath());
}

function current(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : 'not a symlink';
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function link(entry, socket, project) {
  const links = ledger();
  const { path, target } = SOCKETS[socket](entry, project);
  const found = current(path);
  if (found !== null && found !== target) throw new Error(`${path} already exists and is not a link to ${target}`);
  if (found === null) {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path);
  }
  const record = { name: entry.name, socket, path, target, linkedAt: new Date().toISOString() };
  save([...links.filter((l) => l.path !== path), record]);
  return record;
}

export function unlink(entry, socket, project) {
  const links = ledger();
  const path = socket && SOCKETS[socket](entry, project).path;
  const gone = links.filter((l) => l.name === entry.name && (!socket || l.path === path));
  for (const l of gone) if (current(l.path) === l.target) rmSync(l.path);
  save(links.filter((l) => !gone.includes(l)));
  return gone;
}

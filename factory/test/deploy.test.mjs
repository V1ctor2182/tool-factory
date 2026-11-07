import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { REPO } from './repo.mjs';

const SCRIPT = 'factory/bin/deploy-flows.mjs';
const FAKE_RAILWAY = `#!/bin/sh
echo "$(pwd) $1" >> "$RAILWAY_LOG"
[ "$1" = deployment ] && echo '[{"status":"FAILED"}]'
exit 0
`;

let base;
let work;
let log;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function deploy(cwd) {
  writeFileSync(log, '');
  const env = { ...process.env, PATH: `${join(base, 'bin')}:${process.env.PATH}`, RAILWAY_LOG: log };
  const { status, stderr } = spawnSync(process.execPath, [join(cwd, SCRIPT)], { cwd, env, encoding: 'utf8' });
  return { status, stderr, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

function commitToOrigin(file) {
  const other = join(base, 'other');
  if (!existsSync(other)) git(base, 'clone', '-q', join(base, 'origin.git'), other);
  git(other, 'pull', '-q');
  writeFileSync(join(other, file), file);
  git(other, 'add', file);
  git(other, 'commit', '-qm', file);
  git(other, 'push', '-q', 'origin', 'main');
}

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-test-')));
  log = join(base, 'railway.log');
  work = join(base, 'work');
  mkdirSync(join(base, 'bin'));
  writeFileSync(join(base, 'bin', 'railway'), FAKE_RAILWAY);
  chmodSync(join(base, 'bin', 'railway'), 0o755);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(base, 'origin.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  mkdirSync(dirname(join(work, SCRIPT)), { recursive: true });
  cpSync(join(REPO, SCRIPT), join(work, SCRIPT));
  writeFileSync(join(work, 'Dockerfile'), 'FROM node\nCOPY served.txt /app/served.txt\n');
  writeFileSync(join(work, '.dockerignore'), '*\n');
  writeFileSync(join(work, 'served.txt'), 'served\n');
  git(work, 'remote', 'add', 'origin', join(base, 'origin.git'));
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'first');
  git(work, 'push', '-q', '-u', 'origin', 'main');
});

beforeEach(() => {
  git(work, 'reset', '-q', '--hard');
  git(work, 'clean', '-fdq');
  git(work, 'checkout', '-q', 'main');
  git(work, 'pull', '-q');
});

after(() => rmSync(base, { recursive: true, force: true }));

test('a branch without the latest origin/main never reaches Railway, even when its local ref is stale', () => {
  git(work, 'checkout', '-q', '-b', 'behind');
  commitToOrigin('merged.txt');
  const { status, stderr, calls } = deploy(work);
  assert.equal(status, 1);
  assert.match(stderr, /lacks origin\/main/);
  assert.deepEqual(calls, []);
});

test('an uncommitted image file never reaches Railway', () => {
  writeFileSync(join(work, 'served.txt'), 'edited\n');
  const { status, stderr, calls } = deploy(work);
  assert.equal(status, 1);
  assert.match(stderr, /commit these image files first\n.*served\.txt/);
  assert.deepEqual(calls, []);
});

test('an unrelated uncommitted file does not block a deploy', () => {
  writeFileSync(join(work, 'notes.txt'), 'scratch\n');
  const { calls } = deploy(work);
  assert.equal(calls[0], `${work} up`);
});

test('a linked worktree at origin/main uploads through the primary checkout', () => {
  const linked = join(base, 'linked');
  git(work, 'worktree', 'add', '-q', '--detach', linked, 'origin/main');
  const { calls } = deploy(linked);
  git(work, 'worktree', 'remove', '--force', linked);
  assert.deepEqual(calls, [`${work} up`, `${work} deployment`]);
});

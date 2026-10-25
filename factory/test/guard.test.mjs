import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { copyRepo, manifest, REPO } from './repo.mjs';

const dirs = [];
const CAP = 'model spend today is $3.0000, at the $3.00 daily cap. To raise the cap, export TOOL_FACTORY_BUDGET_USD in the shell that starts Claude Code, or wait for the next UTC day.';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'factory-guard-'));
  dirs.push(dir);
  return dir;
}

function home(lines) {
  const dir = scratch();
  writeFileSync(join(dir, 'runs.jsonl'), lines.map((l) => `${l}\n`).join(''));
  return dir;
}

const spent = (usd) => JSON.stringify({ type: 'atom', name: 'digest', startedAt: new Date().toISOString(), costUsd: usd });

function guard(command, { root = REPO, data = home([]), budget } = {}) {
  const env = { ...process.env, TOOL_FACTORY_HOME: data };
  if (budget === undefined) delete env.TOOL_FACTORY_BUDGET_USD;
  else env.TOOL_FACTORY_BUDGET_USD = budget;
  const done = spawnSync('node', [join(root, 'factory', 'hooks', 'guard.mjs')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env,
  });
  return { code: done.status, stdout: done.stdout.trim(), stderr: done.stderr.trim() };
}

after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const atCap = [
  ['a bare call', 'digest make x', 'digest'],
  ['a double-quoted entry path', '"atoms/digest/bin/digest" make x', 'digest'],
  ['a single-quoted entry path', "'/x/atoms/see/bin/see' describe a.png", 'see'],
  ['factory run', 'node factory/bin/factory.mjs run digest make x', 'digest'],
];
for (const [what, command, name] of atCap) {
  test(`at the cap, ${what} is blocked`, () => {
    assert.deepEqual(guard(command, { data: home([spent(3)]) }), { code: 2, stdout: '', stderr: `Blocked ${name}: ${CAP}` });
  });
}

test('under the cap, a model atom call passes', () => {
  assert.deepEqual(guard('digest make x', { data: home([spent(1)]) }), { code: 0, stdout: '', stderr: '' });
});

test('a corrupt run log line blocks a model atom call and names the file and line', () => {
  const data = home([spent(1), '{"costUsd": 2']);
  assert.deepEqual(guard('digest make x', { data }), {
    code: 2,
    stdout: '',
    stderr: `Blocked digest: ${join(data, 'runs.jsonl')} line 2 is not JSON, so today's spend is unknown`,
  });
});

const CAPS = ['3', '0.5', ' 2.5 ', '1_000', '1e2', '.5', '5.', '+4', '0x10', '0b1', '0o7', '1__0', '_1', '1_', '1e400', 'inf', 'nan', '-1', '', 'abc', '3 dollars'];

function kitAccepts() {
  const script = `import json, os, sys
from factory_kit.model import _dollars
out = {}
for raw in json.loads(sys.argv[1]):
    os.environ["CAP"] = raw
    try:
        out[raw] = _dollars("CAP", "3") >= 0
    except Exception:
        out[raw] = False
print(json.dumps(out))`;
  const done = spawnSync('uv', ['run', '--quiet', '--project', join(REPO, 'kit', 'py'), 'python', '-c', script, JSON.stringify(CAPS)], { encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  return JSON.parse(done.stdout);
}

test('the hook accepts the same caps as the kit', () => {
  const kit = kitAccepts();
  const hook = Object.fromEntries(CAPS.map((raw) => [raw, !guard('digest make x', { budget: raw }).stderr.includes('is not a finite number of dollars')]));
  assert.deepEqual(hook, kit);
  assert.equal(kit['0x10'], false);
  assert.equal(kit['1_000'], true);
});

function actCopy() {
  const root = copyRepo(scratch());
  manifest(root, 'atoms/find-url', (m) => (m.kind = 'act'));
  return root;
}

test('a call to an act atom asks for confirmation, directly or through factory run', () => {
  const root = actCopy();
  const ask = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'find-url is an act atom, so every run needs your confirmation.' },
  });
  for (const command of ['atoms/find-url/bin/find-url search cats --json', 'node factory/bin/factory.mjs run find-url search cats']) {
    assert.deepEqual(guard(command, { root }), { code: 0, stdout: ask, stderr: '' });
  }
  assert.deepEqual(guard('ls atoms/find-url', { root }), { code: 0, stdout: '', stderr: '' });
});

test('the same call passes without a question while find-url is an observe atom', () => {
  assert.deepEqual(guard('atoms/find-url/bin/find-url search cats --json'), { code: 0, stdout: '', stderr: '' });
});

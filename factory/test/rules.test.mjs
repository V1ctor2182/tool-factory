import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const REPO = resolve(import.meta.dirname, '..', '..');
const copies = [];

function copy() {
  const root = mkdtempSync(join(tmpdir(), 'factory-rules-'));
  copies.push(root);
  for (const dir of ['atoms', 'tools', 'contracts', 'kit', 'factory']) {
    cpSync(join(REPO, dir), join(root, dir), { recursive: true, filter: (src) => !src.includes('__pycache__') });
  }
  return root;
}

function rules(root) {
  const done = spawnSync('node', [join(root, 'factory', 'bin', 'factory.mjs'), 'test', '--rules'], {
    encoding: 'utf8',
    env: { ...process.env, TOOL_FACTORY_HOME: join(root, 'home') },
  });
  return { code: done.status, lines: done.stdout.trim().split('\n') };
}

function edit(path, change) {
  writeFileSync(path, change(readFileSync(path, 'utf8')));
}

after(() => copies.forEach((root) => rmSync(root, { recursive: true, force: true })));

test('the repo as it stands passes every rule', () => {
  assert.deepEqual(rules(copy()), { code: 0, lines: ['PASS rules'] });
});

test('an atom that imports another atom fails atoms-import-only-kit', () => {
  const root = copy();
  edit(join(root, 'atoms/digest/src/digest.py'), (text) => text.replace('import hashlib\n', 'import hashlib\nimport captions\n'));
  const line = readFileSync(join(root, 'atoms/digest/src/digest.py'), 'utf8').split('\n').indexOf('import captions') + 1;
  assert.deepEqual(rules(root), {
    code: 1,
    lines: [`FAIL rule atoms-import-only-kit: atoms/digest/src/digest.py:${line}: atom digest imports atom captions. Atoms import the kit, never each other.`],
  });
});

test('an atom that runs a binary its manifest leaves out fails declare-binaries', () => {
  const root = copy();
  edit(join(root, 'atoms/frames/manifest.json'), (text) => text.replace('"bin": ["ffmpeg"]', '"bin": []'));
  const result = rules(root);
  assert.equal(result.code, 1);
  assert.equal(result.lines.length, 1);
  assert.match(
    result.lines[0],
    /^FAIL rule declare-binaries: atoms\/frames\/src\/frames\.py:\d+: frames runs ffmpeg, which needs\.bin in atoms\/frames\/manifest\.json does not declare\.$/,
  );
});

test('an observe atom that caches fails kind-decides-caching', () => {
  const root = copy();
  edit(join(root, 'atoms/find-url/src/find-url.py'), (text) => `${text}\n_unused = Cache("find-url")\n`);
  const result = rules(root);
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /FAIL rule kind-decides-caching: atoms\/find-url\/src\/find-url\.py:\d+: find-url is an observe atom, which is never cached, but it builds a Cache\./);
});

test('a tool that calls an atom outside its uses fails tools-call-only-uses', () => {
  const root = copy();
  edit(join(root, 'tools/youtube/manifest.json'), (text) => text.replace('"frames", ', ''));
  const result = rules(root);
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /FAIL rule tools-call-only-uses: tools\/youtube\/run:\d+: tool youtube calls atom frames, which its uses does not list\./);
});

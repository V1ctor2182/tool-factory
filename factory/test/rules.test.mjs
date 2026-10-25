import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { copyRepo, manifest } from './repo.mjs';

const copies = [];

function copy() {
  const root = mkdtempSync(join(tmpdir(), 'factory-rules-'));
  copies.push(root);
  return copyRepo(root);
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

test('a pipeline tool that uses an act atom fails act-atoms-skill-only', () => {
  const root = copy();
  manifest(root, 'atoms/find-url', (m) => (m.kind = 'act'));
  const result = rules(root);
  assert.equal(result.code, 1);
  for (const line of result.lines) assert.match(line, /^FAIL rule act-atoms-skill-only: tools\/[^/]+\/manifest\.json: /);
  assert.ok(
    result.lines.includes(
      'FAIL rule act-atoms-skill-only: tools/youtube/manifest.json: tool youtube is a pipeline tool, but it uses find-url, an act atom. Only the agent decides what an act atom does, so a tool that acts is a skill tool.',
    ),
    result.lines.join('\n'),
  );
});

test('an atom that runs a sibling CLI by path fails atoms-import-only-kit', () => {
  const root = copy();
  edit(join(root, 'atoms/frames/src/frames.py'), (text) => `${text}\nSIBLING = Path(__file__).resolve().parents[2] / "captions" / "bin" / "captions"\n`);
  const result = rules(root);
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /FAIL rule atoms-import-only-kit: atoms\/frames\/src\/frames\.py:\d+: atom frames calls atom captions\./);
});

test('a free atom that imports the model adapter under an alias fails kind-decides-cost', () => {
  const root = copy();
  edit(join(root, 'atoms/frames/src/frames.py'), (text) => text.replace('import subprocess\n', 'import subprocess\nfrom factory_kit import (\n    model as llm,\n)\n'));
  const result = rules(root);
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /FAIL rule kind-decides-cost: atoms\/frames: frames is a transform atom, which is free, but it imports the kit's model adapter\./);
  assert.match(result.lines.join('\n'), /FAIL rule declare-binaries: kit\/py\/src\/factory_kit\/model\.py:\d+: frames runs claude, which needs\.bin in atoms\/frames\/manifest\.json does not declare\./);
});

function plant(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, `${before}\n${text}\n`);
  return before.split('\n').length + 1;
}

const CROSS = 'Atoms import the kit, never each other.';
const crossAtom = [
  ['a dotted import through the atoms folder', 'atoms/digest/src/digest.py', 'from atoms.captions.src import captions'],
  ['a dotted plain import through the atoms folder', 'atoms/digest/src/digest.py', 'import atoms.captions.src.captions'],
  ['an import after a semicolon', 'atoms/digest/src/digest.py', 'import os; import captions'],
  ['an import inside a one-line if', 'atoms/digest/src/digest.py', 'if True: import captions'],
  ['an import in a nested prompts folder', 'atoms/digest/src/prompts/helper.py', 'import captions'],
  ['an import in a nested test folder', 'atoms/digest/src/test/helper.py', 'import captions'],
];
for (const [what, rel, text] of crossAtom) {
  test(`${what} fails atoms-import-only-kit`, () => {
    const root = copy();
    const line = plant(root, rel, text);
    assert.deepEqual(rules(root), { code: 1, lines: [`FAIL rule atoms-import-only-kit: ${rel}:${line}: atom digest imports atom captions. ${CROSS}`] });
  });
}

test('a shell entry that runs a sibling CLI fails atoms-import-only-kit', () => {
  const root = copy();
  const line = plant(root, 'atoms/digest/bin/digest', '"$(dirname "$self")/../../captions/bin/captions" get x');
  assert.deepEqual(rules(root), { code: 1, lines: [`FAIL rule atoms-import-only-kit: atoms/digest/bin/digest:${line}: atom digest calls atom captions. ${CROSS}`] });
});

test('a tool that names an atom outside its uses in a constant fails tools-call-only-uses', () => {
  const root = copy();
  manifest(root, 'tools/youtube', (m) => m.uses.splice(m.uses.indexOf('see'), 1));
  edit(join(root, 'tools/youtube/run'), (text) => text.replace('atom("see",', 'atom(SEE,').replace('MAX_FRAMES = 8\n', 'MAX_FRAMES = 8\nSEE = "see"\n'));
  const line = readFileSync(join(root, 'tools/youtube/run'), 'utf8').split('\n').indexOf('SEE = "see"') + 1;
  assert.deepEqual(rules(root), { code: 1, lines: [`FAIL rule tools-call-only-uses: tools/youtube/run:${line}: tool youtube calls atom see, which its uses does not list.`] });
});

const undeclared = (rel, line, name, bin) => `FAIL rule declare-binaries: ${rel}:${line}: ${name} runs ${bin}, which needs.bin in atoms/${name}/manifest.json does not declare.`;
const binaryShapes = [
  ['a run imported from subprocess', 'from subprocess import run\nrun(["ffprobe", "-v"])', 1],
  ['subprocess under an alias', 'import subprocess as sp\nsp.run(["ffprobe", "-v"])', 1],
  ['a command list passed with a splat', 'cmd = ["ffprobe", "-v"]\nsubprocess.run([*cmd])', 0],
  ['a command list passed as args=', 'subprocess.run(args=["ffprobe", "-v"])', 0],
];
for (const [what, text, offset] of binaryShapes) {
  test(`${what} fails declare-binaries`, () => {
    const root = copy();
    const line = plant(root, 'atoms/frames/src/frames.py', text) + offset;
    assert.deepEqual(rules(root), { code: 1, lines: [undeclared('atoms/frames/src/frames.py', line, 'frames', 'ffprobe')] });
  });
}

test('a shell entry that runs an undeclared binary fails declare-binaries', () => {
  const root = copy();
  const line = plant(root, 'atoms/frames/bin/frames', 'jq --version >/dev/null');
  assert.deepEqual(rules(root), { code: 1, lines: [undeclared('atoms/frames/bin/frames', line, 'frames', 'jq')] });
});

test('a yt-dlp js_runtimes entry counts as running that runtime', () => {
  const root = copy();
  manifest(root, 'atoms/captions', (m) => (m.needs.bin = []));
  const line = readFileSync(join(root, 'atoms/captions/src/captions.py'), 'utf8').split('\n').findIndex((l) => l.includes('"js_runtimes"')) + 1;
  assert.deepEqual(rules(root), { code: 1, lines: [undeclared('atoms/captions/src/captions.py', line, 'captions', 'node')] });
});

test('a Cache named only in a comment does not count as caching', () => {
  const root = copy();
  edit(join(root, 'atoms/frames/src/frames.py'), (text) => text.replace('cache = Cache("frames")', 'cache = None  # was Cache("frames")'));
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule kind-decides-caching: atoms/frames: frames is a transform atom, cached by content, but no source builds a Cache.'] });
});

test('a free atom that runs the paid backend fails kind-decides-cost', () => {
  const root = copy();
  manifest(root, 'atoms/find-url', (m) => m.needs.bin.push('claude'));
  const line = plant(root, 'atoms/find-url/src/find-url.py', 'import subprocess\nsubprocess.run(["claude", "-p", "hi"])') + 1;
  assert.deepEqual(rules(root), {
    code: 1,
    lines: [
      'FAIL rule kind-decides-cost: atoms/find-url/manifest.json: find-url is an observe atom, which is free, but needs.bin lists the paid backend claude.',
      `FAIL rule kind-decides-cost: atoms/find-url/src/find-url.py:${line}: find-url is an observe atom, which is free, but it runs the paid backend claude.`,
    ],
  });
});

test('an invalid atom manifest reports only the schema error', () => {
  const root = copy();
  manifest(root, 'atoms/frames', (m) => delete m.contract);
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule manifest-matches-schema: atoms/frames/manifest.json: / lacks contract'] });
});

function skillTool(root, files = { 'SKILL.md': '---\nname: style\ndescription: House style.\n---\n' }) {
  const dir = join(root, 'tools/style');
  mkdirSync(dir, { recursive: true });
  const m = { name: 'style', type: 'tool', kind: 'skill', description: 'House style.', status: 'alpha', needs: { bin: [], secrets: [], paid: [] }, adapters: ['skill'] };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, { mode: name === 'run' ? 0o755 : 0o644 });
}

test('a skill tool with SKILL.md and a manifest only passes', () => {
  const root = copy();
  skillTool(root);
  assert.deepEqual(rules(root), { code: 0, lines: ['PASS rules'] });
});

test('a skill tool with a CLI fails manifest-matches-schema', () => {
  const root = copy();
  manifest(root, 'tools/youtube', (m) => {
    m.kind = 'skill';
    delete m.runtime;
  });
  assert.deepEqual(rules(root), {
    code: 1,
    lines: [
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: /uses has more than 0 items',
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: /adapters/0 is not "skill"',
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: /adapters/2 is not "skill"',
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: / must not have entry',
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: / must not have verbs',
      'FAIL rule manifest-matches-schema: tools/youtube/manifest.json: / must not have contract',
    ],
  });
});

test('a skill tool that holds a script fails tool-kind-shape', () => {
  const root = copy();
  skillTool(root, { 'SKILL.md': '---\nname: style\n---\n', run: '#!/bin/sh\necho hi\n' });
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule tool-kind-shape: tools/style/run: style is a skill tool, which holds only manifest.json, SKILL.md, and Markdown.'] });
});

test('a tool without SKILL.md fails tool-kind-shape', () => {
  const root = copy();
  rmSync(join(root, 'tools/youtube/SKILL.md'));
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule tool-kind-shape: tools/youtube: youtube is a pipeline tool, but it has no SKILL.md.'] });
});

test('a pipeline tool with no uses fails manifest-matches-schema', () => {
  const root = copy();
  manifest(root, 'tools/youtube', (m) => (m.uses = []));
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule manifest-matches-schema: tools/youtube/manifest.json: /uses has fewer than 1 items'] });
});

const SHELL_ENTRY = (body) => `#!/bin/sh\nself=$(readlink -f "$0")\n${body}exec uv run --quiet --script "$(dirname "$self")/../src/$(basename "$self").py" "$@"\n`;
const shellForms = [
  ['if, then, and fi', 'if [ -z "$1" ]; then\n  echo usage >&2\nfi\n'],
  ['elif and else', 'if [ "$1" = a ]; then :\nelif [ "$1" = b ]; then :\nelse :\nfi\n'],
  ['case and esac', 'case "$1" in\n  -h) echo usage ;;\nesac\n'],
  ['for, do, and done', 'for a in "$@"; do\n  :\ndone\n'],
  ['while and until', 'while false; do break; done\nuntil true; do continue; done\n'],
];
for (const [what, body] of shellForms) {
  test(`a shell entry that uses ${what} passes declare-binaries`, () => {
    const root = copy();
    writeFileSync(join(root, 'atoms/frames/bin/frames'), SHELL_ENTRY(body), { mode: 0o755 });
    assert.deepEqual(rules(root), { code: 0, lines: ['PASS rules'] });
  });
}

const dataForms = [
  ['a dict key', 'atoms/see/src/see.py', 'NAMES = {"frames": 1}'],
  ['a get call', 'atoms/see/src/see.py', 'def _n(payload):\n    return payload.get("frames")'],
  ['a subscript', 'atoms/see/src/see.py', 'def _n(payload):\n    return payload["frames"]'],
  ['a dict key in a tool', 'tools/youtube/run', 'NAMES = {"transcribe": 1}'],
  ['a get call in a tool', 'tools/youtube/run', 'def _n(payload):\n    return payload.get("transcribe")'],
  ['a subscript in a tool', 'tools/youtube/run', 'def _n(payload):\n    return payload["transcribe"]'],
];
for (const [what, rel, text] of dataForms) {
  test(`an atom name used as ${what} is data and passes`, () => {
    const root = copy();
    if (rel.startsWith('tools/')) {
      manifest(root, 'tools/youtube', (m) => m.uses.splice(m.uses.indexOf('transcribe'), 1));
      edit(join(root, rel), (text) => text.replace('atom("transcribe", "file", media["path"])', '{}'));
    }
    plant(root, rel, text);
    assert.deepEqual(rules(root), { code: 0, lines: ['PASS rules'] });
  });
}

const tupleShapes = [
  ['a tuple command', 'subprocess.run(("ffprobe", "-v"))', 0],
  ['a tuple command variable', 'cmd = ("ffprobe", "-v")\nsubprocess.run(cmd)', 0],
  ['a shlex.split command', 'import shlex\nsubprocess.run(shlex.split("ffprobe -v"))', 1],
];
for (const [what, text, offset] of tupleShapes) {
  test(`${what} fails declare-binaries`, () => {
    const root = copy();
    const line = plant(root, 'atoms/frames/src/frames.py', text) + offset;
    assert.deepEqual(rules(root), { code: 1, lines: [undeclared('atoms/frames/src/frames.py', line, 'frames', 'ffprobe')] });
  });
}

test('a shell command behind an env prefix fails declare-binaries', () => {
  const root = copy();
  const line = plant(root, 'atoms/frames/bin/frames', 'LC_ALL=C jq . >/dev/null');
  assert.deepEqual(rules(root), { code: 1, lines: [undeclared('atoms/frames/bin/frames', line, 'frames', 'jq')] });
});

test('a skill tool that holds a file that is not Markdown fails tool-kind-shape, executable or not', () => {
  const root = copy();
  skillTool(root, { 'SKILL.md': '---\nname: style\n---\n', 'helper.py': 'print(1)\n', 'notes.md': '# Notes\n' });
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule tool-kind-shape: tools/style/helper.py: style is a skill tool, which holds only manifest.json, SKILL.md, and Markdown.'] });
});

test('a skill tool with Markdown references passes', () => {
  const root = copy();
  skillTool(root, { 'SKILL.md': '---\nname: style\n---\n', 'reference.md': '# Reference\n' });
  assert.deepEqual(rules(root), { code: 0, lines: ['PASS rules'] });
});

test('a skill tool with an adapter other than skill fails manifest-matches-schema', () => {
  const root = copy();
  skillTool(root);
  manifest(root, 'tools/style', (m) => (m.adapters = ['skill', 'mcp']));
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule manifest-matches-schema: tools/style/manifest.json: /adapters/1 is not "skill"'] });
});

test('a skill tool with a contract fails manifest-matches-schema', () => {
  const root = copy();
  skillTool(root);
  manifest(root, 'tools/style', (m) => (m.contract = 'digest'));
  assert.deepEqual(rules(root), { code: 1, lines: ['FAIL rule manifest-matches-schema: tools/style/manifest.json: / must not have contract'] });
});

test('a directory symlink loop does not crash the scan', () => {
  const root = copy();
  symlinkSync('.', join(root, 'atoms/digest/src/loop'));
  assert.deepEqual(rules(root), { code: 0, lines: ['PASS rules'] });
});

const wrongKinds = [
  ['an atom kinded pipeline', 'atoms/frames', 'pipeline', '/kind pipeline is not a kind of atom'],
  ['an atom kinded skill', 'atoms/frames', 'skill', '/kind skill is not a kind of atom'],
  ['a tool kinded model', 'tools/youtube', 'model', '/kind model is not a kind of tool'],
  ['a model atom with an unknown kind', 'atoms/see', 'vision', '/kind is not one of pipeline, skill, transform, model, observe, act'],
];
for (const [what, rel, kind, message] of wrongKinds) {
  test(`${what} reports only the kind error`, () => {
    const root = copy();
    manifest(root, rel, (m) => (m.kind = kind));
    assert.deepEqual(rules(root), { code: 1, lines: [`FAIL rule manifest-matches-schema: ${rel}/manifest.json: ${message}`] });
  });
}

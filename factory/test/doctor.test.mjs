import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const REPO = resolve(import.meta.dirname, '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'factory-doctor-'));
const MODEL = 'huggingface.co/ggerganov/whisper.cpp ggml-large-v3-turbo-q5_0.bin';
const OTHERS = 'downloads on first use: huggingface.co/ggerganov/whisper.cpp ggml-<model>.bin for each other --model <model>';

after(() => rmSync(scratch, { recursive: true, force: true }));

function transcribeRow(hfHome) {
  const env = { ...process.env, HF_HOME: hfHome, TOOL_FACTORY_HOME: join(scratch, 'home') };
  for (const name of ['HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'XDG_CACHE_HOME']) delete env[name];
  const done = spawnSync('node', [join(REPO, 'factory', 'bin', 'factory.mjs'), 'doctor'], { encoding: 'utf8', env });
  const [status, , notes] = done.stdout.split('\n').find((line) => /^\S+\s+transcribe\s/.test(line)).split(/\s{2,}/);
  return { status, notes };
}

test('doctor warns when a model is not in the Hugging Face cache', () => {
  assert.deepEqual(transcribeRow(join(scratch, 'empty')), { status: 'warn', notes: `${MODEL} is not in the Hugging Face cache, so it downloads on first use. ${OTHERS}` });
});

test('doctor passes a model that is in the Hugging Face cache', () => {
  const hfHome = join(scratch, 'full');
  const snapshot = join(hfHome, 'hub', 'models--ggerganov--whisper.cpp', 'snapshots', 'abc');
  mkdirSync(snapshot, { recursive: true });
  writeFileSync(join(snapshot, 'ggml-large-v3-turbo-q5_0.bin'), '');
  assert.deepEqual(transcribeRow(hfHome), { status: 'ok', notes: OTHERS });
});

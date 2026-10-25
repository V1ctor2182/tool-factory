import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';

const REPO = resolve(import.meta.dirname, '..', '..');
const MANIFESTS = ['tools', 'atoms'].flatMap((folder) =>
  readdirSync(join(REPO, folder)).sort().map((name) => JSON.parse(readFileSync(join(REPO, folder, name, 'manifest.json'), 'utf8'))),
);
const SERVED = MANIFESTS.filter((m) => m.adapters.includes('mcp') && m.entry);
const home = mkdtempSync(join(tmpdir(), 'factory-mcp-'));
let server;
let replies;
let nextId = 1;

function request(method, params) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return replies(id);
}

before(() => {
  server = spawn('node', [join(REPO, 'factory', 'bin', 'factory.mjs'), 'mcp', ...SERVED.map((m) => m.name)], {
    env: { ...process.env, TOOL_FACTORY_HOME: home },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiting = new Map();
  createInterface({ input: server.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  replies = (id) => new Promise((done) => waiting.set(id, done));
});

after(() => {
  server.stdin.end();
  rmSync(home, { recursive: true, force: true });
});

test('initialize answers with the tools capability', async () => {
  const reply = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(reply.result.protocolVersion, '2025-06-18');
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
});

test('initialize answers an unknown protocol version with the newest one the server speaks', async () => {
  for (const [asked, answered] of [['2025-03-26', '2025-03-26'], ['2024-11-05', '2024-11-05'], ['1999-01-01', '2025-06-18'], [undefined, '2025-06-18']]) {
    const reply = await request('initialize', { protocolVersion: asked, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(reply.result.protocolVersion, answered);
  }
});

test('tools/list has one tool per verb of every mcp manifest, with the input schema from the manifest', async () => {
  const reply = await request('tools/list', {});
  const expected = SERVED.flatMap((m) => m.verbs.map((verb) => ({ name: `${m.name}_${verb.name}`, description: verb.description, inputSchema: verb.input })));
  assert.deepEqual(reply.result.tools, expected);
  assert.ok(SERVED.length >= 8, `served ${SERVED.map((m) => m.name).join(' ')}`);
});

test('tools/call runs the CLI and the run log names mcp as the caller', async () => {
  const fixture = join(REPO, 'atoms', 'captions', 'test', 'fixtures', 'jNQXAC9IVRw.en.json3');
  const reply = await request('tools/call', { name: 'captions_parse', arguments: { path: fixture } });
  assert.equal(reply.result.isError, false);
  const transcript = JSON.parse(reply.result.content[0].text);
  assert.equal(transcript.segments[0].text, 'All right, so here we are, in front of the elephants');
  const runs = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(
    runs.map((r) => [r.name, r.verb, r.ok, r.caller]),
    [['captions', 'parse', true, 'mcp']],
  );
});

test('tools/call with arguments outside the schema fails without running the CLI', async () => {
  const reply = await request('tools/call', { name: 'transcribe_file', arguments: { path: 3, speed: 2 } });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /^Invalid arguments: \/path is not string; \/speed is not a known field$/);
});

test('an unknown tool is a JSON-RPC error', async () => {
  const reply = await request('tools/call', { name: 'nope_get', arguments: {} });
  assert.equal(reply.error.code, -32602);
});

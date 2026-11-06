// State file, home()/push-state.json unless --state names another:
//   { destinations: { <origin>: { version, traces: { "flowId/agentId/<state>/<endedAt>": sha }, sent: { source: manifestSha } } } }
// traces holds finished traces, which do not change, so the expensive read happens once. Each destination keeps its own
// memory, and a different SHAPE_VERSION forgets it, so a change to what may leave the machine reaches old traces too.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getFlow, getTrace, listSource, SOURCES } from './flows/index.mjs';
import { sha256 } from './hosted-store.mjs';
import { GUARD_RULES, isPublicSource, PUBLIC_SOURCES, rulesHitBy, scanPublic, SHAPE_VERSION, shapeFlow, shapeSourceList, shapeTrace, walkStrings } from './public-flows.mjs';
import { home } from './runs.mjs';

const PARALLEL_UPLOADS = 8;
const REQUEST_TIMEOUT_MS = 120_000;
const SETTLED = new Set(['done', 'failed']);
const PREVIEWED = /\.(?:title|subtitle|name)$/;
const PREVIEW_CHARS = 60;
const SAMPLE_LIMIT = 40;
const HITS_PRINTED = 20;

function pushToken() {
  if (process.env.FACTORY_PUSH_TOKEN) return process.env.FACTORY_PUSH_TOKEN;
  if (process.platform === 'darwin') {
    try {
      const found = execFileSync('security', ['find-generic-password', '-s', 'factory-push', '-w'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000 }).trim();
      if (found) return found;
    } catch {
      // Falls through to the message below, which says both places to look.
    }
  }
  throw new Error(`no push token. Set FACTORY_PUSH_TOKEN${process.platform === 'darwin' ? ', or add it to the keychain as service factory-push' : ''}.`);
}

function destination(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${raw} is not a URL.`);
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error(`${url.origin} is not https, and only 127.0.0.1 and localhost may skip it, because the push token travels with every request.`);
  return url.origin;
}

function publicEntries(names) {
  return names.map((name) => {
    if (!isPublicSource(name)) throw new Error(`${name} is not on the public allowlist, so nothing was sent. The public sources are ${PUBLIC_SOURCES.map((s) => s.source).join(', ')}.`);
    return SOURCES.find((entry) => entry.source === name);
  });
}

function readStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { destinations: {} };
  }
}

function saveStateFile(path, file) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(file));
  renameSync(temp, path);
}

function client(url, token) {
  return async function send(method, path, body) {
    let res;
    try {
      res = await fetch(`${url}${path}`, {
        method,
        body,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`${method} ${path} to ${url} failed: ${e.cause?.message ?? e.message}`);
    }
    return { status: res.status, text: await res.text() };
  };
}

function ok({ status, text }, what) {
  if (status < 200 || status >= 300) throw new Error(`${what} answered ${status}: ${text.trim().slice(0, 300)}`);
  return text;
}

// A source's public form: its manifest, the bytes of every blob not already sent, and every guard hit. Nothing here touches
// the network, so a hit anywhere stops the whole source before its first byte leaves.
async function shapeSource(root, entry, known = {}) {
  const blobs = new Map();
  const hits = [];
  const answers = [];
  const add = (value, path) => {
    hits.push(...scanPublic(value, path));
    answers.push({ value, path });
    const body = Buffer.from(JSON.stringify(value));
    const sha = sha256(body);
    blobs.set(sha, body);
    return sha;
  };
  const listed = await listSource(root, entry);
  const list = shapeSourceList(listed);
  const manifest = { source: list.source, label: list.label, error: list.error, list: add(list, 'list'), flows: {}, traces: {} };
  const shaped = { manifest, blobs, hits, answers, committed: [], seen: null, reads: 0, reason: listed.error };
  if (listed.error) return shaped;

  const seen = new Set();
  let traceIndex = 0;
  const traceSha = async (flowId, agentId, key, canChange) => {
    seen.add(key);
    if (!canChange && known[key]) return known[key];
    shaped.reads += 1;
    const answer = await getTrace(root, flowId, agentId);
    if (!answer) return null;
    const sha = add(shapeTrace(answer), `traces[${traceIndex++}]`);
    if (!canChange) shaped.committed.push([key, sha]);
    return sha;
  };

  const ids = [...(listed.loop ? [listed.loop.id] : []), ...listed.flows.map((flow) => flow.id)];
  try {
    for (const [i, flowId] of ids.entries()) {
      const flow = await getFlow(root, flowId);
      if (!flow) continue;
      const publicFlow = shapeFlow(flow);
      manifest.flows[publicFlow.id] = add(publicFlow, `flows[${i}]`);
      const pairs = flow.stages.flatMap((stage, s) => stage.agents.map((agent, a) => ({ agent, publicId: publicFlow.stages[s].agents[a].id })));
      const traceKey = (publicId) => `${publicFlow.id}/${publicId}`;
      if (entry.adapter.wholeFlowTrace) {
        if (!pairs.length) continue;
        const sha = await traceSha(flowId, pairs[0].agent.id, `${flowId}/*/${flow.state}/${flow.lastAt}/${pairs.length}`, !SETTLED.has(flow.state));
        if (sha) for (const pair of pairs) manifest.traces[traceKey(pair.publicId)] = sha;
        continue;
      }
      for (const { agent, publicId } of pairs) {
        const sha = await traceSha(flowId, agent.id, `${flowId}/${agent.id}/${agent.state}/${agent.endedAt}`, agent.state === 'running');
        if (sha) manifest.traces[traceKey(publicId)] = sha;
      }
    }
  } catch (e) {
    const failed = shapeSourceList({ source: entry.source, flows: [], error: e.message });
    return { ...shaped, manifest: { ...manifest, error: failed.error, list: add(failed, 'list'), flows: {}, traces: {} }, committed: [], reason: e.message };
  }
  hits.push(...scanPublic({ flows: Object.keys(manifest.flows), traces: Object.keys(manifest.traces) }, 'manifest'));
  return { ...shaped, seen };
}

async function sendBlobs(send, blobs) {
  const { missing } = JSON.parse(ok(await send('POST', '/ingest/missing', JSON.stringify({ shas: [...blobs.keys()] })), 'asking which blobs are missing'));
  for (let i = 0; i < missing.length; i += PARALLEL_UPLOADS) {
    await Promise.all(missing.slice(i, i + PARALLEL_UPLOADS).map(async (sha) => ok(await send('PUT', `/ingest/blob/${sha}`, blobs.get(sha)), `sending blob ${sha}`)));
  }
  return { blobs: missing.length, bytes: missing.reduce((sum, sha) => sum + blobs.get(sha).length, 0) };
}

function forgetTraces(state, shas) {
  const lost = new Set(shas);
  for (const [key, sha] of Object.entries(state.traces)) {
    if (lost.has(sha)) delete state.traces[key];
  }
}

function pruneTraces(state, source, seen) {
  for (const key of Object.keys(state.traces)) {
    if (key.startsWith(`${source}:`) && !seen.has(key)) delete state.traces[key];
  }
}

function reportHits(source, hits, warn) {
  warn(`factory: ${source} rejected by the publish guard, ${hits.length} hits, nothing of it was published.`);
  for (const { path, rule } of hits.slice(0, HITS_PRINTED)) warn(`  ${source} ${path} broke rule ${rule}`);
  if (hits.length > HITS_PRINTED) warn(`  and ${hits.length - HITS_PRINTED} more. Run factory push --scan for the rest.`);
}

async function pushSource(root, entry, send, state) {
  const { source } = entry;
  const { manifest, blobs, hits, committed, seen, reads, reason } = await shapeSource(root, entry, state.traces);
  if (hits.length) return { source, hits };
  const body = JSON.stringify(manifest);
  const digest = sha256(body);
  let action = 'heartbeat';
  let sent = { blobs: 0, bytes: 0 };
  const beat = state.sent[source] === digest ? await send('POST', `/ingest/heartbeat/${source}`) : null;
  if (beat && beat.status !== 404) {
    ok(beat, `the heartbeat for ${source}`);
  } else {
    action = 'manifest';
    sent = await sendBlobs(send, blobs);
    const answer = await send('PUT', `/ingest/source/${source}`, body);
    if (answer.status === 400 && answer.text.startsWith('{')) {
      const { missing } = JSON.parse(answer.text);
      forgetTraces(state, missing);
      delete state.sent[source];
      throw new Error(`the server has lost ${missing.length} blobs of ${source}. They are forgotten here, so the next push re-reads and re-sends them.`);
    }
    ok(answer, `the manifest for ${source}`);
    state.sent[source] = digest;
  }
  for (const [key, sha] of committed) state.traces[key] = sha;
  if (seen) pruneTraces(state, source, seen);
  return { source, reason, flows: Object.keys(manifest.flows).length, traces: Object.keys(manifest.traces).length, reads, action, ...sent };
}

export async function push(root, rawUrl, names, { log, warn, statePath = join(home(), 'push-state.json') }) {
  const entries = publicEntries(names);
  const url = destination(rawUrl);
  const send = client(url, pushToken());
  const file = readStateFile(statePath);
  const remembered = file.destinations?.[url];
  const state = remembered?.version === SHAPE_VERSION ? remembered : { version: SHAPE_VERSION, traces: {}, sent: {} };
  file.destinations = { ...file.destinations, [url]: state };
  let code = 0;
  try {
    for (const entry of entries) {
      const done = await pushSource(root, entry, send, state);
      if (done.hits) {
        reportHits(done.source, done.hits, warn);
        code = 1;
        continue;
      }
      const said = done.reason ? `read failed, sent a generic error. Here it said: ${done.reason}` : `${done.flows} flows, ${done.traces} traces, ${done.reads} traces read`;
      log(`${done.source}: ${said}, ${done.blobs} blobs (${done.bytes} bytes) uploaded, ${done.action === 'heartbeat' ? 'nothing changed, heartbeat sent' : 'manifest sent'}`);
    }
  } finally {
    saveStateFile(statePath, file);
  }
  return code;
}

const fieldOf = (path) => path.replace(/\[\d+\]/g, '[]').replace(/(?:\.children\[\])+/g, '.children[]');
const preview = (value) => (value.length > PREVIEW_CHARS ? `${value.slice(0, PREVIEW_CHARS)}...` : value);

function sampleAcross(samples) {
  const lanes = [...samples.values()].map((values) => [...values]);
  const picked = new Set();
  for (let i = 0; picked.size < SAMPLE_LIMIT && lanes.some((lane) => i < lane.length); i += 1) {
    for (const lane of lanes) {
      if (i < lane.length && picked.size < SAMPLE_LIMIT) picked.add(lane[i]);
    }
  }
  return [...picked];
}

// Shapes everything exactly as push does and sends nothing, so it needs no URL or token.
export async function scan(root, names, log) {
  const entries = publicEntries(names);
  const ruleCounts = new Map(Object.keys(GUARD_RULES).map((rule) => [rule, 0]));
  const hitFields = new Map();
  const distinct = new Map();
  const samples = new Map();
  for (const entry of entries) {
    const { manifest, blobs, hits, answers, reason } = await shapeSource(root, entry);
    const bytes = [...blobs.values()].reduce((sum, body) => sum + body.length, 0);
    log(`${entry.source}: ${Object.keys(manifest.flows).length} flows, ${Object.keys(manifest.traces).length} trace routes, ${blobs.size} blobs, ${bytes} bytes${reason ? `, read failed: ${reason}` : ''}`);
    for (const { path, rule } of hits) {
      ruleCounts.set(rule, ruleCounts.get(rule) + 1);
      const field = `${entry.source} ${fieldOf(path)}`;
      if (!hitFields.has(field)) hitFields.set(field, new Map());
      hitFields.get(field).set(rule, (hitFields.get(field).get(rule) ?? 0) + 1);
    }
    for (const { value, path } of answers) {
      walkStrings(value, path, (at, found) => {
        if (at.includes('.key[')) return;
        const field = fieldOf(at).replace(/^(list\.flows\[\]|list\.loop|flows\[\]|traces\[\]|list)\./, '$1 ');
        if (!distinct.has(field)) distinct.set(field, new Set());
        distinct.get(field).add(found);
        if (!PREVIEWED.test(at) || rulesHitBy(found).length) return;
        if (!samples.has(field)) samples.set(field, new Set());
        samples.get(field).add(preview(found));
      });
    }
  }
  const total = [...ruleCounts.values()].reduce((sum, n) => sum + n, 0);
  log(`\nGuard rules, ${total} hits in all:`);
  for (const [rule, n] of ruleCounts) log(`  ${rule}: ${n}`);
  if (hitFields.size) log('\nFields with hits:');
  for (const [field, rules] of hitFields) log(`  ${field}: ${[...rules].map(([rule, n]) => `${rule} ${n}`).join(', ')}`);
  log('\nDistinct values per field:');
  for (const [field, values] of [...distinct].sort(([a], [b]) => a.localeCompare(b))) log(`  ${field}: ${values.size}`);
  const picked = sampleAcross(samples);
  log(`\nA sample of ${picked.length} distinct title, subtitle, and name values, taken in turn from each field:`);
  for (const value of picked) log(`  ${value}`);
  return total ? 1 : 0;
}

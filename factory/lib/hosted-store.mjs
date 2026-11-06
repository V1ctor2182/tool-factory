// The hosted dashboard's store. Three shapes live under home()/hosted:
//   Blob            blobs/<sha>.json, one public answer named by the sha256 of its bytes.
//   SourceManifest  sources/<source>.json, { source, label, error, list, flows: {flowId: sha}, traces: {"flowId/agentId": sha} }.
//   Heartbeat       sources/<source>.heartbeat.json, { source, at }, where at is this server's receipt time.
//   ToolCatalog     catalog.json, { tools: [{ name, type, kind, description, verbs, uses }] }.
// The heartbeat has its own file so a quiet machine's minute costs one small write, not a rewrite of its manifest.
// Every answer is shaped again on its way out, so a blob stored under an older allowlist cannot show what the current one drops.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicSource, LIST_LOST, NOTHING_PUSHED, PUBLIC_SOURCES, shapeCatalog, shapeFlow, shapeSourceList, shapeTrace } from './public-flows.mjs';
import { home } from './home.mjs';

const STALE_AFTER_MS = 5 * 60_000;
const ORPHAN_AFTER_MS = 60 * 60_000;

const blobsDir = () => join(home(), 'hosted', 'blobs');
const sourcesDir = () => join(home(), 'hosted', 'sources');
const blobPath = (sha) => join(blobsDir(), `${sha}.json`);
const manifestPath = (source) => join(sourcesDir(), `${source}.json`);
const heartbeatPath = (source) => join(sourcesDir(), `${source}.heartbeat.json`);
const catalogPath = () => join(home(), 'hosted', 'catalog.json');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function writeAtomic(path, bytes) {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function prepareStore() {
  mkdirSync(blobsDir(), { recursive: true });
  mkdirSync(sourcesDir(), { recursive: true });
}

function touch(sha) {
  const at = new Date();
  utimesSync(blobPath(sha), at, at);
}

// A blob someone just asked about is about to be referenced, so it counts as new and collection leaves it alone.
export function missingBlobs(shas) {
  return shas.filter((sha) => {
    if (!existsSync(blobPath(sha))) return true;
    touch(sha);
    return false;
  });
}

export function putBlob(sha, bytes) {
  if (existsSync(blobPath(sha))) touch(sha);
  else writeAtomic(blobPath(sha), bytes);
}

const referenced = (manifest) => [manifest.list, ...Object.values(manifest.flows), ...Object.values(manifest.traces)];

export function missingFromManifest(manifest) {
  return [...new Set(referenced(manifest))].filter((sha) => !existsSync(blobPath(sha)));
}

export const storedListSource = (sha) => readJson(blobPath(sha))?.source;

function collect() {
  const now = Date.now();
  const kept = new Set(PUBLIC_SOURCES.flatMap(({ source }) => {
    const manifest = readJson(manifestPath(source));
    return manifest ? referenced(manifest) : [];
  }).map((sha) => `${sha}.json`));
  for (const name of readdirSync(blobsDir())) {
    if (kept.has(name)) continue;
    const path = join(blobsDir(), name);
    if (now - statSync(path, { throwIfNoEntry: false })?.mtimeMs > ORPHAN_AFTER_MS) rmSync(path, { force: true });
  }
}

export function writeManifest(source, manifest) {
  // A failing read names nothing, and collection would then delete a source's whole history over one busy database.
  const previous = manifest.error ? readJson(manifestPath(source)) : null;
  const stored = previous ? { ...manifest, flows: previous.flows, traces: previous.traces } : manifest;
  writeAtomic(manifestPath(source), JSON.stringify(stored));
  beat(source);
  collect();
}

function beat(source) {
  writeAtomic(heartbeatPath(source), JSON.stringify({ source, at: new Date().toISOString() }));
}

export function heartbeat(source) {
  if (!existsSync(manifestPath(source))) return false;
  beat(source);
  return true;
}

export const writeCatalog = (bytes) => writeAtomic(catalogPath(), bytes);
export const readCatalog = () => shapeCatalog(readJson(catalogPath()) ?? { tools: [] });

// The one rule that keeps the page honest: a source not heard from has lost its machine, so nothing in it still runs.
// A blocked agent stays blocked because the question to Victor is still open.
const stalled = (state) => (state === 'running' ? 'stalled' : state);

function staleFlow(flow) {
  return {
    ...flow,
    state: stalled(flow.state),
    working: 0,
    ...(flow.stages && { stages: flow.stages.map((stage) => ({ ...stage, state: stalled(stage.state), agents: stage.agents.map((agent) => ({ ...agent, state: stalled(agent.state) })) })) }),
  };
}

// A null end means "still open" and the page animates it, so an open span stops where the machine was last heard.
function closeSpans(node, end) {
  const closed = { ...node, end: node.end ?? Math.max(node.start, end) };
  return node.kind === 'group' ? { ...closed, children: node.children.map((child) => closeSpans(child, end)) } : closed;
}

function staleTrace(trace, lastPush) {
  return {
    ...trace,
    live: false,
    ...(trace.state && { state: stalled(trace.state) }),
    root: closeSpans(trace.root, (Date.parse(lastPush ?? trace.startedAt) - Date.parse(trace.startedAt)) / 1000),
  };
}

const isStale = (lastPush) => lastPush === null || Date.now() - Date.parse(lastPush) > STALE_AFTER_MS;

function readSource(source) {
  const manifest = readJson(manifestPath(source));
  return manifest && { manifest, lastPush: readJson(heartbeatPath(source))?.at ?? null };
}

const readBlob = (sha) => readJson(blobPath(sha));

function listOne({ source, label }) {
  const found = readSource(source);
  if (!found) return { source, label, flows: [], error: NOTHING_PUSHED, lastPush: null, stale: true };
  const listed = readBlob(found.manifest.list);
  const stale = isStale(found.lastPush);
  if (!listed) return { source, label, flows: [], error: LIST_LOST, lastPush: found.lastPush, stale };
  const shaped = shapeSourceList({ ...listed, source });
  if (!stale) return { ...shaped, lastPush: found.lastPush, stale };
  return { ...shaped, flows: shaped.flows.map(staleFlow), ...(shaped.loop && { loop: staleFlow(shaped.loop) }), lastPush: found.lastPush, stale };
}

export function hostedFlows() {
  const lookup = (flowId, map, key) => {
    const split = flowId.indexOf(':');
    const source = split < 0 ? null : flowId.slice(0, split);
    const found = isPublicSource(source) ? readSource(source) : null;
    if (!found || !Object.hasOwn(found.manifest[map], key)) return null;
    return { answer: readBlob(found.manifest[map][key]), lastPush: found.lastPush, stale: isStale(found.lastPush) };
  };
  return {
    list: () => ({ sources: PUBLIC_SOURCES.map(listOne) }),
    flow(flowId) {
      const found = lookup(flowId, 'flows', flowId);
      if (!found?.answer) return null;
      const flow = shapeFlow(found.answer);
      return found.stale ? staleFlow(flow) : flow;
    },
    trace(flowId, agentId) {
      const found = lookup(flowId, 'traces', `${flowId}/${agentId}`);
      if (!found?.answer) return null;
      const trace = shapeTrace(found.answer);
      return found.stale ? staleTrace(trace, found.lastPush) : trace;
    },
  };
}

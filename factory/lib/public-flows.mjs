// What may be seen on the public page. The pusher and the ingest route both go through this one module, so a buggy or
// old pusher cannot publish more than the page shows. Shaping copies named fields into new objects, and it is idempotent:
// shaping a shaped answer gives the same bytes, which is how ingest recognizes a blob that holds nothing else.
import { createHash } from 'node:crypto';

// Raise this when shaping changes, so the pusher re-reads and re-sends traces it already sent.
export const SHAPE_VERSION = 2;

export const PUBLIC_SOURCES = [
  { source: 'game-studio', label: 'Game Studio' },
  { source: 'tools', label: 'Factory tools' },
];
export const isPublicSource = (name) => PUBLIC_SOURCES.some((entry) => entry.source === name);
const labelOf = (source) => PUBLIC_SOURCES.find((entry) => entry.source === source)?.label ?? null;

export const NOTHING_PUSHED = 'No data pushed yet.';
export const LIST_LOST = 'The stored list of this source is gone. The next push restores it.';
const READ_FAILED = 'This source could not be read on the Mac.';
const SOURCE_ERRORS = new Set([NOTHING_PUSHED, LIST_LOST, READ_FAILED]);

const STATES = new Set(['running', 'blocked', 'stalled', 'failed', 'pending', 'done']);
const ROLES = new Set(['planner', 'worker', 'verifier', 'image', 'coordinator', 'you', 'transform', 'model', 'observe', 'act']);
const CATEGORIES = new Set(['model', 'browser', 'backend', 'shell', 'file', 'agent', 'human']);
const OUTCOMES = new Set(['ok', 'failed']);
const KINDS = new Set(['step', 'group']);
const EDGE_LABELS = new Set(['rejected', 'rework', 'replan']);
const TOOL_TYPES = new Set(['microservice', 'atom']);
const TOOL_KINDS = new Set(['pipeline', 'skill', 'transform', 'model', 'observe', 'act']);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TOKEN_LIKE_ID = /[A-Za-z0-9]{24,}|[0-9a-f]{8}-[0-9a-f]{4}-/;
const PLAIN_ID = /^[\w.:-]{1,80}$/;

const text = (value) => (typeof value === 'string' ? value : null);
const count = (value) => (Number.isFinite(value) ? value : 0);
const number = (value) => (Number.isFinite(value) ? value : null);
const flag = (value) => value === true;
const time = (value) => (typeof value === 'string' && ISO_TIME.test(value) ? value : null);
const oneOf = (allowed) => (value) => (allowed.has(value) ? value : null);
const list = (shape) => (value) => (Array.isArray(value) ? value.map(shape) : []);

// A raw attempt or tool-call id would read as a token on a public page and says nothing to a visitor, so it leaves
// as a short digest. The same input always gives the same digest, and a digest maps to itself.
function publicId(id) {
  const raw = String(id);
  if (PLAIN_ID.test(raw) && !TOKEN_LIKE_ID.test(raw)) return raw;
  return `x${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

function publicFlowId(id) {
  const raw = String(id);
  const split = raw.indexOf(':');
  return split < 0 ? publicId(raw) : `${raw.slice(0, split)}:${publicId(raw.slice(split + 1))}`;
}

// A name is a label or a tool name. A word built from a file path or URL keeps only its last segment.
function publicName(name) {
  if (typeof name !== 'string') return null;
  return name.split(/(\s+)/).map((word) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) return 'link';
    return /[\\/]/.test(word) ? word.split(/[\\/]/).filter(Boolean).at(-1) ?? 'path' : word;
  }).join('');
}

function shaper(fields) {
  return function shape(value) {
    const out = {};
    if (value === null || typeof value !== 'object') return out;
    for (const [field, keep] of Object.entries(fields)) {
      if (Object.hasOwn(value, field) && value[field] !== undefined) out[field] = keep(value[field]);
    }
    return out;
  };
}

const shapeAgent = shaper({ id: publicId, name: publicName, role: oneOf(ROLES), state: oneOf(STATES), startedAt: time, endedAt: time, traced: flag });
const shapeStage = shaper({ id: text, title: text, state: oneOf(STATES), loops: count, agents: list(shapeAgent) });
const shapeEdge = shaper({ from: text, to: text, count, label: oneOf(EDGE_LABELS) });

export const shapeFlow = shaper({
  id: publicFlowId,
  source: text,
  title: text,
  subtitle: text,
  state: oneOf(STATES),
  startedAt: time,
  endedAt: time,
  lastAt: time,
  agents: count,
  working: count,
  loops: count,
  backEdges: list(shapeEdge),
  stages: list(shapeStage),
});

const shapeNode = shaper({
  kind: oneOf(KINDS),
  id: publicId,
  name: publicName,
  category: oneOf(CATEGORIES),
  start: number,
  end: number,
  outcome: oneOf(OUTCOMES),
  role: oneOf(ROLES),
  children: list((child) => shapeNode(child)),
});

export const shapeTrace = shaper({ title: text, subtitle: text, startedAt: time, live: flag, state: oneOf(STATES), root: shapeNode });

const shapeTool = shaper({ name: text, type: oneOf(TOOL_TYPES), kind: oneOf(TOOL_KINDS), description: text, verbs: list(text), uses: list(text) });
export const shapeCatalog = shaper({ tools: list(shapeTool) });

// A raw exception can hold a path, so an error crosses as one of these sentences or as READ_FAILED.
const sourceError = (error) => (error ? (SOURCE_ERRORS.has(error) ? error : READ_FAILED) : null);

export function shapeSourceList({ source, flows, loop, error }) {
  return {
    source,
    label: labelOf(source),
    flows: list(shapeFlow)(flows),
    ...(loop && { loop: shapeFlow(loop) }),
    error: sourceError(error),
  };
}

const SHA = /^[0-9a-f]{64}$/;
export const isSha = (value) => typeof value === 'string' && SHA.test(value);
const MANIFEST_FIELDS = new Set(['source', 'label', 'error', 'list', 'flows', 'traces']);

export function manifestProblem(manifest, source) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return 'the body is not an object';
  if (!Object.keys(manifest).every((field) => MANIFEST_FIELDS.has(field))) return 'it carries a field outside the allowlist';
  if (manifest.source !== source) return `source is not ${source}`;
  if (manifest.label !== labelOf(source)) return 'label is not this source\'s label';
  if (manifest.error !== sourceError(manifest.error)) return 'error is not one of the public sentences';
  if (!isSha(manifest.list)) return 'list is not a sha256';
  for (const field of ['flows', 'traces']) {
    const map = manifest[field];
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return `${field} is not an object`;
    if (!Object.values(map).every(isSha)) return `${field} holds a value that is not a sha256`;
    if (!Object.keys(map).every((key) => key.startsWith(`${source}:`))) return `${field} names another source`;
  }
  return null;
}

// The publish guard. A hit rejects the whole blob, so a rule stays narrow enough that the page's own words never hit it.
const MIXED_RUN = 20;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4 = new RegExp(`(?<![\\d.])${OCTET}(?:\\.${OCTET}){3}(?![\\d.])`);

// A slug or a timestamped id is long but breaks into short words. A secret is one long run, or a stretch that mixes
// lower case, upper case, and digits for longer than a compact timestamp does.
function holdsLongSecret(value) {
  return (value.match(/[A-Za-z0-9+/=_-]{33,}/g) ?? []).some((run) => run.split(/[-_/]/).some((part) => part.length > 32 || (part.length >= MIXED_RUN && /[a-z]/.test(part) && /[A-Z]/.test(part) && /\d/.test(part))));
}

const matches = (pattern) => (value) => pattern.test(value);
export const GUARD_RULES = {
  'home-path': matches(/\/(?:Users|home)\//),
  'tilde-path': matches(/~\//),
  'windows-path': matches(/\b[A-Za-z]:\\/),
  email: matches(/[^\s@]+@[^\s@]+\.[^\s@]+/),
  url: matches(/\bhttps?:\/\//i),
  ipv4: matches(IPV4),
  tailnet: matches(/\.ts\.net\b/i),
  'token-prefix': matches(/(?<![\w-])(?:sk-[A-Za-z0-9]|gh[pousr]_|AKIA[0-9A-Z]|xox[a-z]-)/),
  'long-secret': holdsLongSecret,
};

// Visits every string of a JSON value, object keys included, as (path, value).
export function walkStrings(value, path, visit) {
  if (typeof value === 'string') return visit(path, value);
  if (Array.isArray(value)) return value.forEach((item, i) => walkStrings(item, `${path}[${i}]`, visit));
  if (value === null || typeof value !== 'object') return undefined;
  Object.entries(value).forEach(([key, item], i) => {
    visit(`${path}.key[${i}]`, key);
    walkStrings(item, `${path}.${key}`, visit);
  });
  return undefined;
}

export const rulesHitBy = (value) => Object.entries(GUARD_RULES).filter(([, hits]) => hits(value)).map(([rule]) => rule);

export function scanPublic(value, path) {
  const hits = [];
  walkStrings(value, path, (at, found) => {
    for (const rule of rulesHitBy(found)) hits.push({ path: at, rule });
  });
  return hits;
}

// The shapes a blob can take. Returns its value only if it holds nothing but the allowlist.
export function readBlob(bytes) {
  let value;
  const raw = bytes.toString('utf8');
  try {
    value = JSON.parse(raw);
  } catch {
    return { problem: 'A blob must be JSON.' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { problem: 'A blob must be one public answer.' };
  const shape = Object.hasOwn(value, 'root') ? shapeTrace : Object.hasOwn(value, 'label') ? shapeSourceList : Object.hasOwn(value, 'id') ? shapeFlow : null;
  if (!shape) return { problem: 'A blob must be one public answer.' };
  if (shape !== shapeTrace && !isPublicSource(value.source)) return { refused: true };
  if (JSON.stringify(shape(value)) !== raw) return { problem: 'The blob holds something outside the allowlist.' };
  return { value };
}

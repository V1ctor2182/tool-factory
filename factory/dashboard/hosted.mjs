// The public dashboard. Its whole surface is this file's routes: /healthz, the status pages, the flows page and API with
// no login, and a token-guarded ingest. It has no route that runs a tool. It imports nothing that reads the Mac, so the deployed image holds only what the page needs.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { heartbeat, hostedFlows, missingBlobs, missingFromManifest, prepareStore, putBlob, readStatus, sha256, storedListSource, writeManifest, writeStatus } from '../lib/hosted-store.mjs';
import { isPublicSource, isSha, manifestProblem, readBlob, scanPublic, shapeStatus } from '../lib/public-flows.mjs';
import { FLOWS_API, FLOWS_PAGE, replier, STATUS_PAGE, withStatus } from './http.mjs';

const MIN_TOKEN = 32;
const MAX_BODY = 8 * 1024 * 1024;
const API_CACHE = 'public, max-age=2';
const BIND_HOST = '0.0.0.0';
const INGEST = /^\/ingest\/(?:(missing|status)|(blob|source|heartbeat)\/([^/]+))$/;
const INGEST_METHOD = { missing: 'POST', status: 'PUT', blob: 'PUT', source: 'PUT', heartbeat: 'POST' };
const NOT_PUBLIC = 'That source is not on the public allowlist.';

function pushTokenFrom(env) {
  const token = env.FACTORY_PUSH_TOKEN;
  if (typeof token !== 'string' || token.length < MIN_TOKEN) throw new Error(`FACTORY_PUSH_TOKEN must have at least ${MIN_TOKEN} characters, so the server did not start.`);
  return token;
}

const digest = (text) => createHash('sha256').update(text).digest();

function hasPushToken(req, token) {
  const [scheme, given] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && Boolean(given) && timingSafeEqual(digest(given), digest(token));
}

// A body over the limit is drained, not kept, so the client can read the 413 instead of a dropped connection.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(bytes) {
  try {
    return { value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    return null;
  }
}

async function ingest(req, path, reply, token) {
  const json = (code, value) => reply(code, 'application/json', JSON.stringify(value));
  const refuse = (code, message) => reply(code, 'text/plain', `${message}\n`);
  const rejectHit = ([hit]) => json(422, { field: hit.path, rule: hit.rule });
  if (!hasPushToken(req, token)) return reply(401, 'text/plain', 'Send the push token as a bearer token.\n', { 'www-authenticate': 'Bearer' });
  const [, plain, kind, name] = path.match(INGEST) ?? [];
  const route = INGEST_METHOD[plain ?? kind];
  if (!route) return refuse(404, 'No such ingest path.');
  if (req.method !== route) return reply(405, 'text/plain', `Use ${route}.\n`, { allow: route });
  if (kind === 'blob' && !isSha(name)) return refuse(400, 'A blob name is 64 lowercase hex characters.');
  if ((kind === 'source' || kind === 'heartbeat') && !isPublicSource(name)) return refuse(403, NOT_PUBLIC);
  if (kind === 'heartbeat') return heartbeat(name) ? json(200, { ok: true }) : refuse(404, `Nothing is stored for ${name} yet, so send its manifest.`);

  const bytes = await readBody(req);
  if (bytes === null) return refuse(413, `The body is over ${MAX_BODY} bytes.`);
  if (kind === 'blob') {
    if (sha256(bytes) !== name) return refuse(400, 'The body does not hash to its name.');
    const read = readBlob(bytes);
    if (read.refused) return refuse(403, NOT_PUBLIC);
    if (read.problem) return refuse(400, read.problem);
    const hits = scanPublic(read.value, 'blob');
    if (hits.length) return rejectHit(hits);
    putBlob(name, bytes);
    return json(200, { ok: true });
  }
  const parsed = parseJson(bytes);
  if (!parsed) return refuse(400, 'The body is not JSON.');
  if (plain === 'status') {
    if (!Array.isArray(parsed.value?.microservices) || JSON.stringify(shapeStatus(parsed.value)) !== bytes.toString('utf8')) return refuse(400, 'The status holds something outside the allowlist.');
    const hits = scanPublic(parsed.value, 'status');
    if (hits.length) return rejectHit(hits);
    writeStatus(bytes);
    return json(200, { ok: true });
  }
  if (plain === 'missing') {
    const shas = parsed.value?.shas;
    if (!Array.isArray(shas) || !shas.every(isSha)) return refuse(400, 'Send { shas: [sha256...] }.');
    return json(200, { missing: missingBlobs(shas) });
  }
  const problem = manifestProblem(parsed.value, name);
  if (problem) return refuse(400, `The manifest is invalid: ${problem}.`);
  const hits = scanPublic(parsed.value, 'manifest').filter(({ path: at }) => at.includes('.key['));
  if (hits.length) return rejectHit(hits);
  const missing = missingFromManifest(parsed.value);
  if (missing.length) return json(400, { missing });
  if (storedListSource(parsed.value.list) !== name) return refuse(400, 'The manifest\'s list belongs to another source.');
  writeManifest(name, parsed.value);
  return json(200, { ok: true });
}

export async function hostedDashboard(port) {
  const pushToken = pushTokenFrom(process.env);
  prepareStore();
  const flows = hostedFlows();
  const hostedPage = (name) => readFileSync(new URL(name, import.meta.url), 'utf8').replace('<body>', '<body data-hosted>');
  const page = hostedPage('flows.html');
  const statusTemplate = hostedPage('index.html');

  const handle = async (req, res) => {
    const reply = replier(req, res);
    const tagged = (type, body) => {
      const etag = `"${sha256(body)}"`;
      const headers = { 'cache-control': API_CACHE, etag };
      return req.headers['if-none-match'] === etag ? reply(304, type, undefined, headers) : reply(200, type, body, headers);
    };
    const notFound = () => reply(404, 'text/plain', 'Not found.\n');
    const path = new URL(req.url, 'http://hosted').pathname;
    if (path.startsWith('/ingest/')) return await ingest(req, path, reply, pushToken);
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
    if (path === '/healthz') return reply(200, 'text/plain', 'ok\n');
    if (STATUS_PAGE.test(path)) return tagged('text/html', withStatus(statusTemplate, readStatus()));
    if (FLOWS_PAGE.test(path)) return reply(200, 'text/html', page);
    const api = path.match(FLOWS_API);
    if (!api) return notFound();
    const [flow, agent] = api.slice(1).map((part) => part && decodeURIComponent(part));
    const answer = agent ? flows.trace(flow, agent) : flow ? flows.flow(flow) : flows.list();
    if (!answer) return notFound();
    return tagged('application/json', JSON.stringify(answer));
  };

  // A bad URL or escape from the open internet must cost one request, never the process. The answer names no cause,
  // because a raw exception holds this server's paths.
  const server = createServer((req, res) => handle(req, res).catch((e) => {
    if (res.headersSent) return res.destroy();
    const bad = e instanceof URIError || e.code === 'ERR_INVALID_URL';
    if (!bad) console.error(`factory: ${req.method} failed: ${e.message}`);
    res.writeHead(bad ? 400 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(bad ? 'Bad request.\n' : 'The request failed.\n');
  }));
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} on ${BIND_HOST} is in use`) : e));
    server.listen(port, BIND_HOST, () => resolve(`http://${BIND_HOST}:${server.address().port}/`));
  });
}

if (import.meta.main) {
  hostedDashboard(Number(process.env.PORT || 8080)).then(
    (url) => console.log(`dashboard on ${url}. Stop it with ctrl-c.`),
    (e) => {
      console.error(`factory: ${e.message}`);
      process.exitCode = 1;
    },
  );
}

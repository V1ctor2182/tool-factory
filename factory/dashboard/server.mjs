import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { validate } from '../lib/manifest.mjs';
import { argv, load } from '../lib/registry.mjs';
import { invoke } from '../lib/runs.mjs';
import { statusModel } from '../lib/status.mjs';

const HOST = '127.0.0.1';
const OPEN = '<script id="status" type="application/json">';
const RUN = /^\/run\/([^/]+)\/([^/]+)$/;
// Every page is the same HTML. The page picks its view from the path.
const PAGE = /^\/(?:try|wiring|elsewhere|docs(?:\/[^/]+){0,2})?$/;
const MAX_BODY = 64 * 1024;

function page(template, root) {
  const json = JSON.stringify(statusModel(load(root))).replaceAll('<', '\\u003c');
  return template.replace(`${OPEN}</script>`, () => `${OPEN}${json}</script>`);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > MAX_BODY) reject(new Error(`the body is over ${MAX_BODY} bytes`));
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

// Streams one JSON line per stderr chunk, then a last line with the exit code and the CLI's --json output.
async function run(root, req, res, [, name, verbName], refuse) {
  // A page on another site can POST here too, so only this page's own origin may run a verb.
  if (req.headers.origin !== `http://${req.headers.host}`) return refuse(403, 'Only the dashboard page itself can run a verb.\n');
  if (!req.headers['content-type']?.startsWith('application/json')) return refuse(415, 'Send the input as application/json.\n');
  const entry = load(root).entries.get(name);
  const verb = entry?.manifest.verbs?.find((v) => v.name === verbName);
  if (!verb) return refuse(404, `No verb ${name} ${verbName}.\n`);
  if (entry.info.guard === 'confirm') return refuse(403, `${name} needs your confirmation on every run, so run it from a terminal.\n`);
  let input;
  try {
    input = JSON.parse(await body(req));
  } catch (e) {
    return refuse(400, `The body is not JSON: ${e.message}\n`);
  }
  const errors = validate({ ...verb.input, additionalProperties: false }, input);
  if (errors.length) return refuse(400, `Invalid input: ${errors.join('; ')}\n`);

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const line = (value) => res.write(`${JSON.stringify(value)}\n`);
  const { code, stdout, stderr } = await invoke(entry, verb, argv(entry, verb, input), 'dashboard', { onStderr: (chunk) => line({ progress: chunk }) });
  let output = null;
  try {
    output = JSON.parse(stdout);
  } catch {
    output = { error: { code: 'internal', message: stderr.trim() || stdout.trim() || `${name} exited ${code} with no output` } };
  }
  line({ code, output });
  res.end();
}

export function dashboard(root, port) {
  const template = readFileSync(new URL('index.html', import.meta.url), 'utf8');
  let hosts;
  const server = createServer(async (req, res) => {
    const reply = (code, type, body, headers = {}) => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'none'", ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const refuse = (code, message) => reply(code, 'text/plain', message);
    if (!hosts.has(req.headers.host)) return refuse(421, 'This dashboard answers only on 127.0.0.1 or localhost.\n');
    const path = new URL(req.url, `http://${HOST}`).pathname;
    const runPath = path.match(RUN);
    if (runPath) {
      if (req.method !== 'POST') return reply(405, 'text/plain', 'Run a verb with POST.\n', { allow: 'POST' });
      try {
        return await run(root, req, res, runPath.map(decodeURIComponent), refuse);
      } catch (e) {
        if (res.headersSent) return res.end();
        return refuse(500, `The run failed: ${e.message}\n`);
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'text/plain', 'This page is read-only. Verbs run through POST /run/<name>/<verb>.\n', { allow: 'GET, HEAD' });
    if (!PAGE.test(path)) return refuse(404, 'Not found. The pages are /, /try, /wiring, /docs, and /elsewhere.\n');
    try {
      reply(200, 'text/html', page(template, root));
    } catch (e) {
      reply(500, 'text/plain', `The status model failed: ${e.message}\n`);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} on ${HOST} is in use, so pass --port`) : e));
    server.listen(port, HOST, () => {
      const bound = server.address().port;
      hosts = new Set([`${HOST}:${bound}`, `localhost:${bound}`]);
      resolve(`http://${HOST}:${bound}/`);
    });
  });
}

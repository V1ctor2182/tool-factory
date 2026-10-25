import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { load } from '../lib/registry.mjs';
import { statusModel } from '../lib/status.mjs';

const HOST = '127.0.0.1';
const OPEN = '<script id="status" type="application/json">';

function page(template, root) {
  const json = JSON.stringify(statusModel(load(root))).replaceAll('<', '\\u003c');
  return template.replace(`${OPEN}</script>`, () => `${OPEN}${json}</script>`);
}

export function dashboard(root, port) {
  const template = readFileSync(new URL('index.html', import.meta.url), 'utf8');
  let hosts;
  const server = createServer((req, res) => {
    const reply = (code, type, body, headers = {}) => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!hosts.has(req.headers.host)) return reply(421, 'text/plain', 'This dashboard answers only on 127.0.0.1 or localhost.\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'text/plain', 'The dashboard is read-only.\n', { allow: 'GET, HEAD' });
    if (new URL(req.url, `http://${HOST}`).pathname !== '/') return reply(404, 'text/plain', 'Not found. The dashboard has one page, /.\n');
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

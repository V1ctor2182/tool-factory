// What the local and the public dashboard answer the same way. It reads nothing, so the public image can hold it.
// Every status page is the same HTML. The page picks its view from the path.
export const STATUS_PAGE = /^\/(?:try|wiring|elsewhere|docs(?:\/[^/]+){0,2})?$/;
export const FLOWS_PAGE = /^\/flows(?:\/[^/]+){0,2}$/;
export const FLOWS_API = /^\/api\/flows(?:\/([^/]+)(?:\/agents\/([^/]+))?)?$/;

const STATUS_TAG = '<script id="status" type="application/json">';

export function withStatus(template, model) {
  const json = JSON.stringify(model).replaceAll('<', '\\u003c');
  return template.replace(`${STATUS_TAG}</script>`, () => `${STATUS_TAG}${json}</script>`);
}

export function replier(req, res) {
  return (code, type, body, headers = {}) => {
    res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'none'", ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

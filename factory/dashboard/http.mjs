// What the local and the public dashboard answer the same way. It reads nothing, so the public image can hold it.
export const FLOWS_PAGE = /^\/flows(?:\/[^/]+){0,2}$/;
export const FLOWS_API = /^\/api\/flows(?:\/([^/]+)(?:\/agents\/([^/]+))?)?$/;

export function replier(req, res) {
  return (code, type, body, headers = {}) => {
    res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'none'", ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

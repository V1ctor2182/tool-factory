import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

ROUTES = {
    "/item.json": (200, b'{"name": "badge"}'),
    "/page.html": (200, b"<html></html>"),
    "/limited.json": (429, b"slow down"),
    "/pro.json": (401, b"sign in"),
}


class Handler(BaseHTTPRequestHandler):
    agents: list[str] = []

    def do_GET(self):
        Handler.agents.append(self.headers["User-Agent"])
        status, body = ROUTES.get(self.path, (404, b"missing"))
        self.send_response(status)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def server():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()

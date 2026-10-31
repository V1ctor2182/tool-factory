import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from factory_kit import web
from factory_kit.cli import AtomError

ROUTES = {"/item.json": (200, b'{"name": "badge"}'), "/page.html": (200, b"<html></html>")}


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


def test_names_the_atom_in_the_user_agent(server):
    Handler.agents.clear()
    assert web.get_json(f"{server}/item.json", "ui-source") == {"name": "badge"}
    assert Handler.agents == ["tool-factory/ui-source"]


@pytest.mark.parametrize(
    ("path", "code"),
    [("/missing.json", "unavailable"), ("/page.html", "invalid_source")],
)
def test_maps_failures_to_error_codes(server, path, code):
    with pytest.raises(AtomError) as raised:
        web.get_json(f"{server}{path}", "ui-source")
    assert raised.value.code == code


def test_rejects_a_non_http_url():
    with pytest.raises(AtomError) as raised:
        web.get_json("not-a-url", "ui-source")
    assert raised.value.code == "invalid_source"


def test_reports_an_unreachable_host():
    with pytest.raises(AtomError) as raised:
        web.get_json("http://127.0.0.1:9/item.json", "ui-source")
    assert raised.value.code == "network_error"

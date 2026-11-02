import pytest
from conftest import Handler

from factory_kit import web
from factory_kit.cli import AtomError


def test_names_the_atom_in_the_user_agent(server):
    Handler.agents.clear()
    assert web.get_json(f"{server}/item.json", "ui-source") == {"name": "badge"}
    assert Handler.agents == ["tool-factory/ui-source"]


@pytest.mark.parametrize(
    ("path", "code"),
    [("/missing.json", "unavailable"), ("/limited.json", "rate_limited"), ("/page.html", "invalid_source")],
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

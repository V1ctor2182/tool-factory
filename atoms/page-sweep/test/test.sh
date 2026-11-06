#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-sweep"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL page-sweep: $1" >&2; exit 1; }

cat > "$out/plan.json" <<EOF
{"url": "file://$test_dir/fixtures/page.html", "loadMs": 200, "viewport": {"width": 600, "height": 400},
 "runs": [
  {"id": "load", "kind": "load", "forMs": 500},
  {"id": "walk", "kind": "walk", "from": 0, "to": "end", "step": 700},
  {"id": "pass", "kind": "pass", "at": 0, "distance": 200, "afterMs": 300},
  {"id": "idle", "kind": "idle", "at": 0, "forMs": 1200},
  {"id": "hover", "kind": "hover", "at": 0, "target": {"selector": "#box"}, "holdMs": 500},
  {"id": "gone", "kind": "hover", "at": 0, "target": {"selector": "#nothing"}},
  {"id": "path", "kind": "path", "at": 0, "points": [[20, 20], [300, 200]]},
  {"id": "jump", "kind": "click", "at": 0, "target": {"selector": "#jump"}, "afterMs": 500},
  {"id": "away", "kind": "click", "at": 0, "target": {"selector": "#away"}, "afterMs": 500},
  {"id": "write", "kind": "click", "at": 0, "target": {"selector": "#write"}, "afterMs": 500}
 ]}
EOF
"$bin" capture "$out/plan.json" --json > "$out/s.json" || fail "capture exited nonzero: $(cat "$out/s.json")"
"$repo/contracts/check" page-sweep "$out/s.json" || fail "output does not match page-sweep.schema.json"
run() { jq -c --arg id "$1" '.runs[] | select(.id == $id)' "$out/s.json"; }
dir=$(dirname "$(jq -r .sweep "$out/s.json")")
for id in load pass idle hover path jump; do
	[ "$(run "$id" | jq '.status == "ok" and (.frames | length) > 0')" = true ] || fail "run $id has no frames: $(run "$id" | cut -c1-200)"
	[ -f "$dir/$(run "$id" | jq -r '.frames[0].file')" ] || fail "run $id's first frame is not on disk"
done
[ "$(run walk | jq '.stops | length')" = 3 ] || fail "the walk did not stop three times on a 1400 px scroll at step 700"
[ "$(run walk | jq '.stops[2].y')" = 1400 ] || fail "the walk did not reach the end: $(run walk | jq -c '.stops[2]')"
[ "$(run walk | jq '.overflow.sidewaysPx')" = 0 ] || fail "a page with no overflow moved sideways"
[ "$(run gone | jq -r .status)" = missing ] || fail "a missing target did not report missing"
[ "$(run hover | jq '[.events[].type] == ["enter", "exit"]')" = true ] || fail "hover events are wrong"
[ "$(run jump | jq -r .state.hash)" = "#two" ] || fail "a same-page click did not land on its hash"
[ "$(run away | jq -r '.state.blocked.navigations[0]')" = "https://example.com/" ] || fail "a click that leaves the page was not blocked"
echo '{"url": "file:///x", "runs": [{"id": "a", "kind": "idle"}]}' > "$out/bad.json"
if "$bin" capture "$out/bad.json" --json > "$out/bad-out.json"; then fail "an idle run with no at exited 0"; fi
[ "$(jq -r .error.code "$out/bad-out.json")" = invalid_args ] || fail "a bad plan did not report invalid_args"
echo "PASS page-sweep"

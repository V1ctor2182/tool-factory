#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-read"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/facts.json"

fail() { echo "FAIL page-read: $1" >&2; exit 1; }

"$bin" facts "file://$test_dir/fixtures/page.html" --load-ms 200 --json > "$out" || fail "facts exited nonzero: $(cat "$out")"
"$repo/contracts/check" page-facts "$out" || fail "facts does not match page-facts.schema.json"
[ "$(jq -r .scrollHeight "$out")" = 2000 ] || fail "scrollHeight is not 2000"
jq -e '.dataAttributes.html["data-state"] == "ready"' "$out" > /dev/null || fail "html data attribute missing"
jq -e '.labels[0].label == "A field of moving dots"' "$out" > /dev/null || fail "canvas label missing"
jq -e '.console[0] == "a note in the console"' "$out" > /dev/null || fail "console note missing"
jq -e '.animations.clock == 1' "$out" > /dev/null || fail "clock animation not counted"
safe() { jq -r --arg t "$1" '.targets[] | select(.text == $t) | .safe' "$out"; }
[ "$(safe Jump)" = true ] || fail "a same-page link is not safe"
[ "$(safe Away)" = false ] || fail "an external link is safe"
[ "$(safe Send)" = false ] || fail "a submit button is safe"
[ "$(safe Open)" = true ] || fail "a plain button is not safe"
[ "$(safe Card)" = true ] || fail "a cursor pointer element was not listed as safe"

if "$bin" facts "http://127.0.0.1:9/" --load-ms 0 --json > "$out"; then fail "an unreachable page exited 0"; fi
[ "$(jq -r .error.code "$out")" = network_error ] || fail "an unreachable page did not report network_error"
echo "PASS page-read"

#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/find-url"
fixture="$test_dir/fixtures/ytsearch3-me-at-the-zoo.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL find-url: $1" >&2; exit 1; }

"$bin" parse "$fixture" --json > "$out/list.json"
"$repo/contracts/check" url-list "$out/list.json" \
	|| fail "parse output does not match url-list.schema.json"
first=$(jq -c '.items[0]' "$out/list.json")
[ "$first" = '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","id":"jNQXAC9IVRw","title":"Me at the zoo","durationSec":19,"channel":"jawed"}' ] \
	|| fail "first item is $first"
[ "$(jq '.items | length' "$out/list.json")" = 3 ] || fail "parse did not return the three recorded results"
[ "$(jq '[.items[].url] | unique | length' "$out/list.json")" = 3 ] || fail "parse returned a duplicate URL"
[ "$(jq .cacheHit "$out/list.json")" = false ] || fail "an observe atom reported a cache hit"
"$bin" parse "$fixture" > "$out/list.txt"
[ "$(sed -n 1p "$out/list.txt")" = "https://www.youtube.com/watch?v=jNQXAC9IVRw" ] || fail "text output does not start with the first URL"

jq '.entries += [.entries[0]]' "$fixture" > "$out/duplicate.json"
[ "$("$bin" parse "$out/duplicate.json" --json | jq '.items | length')" = 3 ] || fail "parse kept a duplicate URL"

if "$bin" search "me at the zoo" --limit 0 --json > "$out/zero.json"; then fail "limit 0 exited 0"; fi
[ "$(jq -r .error.code "$out/zero.json")" = invalid_args ] || fail "limit 0 did not report invalid_args"
if "$bin" list not-a-url --json > "$out/invalid.json"; then fail "list not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "list not-a-url did not report invalid_source"
printf '[]' > "$out/not-info.json"
if "$bin" parse "$out/not-info.json" --json > "$out/bad.json"; then fail "a JSON list exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a JSON list did not report invalid_source"

echo "PASS find-url"

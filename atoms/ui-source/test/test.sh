#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/ui-source"
exposed="$test_dir/fixtures/exposed-item.json"
unexposed="$test_dir/fixtures/unexposed-item.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL ui-source: $1" >&2; exit 1; }

"$bin" parse "$exposed" --json > "$out/exposed.json"
"$repo/contracts/check" ui-source "$out/exposed.json" \
	|| fail "parse output does not match ui-source.schema.json"
[ "$(jq .exposed "$out/exposed.json")" = true ] || fail "an item with file content is not exposed"
jq -S . "$exposed" > "$out/expected-item.json"
[ "$(jq -S .item "$out/exposed.json")" = "$(cat "$out/expected-item.json")" ] || fail "the item was not passed through untouched"
[ "$(jq .cacheHit "$out/exposed.json")" = false ] || fail "an observe atom reported a cache hit"
[ "$("$bin" parse "$exposed")" = "registry/ui/sample-badge.tsx
registry/lib/sample-utils.ts" ] || fail "text output is not the file paths in item order"

"$bin" parse "$unexposed" --json > "$out/unexposed.json"
"$repo/contracts/check" ui-source "$out/unexposed.json" \
	|| fail "unexposed output does not match ui-source.schema.json"
[ "$(jq .exposed "$out/unexposed.json")" = false ] || fail "an item with no files is exposed"
[ -z "$("$bin" parse "$unexposed")" ] || fail "text output for an unexposed item is not empty"

jq 'del(.files[1].content)' "$exposed" > "$out/partial.json"
[ "$("$bin" parse "$out/partial.json" --json | jq .exposed)" = false ] || fail "an item with a file missing its content is exposed"

if "$bin" registry not-a-url --json > "$out/invalid.json"; then fail "registry not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "registry not-a-url did not report invalid_source"
printf '[]' > "$out/not-item.json"
if "$bin" parse "$out/not-item.json" --json > "$out/bad.json"; then fail "a JSON list exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a JSON list did not report invalid_source"

echo "PASS ui-source"

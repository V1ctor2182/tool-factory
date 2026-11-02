#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/ui-catalog"
fixture="$test_dir/fixtures/kobra-index-trimmed.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL ui-catalog: $1" >&2; exit 1; }

"$bin" parse "$fixture" --json > "$out/catalog.json"
"$repo/contracts/check" ui-catalog "$out/catalog.json" \
	|| fail "parse output does not match ui-catalog.schema.json"
first=$(jq -c '.items[0]' "$out/catalog.json")
[ "$first" = '{"name":"accordion","type":"registry:ui","title":"Accordion","description":null,"itemUrl":"https://kobra.systems/r/accordion.json"}' ] \
	|| fail "first item is $first"
[ "$(jq -c '[.items[].name]' "$out/catalog.json")" = '["accordion","advertisement","ai-editor","alert"]' ] \
	|| fail "parse did not keep the index order"
[ "$(jq .cacheHit "$out/catalog.json")" = false ] || fail "an observe atom reported a cache hit"
"$bin" parse "$fixture" > "$out/catalog.txt"
[ "$(sed -n 1p "$out/catalog.txt")" = "https://kobra.systems/r/accordion.json" ] || fail "text output does not start with the first item URL"

[ "$("$bin" parse "$fixture" --base https://example.test/registry --json | jq -r '.items[0].itemUrl')" = "https://example.test/registry/accordion.json" ] \
	|| fail "--base did not set the item folder"

jq '.items += [.items[0]]' "$fixture" > "$out/duplicate.json"
[ "$("$bin" parse "$out/duplicate.json" --json | jq -c '[.items[].name]')" = '["accordion","advertisement","ai-editor","alert"]' ] \
	|| fail "parse kept a duplicate item"

if "$bin" registry not-a-url --json > "$out/invalid.json"; then fail "registry not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "registry not-a-url did not report invalid_source"
printf '[]' > "$out/not-index.json"
if "$bin" parse "$out/not-index.json" --json > "$out/bad.json"; then fail "a JSON list exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a JSON list did not report invalid_source"

echo "PASS ui-catalog"

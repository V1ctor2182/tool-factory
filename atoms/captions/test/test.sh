#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/captions"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL captions: $1" >&2; exit 1; }

"$bin" parse "$test_dir/fixtures/jNQXAC9IVRw.en.json3" --json > "$out/zoo.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/transcript.schema.json" "$out/zoo.json" > /dev/null \
	|| fail "parse output does not match transcript.schema.json"
first=$(jq -c '.segments[0]' "$out/zoo.json")
[ "$first" = '{"start":1.2,"end":3.36,"text":"All right, so here we are, in front of the elephants"}' ] \
	|| fail "first segment is $first"
jq -S 'del(.source, .cacheHit)' "$out/zoo.json" > "$out/actual.json"
jq -S . "$test_dir/expected/jNQXAC9IVRw.en.json" > "$out/expected.json"
diff "$out/expected.json" "$out/actual.json" || fail "parse output differs from expected/jNQXAC9IVRw.en.json"
[ "$(jq .cacheHit "$out/zoo.json")" = false ] || fail "first parse reported a cache hit"

"$bin" parse "$test_dir/fixtures/jNQXAC9IVRw.en.json3" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second parse missed the cache"
jq -S 'del(.source, .cacheHit)' "$out/again.json" | diff "$out/expected.json" - || fail "cached parse differs from expected/jNQXAC9IVRw.en.json"

if "$bin" get not-a-url --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "not-a-url did not report invalid_source"

echo "PASS captions"

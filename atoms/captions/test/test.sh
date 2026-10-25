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
[ "$(jq -r .method "$out/zoo.json")" = captions ] || fail "method is not captions"
[ "$(jq '.segments | length' "$out/zoo.json")" = 6 ] || fail "expected 6 segments"

if "$bin" get not-a-url --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "not-a-url did not report invalid_source"

echo "PASS captions"

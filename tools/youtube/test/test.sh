#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
run="$test_dir/../run"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL youtube: $1" >&2; exit 1; }

"$run" "https://www.youtube.com/watch?v=jNQXAC9IVRw" --no-digest --json > "$out/transcript.json" 2> "$out/transcript.err"
uvx -q check-jsonschema --schemafile "$repo/contracts/transcript.schema.json" "$out/transcript.json" > /dev/null \
	|| fail "--no-digest output does not match transcript.schema.json"
[ "$(jq -r .method "$out/transcript.json")" = captions ] || fail "the zoo video did not use captions"
[ "$(jq -s '[.[] | select(.name == "captions" and .caller == "youtube")] | length' "$runs")" = 1 ] \
	|| fail "the run log has no captions line with caller youtube"
[ "$(jq -s '[.[] | select(.name == "digest")] | length' "$runs")" = 0 ] || fail "--no-digest ran digest"
[ "$(jq -s 'map(.costUsd) | add == 0' "$runs")" = true ] || fail "--no-digest logged model spend"

if "$run" not-a-url --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "not-a-url did not report invalid_source"

echo "PASS youtube"

#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/motion-measure"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/m.json"

fail() { echo "FAIL motion-measure: $1" >&2; exit 1; }

"$bin" measure "$test_dir/fixtures/sweep/sweep.json" --json > "$out" || fail "measure exited nonzero: $(cat "$out")"
"$repo/contracts/check" motion-measures "$out" || fail "output does not match motion-measures.schema.json"
strip='del(.source, .cacheHit, .runs[].keyFrames)'
[ "$(jq -S "$strip" "$out")" = "$(jq -S . "$test_dir/fixtures/expected.json")" ] \
	|| fail "measures differ from fixtures/expected.json: $(jq -S "$strip" "$out")"
[ "$(jq '[.runs[] | select(.status == "ok") | .keyFrames | length > 0] | all' "$out")" = true ] || fail "an ok run has no key frames"
"$bin" measure "$test_dir/fixtures/sweep/sweep.json" --json > "$out"
[ "$(jq .cacheHit "$out")" = true ] || fail "the second call was not served from cache"
if "$bin" measure /nonexistent/sweep.json --json > "$out"; then fail "a missing sweep exited 0"; fi
[ "$(jq -r .error.code "$out")" = invalid_source ] || fail "a missing sweep did not report invalid_source"
echo "PASS motion-measure"

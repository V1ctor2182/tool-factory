#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/motion-trace"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/t.json"
sweep="$test_dir/fixtures/sweep/sweep.json"
bundle="$test_dir/fixtures/bundle.json"

fail() { echo "FAIL motion-trace: $1" >&2; exit 1; }
trace() { "$bin" trace "$sweep" --run "$1" --box "$2" --bundle "$bundle" --json > "$out" || fail "$1 exited nonzero: $(cat "$out")"; }

strip='del(.source, .cacheHit, .channels[].samples)'
: > "$TOOL_FACTORY_HOME/all.json"
for spec in turn:40,0,160,120 scroll:0,0,200,120 fade:0,0,200,120; do
	trace "${spec%%:*}" "${spec#*:}"
	"$repo/contracts/check" motion-trace "$out" || fail "${spec%%:*} does not match motion-trace.schema.json"
	jq -S "$strip" "$out" >> "$TOOL_FACTORY_HOME/all.json"
done
[ "$(jq -s . "$TOOL_FACTORY_HOME/all.json")" = "$(jq -S . "$test_dir/fixtures/expected.json")" ] \
	|| fail "traces differ from fixtures/expected.json: $(jq -cs . "$TOOL_FACTORY_HOME/all.json")"

trace turn 40,0,160,120
[ "$(jq .cacheHit "$out")" = true ] || fail "the second call was not served from cache"
[ "$(jq -r '.channels[0].name' "$out")" = angle ] || fail "a turn did not read as an angle"
[ "$(jq '.channels[0].periodS == 1' "$out")" = true ] || fail "the turn's period is not 1 s"
[ "$(jq -r '.channels[0].moves[0].fits[0].ease' "$out")" = 'cubic-bezier(.23,1,.32,1)' ] || fail "the turn's curve was not found"
trace fade 0,0,200,120
[ "$(jq -c '[.channels[].name]' "$out")" = '["activity"]' ] || fail "a fade read as a shift or a turn"

if "$bin" trace "$sweep" --run pruned --box 0,0,200,120 --json > "$out"; then fail "a pruned run exited 0"; fi
[ "$(jq -r .error.code "$out")" = invalid_source ] || fail "a pruned run did not report invalid_source"
if "$bin" trace "$sweep" --run turn --box 1,2 --json > "$out"; then fail "a bad box exited 0"; fi
[ "$(jq -r .error.code "$out")" = invalid_args ] || fail "a bad box did not report invalid_args"
echo "PASS motion-trace"

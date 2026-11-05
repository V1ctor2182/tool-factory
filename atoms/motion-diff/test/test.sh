#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/motion-diff"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL motion-diff: $1" >&2; exit 1; }

for f in a b baseline; do sed "s#@FIXTURES@#$test_dir/fixtures#" "$test_dir/fixtures/$f.json" > "$out/$f.json"; done
echo '[{"run": "*", "metric": "cursor", "why": "own design"}]' > "$out/departures.json"

"$bin" compare "$out/a.json" "$out/b.json" --baseline "$out/baseline.json" --departures "$out/departures.json" --json > "$out/d.json" || fail "compare exited nonzero: $(cat "$out/d.json")"
"$repo/contracts/check" motion-diff "$out/d.json" || fail "output does not match motion-diff.schema.json"
list='[.differences[] | {run, metric, severity}] | sort_by(.run, .metric)'
[ "$(jq -S "$list" "$out/d.json")" = "$(jq -S "$list" "$test_dir/fixtures/expected.json")" ] \
	|| fail "differences differ from fixtures/expected.json: $(jq -cS "$list" "$out/d.json")"
[ -f "$(jq -r '.runs[0].sheet' "$out/d.json")" ] || fail "no sheet on disk for the first run"
"$bin" compare "$out/a.json" "$out/a.json" --json > "$out/self.json"
[ "$(jq '.summary.major + .summary.minor' "$out/self.json")" = 0 ] || fail "a page differs from itself: $(jq -c .differences "$out/self.json")"
"$bin" compare "$out/a.json" "$out/b.json" --baseline "$out/baseline.json" --departures "$out/departures.json" --json > "$out/d2.json"
[ "$(jq .cacheHit "$out/d2.json")" = true ] || fail "the second call was not served from cache"
if "$bin" compare /nonexistent "$out/a.json" --json > "$out/bad.json"; then fail "a missing file exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing file did not report invalid_source"
echo "PASS motion-diff"

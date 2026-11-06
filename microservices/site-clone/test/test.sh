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
original="file://$test_dir/fixtures/original.html"

fail() { echo "FAIL site-clone: $1" >&2; exit 1; }

"$run" study "$original" --name t --load-ms 300 --idle-ms 4000 --json > "$out/study.json" 2> "$out/study.err" || fail "study exited nonzero: $(cat "$out/study.json") $(tail -3 "$out/study.err")"
"$repo/contracts/check" site-clone "$out/study.json" || fail "study does not match site-clone.schema.json"
root=$(jq -r .dir "$out/study.json")
for f in facts plan brief map departures; do [ -f "$(jq -r ".files.$f" "$out/study.json")" ] || fail "study did not write $f"; done
[ "$(jq '[.runs[].kind] | (index("walk") != null) and (index("idle") != null) and (index("hover") != null) and (index("click") != null) and (index("path") != null)' "$root/plan.json")" = true ] \
	|| fail "the plan does not cover every input: $(jq -c '[.runs[].kind]' "$root/plan.json")"
if jq -e '.runs[] | select(.kind == "click") | select(.target.selector | test("example"))' "$root/plan.json" > /dev/null; then fail "the plan clicks a link that leaves the page"; fi
[ "$(jq '[.runs[] | select(.status != "ok")] | length' "$root/original/measures.json")" = 0 ] || fail "a run failed on the original: $(jq -c '[.runs[] | select(.status != "ok") | {id, detail}]' "$root/original/measures.json")"

"$run" compare t --clone "file://$test_dir/fixtures/clone.html" --json > "$out/cmp.json" 2> "$out/cmp.err" || fail "compare exited nonzero: $(cat "$out/cmp.json") $(tail -3 "$out/cmp.err")"
"$repo/contracts/check" site-clone "$out/cmp.json" || fail "compare does not match site-clone.schema.json"
has() { jq -e --arg m "$1" '.differences | any(.metric == $m)' "$out/cmp.json" > /dev/null || fail "compare missed $1: $(jq -c '[.differences[] | [.run, .metric]]' "$out/cmp.json")"; }
has sidewaysPx
has hues
has responseMs
[ -f "$(jq -r .files.diff "$out/cmp.json")" ] || fail "compare did not write diff.json"

"$run" compare t --clone "$original" --json > "$out/self.json" 2> /dev/null || fail "a compare of the original exited nonzero"
[ "$(jq -r '.dir | endswith("round-2")' "$out/self.json")" = true ] || fail "the second compare did not start round 2"
[ "$(jq .summary.major "$out/self.json")" = 0 ] || fail "the original differs from itself: $(jq -c '[.differences[] | [.run, .metric, .a, .b]]' "$out/self.json")"

echo '{"nope": {"at": 1}}' > "$root/map.json"
if "$run" compare t --clone "$original" --json > "$out/bad.json" 2> /dev/null; then fail "a map naming an unknown run exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "a bad map did not report invalid_args"
if "$run" compare missing --clone "$original" --json > "$out/none.json" 2> /dev/null; then fail "a missing study exited 0"; fi
[ "$(jq -r .error.code "$out/none.json")" = invalid_args ] || fail "a missing study did not report invalid_args"
echo "PASS site-clone"

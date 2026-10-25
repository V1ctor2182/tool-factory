#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/digest"
fixture="$test_dir/fixtures/factory.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL digest: $1" >&2; exit 1; }

TOOL_FACTORY_CALLER=digest-test "$bin" make --transcript "$fixture" --json > "$out/digest.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/digest.schema.json" "$out/digest.json" > /dev/null \
	|| fail "make output does not match digest.schema.json"
summary=$(jq -r .summary "$out/digest.json" | tr '[:upper:]' '[:lower:]')
case "$summary" in *atoms*) ;; *) fail "summary does not mention atoms: $summary" ;; esac
case "$summary" in *tools*) ;; *) fail "summary does not mention tools: $summary" ;; esac
starts=$(jq -c --slurpfile t "$fixture" '[.chapters[].start] as $c | ($t[0].segments | map(.start | floor)) as $s | ($c == ($c | sort)) and all($c[]; . as $x | $s | index($x) != null)' "$out/digest.json")
[ "$starts" = true ] || fail "chapter starts are out of order or match no segment start: $(jq -c '[.chapters[].start]' "$out/digest.json")"
[ "$(jq -r .transcriptPath "$out/digest.json")" = "$fixture" ] || fail "transcriptPath is not the fixture path"
[ "$(jq .cacheHit "$out/digest.json")" = false ] || fail "first make reported a cache hit"
paid=$(tail -n 1 "$runs")
[ "$(echo "$paid" | jq '.costUsd > 0')" = true ] || fail "the paid run logged no cost: $paid"
[ "$(echo "$paid" | jq -r .caller)" = digest-test ] || fail "the run log did not record the caller: $paid"

"$bin" make --transcript "$fixture" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second make missed the cache"
[ "$(jq ".costUsd == 0" "$out/again.json")" = true ] || fail "a cache hit reported model spend"
[ "$(tail -n 1 "$runs" | jq ".costUsd == 0")" = true ] || fail "the cached run logged a cost"

jq '.segments[0].text = "A transcript the cache has not seen."' "$fixture" > "$out/new.json"
if TOOL_FACTORY_BUDGET_USD=0.0001 "$bin" make --transcript "$out/new.json" --json > "$out/over.json"; then fail "over budget exited 0"; fi
[ "$(jq -r .error.code "$out/over.json")" = budget_exceeded ] || fail "over budget did not report budget_exceeded"
[ "$(tail -n 1 "$runs" | jq ".costUsd == 0")" = true ] || fail "the refused run logged a cost"

if "$bin" make --transcript "$test_dir/no-such-file.json" --json > "$out/missing.json"; then fail "missing file exited 0"; fi
[ "$(jq -r .error.code "$out/missing.json")" = invalid_source ] || fail "missing file did not report invalid_source"
if "$bin" make --json > "$out/no-arg.json"; then fail "no --transcript exited 0"; fi
[ "$(jq -r .error.code "$out/no-arg.json")" = invalid_args ] || fail "no --transcript did not report invalid_args"

echo "PASS digest"

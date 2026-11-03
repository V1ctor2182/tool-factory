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
"$repo/contracts/check" digest "$out/digest.json" \
	|| fail "make output does not match digest.schema.json"
summary=$(jq -r .summary "$out/digest.json" | tr '[:upper:]' '[:lower:]')
case "$summary" in *atoms*) ;; *) fail "summary does not mention atoms: $summary" ;; esac
case "$summary" in *microservices*) ;; *) fail "summary does not mention microservices: $summary" ;; esac
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

notes="$test_dir/fixtures/factory-notes.json"
"$bin" make --transcript "$fixture" --image-notes "$notes" --json > "$out/visual.json" \
	|| fail "make --image-notes failed: $(cat "$out/visual.json")"
"$repo/contracts/check" digest "$out/visual.json" \
	|| fail "make --image-notes output does not match digest.schema.json"
[ "$(jq -c --slurpfile n "$notes" '[$n[0].images[].time] as $t | all(.visual[]; .start as $s | $t | index($s) != null)' "$out/visual.json")" = true ] \
	|| fail "a visual start matches no image note time: $(jq -c '[.visual[].start]' "$out/visual.json")"
jq -r '.visual[].note' "$out/visual.json" | grep -qi terminal \
	|| fail "visual does not mention the terminal from the image notes: $(jq -c .visual "$out/visual.json")"

jq '.segments[0].text = "A transcript the cache has not seen."' "$fixture" > "$out/new.json"
if TOOL_FACTORY_BUDGET_USD=0.0001 "$bin" make --transcript "$out/new.json" --json > "$out/over.json"; then fail "over budget exited 0"; fi
[ "$(jq -r .error.code "$out/over.json")" = budget_exceeded ] || fail "over budget did not report budget_exceeded"
[ "$(tail -n 1 "$runs" | jq ".costUsd == 0")" = true ] || fail "the refused run logged a cost"

if "$bin" make --transcript "$test_dir/no-such-file.json" --json > "$out/missing.json"; then fail "missing file exited 0"; fi
[ "$(jq -r .error.code "$out/missing.json")" = invalid_source ] || fail "missing file did not report invalid_source"
if "$bin" make --json > "$out/no-arg.json"; then fail "no --transcript exited 0"; fi
[ "$(jq -r .error.code "$out/no-arg.json")" = invalid_args ] || fail "no --transcript did not report invalid_args"

stub="$out/stub"
mkdir "$stub"
cat > "$stub/claude" <<'STUB'
#!/bin/sh
printf '%s\n' "$@" > "$STUB_ARGS"
case "$STUB_REPLY" in
	text) echo "Error: the session ended"; exit 1 ;;
	no-cost) echo '{"type":"result","is_error":true,"result":"boom"}' ;;
	cost) echo '{"type":"result","is_error":true,"total_cost_usd":0.02,"result":"boom"}' ;;
	negative) echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":-5,"structured_output":{"summary":"Atoms and microservices.","chapters":[{"start":0,"title":"Intro"}],"keyPoints":["Microservices call atoms."]}}' ;;
esac
STUB
chmod +x "$stub/claude"
STUB_ARGS="$out/stub.args"
export STUB_ARGS

stub_call() {
	rm -f "$STUB_ARGS"
	jq --arg t "$2" '.segments[0].text = $t' "$fixture" > "$out/stubbed.json"
	if env -u TOOL_FACTORY_CALL_BUDGET_USD STUB_REPLY="$1" PATH="$stub:$PATH" TOOL_FACTORY_HOME="$out/stub-home" TOOL_FACTORY_BUDGET_USD="${3:-3}" \
		${4:+TOOL_FACTORY_CALL_BUDGET_USD=$4} "$bin" make --transcript "$out/stubbed.json" --json > "$out/stubbed.out"; then
		fail "$1 reply exited 0"
	fi
}
stubbed() { rm -rf "$out/stub-home"; stub_call "$@"; }
stub_cost() { tail -n 1 "$out/stub-home/runs.jsonl" | jq .costUsd; }
stub_cap() { grep -A 1 -x -- --max-budget-usd "$STUB_ARGS" | tail -n 1; }

stubbed text "Unreadable reply."
[ "$(jq -r .error.code "$out/stubbed.out")" = model_error ] || fail "a reply that is not JSON did not report model_error"
[ "$(stub_cap)" = 0.250000 ] || fail "a call with \$3 left passed --max-budget-usd $(stub_cap), not the 0.25 per-call ceiling"
[ "$(stub_cost)" = 0.25 ] || fail "a reply that is not JSON logged $(stub_cost), not the 0.25 per-call ceiling"
stub_call no-cost "A second call the same day."
[ "$(jq -r .error.code "$out/stubbed.out")" = model_error ] || fail "a second call after an unknown-cost failure reported $(jq -r .error.code "$out/stubbed.out")"
[ -e "$STUB_ARGS" ] || fail "a second call after an unknown-cost failure did not reach claude"
[ "$(stub_cost)" = 0.25 ] || fail "a JSON reply without a cost logged $(stub_cost), not the 0.25 per-call ceiling"
stubbed no-cost "Less budget left than the ceiling." 0.1
[ "$(stub_cap)" = 0.100000 ] || fail "a call with \$0.1 left passed --max-budget-usd $(stub_cap), not 0.1"
[ "$(stub_cost)" = 0.1 ] || fail "a call with \$0.1 left logged $(stub_cost), not 0.1"
stubbed text "A smaller ceiling." 3 0.05
[ "$(stub_cost)" = 0.05 ] || fail "TOOL_FACTORY_CALL_BUDGET_USD=0.05 logged $(stub_cost), not 0.05"
stubbed cost "Reply with a cost."
[ "$(stub_cost)" = 0.02 ] || fail "a failed reply with a cost logged $(stub_cost), not its 0.02"

rm -rf "$out/stub-home"
jq '.segments[0].text = "A reply with a negative cost."' "$fixture" > "$out/stubbed.json"
env -u TOOL_FACTORY_CALL_BUDGET_USD STUB_REPLY=negative PATH="$stub:$PATH" TOOL_FACTORY_HOME="$out/stub-home" "$bin" make --transcript "$out/stubbed.json" --json > "$out/stubbed.out" \
	|| fail "a reply with a negative cost failed: $(cat "$out/stubbed.out")"
"$repo/contracts/check" digest "$out/stubbed.out" \
	|| fail "a reply with a negative cost broke digest.schema.json: $(jq -c .costUsd "$out/stubbed.out")"
[ "$(stub_cost)" = 0.25 ] || fail "a reply with a negative cost logged $(stub_cost), not the 0.25 per-call ceiling"

for caps in "3 0" "3 0.0000004" "0.0000004 0.25"; do
	set -- $caps
	stubbed cost "Cap $1 $2." "$1" "$2"
	[ "$(jq -r .error.code "$out/stubbed.out")" = budget_exceeded ] || fail "budget $1 and ceiling $2 did not report budget_exceeded"
	[ ! -e "$STUB_ARGS" ] || fail "budget $1 and ceiling $2 reached claude with --max-budget-usd $(stub_cap)"
done

for budget in nan inf -inf -1; do
	stubbed cost "Budget $budget." "$budget"
	[ "$(jq -r .error.code "$out/stubbed.out")" = invalid_args ] || fail "budget $budget did not report invalid_args"
	[ ! -e "$STUB_ARGS" ] || fail "budget $budget reached claude"
done
for ceiling in nan -1; do
	stubbed cost "Ceiling $ceiling." 3 "$ceiling"
	[ "$(jq -r .error.code "$out/stubbed.out")" = invalid_args ] || fail "ceiling $ceiling did not report invalid_args"
	[ ! -e "$STUB_ARGS" ] || fail "ceiling $ceiling reached claude"
done
TOOL_FACTORY_BUDGET_USD=nan "$bin" make --transcript "$fixture" --json > "$out/cached-nan.json" \
	|| fail "a cache hit read the budget"

echo "PASS digest"

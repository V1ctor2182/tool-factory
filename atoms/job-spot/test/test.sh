#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/job-spot"
fixtures="$test_dir/fixtures"
sessions="$fixtures/stub-sessions.json"
catalog="$fixtures/stub-catalog.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL job-spot: $1" >&2; exit 1; }

stub="$out/stub"
mkdir "$stub"
cat > "$stub/claude" <<'STUB'
#!/bin/sh
echo call >> "$STUB_CALLS"
jq -c . "$STUB_REPLY"
STUB
chmod +x "$stub/claude"
STUB_CALLS="$out/calls"
STUB_REPLY="$fixtures/stub-reply.json"
export STUB_CALLS STUB_REPLY
: > "$STUB_CALLS"
calls() { wc -l < "$STUB_CALLS" | tr -d ' '; }
find_stubbed() { PATH="$stub:$PATH" "$bin" find --sessions "$sessions" --catalog "$catalog" --json "$@"; }

find_stubbed > "$out/first.json"
"$repo/contracts/check" job-candidates "$out/first.json" \
	|| fail "find output does not match job-candidates.schema.json"
[ "$(calls)" = 1 ] || fail "the first find made $(calls) model calls"
[ "$(jq -c '[.candidates[].slug]' "$out/first.json")" = '["most-seen","alpha-tie","skill-covered","zeta-tie"]' ] \
	|| fail "candidates are not sorted by session count, then slug: $(jq -c '[.candidates[].slug]' "$out/first.json")"
[ "$(jq -c '[.candidates[] | select(.slug == "alpha-tie") | .citations[].sessionId]' "$out/first.json")" = '["s2","s3","s4"]' ] \
	|| fail "repeats and unknown ids stayed in citations: $(jq -c '.candidates[1].citations' "$out/first.json")"
[ "$(jq -r '.candidates[] | select(.slug == "skill-covered") | .coveredBy' "$out/first.json")" = release-it ] \
	|| fail "a coveredBy naming a skill was removed"
[ "$(jq -r '.candidates[] | select(.slug == "zeta-tie") | .missing[0].name' "$out/first.json")" = release-it ] \
	|| fail "a missing atom named like a skill was removed"
[ "$(jq -c '.candidates[] | select(.slug == "alpha-tie") | .coveredBy' "$out/first.json")" = null ] \
	|| fail "a coveredBy absent from the catalog was not nulled"
[ "$(jq -r '.candidates[] | select(.slug == "most-seen") | .coveredBy' "$out/first.json")" = podcast ] \
	|| fail "a coveredBy in the catalog was removed"
[ "$(jq -c '.candidates[] | select(.slug == "zeta-tie") | .coveredBy' "$out/first.json")" = null ] \
	|| fail "a coveredBy naming an atom was not nulled"
[ "$(jq -c '.candidates[] | select(.slug == "alpha-tie") | .reuses' "$out/first.json")" = '["page-read","digest"]' ] \
	|| fail "reuses is $(jq -c '.candidates[1].reuses' "$out/first.json"), which should drop ghost-atom and the microservice, and add digest once"
[ "$(jq -c '.candidates[] | select(.slug == "alpha-tie") | .missing' "$out/first.json")" = '[{"name":"new-atom","kind":"observe","noun":"new noun"}]' ] \
	|| fail "missing still holds a catalog name: $(jq -c '.candidates[1].missing' "$out/first.json")"
[ "$(jq -c .dropped "$out/first.json")" = '[{"slug":"thin","reason":"too_few_sessions"},{"slug":"one-object","reason":"too_few_objects"},{"slug":"invented","reason":"too_few_sessions"}]' ] \
	|| fail "thin, one-object, and invented citations were not dropped: $(jq -c .dropped "$out/first.json")"
[ "$(jq -c '[.sessionCount, .minSessions, .minObjects, .model, .costUsd, .cacheHit]' "$out/first.json")" = '[4,3,2,"sonnet",0.01,false]' ] \
	|| fail "the summary fields are $(jq -c '[.sessionCount, .minSessions, .minObjects, .model, .costUsd, .cacheHit]' "$out/first.json")"
[ "$(tail -n 1 "$runs" | jq .costUsd)" = 0.01 ] || fail "the run log did not record the cost"

find_stubbed --min-sessions 1 --min-objects 1 > "$out/low.json"
"$repo/contracts/check" job-candidates "$out/low.json" || fail "the cached output does not match job-candidates.schema.json"
[ "$(calls)" = 1 ] || fail "a new --min-sessions called the model"
[ "$(jq -c '[.cacheHit, .costUsd == 0, .minSessions]' "$out/low.json")" = '[true,true,1]' ] \
	|| fail "the cached find reported $(jq -c '[.cacheHit, .costUsd, .minSessions]' "$out/low.json")"
[ "$(jq -c '[.candidates[].slug]' "$out/low.json")" = '["most-seen","alpha-tie","one-object","skill-covered","zeta-tie","invented","thin"]' ] \
	|| fail "low gates did not keep every candidate: $(jq -c '[.candidates[].slug]' "$out/low.json")"
[ "$(jq -c .dropped "$out/low.json")" = '[]' ] || fail "low gates dropped a candidate"
[ "$(jq -c '[.candidates[] | select(.slug == "invented") | .citations[].sessionId]' "$out/low.json")" = '["s1","s2"]' ] \
	|| fail "a citation whose object is not in its session stayed: $(jq -c '.candidates' "$out/low.json")"
[ "$(jq -r '.candidates[] | select(.slug == "one-object") | .citations | map(.object) | unique | length' "$out/low.json")" = 2 ] \
	|| fail "the one-object fixture no longer spells one object in two cases"
[ "$(tail -n 1 "$runs" | jq ".costUsd == 0")" = true ] || fail "the cached run logged a cost"

find_stubbed --min-sessions 4 > "$out/high.json"
[ "$(jq -c '[.candidates[].slug]' "$out/high.json")" = '["most-seen"]' ] || fail "--min-sessions 4 kept $(jq -c '[.candidates[].slug]' "$out/high.json")"
[ "$(jq -c '[.dropped[].slug]' "$out/high.json")" = '["zeta-tie","alpha-tie","thin","one-object","invented","skill-covered"]' ] || fail "--min-sessions 4 dropped $(jq -c '[.dropped[].slug]' "$out/high.json")"
[ "$(calls)" = 1 ] || fail "--min-sessions 4 called the model"

jq '.sessions[0].prompts = ["A changed prompt."]' "$sessions" > "$out/changed.json"
PATH="$stub:$PATH" "$bin" find --sessions "$out/changed.json" --catalog "$catalog" --json > "$out/changed.out"
[ "$(calls)" = 2 ] || fail "changed sessions read the old cache"
jq '.parts += [{"name": "extra", "type": "atom", "description": "New."}]' "$catalog" > "$out/catalog.json"
PATH="$stub:$PATH" "$bin" find --sessions "$sessions" --catalog "$out/catalog.json" --json > "$out/changed.out"
[ "$(calls)" = 3 ] || fail "a changed catalog read the old cache"

echo '{"sessions": []}' > "$out/empty.json"
PATH="$stub:$PATH" "$bin" find --sessions "$out/empty.json" --catalog "$catalog" --json > "$out/empty.out"
"$repo/contracts/check" job-candidates "$out/empty.out" || fail "the empty output does not match job-candidates.schema.json"
[ "$(calls)" = 3 ] || fail "an empty session list called the model"
[ "$(jq -c '[.sessionCount, .candidates, .costUsd == 0]' "$out/empty.out")" = '[0,[],true]' ] || fail "an empty session list gave $(cat "$out/empty.out")"

find_text=$(PATH="$stub:$PATH" "$bin" find --sessions "$sessions" --catalog "$catalog")
[ "$(echo "$find_text" | tail -n 1)" = "4 candidates, 3 dropped, from 4 sessions." ] || fail "text output ends with $(echo "$find_text" | tail -n 1)"

expect() {
	code=$1
	shift
	if PATH="$stub:$PATH" "$bin" find "$@" --json > "$out/bad.json"; then fail "find $* exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = "$code" ] || fail "find $* reported $(jq -r .error.code "$out/bad.json"), not $code"
}
echo '[]' > "$out/list.json"
echo '{"sessions": [{"id": "s1"}]}' > "$out/thin.json"
expect invalid_source --sessions "$test_dir/no-such-file.json" --catalog "$catalog"
expect invalid_source --sessions "$out/list.json" --catalog "$catalog"
expect invalid_source --sessions "$out/thin.json" --catalog "$catalog"
expect invalid_source --sessions "$sessions" --catalog "$test_dir/no-such-file.json"
expect invalid_source --sessions "$sessions" --catalog "$sessions"
expect invalid_args --sessions "$sessions"
expect invalid_args --catalog "$catalog"
expect invalid_args --sessions "$sessions" --catalog "$catalog" --min-sessions 0
expect invalid_args --sessions "$sessions" --catalog "$catalog" --min-objects 0

"$bin" find --sessions "$fixtures/real-sessions.json" --catalog "$fixtures/real-catalog.json" --json > "$out/real.json" \
	|| fail "the real call failed: $(cat "$out/real.json")"
"$repo/contracts/check" job-candidates "$out/real.json" || fail "the real call does not match job-candidates.schema.json"
[ "$(jq '.costUsd > 0' "$out/real.json")" = true ] || fail "the real call reported no cost"
[ "$(jq '[.candidates[] | select([.citations[].sessionId | select(. == "site-a" or . == "site-b" or . == "site-c" or . == "site-d")] | length == 4)] | length' "$out/real.json")" = 1 ] \
	|| fail "no one candidate cites all four site sessions: $(jq -c .candidates "$out/real.json")"
[ "$(jq '[.candidates[].citations[].sessionId | select(. == "footer-typo" or . == "status-chat")] | length' "$out/real.json")" = 0 ] \
	|| fail "a candidate cites the one-off or the status chat: $(jq -c .candidates "$out/real.json")"

echo "PASS job-spot"

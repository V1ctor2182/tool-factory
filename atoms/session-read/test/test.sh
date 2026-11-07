#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/session-read"
root="$test_dir/fixtures/projects"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL session-read: $1" >&2; exit 1; }

"$bin" list --root "$root" --until 2026-10-31 --json > "$out/list.json"
"$repo/contracts/check" session-list "$out/list.json" \
	|| fail "list output does not match session-list.schema.json"
[ "$(jq -c .sessions "$out/list.json")" = '[{"id":"other-project","project":"-synthetic-beta","startedAt":"2026-10-09T09:00:00.000Z","prompts":["Explain how the example.test site works"]},{"id":"human-one","project":"-synthetic-alpha","startedAt":"2026-10-10T09:00:00.000Z","prompts":["Explain how the example.test site works","Now the pricing page. Keep it short.","Third prompt."]},{"id":"desktop-human","project":"-synthetic-alpha","startedAt":"2026-10-14T09:00:00.000Z","prompts":["Typed in the desktop app."]}]' ] \
	|| fail "sessions are $(jq -c .sessions "$out/list.json")"
[ "$(jq -c .skipped "$out/list.json")" = '{"machine":5,"duplicate":1}' ] || fail "skipped is $(jq -c .skipped "$out/list.json")"
[ "$(jq -r .root "$out/list.json")" = "$root" ] || fail "root is $(jq -r .root "$out/list.json")"
[ "$(jq -r .until "$out/list.json")" = 2026-10-31T23:59:59.999Z ] || fail "until is $(jq -r .until "$out/list.json")"
[ "$(jq -r .since "$out/list.json")" = 2026-10-01T23:59:59.999Z ] || fail "since is $(jq -r .since "$out/list.json")"
[ "$(jq .cacheHit "$out/list.json")" = false ] || fail "an observe atom reported a cache hit"

ids() { "$bin" list --root "$root" --json "$@" | jq -c '[.sessions[].id]'; }
[ "$(ids --until 2026-10-10)" = '["other-project","human-one"]' ] || fail "a date until did not include that whole day: $(ids --until 2026-10-10)"
[ "$(ids --until 2026-10-10T09:00:00Z)" = '["other-project","human-one"]' ] || fail "a session starting at until was excluded"
[ "$(ids --until 2026-10-10T08:59:59Z)" = '["other-project"]' ] || fail "a session starting after until was kept"
[ "$(ids --until 2026-10-14 --days 1)" = '["desktop-human"]' ] || fail "--days did not count back from --until"
[ "$(ids --until 2026-09-30)" = '["before-window"]' ] || fail "a past window did not find its session"
[ "$(ids --until 2026-10-11T12:00:00+09:00 --days 2)" = '["other-project","human-one"]' ] || fail "an until with an offset was not read as that instant"

"$bin" list --root "$root" --until 2026-10-10T09:00:00Z --days 1 --max-prompts 1 --max-chars 11 --json > "$out/short.json"
[ "$(jq -c '.sessions[0].prompts' "$out/short.json")" = '["Explain how"]' ] || fail "the limits gave $(jq -c '.sessions[0].prompts' "$out/short.json")"

mkdir -p "$out/after/-a"
cat "$root/-synthetic-alpha/fork-of-one.jsonl" > "$out/after/-a/late.jsonl"
"$bin" list --root "$out/after" --until 2026-10-31 --json > "$out/lone.json"
[ "$(jq -c '[.sessions[].id, .skipped.duplicate]' "$out/lone.json")" = '["late",0]' ] || fail "a lone session counted as a duplicate"

"$bin" list --root "$root" --until 2026-10-31 > "$out/list.txt"
[ "$(tail -n 1 "$out/list.txt")" = "3 sessions since 2026-10-01T23:59:59.999Z. Skipped 5 machine, 1 duplicate." ] || fail "text output ends with $(tail -n 1 "$out/list.txt")"

expect() {
	code=$1
	shift
	if "$bin" list "$@" --json > "$out/bad.json"; then fail "list $* exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = "$code" ] || fail "list $* reported $(jq -r .error.code "$out/bad.json"), not $code"
}
expect invalid_source --root "$test_dir/no-such-folder"
expect invalid_source --root "$test_dir/test.sh"
expect invalid_args --root "$root" --until not-a-date
expect invalid_args --root "$root" --days 0
expect invalid_args --root "$root" --max-prompts 0
expect invalid_args --root "$root" --max-chars 0

echo "PASS session-read"

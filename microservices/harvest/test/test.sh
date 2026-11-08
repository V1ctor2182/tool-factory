#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
run="$test_dir/../run"
root="$test_dir/fixtures/projects"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"
saved="$TOOL_FACTORY_HOME/harvest"

fail() { echo "FAIL harvest: $1" >&2; exit 1; }

stub="$out/stub"
mkdir "$stub"
cat > "$stub/claude" <<'STUB'
#!/bin/sh
echo call >> "$STUB_CALLS"
jq -c . "$STUB_REPLY"
STUB
chmod +x "$stub/claude"
STUB_CALLS="$out/calls"
STUB_REPLY="$test_dir/fixtures/stub-reply.json"
export STUB_CALLS STUB_REPLY
: > "$STUB_CALLS"
skills="$test_dir/fixtures/skills"
scan() { PATH="$stub:$PATH" "$run" scan --root "$root" --skills "$skills" --until 2026-10-31 "$@" 2> "$out/scan.err"; }

scan --json > "$out/scan.json" || fail "scan failed: $(cat "$out/scan.json") $(cat "$out/scan.err")"
"$repo/contracts/check" job-candidates "$out/scan.json" || fail "scan output does not match job-candidates.schema.json"
[ "$(jq -cS . "$saved/latest.json")" = "$(jq -cS . "$out/scan.json")" ] || fail "latest.json is not what scan printed"
[ "$(jq -c '[.candidates[] | [.slug, [.citations[].sessionId]]]' "$out/scan.json")" = '[["site-explainer",["site-a","site-b","site-c"]]]' ] \
	|| fail "candidates are $(jq -c .candidates "$out/scan.json")"
[ "$(jq -c '.candidates[0].reuses' "$out/scan.json")" = '["page-read"]' ] \
	|| fail "the catalog did not reach job-spot, since reuses is $(jq -c '.candidates[0].reuses' "$out/scan.json")"
[ "$(jq -c '[.dropped[].slug]' "$out/scan.json")" = '["site-summary","thin"]' ] || fail "dropped is $(jq -c .dropped "$out/scan.json")"
[ "$(jq .sessionCount "$out/scan.json")" = 3 ] || fail "sessionCount is $(jq .sessionCount "$out/scan.json")"

"$repo/contracts/check" session-list "$saved/sessions.json" || fail "sessions.json does not match session-list.schema.json"
[ "$(jq -c '[.sessions[].id]' "$saved/sessions.json")" = '["site-a","site-b","site-c"]' ] || fail "sessions.json holds $(jq -c '[.sessions[].id]' "$saved/sessions.json")"
for part in session-read job-spot digest podcast harvest; do
	[ "$(jq --arg p "$part" '[.parts[] | select(.name == $p)] | length' "$saved/catalog.json")" = 1 ] || fail "the catalog does not list $part once"
done
[ "$(jq -r '.parts[] | select(.name == "podcast") | .type' "$saved/catalog.json")" = microservice ] || fail "the catalog does not say podcast is a microservice"
[ "$(jq -r '.parts[] | select(.name == "digest") | .type' "$saved/catalog.json")" = atom ] || fail "the catalog does not say digest is an atom"
[ "$(jq -c '[.parts[] | keys] | unique' "$saved/catalog.json")" = '[["description","name","type"]]' ] || fail "a catalog row holds more than name, type, and description"
[ "$(jq -c '[.parts[] | select(.type == "skill") | [.name, .description]]' "$saved/catalog.json")" = '[["release-it","Open a pull request and land it."]]' ] \
	|| fail "the catalog skills are $(jq -c '[.parts[] | select(.type == "skill")]' "$saved/catalog.json")"
[ "$(jq -r '.parts[] | select(.name == "art-desk") | .type' "$saved/catalog.json")" = external ] || fail "the catalog does not list external.json"
grep -q 'skipping skill no-frontmatter' "$out/scan.err" || fail "a skill without frontmatter was not reported: $(cat "$out/scan.err")"

[ "$(jq -sc '[.[] | select(.caller == "harvest") | .name] | sort' "$runs")" = "$(jq -c '.uses | sort' "$test_dir/../manifest.json")" ] \
	|| fail "the atoms scan called are not the uses in its manifest: $(cat "$runs")"

scan --min-sessions 2 > "$out/scan.txt" || fail "plain scan failed"
[ "$(wc -l < "$STUB_CALLS" | tr -d ' ')" = 1 ] || fail "a new --min-sessions called the model"
cat > "$out/expected.txt" <<'TEXT'
site-explainer (3 sessions, 3 objects)
  Understand how this website works.
  Reuses: page-read
  Missing: site-map (observe, site map)

site-summary (2 sessions, 2 objects)
  Summarize this site.
  Covered by podcast

2 candidates, 1 dropped, from 3 sessions. Cost $0.0000.
TEXT
cmp "$out/scan.txt" "$out/expected.txt" || fail "text output is $(cat "$out/scan.txt")"

scan --min-sessions 2 --min-objects 3 --json > "$out/objects.json" || fail "scan --min-objects failed"
[ "$(jq -c '[.minObjects, [.candidates[].slug]]' "$out/objects.json")" = '[3,["site-explainer"]]' ] || fail "--min-objects did not reach job-spot: $(cat "$out/objects.json")"
[ "$(wc -l < "$STUB_CALLS" | tr -d ' ')" = 1 ] || fail "a new --min-objects called the model"

scan --days 1 --json > "$out/narrow.json" || fail "scan --days 1 failed"
[ "$(jq .sessionCount "$out/narrow.json")" = 0 ] || fail "--days did not reach session-read"

if PATH="$stub:$PATH" "$run" scan --root "$test_dir/no-such-folder" --json > "$out/bad.json" 2> /dev/null; then fail "a missing root exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing root reported $(cat "$out/bad.json")"
if "$run" scan --root "$root" --skills "$test_dir/no-such-folder" --json > "$out/bad.json" 2> /dev/null; then fail "a missing skills folder exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing skills folder reported $(cat "$out/bad.json")"
if "$run" scan --root "$root" --until not-a-date --json > "$out/bad.json" 2> /dev/null; then fail "a bad --until exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "a bad --until reported $(cat "$out/bad.json")"
if "$run" scan --bogus --json > "$out/bad.json" 2> /dev/null; then fail "an unknown flag exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "an unknown flag reported $(cat "$out/bad.json")"

echo "PASS harvest"

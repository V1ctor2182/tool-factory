#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
run="$test_dir/../run"
atoms="$test_dir/fixtures/atoms"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL atom-audit: $1" >&2; exit 1; }

"$run" scan --atoms "$atoms" --json > "$out/scan.json" 2> "$out/scan.err" || fail "scan failed: $(cat "$out/scan.json") $(cat "$out/scan.err")"
"$repo/contracts/check" atom-audit "$out/scan.json" || fail "scan output does not match atom-audit.schema.json"
[ "$(jq -c '[.clones[].locations[].file]' "$out/scan.json")" = '["alpha/src/alpha.py","beta/src/beta.py"]' ] || fail "clones are $(jq -c .clones "$out/scan.json")"
[ "$(jq -c .pairs "$out/scan.json")" = '[{"atoms":["alpha","beta"],"sharedLines":6,"shareOfSmaller":0.667}]' ] || fail "pairs are $(jq -c .pairs "$out/scan.json")"
[ "$(jq -c .large "$out/scan.json")" = '[{"atom":"beta","lines":309,"verbs":1}]' ] || fail "large is $(jq -c .large "$out/scan.json")"
[ "$(jq -sc '[.[] | select(.caller == "atom-audit") | .name] | sort' "$runs")" = "$(jq -c '.uses | sort' "$test_dir/../manifest.json")" ] \
	|| fail "the atoms scan called are not the uses in its manifest: $(cat "$runs")"

"$run" scan --atoms "$atoms" --min-size 1000 --json > "$out/none.json" 2> /dev/null
[ "$(jq -c '[.minSize, .clones, .pairs]' "$out/none.json")" = '[1000,[],[]]' ] || fail "--min-size did not reach code-clone: $(cat "$out/none.json")"

"$run" scan --atoms "$atoms" > "$out/scan.txt" 2> /dev/null
cat > "$out/expected.txt" <<'TEXT'
Repeated code
38  alpha/src/alpha.py:4-9  beta/src/beta.py:4-9

Atoms that share the most code
67%  6 lines  alpha and beta

Large atoms to check for a second noun
309 lines  1 verbs  beta
TEXT
cmp "$out/scan.txt" "$out/expected.txt" || fail "text output is $(cat "$out/scan.txt")"

base="$TOOL_FACTORY_HOME/base"
mkdir "$base"
cp -R "$atoms/alpha" "$base/alpha"
"$run" scan --atoms "$atoms" --base "$base" --json > "$out/added.json" 2> /dev/null || fail "scan --base failed: $(cat "$out/added.json")"
"$repo/contracts/check" atom-audit "$out/added.json" || fail "scan --base output does not match atom-audit.schema.json"
[ "$(jq 'has("added")' "$out/scan.json")" = false ] || fail "a scan without --base reports added"

moved="$TOOL_FACTORY_HOME/moved"
cp -R "$atoms" "$moved"
{ printf 'import os\n\n'; cat "$atoms/beta/src/beta.py"; } > "$moved/beta/src/beta.py"
"$run" scan --atoms "$moved" --base "$atoms" --json > "$out/moved.json" 2> /dev/null
[ "$(jq -c '[.clones[0].locations[1].startLine, .added]' "$out/moved.json")" = '[6,[]]' ] || fail "a clone that only moved lines is added: $(cat "$out/moved.json")"

"$run" scan --atoms "$atoms" --base "$base" > "$out/added.txt" 2> /dev/null
cat > "$out/expected-added.txt" <<'TEXT'
Repeated code the base does not have
38  alpha/src/alpha.py:4-9  beta/src/beta.py:4-9
TEXT
cmp "$out/added.txt" "$out/expected-added.txt" || fail "text output with --base is $(cat "$out/added.txt")"

if "$run" scan --atoms "$atoms" --base "$test_dir/no-such-folder" --json > "$out/bad.json" 2> /dev/null; then fail "a missing base exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing base reported $(cat "$out/bad.json")"

if "$run" scan --atoms "$test_dir/no-such-folder" --json > "$out/bad.json" 2> /dev/null; then fail "a missing folder exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing folder reported $(cat "$out/bad.json")"
if "$run" scan --bogus --json > "$out/bad.json" 2> /dev/null; then fail "an unknown flag exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "an unknown flag reported $(cat "$out/bad.json")"

echo "PASS atom-audit"

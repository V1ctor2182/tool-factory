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
runs="$TOOL_FACTORY_HOME/runs.jsonl"
zoo="https://www.youtube.com/watch?v=jNQXAC9IVRw"

fail() { echo "FAIL youtube: $1" >&2; exit 1; }
sh "$test_dir/routing.sh"
matches_manifest() {
	contract=$(jq -r --arg v "$1" '.verbs[] | select(.name == $v) | .output' "$test_dir/../manifest.json")
	uvx -q check-jsonschema --schemafile "$repo/contracts/$contract.schema.json" "$2" > /dev/null \
		|| fail "$1 output does not match the $contract contract its manifest names"
}

"$run" transcript "$zoo" --json > "$out/transcript.json" 2> "$out/transcript.err" \
	|| fail "run transcript failed: $(cat "$out/transcript.json")"
matches_manifest transcript "$out/transcript.json"
[ "$(jq -r .method "$out/transcript.json")" = captions ] || fail "the zoo video did not use captions"
[ "$(jq -s '[.[] | select(.name == "captions" and .caller == "youtube")] | length' "$runs")" = 1 ] \
	|| fail "the run log has no captions line with caller youtube"
[ "$(jq -s 'map(.costUsd) | add == 0' "$runs")" = true ] || fail "the transcript verb logged model spend"

"$run" --json "$zoo" --no-digest > "$out/no-digest.json" 2> "$out/no-digest.err" \
	|| fail "run --no-digest failed: $(cat "$out/no-digest.json")"
[ "$(jq -c 'del(.cacheHit)' "$out/no-digest.json")" = "$(jq -c 'del(.cacheHit)' "$out/transcript.json")" ] \
	|| fail "run <url> --no-digest differs from run transcript <url>"
[ "$(jq -s '[.[] | select(.name == "digest")] | length' "$runs")" = 0 ] || fail "transcript or --no-digest ran digest"

mkdir "$out/stub"
cat > "$out/stub/claude" <<'STUB'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0,"structured_output":{"summary":"A man at the zoo.","chapters":[{"start":0,"title":"Elephants"}],"keyPoints":["Long trunks."]}}'
STUB
chmod +x "$out/stub/claude"
for form in "get $zoo" "$zoo"; do
	PATH="$out/stub:$PATH" "$run" --json $form > "$out/digest.json" 2> "$out/digest.err" \
		|| fail "run $form failed: $(cat "$out/digest.json")"
	matches_manifest get "$out/digest.json"
	[ -f "$(jq -r .transcriptPath "$out/digest.json")" ] || fail "run $form named a transcript path that does not exist"
done

if "$run" ftp://example.com/clip --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "an ftp URL exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "an ftp URL did not report invalid_source"

rm -rf "$TOOL_FACTORY_HOME/youtube"
touch "$TOOL_FACTORY_HOME/youtube"
if PATH="$out/stub:$PATH" "$run" get "$zoo" --json > "$out/blocked.json" 2> "$out/blocked.err"; then fail "a data home where youtube is a file exited 0"; fi
[ "$(jq -r .error.code "$out/blocked.json")" = internal ] \
	|| fail "a data home where youtube is a file did not report internal: $(cat "$out/blocked.json") $(tail -n 1 "$out/blocked.err")"

echo "PASS youtube"

#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
run="$test_dir/../run"
manifest="$test_dir/../manifest.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"
hello="$repo/atoms/transcribe/test/fixtures/hello.aiff"

fail() { echo "FAIL meeting-notes: $1" >&2; exit 1; }
matches_manifest() {
	contract=$(jq -r --arg v "$1" '.verbs[] | select(.name == $v) | .output' "$manifest")
	uvx -q check-jsonschema --base-uri "file://$repo/contracts/" --schemafile "$repo/contracts/$contract.schema.json" "$2" > /dev/null \
		|| fail "$1 output does not match the $contract contract its manifest names"
}

"$run" transcript "$hello" --json > "$out/transcript.json" 2> "$out/transcript.err" \
	|| fail "run transcript failed: $(cat "$out/transcript.json")"
matches_manifest transcript "$out/transcript.json"
text=$(jq -r .text "$out/transcript.json" | tr '[:upper:]' '[:lower:]' | tr -d '[:punct:]')
[ "$text" = "hello from the tool factory" ] || fail "transcript text is '$text'"
[ "$("$run" transcript "$hello" 2> /dev/null)" = "[0:00] Hello from the Tool Factory." ] || fail "plain transcript is not one timed line"
[ "$(jq -s '[.[] | select(.name == "digest")] | length' "$runs")" = 0 ] || fail "the transcript verb ran digest"

mkdir "$out/stub"
cat > "$out/stub/claude" <<'STUB'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0,"structured_output":{"summary":"A greeting from the tool factory.","chapters":[{"start":0,"title":"Greeting"}],"keyPoints":["The factory says hello."]}}'
STUB
chmod +x "$out/stub/claude"
for form in "get $hello" "$hello"; do
	PATH="$out/stub:$PATH" "$run" --json $form > "$out/digest.json" 2> "$out/digest.err" \
		|| fail "run $form failed: $(cat "$out/digest.json")"
	matches_manifest get "$out/digest.json"
	[ "$(jq -r .source "$out/digest.json")" = "$hello" ] || fail "run $form digest names another source"
	[ -f "$(jq -r .transcriptPath "$out/digest.json")" ] || fail "run $form named a transcript path that does not exist"
done
[ "$(jq -sc '[.[] | select(.caller == "meeting-notes") | .name] | unique' "$runs")" = "$(jq -c '.uses | sort' "$manifest")" ] \
	|| fail "the atoms run with caller meeting-notes are not the uses in its manifest"

if "$run" "$test_dir/no-such-file.wav" --json > "$out/missing.json" 2> "$out/missing.err"; then fail "a missing file exited 0"; fi
[ "$(jq -r .error.code "$out/missing.json")" = invalid_source ] || fail "a missing file did not report invalid_source"

rm -rf "$TOOL_FACTORY_HOME/meeting-notes"
touch "$TOOL_FACTORY_HOME/meeting-notes"
if PATH="$out/stub:$PATH" "$run" get "$hello" --json > "$out/blocked.json" 2> "$out/blocked.err"; then fail "a data home where meeting-notes is a file exited 0"; fi
[ "$(jq -r .error.code "$out/blocked.json")" = internal ] \
	|| fail "a data home where meeting-notes is a file did not report internal: $(cat "$out/blocked.json")"

echo "PASS meeting-notes"

#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/transcribe"
fixture="$test_dir/fixtures/hello.aiff"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL transcribe: $1" >&2; exit 1; }

"$bin" file "$fixture" --json > "$out/hello.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/transcript.schema.json" "$out/hello.json" > /dev/null \
	|| fail "file output does not match transcript.schema.json"
text=$(jq -r .text "$out/hello.json" | tr '[:upper:]' '[:lower:]' | tr -d '[:punct:]')
[ "$text" = "hello from the tool factory" ] || fail "text is '$text'"
jq -S 'del(.source, .cacheHit)' "$out/hello.json" > "$out/actual.json"
jq -S . "$test_dir/expected/hello.json" > "$out/expected.json"
diff "$out/expected.json" "$out/actual.json" || fail "file output differs from expected/hello.json"
[ "$(jq .cacheHit "$out/hello.json")" = false ] || fail "first run reported a cache hit"

"$bin" srt "$fixture" > "$out/hello.srt"
cmp "$out/hello.srt" "$test_dir/expected/hello.srt" || fail "srt output differs from expected/hello.srt"

"$bin" file "$fixture" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second run missed the cache"

if "$bin" file "$test_dir/no-such-file.wav" --json > "$out/missing.json"; then fail "missing file exited 0"; fi
[ "$(jq -r .error.code "$out/missing.json")" = invalid_source ] || fail "missing file did not report invalid_source"

echo "PASS transcribe"

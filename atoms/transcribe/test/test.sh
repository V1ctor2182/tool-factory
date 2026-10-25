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
"$bin" srt "$fixture" --json > "$out/srt.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/transcript.schema.json" "$out/srt.json" > /dev/null \
	|| fail "srt --json output does not match transcript.schema.json"
jq -r .srt "$out/srt.json" | cmp - "$test_dir/expected/hello.srt" || fail "srt --json srt field differs from expected/hello.srt"

"$bin" file "$fixture" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second run missed the cache"
"$bin" file "$fixture" --language en --json > "$out/en.json"
[ "$(jq .cacheHit "$out/en.json")" = false ] || fail "--language en reused the auto-detect entry"
"$bin" file "$fixture" --language en --json > "$out/en-again.json"
[ "$(jq .cacheHit "$out/en-again.json")" = true ] || fail "second --language en run missed the cache"
[ "$(ls "$TOOL_FACTORY_HOME/transcribe/cache" | wc -l | tr -d ' ')" = 2 ] || fail "auto and en did not make exactly two cache entries"

if "$bin" file "$test_dir/no-such-file.wav" --json > "$out/missing.json"; then fail "missing file exited 0"; fi
[ "$(jq -r .error.code "$out/missing.json")" = invalid_source ] || fail "missing file did not report invalid_source"

if HF_HOME="$TOOL_FACTORY_HOME/no-weights" HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 "$bin" file "$repo/README.md" --json > "$out/not-audio.json" 2> "$out/not-audio.err"; then fail "README.md exited 0"; fi
[ "$(jq -r .error.code "$out/not-audio.json")" = invalid_source ] || fail "README.md reached the network before the input check"
[ ! -e "$TOOL_FACTORY_HOME/no-weights" ] || fail "README.md touched the weights cache"

echo "PASS transcribe"

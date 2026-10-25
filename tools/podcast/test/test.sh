#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
run="$test_dir/../run"
manifest="$test_dir/../manifest.json"
work=$(mktemp -d)
TOOL_FACTORY_HOME="$work/home"
export TOOL_FACTORY_HOME
out="$work/out"
mkdir -p "$out" "$TOOL_FACTORY_HOME"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

(python3 -c '
import functools, http.server, os, sys
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
server = http.server.HTTPServer(("127.0.0.1", 0), handler)
print(server.server_port, os.getpid(), flush=True)
server.serve_forever()
' "$repo/atoms/transcribe/test/fixtures" > "$work/server" 2> /dev/null &)
trap 'kill $(cut -d" " -f2 "$work/server") 2> /dev/null; rm -rf "$work"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$work/server" ] && break; sleep 0.2; done
episode="http://127.0.0.1:$(cut -d" " -f1 "$work/server")/hello.aiff"

fail() { echo "FAIL podcast: $1" >&2; exit 1; }
matches() {
	uvx -q check-jsonschema --base-uri "file://$repo/contracts/" --schemafile "$repo/contracts/$1.schema.json" "$2" > /dev/null \
		|| fail "$3 does not match the $1 contract"
}
output_of() { jq -r --arg v "$1" '.verbs[] | select(.name == $v) | .output' "$manifest"; }

"$run" transcript "$episode" --json > "$out/transcript.json" 2> "$out/transcript.err" \
	|| fail "run transcript failed: $(cat "$out/transcript.json")"
matches "$(output_of transcript)" "$out/transcript.json" "transcript output"
[ "$(jq -r .source "$out/transcript.json")" = "$episode" ] || fail "the transcript source is not the episode URL"
text=$(jq -r .text "$out/transcript.json" | tr '[:upper:]' '[:lower:]' | tr -d '[:punct:]')
[ "$text" = "hello from the tool factory" ] || fail "transcript text is '$text'"
[ "$(jq -s '[.[] | select(.name == "digest")] | length' "$runs")" = 0 ] || fail "the transcript verb ran digest"

mkdir "$out/stub"
cat > "$out/stub/claude" <<'STUB'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0,"structured_output":{"summary":"A greeting from the tool factory.","chapters":[{"start":0,"title":"Greeting"}],"keyPoints":["The factory says hello."]}}'
STUB
chmod +x "$out/stub/claude"
for form in "get $episode" "$episode"; do
	PATH="$out/stub:$PATH" "$run" --json $form > "$out/digest.json" 2> "$out/digest.err" \
		|| fail "run $form failed: $(cat "$out/digest.json")"
	matches "$(output_of get)" "$out/digest.json" "run $form output"
	[ "$(jq -r .source "$out/digest.json")" = "$episode" ] || fail "run $form digest names another source"
	[ -f "$(jq -r .transcriptPath "$out/digest.json")" ] || fail "run $form named a transcript path that does not exist"
done
[ "$(jq -sc '[.[] | select(.caller == "podcast") | .name] | unique' "$runs")" = '["digest","download","transcribe"]' ] \
	|| fail "an episode URL did not run download, transcribe, and digest with caller podcast"

if "$run" ftp://example.com/episode.mp3 --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "an ftp URL exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "an ftp URL did not report invalid_source"

rm -rf "$TOOL_FACTORY_HOME/podcast"
touch "$TOOL_FACTORY_HOME/podcast"
if PATH="$out/stub:$PATH" "$run" get "$episode" --json > "$out/blocked.json" 2> "$out/blocked.err"; then fail "a data home where podcast is a file exited 0"; fi
[ "$(jq -r .error.code "$out/blocked.json")" = internal ] \
	|| fail "a data home where podcast is a file did not report internal: $(cat "$out/blocked.json")"
rm "$TOOL_FACTORY_HOME/podcast"

fake="$work/repo"
mkdir -p "$fake/tools/podcast"
cp "$run" "$manifest" "$fake/tools/podcast/"
STUB_LOG="$work/calls"
REPO="$repo"
export STUB_LOG REPO
cat > "$work/atom" <<'STUB'
#!/bin/sh
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$STUB_LOG"
case "$name $2" in
"find-url nothing") echo '{"source":"nothing","items":[],"cacheHit":false}' ;;
"find-url "*) echo '{"source":"words","items":[{"url":"https://example.com/ep1","id":"ep1","title":"One","durationSec":60},{"url":"https://example.com/broken","id":"broken","title":"Broken","durationSec":60}],"cacheHit":false}' ;;
"download https://example.com/broken") echo '{"error":{"code":"unavailable","message":"stub refused"}}'; exit 1 ;;
"download "*) jq -cn --arg s "$2" --arg p "$REPO/atoms/transcribe/test/fixtures/hello.aiff" '{source: $s, path: $p, kind: "audio", extractor: "stub", id: "ep1", title: "One", durationSec: 2, bytes: 1, cacheHit: false}'; exit "${DOWNLOAD_EXIT:-0}" ;;
*) exec "$REPO/atoms/$name/bin/$name" "$@" ;;
esac
STUB
for name in find-url download transcribe digest; do
	mkdir -p "$fake/atoms/$name/bin"
	cp "$work/atom" "$fake/atoms/$name/bin/$name"
	chmod +x "$fake/atoms/$name/bin/$name"
done

PATH="$out/stub:$PATH" "$fake/tools/podcast/run" "tool factory" --limit 2 --site scsearch --json > "$out/search.json" 2> "$out/search.err" \
	|| fail "run <words> failed: $(cat "$out/search.json")"
matches "$(output_of search)" "$out/search.json" "search output"
[ "$(jq -c '[(.items | length), .failed[].url, .failed[].error.code]' "$out/search.json")" = '[1,"https://example.com/broken","unavailable"]' ] \
	|| fail "search did not digest one episode and list the broken one as failed: $(jq -c . "$out/search.json")"
grep -qx 'find-url search tool factory --limit 2 --site scsearch --json' "$STUB_LOG" || fail "search did not pass the words, limit, and site to find-url: $(cat "$STUB_LOG")"
[ "$(cut -d' ' -f1 "$STUB_LOG" | sort -u | jq -Rsc 'split("\n") | map(select(. != ""))')" = "$(jq -c '.uses | sort' "$manifest")" ] \
	|| fail "the atoms search called are not the uses in its manifest: $(cut -d' ' -f1 "$STUB_LOG" | sort -u | tr '\n' ' ')"

if "$fake/tools/podcast/run" search nothing --json > "$out/none.json" 2> "$out/none.err"; then fail "a search with no results exited 0"; fi
[ "$(jq -r .error.code "$out/none.json")" = no_results ] || fail "a search with no results did not report no_results"

if DOWNLOAD_EXIT=1 "$fake/tools/podcast/run" transcript https://example.com/ep1 --json > "$out/exit1.json" 2> /dev/null; then fail "a download that printed JSON and exited 1 exited 0"; fi
[ "$(jq -r .error.message "$out/exit1.json")" = "download exited 1 without an error object on stdout" ] \
	|| fail "a download that printed JSON and exited 1 did not report it as internal: $(cat "$out/exit1.json")"
[ "$(jq -r .error.code "$out/exit1.json")" = internal ] || fail "a download that printed JSON and exited 1 did not report internal"

echo "PASS podcast"

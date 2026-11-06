#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-bundle"
site="$test_dir/fixtures/site"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL page-bundle: $1" >&2; exit 1; }

"$bin" parse "$site" --json > "$out/parse.json"
"$repo/contracts/check" page-bundle "$out/parse.json" \
	|| fail "parse output does not match page-bundle.schema.json"
[ "$(jq -r .source "$out/parse.json")" = "$site" ] || fail "source is not the folder passed"
[ "$(jq -S 'del(.dir, .source)' "$out/parse.json")" = "$(jq -S . "$test_dir/fixtures/expected.json")" ] \
	|| fail "parse output differs from fixtures/expected.json: $(jq -S 'del(.dir, .source)' "$out/parse.json")"
[ "$("$bin" parse "$site")" = "build vite
view snabbdom
render pixi
style tailwind" ] || fail "text output is not one layer and name per line"

if "$bin" parse "$out" --json > "$out/empty.json"; then fail "a folder without index.html exited 0"; fi
[ "$(jq -r .error.code "$out/empty.json")" = invalid_source ] || fail "a folder without index.html did not report invalid_source"
if "$bin" fetch not-a-url --json > "$out/invalid.json"; then fail "fetch not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "fetch not-a-url did not report invalid_source"

python3 -I -c '
import functools, http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = http.server.HTTPServer(("127.0.0.1", 0), functools.partial(H, directory=sys.argv[1]))
print(s.server_port, flush=True)
s.serve_forever()
' "$site" > "$out/port" &
server=$!
trap 'kill $server; wait $server 2>/dev/null || :; rm -rf "$TOOL_FACTORY_HOME"' EXIT
while [ ! -s "$out/port" ]; do sleep 0.05; done
port=$(cat "$out/port")
base="http://127.0.0.1:$port"
data="$TOOL_FACTORY_HOME/page-bundle/127.0.0.1:$port"

mkdir -p "$data" && touch "$data/stale.js"
"$bin" fetch "$base/" --json > "$out/fetch.json" || fail "fetch exited non-zero: $(cat "$out/fetch.json")"
"$repo/contracts/check" page-bundle "$out/fetch.json" || fail "fetch output does not match page-bundle.schema.json"
[ ! -e "$data/stale.js" ] || fail "fetch kept a file from an earlier call"
[ "$(jq -r .dir "$out/fetch.json")" = "$data" ] || fail "fetch did not save into the data home"
for field in stack modules storageKeys keys tokens keyframes easings fonts; do
	[ "$(jq -cS ".$field" "$out/fetch.json")" = "$(jq -cS ".$field" "$out/parse.json")" ] || fail "fetch and parse disagree on $field"
done
[ "$(jq -c '[.files[].path]' "$out/fetch.json")" = '["index.html","assets/index-abc123.js","assets/vendor-ghi789.js","assets/index-xyz.css","assets/chunk-def456.js","assets/index-abc123.js.map"]' ] \
	|| fail "fetch did not find the page, scripts, stylesheet, chunk, and map: $(jq -c '[.files[].path]' "$out/fetch.json")"
[ "$(jq -r '.files[1].url' "$out/fetch.json")" = "$base/assets/index-abc123.js" ] || fail "a fetched file does not carry its URL"
cmp -s "$data/assets/chunk-def456.js" "$site/assets/chunk-def456.js" || fail "the chunk was not saved at its URL path"
[ "$(jq -r '.assets[0]' "$out/fetch.json")" = "$base/art/hero.svg" ] || fail "fetch assets are not absolute"

if "$bin" fetch "$base/missing/" --json > "$out/gone.json"; then fail "a 404 page exited 0"; fi
[ "$(jq -r .error.code "$out/gone.json")" = unavailable ] || fail "a 404 page did not report unavailable"
[ -f "$data/index.html" ] || fail "a failed fetch wiped the last good fetch"

echo "PASS page-bundle"

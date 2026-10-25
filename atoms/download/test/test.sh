#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/download"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
out="$TOOL_FACTORY_HOME/out"
site="$TOOL_FACTORY_HOME/site"
mkdir "$out" "$site"
server=
trap 'if [ -n "$server" ]; then kill "$server"; wait "$server" 2> /dev/null || true; fi; rm -rf "$TOOL_FACTORY_HOME"' EXIT

fail() { echo "FAIL download: $1" >&2; exit 1; }

say -o "$site/clip.aiff" "A clip for the download test."
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$site" > "$out/server.log" 2>&1 &
server=$!
port=
for _ in 1 2 3 4 5 6 7 8 9 10; do
	port=$(sed -n 's/.* port \([0-9]*\).*/\1/p' "$out/server.log")
	[ -n "$port" ] && break
	sleep 0.2
done
[ -n "$port" ] || fail "local HTTP server did not start"
url="http://127.0.0.1:$port/clip.aiff"

"$bin" get "$url" --audio --json > "$out/first.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/media.schema.json" "$out/first.json" > /dev/null \
	|| fail "output does not match media.schema.json"
[ "$(jq .cacheHit "$out/first.json")" = false ] || fail "first call reported a cache hit"
record=$(jq -c '{extractor, id, kind, title, durationSec}' "$out/first.json")
[ "$record" = '{"extractor":"Generic","id":"clip","kind":"audio","title":"clip","durationSec":null}' ] \
	|| fail "media record is $record"
path=$(jq -r .path "$out/first.json")
[ "$path" = "$TOOL_FACTORY_HOME/download/files/Generic-clip-audio.aiff" ] || fail "path is $path"
cmp "$path" "$site/clip.aiff" || fail "downloaded file differs from the served file"

"$bin" get "$url" --audio --json > "$out/second.json"
[ "$(jq .cacheHit "$out/second.json")" = true ] || fail "second call missed the cache"
[ "$(jq -r .path "$out/second.json")" = "$path" ] || fail "second call returned a different path"


echo "PASS download"

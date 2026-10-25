#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/captions"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
out="$TOOL_FACTORY_HOME/out"
site="$TOOL_FACTORY_HOME/site"
mkdir "$out" "$site"
server=
trap 'if [ -n "$server" ]; then kill "$server"; wait "$server" 2> /dev/null || true; fi; rm -rf "$TOOL_FACTORY_HOME"' EXIT

fail() { echo "FAIL captions: $1" >&2; exit 1; }

"$bin" parse "$test_dir/fixtures/jNQXAC9IVRw.en.json3" --json > "$out/zoo.json"
uvx -q check-jsonschema --schemafile "$repo/contracts/transcript.schema.json" "$out/zoo.json" > /dev/null \
	|| fail "parse output does not match transcript.schema.json"
first=$(jq -c '.segments[0]' "$out/zoo.json")
[ "$first" = '{"start":1.2,"end":3.36,"text":"All right, so here we are, in front of the elephants"}' ] \
	|| fail "first segment is $first"
jq -S 'del(.source, .cacheHit)' "$out/zoo.json" > "$out/actual.json"
jq -S . "$test_dir/expected/jNQXAC9IVRw.en.json" > "$out/expected.json"
diff "$out/expected.json" "$out/actual.json" || fail "parse output differs from expected/jNQXAC9IVRw.en.json"
[ "$(jq .cacheHit "$out/zoo.json")" = false ] || fail "first parse reported a cache hit"

"$bin" parse "$test_dir/fixtures/jNQXAC9IVRw.en.json3" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second parse missed the cache"
jq -S 'del(.source, .cacheHit)' "$out/again.json" | diff "$out/expected.json" - || fail "cached parse differs from expected/jNQXAC9IVRw.en.json"

if "$bin" get not-a-url --json > "$out/invalid.json" 2> "$out/invalid.err"; then fail "not-a-url exited 0"; fi
[ "$(jq -r .error.code "$out/invalid.json")" = invalid_source ] || fail "not-a-url did not report invalid_source"

printf '<html><body>Not a video.</body></html>' > "$site/index.html"
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$site" > "$out/server.log" 2>&1 &
server=$!
port=
for _ in 1 2 3 4 5 6 7 8 9 10; do
	port=$(sed -n 's/.* port \([0-9]*\).*/\1/p' "$out/server.log")
	[ -n "$port" ] && break
	sleep 0.2
done
[ -n "$port" ] || fail "local HTTP server did not start"
if "$bin" get "http://127.0.0.1:$port" --json > "$out/page.json" 2> "$out/page.err"; then fail "a page with no video exited 0"; fi
[ "$(jq -r .error.code "$out/page.json")" = invalid_source ] || fail "a page with no video reported $(jq -c .error "$out/page.json")"

printf '[]' > "$out/list.json3"
printf '{"events": [{"segs": [{"utf8": "hi"}]}]}' > "$out/no-start.json3"
for shape in list no-start; do
	if "$bin" parse "$out/$shape.json3" --json > "$out/$shape.json" 2> "$out/$shape.err"; then fail "$shape.json3 exited 0"; fi
	[ "$(jq -r .error.code "$out/$shape.json")" = invalid_source ] || fail "$shape.json3 did not report invalid_source"
done

echo "PASS captions"

#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-links"
page="file://$test_dir/fixtures/catalog.html"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL page-links: $1" >&2; exit 1; }

"$bin" list "$page" --json > "$out/all.json" || fail "list exited nonzero: $(cat "$out/all.json")"
"$repo/contracts/check" page-links "$out/all.json" || fail "list output does not match page-links.schema.json"
[ "$(jq -c '[.source, .cacheHit]' "$out/all.json")" = "[\"$page\",false]" ] || fail "list named $(jq -c '[.source, .cacheHit]' "$out/all.json")"
[ "$(jq -c .items "$out/all.json")" = '[{"url":"file:///pricing","text":"Pricing"},{"url":"file:///components/button","text":"Button"},{"url":"file:///components/input-otp/","text":"Input OTP"},{"url":"file:///components/button/code","text":"Button code"},{"url":"file:///components/icon","text":""}]' ] \
	|| fail "list did not return the rendered same-origin links once each, in document order: $(jq -c .items "$out/all.json")"

"$bin" list "$page" --match '^/components/[^/]+/?$' > "$out/matched.txt" || fail "list --match exited nonzero"
[ "$(cat "$out/matched.txt")" = "$(printf 'file:///components/button\nfile:///components/input-otp/\nfile:///components/icon')" ] \
	|| fail "--match did not keep only component pages: $(cat "$out/matched.txt")"

if "$bin" list "$page" --match '(' --json > "$out/bad.json"; then fail "a broken --match exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "a broken --match did not report invalid_args"
if "$bin" list "ftp://example.test/" --json > "$out/bad.json"; then fail "an ftp URL exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "an ftp URL did not report invalid_source"

echo "PASS page-links"

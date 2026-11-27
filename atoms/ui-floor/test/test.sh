#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/ui-floor"
page="file://$test_dir/fixtures/floor.html"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL ui-floor: $1" >&2; exit 1; }

"$bin" check "$page" --json > "$out/floor.json" || fail "check exited nonzero: $(cat "$out/floor.json")"
"$repo/contracts/check" ui-floor "$out/floor.json" || fail "check output does not match ui-floor.schema.json"
got=$(jq -c '[.findings[] | select(.selector | startswith("#")) | [.rule, .selector]] | sort' "$out/floor.json")
want='[["clipped","#cut"],["emoji-icon","#save"],["low-contrast","#faint"],["off-screen","#far"],["pure-black","#ink"],["pure-black","#save"]]'
[ "$got" = "$want" ] || fail "check found $got, expected $want. The fixture's .ok and #dots break no line."
[ "$(jq -c '[.findings[] | select(.rule == "page-scrolls-sideways") | .widths]' "$out/floor.json")" = '[[390]]' ] \
	|| fail "the page should scroll sideways only at 390 px"

if "$bin" check "ftp://example.test/" --json > "$out/bad.json"; then fail "an ftp URL exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "an ftp URL did not report invalid_source"

echo "PASS ui-floor"

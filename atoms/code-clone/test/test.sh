#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/code-clone"
root="$test_dir/fixtures/parts"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL code-clone: $1" >&2; exit 1; }

"$bin" find --root "$root" --json > "$out/find.json"
"$repo/contracts/check" code-clones "$out/find.json" || fail "find output does not match code-clones.schema.json"
[ "$(jq -c .clones "$out/find.json")" = '[{"size":35,"shape":"3db2187102661a15","locations":[{"part":"alpha","file":"alpha/src/alpha.py","startLine":6,"endLine":10},{"part":"beta","file":"beta/src/beta.py","startLine":6,"endLine":10}]}]' ] \
	|| fail "clones are $(jq -c .clones "$out/find.json")"
[ "$(jq -c .parts "$out/find.json")" = '[{"part":"alpha","lines":14},{"part":"beta","lines":14},{"part":"gamma","lines":10}]' ] \
	|| fail "parts are $(jq -c .parts "$out/find.json")"
[ "$(jq -c '[.fileCount, .unparsed, .minSize, .cacheHit]' "$out/find.json")" = '[4,["gamma/src/broken.py"],25,false]' ] \
	|| fail "the summary fields are $(jq -c '[.fileCount, .unparsed, .minSize, .cacheHit]' "$out/find.json")"

"$bin" find --root "$root" --min-size 36 --json > "$out/high.json"
[ "$(jq -c .clones "$out/high.json")" = '[]' ] || fail "--min-size 36 kept $(jq -c .clones "$out/high.json")"

"$bin" find --root "$root" > "$out/find.txt"
cat > "$out/expected.txt" <<'TEXT'
35  alpha/src/alpha.py:6-10  beta/src/beta.py:6-10
1 clones in 4 files.
TEXT
cmp "$out/find.txt" "$out/expected.txt" || fail "text output is $(cat "$out/find.txt")"

expect() {
	code=$1
	shift
	if "$bin" find "$@" --json > "$out/bad.json"; then fail "find $* exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = "$code" ] || fail "find $* reported $(jq -r .error.code "$out/bad.json"), not $code"
}
expect invalid_source --root "$test_dir/no-such-folder"
expect invalid_source --root "$test_dir/test.sh"
expect invalid_args
expect invalid_args --root "$root" --min-size 0

echo "PASS code-clone"

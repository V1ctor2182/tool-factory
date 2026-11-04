#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-diff"
a="$test_dir/fixtures/a/recording.json"
b="$test_dir/fixtures/b/recording.json"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL page-diff: $1" >&2; exit 1; }

"$bin" compare "$a" "$a" --json > "$out/same.json"
"$repo/contracts/check" page-diff "$out/same.json" || fail "compare output does not match page-diff.schema.json"
[ "$(jq '.score == 1' "$out/same.json")" = true ] || fail "an identical pair scores $(jq .score "$out/same.json"), not 1"
[ "$(jq '[.states[] | .score == 1, .pixels.mismatch == 0, (.frames[].mismatch == 0)] | all' "$out/same.json")" = true ] \
	|| fail "an identical pair has a state score below 1 or a mismatch above 0"
[ "$(jq -c '[.states[] | .styles + .animations.onlyA + .animations.onlyB + .animations.changed + .motion | length] | add' "$out/same.json")" = 0 ] \
	|| fail "an identical pair lists style, animation, or motion differences"

"$bin" compare "$a" "$b" --json > "$out/first.json"
"$repo/contracts/check" page-diff "$out/first.json" || fail "compare output does not match page-diff.schema.json"
[ "$(jq .cacheHit "$out/first.json")" = false ] || fail "the first compare reported a cache hit"
jq 'del(.a, .b, .cacheHit) | .states[] |= del(.image, .sheet)' "$out/first.json" > "$out/first-normal.json"
diff "$test_dir/fixtures/expected.json" "$out/first-normal.json" > "$out/expected.diff" \
	|| fail "the diff of a and b differs from fixtures/expected.json: $(cat "$out/expected.diff")"
[ "$(jq -r .a "$out/first.json")" = "$a" ] || fail "a is not the absolute path of the first recording"
[ "$(file -b "$(jq -r '.states[0].image' "$out/first.json")")" = "PNG image data, 308 x 60, 8-bit/color RGBA, non-interlaced" ] \
	|| fail "the idle diff image is not a, b, and the heatmap side by side at 100 x 60 with 4 px gaps"
[ "$(file -b "$(jq -r '.states[2].image' "$out/first.json")" | cut -d, -f2)" = " 368 x 60" ] \
	|| fail "the open diff image does not use the wider screenshot for every panel"
[ "$(jq '.states[3].image' "$out/first.json")" = null ] || fail "a missing state has a diff image"
[ "$(file -b "$(jq -r '.states[1].sheet' "$out/first.json")" | cut -d, -f2)" = " 308 x 188" ] \
	|| fail "the hover sheet is not 3 shared frames side by side, each a, b, and the heatmap stacked with 4 px gaps"
[ "$(jq -c '[.states[] | .sheet == null]' "$out/first.json")" = '[true,false,true,true]' ] || fail "a state without shared frames has a sheet"

text=$("$bin" compare "$a" "$b")
expected_text='idle  0.9881  0.0167
hover  0.7061  0.0000
open  0.8810  0.0000
closed  0.0000  missing in b
score 0.6438'
[ "$text" = "$expected_text" ] || fail "text output is: $text"

"$bin" compare "$a" "$b" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "the second compare missed the cache"
[ "$(jq -c 'del(.cacheHit)' "$out/again.json")" = "$(jq -c 'del(.cacheHit)' "$out/first.json")" ] || fail "the cached compare differs from the first"

cp -R "$test_dir/fixtures/a" "$out/a-copy"
"$bin" compare "$out/a-copy/recording.json" "$b" --json > "$out/copy.json"
[ "$(jq .cacheHit "$out/copy.json")" = true ] || fail "a copy of recording a in another folder missed the cache, so the key depends on paths"
[ "$(jq -r .a "$out/copy.json")" = "$(cd "$out/a-copy" && pwd -P)/recording.json" ] || fail "a cache hit kept the old recording's path"

"$bin" compare "$a" "$b" --tolerance 19 --json > "$out/strict.json"
[ "$(jq .cacheHit "$out/strict.json")" = false ] || fail "a different tolerance hit the cache"
[ "$(jq '.states[1].frames[2].mismatch == 1' "$out/strict.json")" = true ] || fail "a frame 20 levels brighter is not a full mismatch at tolerance 19"

if "$bin" compare "$a" "$b" --tolerance 256 --json > "$out/bad-tolerance.json"; then fail "tolerance 256 exited 0"; fi
[ "$(jq -r .error.code "$out/bad-tolerance.json")" = invalid_args ] || fail "tolerance 256 did not report invalid_args"
for source in "$test_dir/fixtures/a/00-idle.styles.json" "$out/no-such.json"; do
	if "$bin" compare "$a" "$source" --json > "$out/bad.json"; then fail "$source exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "$source did not report invalid_source"
done

fixtures="$test_dir/fixtures/a"
with_overlay() { # offset-x at-x: recording a, with one overlay on its idle state.
	mkdir -p "$out/$1-$2"
	jq --arg dir "$fixtures" --argjson ox "$1" --argjson ax "$2" '.states |= map(with_entries(if (.value | type) == "string" and .key != "name" then .value = "\($dir)/\(.value)" elif .key == "frames" then .value |= map("\($dir)/\(.)") else . end)) | .states[0].overlays = [{screenshot: "\($dir)/00-idle.png", dom: "\($dir)/00-idle.dom.html", styles: "\($dir)/00-idle.styles.json", offset: {x: $ox, y: 0}, at: {x: $ax, y: 0}}]' "$a" > "$out/$1-$2/recording.json"
	echo "$out/$1-$2/recording.json"
}
placed=$(with_overlay 10 300)
"$bin" compare "$placed" "$placed" --json > "$out/overlay-same.json"
"$repo/contracts/check" page-diff "$out/overlay-same.json" || fail "a diff with overlays does not match page-diff.schema.json"
[ "$(jq '.states[0].overlays[0] | [.score == 1, .missing, .apartPx]' -c "$out/overlay-same.json")" = '[true,null,0]' ] || fail "an identical overlay does not score 1: $(jq -c .states[0].overlays[0] "$out/overlay-same.json")"
[ "$(file -b "$(jq -r '.states[0].overlays[0].image' "$out/overlay-same.json")" | cut -d, -f1)" = "PNG image data" ] || fail "an overlay has no diff image"

"$bin" compare "$placed" "$a" --json > "$out/overlay-gone.json"
[ "$(jq -c '.states[0].overlays[0] | [.score == 0, .missing]' "$out/overlay-gone.json")" = '[true,"b"]' ] || fail "a rebuild without the overlay does not lose it: $(jq -c .states[0].overlays[0] "$out/overlay-gone.json")"
[ "$(jq '.states[0].score' "$out/overlay-gone.json")" = 0.583333 ] || fail "a state whose overlay is gone scores $(jq .states[0].score "$out/overlay-gone.json"), not 0.7 of its 1.2 in weights"

"$bin" compare "$placed" "$(with_overlay 110 400)" --json > "$out/overlay-far.json"
[ "$(jq -c '.states[0].overlays[0] | [.apartPx, .score]' "$out/overlay-far.json")" = '[100,0.76]' ] || fail "an overlay 100 px away did not lose its placement: $(jq -c '.states[0].overlays[0] | [.apartPx, .score]' "$out/overlay-far.json")"

"$bin" compare "$placed" "$(with_overlay 110 300)" --json > "$out/overlay-centered.json"
[ "$(jq '.states[0].overlays[0].apartPx' "$out/overlay-centered.json")" = 0 ] || fail "a dialog at the same place in the viewport counts as misplaced"

echo "PASS page-diff"

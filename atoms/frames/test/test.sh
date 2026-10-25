#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/frames"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL frames: $1" >&2; exit 1; }

ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=160x120:d=2:r=10 -f lavfi -i color=c=blue:s=160x120:d=2:r=10 \
	-filter_complex "[0][1]concat=n=2:v=1:a=0" -pix_fmt yuv420p "$out/two-scenes.mp4"

"$bin" get "$out/two-scenes.mp4" --json > "$out/first.json"
"$repo/contracts/check" frame-set "$out/first.json" \
	|| fail "get output does not match frame-set.schema.json"
[ "$(jq '[.frames[].time] == [0, 2]' "$out/first.json")" = true ] || fail "frame times are $(jq -c '[.frames[].time]' "$out/first.json")"
[ "$(jq .cacheHit "$out/first.json")" = false ] || fail "first get reported a cache hit"
for path in $(jq -r '.frames[].path' "$out/first.json"); do
	[ "$(file -b --mime-type "$path")" = image/jpeg ] || fail "$path is not a JPEG"
done

"$bin" get "$out/two-scenes.mp4" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "second get missed the cache"
[ "$(jq -c 'del(.cacheHit)' "$out/again.json")" = "$(jq -c 'del(.cacheHit)' "$out/first.json")" ] || fail "cached get differs from the first get"

rm "$(jq -r '.frames[0].path' "$out/first.json")"
"$bin" get "$out/two-scenes.mp4" --json > "$out/third.json"
[ "$(jq .cacheHit "$out/third.json")" = false ] || fail "a missing frame file counted as a cache hit"
[ -f "$(jq -r '.frames[0].path' "$out/third.json")" ] || fail "a missing frame file was not written again"

if "$bin" get "$out/two-scenes.mp4" --threshold 2 --json > "$out/bad-threshold.json"; then fail "threshold 2 exited 0"; fi
[ "$(jq -r .error.code "$out/bad-threshold.json")" = invalid_args ] || fail "threshold 2 did not report invalid_args"
printf 'not a video' > "$out/text.mp4"
for source in "$out/text.mp4" "$out/no-such-file.mp4"; do
	if "$bin" get "$source" --json > "$out/bad.json" 2> "$out/bad.err"; then fail "$source exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "$source did not report invalid_source"
done

echo "PASS frames"

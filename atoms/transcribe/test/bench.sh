#!/bin/sh
# Usage: bench.sh [transcribe bin ...]. Times a cold run and a cached run of each bin on the ten-minute fixture.
# Runs alternate between bins, so drift and warm-up favor none. RUNS sets the rounds, default 5.
# BENCH_OUT, when set, keeps each bin's last cold transcript.
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
[ $# -gt 0 ] || set -- "$test_dir/../bin/transcribe"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
duration=$(sh "$test_dir/make-long-fixture.sh" "$work/ten.aiff")
echo "fixture seconds: $duration" >&2

seconds() { sed -n 's/^real \([0-9.]*\)/\1/p' "$1"; }

printf 'round\tbin\tcold_s\tcached_s\tcold_cache_hit\tcached_cache_hit\tsegments\n'
round=1
while [ "$round" -le "${RUNS:-5}" ]; do
	n=0
	for bin in "$@"; do
		n=$((n + 1))
		home="$work/home-$round-$n"
		TOOL_FACTORY_HOME="$home" /usr/bin/time -p "$bin" file "$work/ten.aiff" --json > "$work/cold.json" 2> "$work/cold.err"
		TOOL_FACTORY_HOME="$home" /usr/bin/time -p "$bin" file "$work/ten.aiff" --json > "$work/cached.json" 2> "$work/cached.err"
		printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$round" "$bin" "$(seconds "$work/cold.err")" "$(seconds "$work/cached.err")" \
			"$(jq .cacheHit "$work/cold.json")" "$(jq .cacheHit "$work/cached.json")" "$(jq '.segments | length' "$work/cold.json")"
		[ -z "${BENCH_OUT:-}" ] || cp "$work/cold.json" "$BENCH_OUT/transcript-$n.json"
	done
	round=$((round + 1))
done

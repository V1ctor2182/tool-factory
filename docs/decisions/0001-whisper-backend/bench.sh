#!/bin/sh
# Usage: bench.sh <out dir>. Times cold runs of faster-whisper small and of the transcribe atom on the ten-minute fixture.
# RUNS sets the rounds, default 5. MODEL sets the atom's whisper.cpp model, default large-v3-turbo-q5_0.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
[ $# -eq 1 ] || { echo "usage: bench.sh <out dir>" >&2; exit 1; }
out=$1
mkdir -p "$out"
sh "$repo/atoms/transcribe/test/make-long-fixture.sh" "$out/ten.aiff" "$out/ten.txt" > "$out/fixture-seconds.txt"

field() { sed -n "s/^$1 \([0-9.]*\)/\1/p" "$2"; }

printf 'round\tbackend\treal_s\tuser_s\n' > "$out/times.tsv"
round=1
while [ "$round" -le "${RUNS:-5}" ]; do
	/usr/bin/time -p uv run --quiet --script "$here/faster_whisper_small.py" "$out/ten.aiff" > "$out/faster-whisper-$round.json" 2> "$out/faster-whisper-$round.err"
	printf '%s\tfaster-whisper small\t%s\t%s\n' "$round" "$(field real "$out/faster-whisper-$round.err")" "$(field user "$out/faster-whisper-$round.err")" >> "$out/times.tsv"
	TOOL_FACTORY_HOME="$out/home-$round" /usr/bin/time -p "$repo/atoms/transcribe/bin/transcribe" file "$out/ten.aiff" --model "${MODEL:-large-v3-turbo-q5_0}" --json > "$out/whisper-cpp-$round.json" 2> "$out/whisper-cpp-$round.err"
	printf '%s\twhisper.cpp %s\t%s\t%s\n' "$round" "${MODEL:-large-v3-turbo-q5_0}" "$(field real "$out/whisper-cpp-$round.err")" "$(field user "$out/whisper-cpp-$round.err")" >> "$out/times.tsv"
	round=$((round + 1))
done
cat "$out/times.tsv"
printf 'transcript\tsource_words\tword_match_pct\n'
python3 "$here/score.py" "$out/ten.txt" "$out"/faster-whisper-*.json "$out"/whisper-cpp-*.json

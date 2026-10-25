#!/bin/sh
# say stops after about 105 seconds on the raw Markdown, so it reads the words with symbols removed.
set -eu
[ $# -eq 1 ] || [ $# -eq 2 ] || { echo "usage: make-long-fixture.sh <out.aiff> [words.txt]" >&2; exit 1; }
repo=$(cd "$(dirname "$0")/../../.." && pwd)
words=$(mktemp)
trap 'rm -f "$words"' EXIT
ten_minutes_of_words=1656
tr -c 'A-Za-z0-9.,;:!?\n ' ' ' < "$repo/ARCHITECTURE.md" | tr -s ' \n\t' '\n\n\n' | head -n "$ten_minutes_of_words" | tr '\n' ' ' > "$words"
say -f "$words" -o "$1"
[ $# -eq 1 ] || cp "$words" "$2"
afinfo "$1" | sed -n 's/^estimated duration: \([0-9.]*\).*/\1/p'

#!/bin/sh
# say stops after about 105 seconds on the raw Markdown, so it reads the words with symbols removed.
# 1656 words of ARCHITECTURE.md at the default voice and rate is about ten minutes.
set -eu
[ $# -eq 1 ] || { echo "usage: make-long-fixture.sh <out.aiff>" >&2; exit 1; }
repo=$(cd "$(dirname "$0")/../../.." && pwd)
words=$(mktemp)
trap 'rm -f "$words"' EXIT
tr -c 'A-Za-z0-9.,;:!?\n ' ' ' < "$repo/ARCHITECTURE.md" | tr -s ' \n\t' '\n\n\n' | head -n 1656 | tr '\n' ' ' > "$words"
say -f "$words" -o "$1"
afinfo "$1" | sed -n 's/^estimated duration: \([0-9.]*\).*/\1/p'

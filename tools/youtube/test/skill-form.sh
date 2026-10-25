#!/bin/sh
set -eu
tool=$(cd "$(dirname "$0")/.." && pwd)
url=${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}
project=$(mktemp -d /private/tmp/youtube-skill-XXXXXX)
trap 'rm -rf "$project"' EXIT
mkdir -p "$project/.claude/skills"
ln -s "$tool" "$project/.claude/skills/youtube"
echo "project: $project" >&2
cd "$project"
claude -p "Summarize $url using the youtube skill" --model sonnet --output-format json \
	--allowedTools "Skill(youtube)" "Bash($project/.claude/skills/youtube/run:*)" "Bash(.claude/skills/youtube/run:*)" "Bash($tool/run:*)" \
	< /dev/null

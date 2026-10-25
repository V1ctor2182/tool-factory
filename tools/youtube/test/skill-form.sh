#!/bin/sh
set -eu
tool=$(cd "$(dirname "$0")/.." && pwd)
url=${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}
project=$(mktemp -d /private/tmp/youtube-skill-XXXXXX)
trap 'rm -rf "$project"' EXIT
TOOL_FACTORY_HOME=${TOOL_FACTORY_HOME:-$(mktemp -d /private/tmp/youtube-skill-home-XXXXXX)}
export TOOL_FACTORY_HOME
echo "data home: $TOOL_FACTORY_HOME" >&2
mkdir -p "$project/.claude/skills"
ln -s "$tool" "$project/.claude/skills/youtube"
echo "project: $project" >&2
cd "$project"
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p "Summarize $url using the youtube skill" --model sonnet --output-format json --no-session-persistence \
	--allowedTools "Skill(youtube)" "Bash($project/.claude/skills/youtube/run:*)" "Bash(.claude/skills/youtube/run:*)" "Bash($tool/run:*)" \
	< /dev/null

#!/bin/sh
# usage: f2-review-capture.sh <out-dir>
# Writes the F2 review-gate captures for lanes 2, 3, and 8 at the checked-out head, each in a fresh data home under /private/tmp.
set -u
repo=$(cd "$(dirname "$0")/../../.." && pwd)
out=$1
head=$(git -C "$repo" rev-parse HEAD)
dirty=$(git -C "$repo" status --porcelain -- atoms tools kit contracts)
mkdir -p "$out"
cd "$repo"

lane() {
	file=$1 url=$2
	home=$(mktemp -d /private/tmp/f2-review-home-XXXXXX)
	{
		echo "head: $head${dirty:+ plus uncommitted code}"
		echo "\$ TOOL_FACTORY_HOME=$home tools/youtube/run $url --json"
		started=$(date +%s)
		TOOL_FACTORY_HOME=$home tools/youtube/run "$url" --json > "$home/stdout" 2> "$home/stderr"
		code=$?
		echo "--- stdout ---"; cat "$home/stdout"
		echo "--- stderr ---"; cat "$home/stderr"
		echo "--- exit $code, wall $(( $(date +%s) - started )) s ---"
		echo "--- digest schema: \$ uvx -q check-jsonschema --schemafile contracts/digest.schema.json stdout ---"
		uvx -q check-jsonschema --schemafile contracts/digest.schema.json "$home/stdout" 2>&1; echo "check-jsonschema exit $?"
		echo "--- transcript method: \$ jq -r .method \"\$(jq -r .transcriptPath stdout)\" ---"
		jq -r .method "$(jq -r .transcriptPath "$home/stdout")"
		echo "--- runs.jsonl ---"; cat "$home/runs.jsonl"
	} > "$out/$file" 2>&1
}

lane f2-review-captions-path.txt https://www.youtube.com/watch?v=jNQXAC9IVRw
lane f2-review-whisper-path.txt https://www.youtube.com/watch?v=7VE8U3Z_av8

home=$(mktemp -d /private/tmp/f2-review-home-XXXXXX)
before=$(ls ~/.claude/projects | wc -l | tr -d ' ')
{
	echo "head: $head${dirty:+ plus uncommitted code}"
	echo "\$ TOOL_FACTORY_HOME=$home sh tools/youtube/test/skill-form.sh"
	TOOL_FACTORY_HOME=$home sh tools/youtube/test/skill-form.sh > "$home/stdout" 2> "$home/stderr"
	code=$?
	echo "--- stdout (claude -p --output-format json, selected fields) ---"
	jq '{result, total_cost_usd, permission_denials, num_turns, modelUsage: (.modelUsage | keys)}' "$home/stdout"
	echo "--- stderr ---"; cat "$home/stderr"
	echo "--- exit $code ---"
	echo "--- runs.jsonl ---"; cat "$home/runs.jsonl"
	echo "--- digest lines in runs.jsonl: $(grep -c '"name":"digest"' "$home/runs.jsonl") ---"
	echo "--- ~/.claude/projects folders: $before before, $(ls ~/.claude/projects | wc -l | tr -d ' ') after ---"
} > "$out/f2-review-skill-form.txt" 2>&1

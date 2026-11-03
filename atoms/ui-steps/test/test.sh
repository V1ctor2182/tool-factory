#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/ui-steps"
TOOL_FACTORY_HOME=$(cd "$(mktemp -d)" && pwd -P)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
rec="$TOOL_FACTORY_HOME/rec"
out="$TOOL_FACTORY_HOME/out"
mkdir "$rec" "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL ui-steps: $1" >&2; exit 1; }

uv run -q --with pillow python - "$rec" <<'PY'
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
rec = Path(sys.argv[1])
image = Image.new("RGB", (240, 80), "#0a0a0a")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 20, 128, 60), radius=8, fill="#fafafa")
draw.text((34, 30), "Options", fill="#0a0a0a", font=ImageFont.load_default(size=16))
image.save(rec / "00-idle.png")
steps = {"url": "https://fixture.test/components/menu", "target": "[data-slot=\"preview-stage\"]", "viewport": {"width": 1024, "height": 640}, "colorScheme": "light", "states": [{"name": "idle", "actions": []}]}
(rec / "survey.json").write_text(json.dumps(steps))
dom = ('<div data-slot="preview-stage"><div class="menu-x81">'
       '<button type="button" aria-haspopup="menu" aria-expanded="false" class="trigger-a7f">Options</button>'
       '<div role="menu" hidden="" class="panel-c2d" style="transition: opacity 0.18s ease-out, transform 0.18s ease-out">'
       '<button role="menuitem">Rename</button><button role="menuitem">Delete</button></div></div></div>')
(rec / "00-idle.dom.html").write_text(dom)
styles = {":scope > :nth-child(1) > :nth-child(1)": {"background-color": "rgb(250, 250, 250)", "transition": "background-color 0.15s ease-out", "cursor": "pointer"},
          ":scope > :nth-child(1) > :nth-child(2)": {"display": "none", "opacity": "0", "transform": "matrix(0.96, 0, 0, 0.96, 0, -4)", "transition": "opacity 0.18s ease-out, transform 0.18s ease-out"}}
(rec / "00-idle.styles.json").write_text(json.dumps(styles))
(rec / "00-idle.motion.json").write_text(json.dumps({"everyMs": None, "tracks": {}}))
state = {"name": "idle", "screenshot": str(rec / "00-idle.png"), "frames": [], "dom": str(rec / "00-idle.dom.html"), "styles": str(rec / "00-idle.styles.json"), "motion": str(rec / "00-idle.motion.json"), "animations": []}
(rec / "recording.json").write_text(json.dumps({"source": steps["url"], "steps": str(rec / "survey.json"), "dir": str(rec), "states": [state], "cacheHit": False}))
PY
"$repo/contracts/check" page-recording "$rec/recording.json" || fail "the fixture is not a page-recording"

TOOL_FACTORY_CALLER=ui-steps-test "$bin" write "$rec/recording.json" --json > "$out/steps.json" || fail "write exited nonzero: $(cat "$out/steps.json")"
"$repo/contracts/check" ui-steps "$out/steps.json" || fail "write output does not match ui-steps.schema.json"
[ "$(jq -c '.steps | [.url, .target, .viewport, .colorScheme]' "$out/steps.json")" = '["https://fixture.test/components/menu","[data-slot=\"preview-stage\"]",{"width":1024,"height":640},"light"]' ] \
	|| fail "the recording's url, target, viewport, and colorScheme were not kept: $(jq -c .steps "$out/steps.json")"
[ "$(jq -c '.steps.states[0]' "$out/steps.json")" = '{"name":"idle","actions":[]}' ] || fail "idle is not the first state: $(jq -c '.steps.states[0]' "$out/steps.json")"
[ "$(jq '.steps.states | length >= 3 and length <= 5' "$out/steps.json")" = true ] || fail "the steps do not add 2 to 4 states after idle: $(jq -c '.steps.states' "$out/steps.json")"
[ "$(jq '[.steps.states[].actions[] | select(.do == "click" and (.selector | startswith("[data-slot=\"preview-stage\"]")) and (.selector | test("button|haspopup")))] | length > 0' "$out/steps.json")" = true ] \
	|| fail "no state clicks the menu's trigger inside the target: $(jq -c '[.steps.states[].actions]' "$out/steps.json")"
[ "$(jq '[.steps.states[] | select(.actions | any(.do == "click")) | .frames.forMs // 0] | max >= 180' "$out/steps.json")" = true ] \
	|| fail "the click that opens a 180 ms transition is not framed for at least 180 ms: $(jq -c '[.steps.states[] | [.name, .frames]]' "$out/steps.json")"
[ "$(jq .cacheHit "$out/steps.json")" = false ] || fail "the first write reported a cache hit"
paid=$(tail -n 1 "$runs")
[ "$(echo "$paid" | jq '.costUsd > 0')" = true ] || fail "the paid run logged no cost: $paid"
[ "$(echo "$paid" | jq -r .caller)" = ui-steps-test ] || fail "the run log did not record the caller: $paid"
echo "ui-steps test call cost \$$(echo "$paid" | jq .costUsd)" >&2

"$bin" write "$rec/recording.json" --json > "$out/again.json"
[ "$(jq '[.cacheHit, .costUsd == 0]' -c "$out/again.json")" = '[true,true]' ] || fail "the same recording missed the cache: $(jq -c '[.cacheHit, .costUsd]' "$out/again.json")"
[ "$(jq -c .steps "$out/again.json")" = "$(jq -c .steps "$out/steps.json")" ] || fail "the cached steps differ from the first steps"

for bad in "$rec/missing.json" "$rec/00-idle.dom.html"; do
	if "$bin" write "$bad" --json > "$out/bad.json"; then fail "$bad exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "$bad did not report invalid_source"
done
[ "$(jq -s '[.[] | select(.costUsd > 0)] | length' "$runs")" = 1 ] || fail "a call other than the first spent money"

echo "PASS ui-steps"

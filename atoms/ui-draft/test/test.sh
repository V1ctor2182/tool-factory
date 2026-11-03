#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/ui-draft"
TOOL_FACTORY_HOME=$(cd "$(mktemp -d)" && pwd -P)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
rec="$TOOL_FACTORY_HOME/rec"
out="$TOOL_FACTORY_HOME/out"
mkdir "$rec" "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL ui-draft: $1" >&2; exit 1; }

uv run -q --with pillow python - "$rec" <<'PY'
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
rec = Path(sys.argv[1])
font = ImageFont.load_default(size=16)
def button(path, fill):
    image = Image.new("RGB", (136, 60), "#0a0a0a")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 12, 120, 48), radius=8, fill=fill)
    draw.text((48, 20), "Save", fill="#0a0a0a", font=font)
    image.save(rec / path)
for path, fill in (("idle.png", "#fafafa"), ("hover.png", "#d4d4d4"), ("hover-f000.png", "#fafafa"), ("hover-f001.png", "#e5e5e5")):
    button(path, fill)
steps = {"url": "https://fixture.test/button", "target": "[data-preview-root]", "states": [
    {"name": "idle", "actions": []},
    {"name": "hover", "actions": [{"do": "hover", "selector": "button"}], "frames": {"everyMs": 100, "forMs": 200}},
]}
(rec / "steps.json").write_text(json.dumps(steps))
dom = '<div data-preview-root=""><button class="save" data-slot="button">Save</button></div>'
style = {"background-color": "rgb(250, 250, 250)", "color": "rgb(10, 10, 10)", "border-radius": "8px", "padding": "8px 16px", "font-size": "16px", "transition": "background-color 0.2s ease-out"}
states = []
for name, frames, bg in (("idle", [], "rgb(250, 250, 250)"), ("hover", ["hover-f000.png", "hover-f001.png"], "rgb(212, 212, 212)")):
    (rec / f"{name}.dom.html").write_text(dom)
    (rec / f"{name}.styles.json").write_text(json.dumps({":scope": {"background-color": "rgb(10, 10, 10)"}, ":scope > button": {**style, "background-color": bg}}))
    (rec / f"{name}.motion.json").write_text(json.dumps({"everyMs": 100 if frames else None, "tracks": {}}))
    animations = [] if not frames else [{"target": ":scope > button", "pseudoElement": None, "type": "CSSTransition", "name": "background-color", "keyframes": [{"offset": 0, "backgroundColor": "rgb(250, 250, 250)"}, {"offset": 1, "backgroundColor": "rgb(212, 212, 212)"}], "duration": 200, "delay": 0, "endDelay": 0, "easing": "ease-out", "iterations": 1, "direction": "normal", "fill": "backwards"}]
    states.append({"name": name, "screenshot": str(rec / f"{name}.png"), "frames": [str(rec / f) for f in frames], "dom": str(rec / f"{name}.dom.html"), "styles": str(rec / f"{name}.styles.json"), "motion": str(rec / f"{name}.motion.json"), "animations": animations})
recording = {"source": steps["url"], "steps": str(rec / "steps.json"), "dir": str(rec), "states": states, "cacheHit": False}
(rec / "recording.json").write_text(json.dumps(recording))
PY
"$repo/contracts/check" page-recording "$rec/recording.json" || fail "the fixture is not a page-recording"

TOOL_FACTORY_CALLER=ui-draft-test "$bin" write "$rec/recording.json" --name save-button-rebuild --packages clsx,tailwind-merge,motion --json > "$out/draft.json" \
	|| fail "write exited nonzero: $(cat "$out/draft.json")"
"$repo/contracts/check" ui-draft "$out/draft.json" || fail "write output does not match ui-draft.schema.json"
[ "$(jq -r .item.name "$out/draft.json")" = save-button-rebuild ] || fail "the item is not named after --name"
[ "$(jq '[.item.files[] | select(.target == "components/ui/save-button-rebuild.tsx" and (.content | length) > 0)] | length' "$out/draft.json")" = 1 ] \
	|| fail "no file targets components/ui/save-button-rebuild.tsx: $(jq -c '[.item.files[].target]' "$out/draft.json")"
jq -r .demo "$out/draft.json" | grep -q "from ['\"]@/components/ui/save-button-rebuild['\"]" || fail "the demo does not import the component: $(jq -r .demo "$out/draft.json")"
jq -r .demo "$out/draft.json" | grep -q 'data-preview-root' || fail "the demo root has no data-preview-root"
[ "$(jq '.item.dependencies - ["clsx", "tailwind-merge", "motion"] | length' "$out/draft.json")" = 0 ] \
	|| fail "the draft depends on a package --packages does not list: $(jq -c .item.dependencies "$out/draft.json")"
[ "$(jq .cacheHit "$out/draft.json")" = false ] || fail "the first write reported a cache hit"
paid=$(tail -n 1 "$runs")
[ "$(echo "$paid" | jq '.costUsd > 0')" = true ] || fail "the paid run logged no cost: $paid"
[ "$(echo "$paid" | jq -r .caller)" = ui-draft-test ] || fail "the run log did not record the caller: $paid"
echo "ui-draft test call cost \$$(echo "$paid" | jq .costUsd)" >&2

"$bin" write "$rec/recording.json" --name save-button-rebuild --packages motion,clsx,tailwind-merge --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "the same inputs missed the cache"
[ "$(jq '.costUsd == 0' "$out/again.json")" = true ] || fail "a cache hit reported model spend"
[ "$(jq -c 'del(.cacheHit, .costUsd)' "$out/again.json")" = "$(jq -c 'del(.cacheHit, .costUsd)' "$out/draft.json")" ] \
	|| fail "the cached draft differs from the first draft"

for bad in "$rec/missing.json" "$rec/idle.dom.html"; do
	if "$bin" write "$bad" --name x --json > "$out/bad.json"; then fail "$bad exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "$bad did not report invalid_source"
done
if "$bin" write "$rec/recording.json" --name x --diff "$rec/no-diff.json" --json > "$out/bad.json"; then fail "a missing --diff exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "a missing --diff did not report invalid_source"
if "$bin" write "$rec/recording.json" --json > "$out/bad.json"; then fail "write without --name exited 0"; fi
[ "$(jq -r .error.code "$out/bad.json")" = invalid_args ] || fail "write without --name did not report invalid_args"
[ "$(jq -s '[.[] | select(.costUsd > 0)] | length' "$runs")" = 1 ] || fail "a call other than the first spent money"

echo "PASS ui-draft"

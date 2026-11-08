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
    overlays = []
    if frames:
        (rec / "hint.dom.html").write_text('<div role="tooltip" data-slot="tooltip-content">Saves your draft to the shared team folder</div>')
        (rec / "hint.styles.json").write_text(json.dumps({":scope": {"background-color": "rgb(28, 28, 28)", "color": "rgb(250, 250, 250)", "font-size": "12px"}}))
        overlays = [{"screenshot": str(rec / "hover.png"), "dom": str(rec / "hint.dom.html"), "styles": str(rec / "hint.styles.json"), "offset": {"x": 0, "y": -40}, "at": {"x": 100, "y": 60}}]
    states.append({"name": name, "screenshot": str(rec / f"{name}.png"), "frames": [str(rec / f) for f in frames], "dom": str(rec / f"{name}.dom.html"), "styles": str(rec / f"{name}.styles.json"), "motion": str(rec / f"{name}.motion.json"), "animations": animations, "overlays": overlays})
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
jq -r '.demo, .item.files[0].content' "$out/draft.json" | grep -q 'tooltip' || fail "the draft left out the overlay"
if jq -r '.demo, .item.files[0].content' "$out/draft.json" | grep -q 'shared team folder'; then fail "the draft kept the original's sentence"; fi
[ "$(jq .copied "$out/draft.json")" = '[]' ] || fail "the draft reports copied text: $(jq -c .copied "$out/draft.json")"
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

uv run -q --with pillow python - "$rec" <<'PY'
import json, shutil, sys
from pathlib import Path
from PIL import Image, ImageDraw
rec = Path(sys.argv[1])
dots = rec / "dots"
(dots / "s").mkdir(parents=True)
def row(big=None):
    image = Image.new("RGB", (136, 56), "#0a0a0a")
    draw = ImageDraw.Draw(image)
    for i, x in enumerate((28, 68, 108)):
        r = 22 if i == big else 16
        draw.ellipse((x - r, 28 - r, x + r, 28 + r), fill="#60a5fa")
    return image
row().save(dots / "s" / "rest.png")
points = []
for i, x in enumerate((20, 60, 100)):
    row(i).save(dots / "s" / f"{i}.png")
    points.append({"col": i, "row": 0, "x": x, "y": 20, "image": f"s/{i}.png", "cursor": "pointer", "changed": {f":scope > :nth-child({i + 1})": {"scale": "1.38"}}})
(dots / "sweep.json").write_text(json.dumps({"cols": 3, "rows": 1, "dwellMs": 800, "rest": "s/rest.png", "points": points}))
recording = json.loads((rec / "recording.json").read_text())
recording["states"] = [{**recording["states"][0], "screenshot": str(dots / "s" / "rest.png"), "sweep": str(dots / "sweep.json")}]
(dots / "recording.json").write_text(json.dumps(recording))
plain = {**recording, "states": [{k: v for k, v in recording["states"][0].items() if k != "sweep"}]}
(dots / "plain.json").write_text(json.dumps(plain))
worst = {"col": 1, "row": 0, "a": {":scope > :nth-child(2)": {"scale": "1.27"}}, "b": {}, "image": str(dots / "s" / "1.png")}
state = {"name": "idle", "score": 0.9, "sweep": {"agreement": 0, "grid": [[0, 0, 0]], "cursors": 3, "worst": worst}}
(dots / "diff.json").write_text(json.dumps({"score": 0, "states": [state]}))
(dots / "previous.json").write_text(json.dumps({"item": {"name": "dots-rebuild", "files": []}, "demo": "export default function Demo() { return <div data-preview-root /> }", "notes": "first draft"}))
PY
"$repo/contracts/check" page-recording "$rec/dots/recording.json" || fail "the sweep fixture is not a page-recording"
"$bin" write "$rec/dots/recording.json" --name dots-rebuild --packages clsx,tailwind-merge --json > "$out/sweep.json" || fail "a recording with a sweep exited nonzero: $(cat "$out/sweep.json")"
jq -r '.item.files[0].content, .demo, (.item.css | tostring)' "$out/sweep.json" | grep -q '1\.38' || fail "the draft did not take the scale that only the sweep shows: $(jq -r '.item.files[0].content' "$out/sweep.json")"
"$bin" write "$rec/dots/plain.json" --name dots-rebuild --packages clsx,tailwind-merge --previous "$rec/dots/previous.json" --diff "$rec/dots/diff.json" --json > "$out/sweep-diff.json" || fail "a diff with a sweep exited nonzero: $(cat "$out/sweep-diff.json")"
jq -r '.item.files[0].content, .demo, (.item.css | tostring)' "$out/sweep-diff.json" | grep -q '1\.27' || fail "the draft did not take the scale that only the diff's sweep shows: $(jq -r '.item.files[0].content' "$out/sweep-diff.json")"

uv run -q python - "$rec" <<'PY'
import json, sys
from pathlib import Path
rec = Path(sys.argv[1])
words = rec / "words"
words.mkdir()
(words / "steps.json").write_text(json.dumps({"url": "https://fixture.test/words", "target": "main", "states": [{"name": "idle", "actions": [{"do": "click", "selector": "button:has-text('Send the weekly report now')"}]}]}))
(words / "idle.dom.html").write_text("<main><style>.x { content: 'a style rule is not text on the page' }</style><p>The moon isn&#x27;t made of green cheese today</p><p>Three short words</p><button>Send the weekly report now</button><p>Nothing else repeats this sentence anywhere</p></main>")
(words / "tip.dom.html").write_text("<div role='tooltip'>Tea is best with a little milk</div>")
recording = json.loads((rec / "recording.json").read_text())
state = {**recording["states"][0], "dom": str(words / "idle.dom.html"), "overlays": [{"screenshot": str(rec / "hover.png"), "dom": str(words / "tip.dom.html"), "styles": str(rec / "hint.styles.json"), "offset": {"x": 0, "y": 0}, "at": {"x": 0, "y": 0}}]}
(words / "recording.json").write_text(json.dumps({**recording, "steps": str(words / "steps.json"), "states": [state]}))
PY
mkdir "$rec/bin"
cat > "$rec/bin/claude" <<'FAKE'
#!/bin/sh
cat > /dev/null
jq -cn '{type: "result", total_cost_usd: 0, structured_output: {title: "T", description: "D", dependencies: [], css: {}, notes: "n",
	component: "export const a = \"The moon isn&apos;t made of green cheese today\"; export const b = \"a style rule is not text on the page\"; export const c = \"Three short words\"",
	demo: "<button>Send the weekly report now</button><i>tea is best with a little milk and sugar</i><p>Something entirely new</p>"}}'
FAKE
chmod +x "$rec/bin/claude"
PATH="$rec/bin:$PATH" "$bin" write "$rec/words/recording.json" --name words-rebuild --json > "$out/words.json" || fail "the copied-text draft exited nonzero: $(cat "$out/words.json")"
"$repo/contracts/check" ui-draft "$out/words.json" || fail "the copied-text draft does not match ui-draft.schema.json"
[ "$(jq -c .copied "$out/words.json")" = '["The moon isn'"'"'t made of green cheese today","Tea is best with a little milk"]' ] \
	|| fail "copied listed the wrong sentences: $(jq -c .copied "$out/words.json")"

echo "PASS ui-draft"

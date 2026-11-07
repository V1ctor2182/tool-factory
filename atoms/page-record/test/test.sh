#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/page-record"
steps="$test_dir/fixtures/steps.json"
page="file://$test_dir/fixtures/component.html"
TOOL_FACTORY_HOME=$(mktemp -d)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"

fail() { echo "FAIL page-record: $1" >&2; exit 1; }

"$bin" capture "$steps" --url "$page" --json > "$out/first.json"
"$repo/contracts/check" page-recording "$out/first.json" || fail "capture output does not match page-recording.schema.json"
[ "$(jq -r .source "$out/first.json")" = "$page" ] || fail "--url did not override the steps file's url"
[ "$(jq '.states | length' "$out/first.json")" = 3 ] || fail "the recording does not hold 3 states"
[ "$(jq '[.states[].frames | length]' -c "$out/first.json")" = '[0,3,0]' ] || fail "frames {everyMs: 100, forMs: 300} did not give 3 frames on the second state only"
[ "$(jq -r '.states[0].styles' "$out/first.json" | xargs jq -r '.[":scope > :nth-child(1)"]["background-color"]')" = "rgb(29, 78, 216)" ] \
	|| fail "the hovered button's settled background is not the :hover color"
[ "$(jq -c '[.states[1].animations[] | [.type, .name, .duration, .keyframes[0].easing, .target]]' "$out/first.json")" = '[["CSSAnimation","slide",300,"ease-out",":scope > :nth-child(2)"]]' ] \
	|| fail "the click did not record the 300ms slide animation on the dot"
[ "$(jq '.states[2].animations | length' "$out/first.json")" = 0 ] || fail "a finished animation was recorded as running"
motion=$(jq -r '.states[1].motion' "$out/first.json")
[ "$(jq '.tracks[":scope > :nth-child(6)"].opacity | map(tonumber) | [., [1, 0.6667, 0.3333]] | transpose | map(.[0] - .[1] | fabs < 0.01) | length == 3 and all' "$motion")" = true ] \
	|| fail "the bar's main-thread fade was not sampled at 0, 100, and 200 ms: $(jq -c '.tracks[":scope > :nth-child(6)"]' "$motion")"
[ "$(jq -c '.tracks[":scope > :nth-child(2)"].transform | map(split(", ")[4] | tonumber | round)' "$motion")" = '[0,78,135]' ] \
	|| fail "the dot's 300ms ease-out slide to 160px is not at 0, 78, and 135px at 0, 100, and 200 ms: $(jq -c '.tracks[":scope > :nth-child(2)"].transform' "$motion")"
[ "$(jq '.everyMs' "$motion")" = 100 ] || fail "the motion file does not record everyMs 100"
[ "$(jq -c . "$(jq -r '.states[0].motion' "$out/first.json")")" = '{"everyMs":null,"tracks":{}}' ] \
	|| fail "a state without frames has motion tracks"
for dom in $(jq -r '.states[].dom' "$out/first.json"); do
	if grep -qi '<script' "$dom"; then fail "$dom keeps a script element"; fi
done
grep -q 'class="on"' "$(jq -r '.states[1].dom' "$out/first.json")" || fail "the toggled class is missing from the DOM"
grep -q '>saved<' "$(jq -r '.states[1].dom' "$out/first.json")" || fail "the settled state did not wait for the click's 1000ms timeout"

"$bin" capture "$steps" --url "$page" --json > "$out/second.json"
for i in 0 1 2; do
	cmp -s "$(jq -r ".states[$i].screenshot" "$out/first.json")" "$(jq -r ".states[$i].screenshot" "$out/second.json")" \
		|| fail "state $i's settled screenshot differs between two runs"
done
for k in 0 1 2; do
	cmp -s "$(jq -r ".states[1].frames[$k]" "$out/first.json")" "$(jq -r ".states[1].frames[$k]" "$out/second.json")" \
		|| fail "frame $k differs between two runs"
done
if cmp -s "$(jq -r '.states[1].frames[0]' "$out/first.json")" "$(jq -r '.states[1].frames[2]' "$out/first.json")"; then fail "frames 0 and 2 are identical, so the bar's fade did not advance"; fi

jq '.states[1].frames = {"everyMs": 50, "forMs": 300}' "$steps" > "$out/fine.json"
"$bin" capture "$out/fine.json" --url "$page" --json > "$out/fine-out.json"
[ "$(jq '.states[1].frames | length' "$out/fine-out.json")" = 6 ] || fail "frames {everyMs: 50, forMs: 300} did not give 6 frames"
cmp -s "$(jq -r '.states[1].frames[2]' "$out/fine-out.json")" "$(jq -r '.states[1].frames[1]' "$out/first.json")" \
	|| fail "the frame at 100ms depends on how often frames are taken, so frame i is not at i * everyMs"

jq '.states[1].actions[0].selector = "#missing"' "$steps" > "$out/missing.json"
if "$bin" capture "$out/missing.json" --url "$page" --json > "$out/missing-out.json"; then fail "a missing selector exited 0"; fi
[ "$(jq -r .error.code "$out/missing-out.json")" = invalid_source ] || fail "a missing selector did not report invalid_source"
jq -r .error.message "$out/missing-out.json" | grep -q "state 'toggle dot' action 0" || fail "invalid_source does not name the state and action"

jq -n --arg url "$page" '{url: $url, target: "body", states: [{name: "shortcut", actions: [{do: "press", key: "shift"}]}]}' > "$out/bad-key.json"
if "$bin" capture "$out/bad-key.json" --json > "$out/bad-key-out.json"; then fail "an action Playwright refused exited 0"; fi
[ "$(jq -r .error.code "$out/bad-key-out.json")" = invalid_source ] || fail "an action Playwright refused did not report invalid_source: $(cat "$out/bad-key-out.json")"
jq -r .error.message "$out/bad-key-out.json" | grep -q "state 'shortcut' action 0 (press): .*Unknown key" || fail "a refused action does not name the state and Playwright's reason: $(cat "$out/bad-key-out.json")"

hidden="file://$test_dir/fixtures/hidden-first.html"
jq -n --arg url "$hidden" '{url: $url, target: "#stage > *", states: [{name: "idle", actions: []}, {name: "hover", actions: [{do: "hover", selector: "#stage button"}]}]}' > "$out/hidden.json"
"$bin" capture "$out/hidden.json" --json > "$out/hidden-out.json" || fail "a page whose first match is hidden did not record: $(cat "$out/hidden-out.json")"
dom=$(jq -r '.states[0].dom' "$out/hidden-out.json" | xargs cat)
case "$dom" in *Shown*) ;; *) fail "the target is not the first visible match: $dom" ;; esac
case "$dom" in *"src=\"file://$test_dir/fixtures/pixel.png\""*) ;; *) fail "an image's src was not made absolute: $dom" ;; esac
case "$dom" in *srcset*) fail "a relative srcset stayed in the DOM: $dom" ;; esac
jq -n --arg url "$hidden" '{url: $url, target: "#gone", states: [{name: "idle", actions: []}]}' > "$out/gone.json"
if "$bin" capture "$out/gone.json" --json > "$out/gone-out.json"; then fail "a target with no visible match exited 0"; fi
jq -r .error.message "$out/gone-out.json" | grep -q "no visible element matches" || fail "a hidden target did not say so: $(cat "$out/gone-out.json")"

jq -n --arg url "$hidden" '{url: $url, target: "#stage > *", states: [{name: "hidden", actions: [{do: "click", selector: "#hide"}]}]}' > "$out/vanish.json"
if "$bin" capture "$out/vanish.json" --json > "$out/vanish-out.json"; then fail "a target that vanished exited 0"; fi
[ "$(jq -r .error.code "$out/vanish-out.json")" = invalid_source ] || fail "a target that vanished after an action did not report invalid_source: $(cat "$out/vanish-out.json")"

jq -n --arg url "file://$test_dir/fixtures/scroll-driven.html" '{url: $url, target: "body", states: [{name: "idle", actions: []}]}' > "$out/scroll-driven.json"
"$bin" capture "$out/scroll-driven.json" --json > "$out/scroll-driven-out.json" || fail "a page with a scroll-driven animation did not record: $(cat "$out/scroll-driven-out.json")"

jq -n --arg url "file://$test_dir/fixtures/sweep.html" '{url: $url, target: "#stage", states: [
	{name: "idle", actions: [], sweep: {cols: 2, rows: 1, dwellMs: 300}},
	{name: "after", actions: []}]}' > "$out/sweep.json"
"$bin" capture "$out/sweep.json" --json > "$out/sweep-out.json" || fail "a sweep did not record: $(cat "$out/sweep-out.json")"
"$repo/contracts/check" page-recording "$out/sweep-out.json" || fail "a sweep's output does not match page-recording.schema.json"
sweep=$(jq -r '.states[0].sweep' "$out/sweep-out.json")
[ "$(jq -c '[.points[] | [.col, .row, (.x | floor), (.y | floor), .cursor, .changed]]' "$sweep")" = '[[0,0,50,50,"pointer",{":scope > :nth-child(1)":{"scale":"0.5"}}],[1,0,150,50,"pointer",{":scope > :nth-child(2)":{"scale":"0.5"}}]]' ] \
	|| fail "the sweep does not show each box answering the pointer over it: $(jq -c .points "$sweep")"
[ "$(file -b "$(dirname "$sweep")/$(jq -r .rest "$sweep")" | cut -d, -f2)" = " 216 x 116" ] || fail "a sweep image is not the target plus 8 px at device scale 1"
[ "$(jq '.states[0].animations | length' "$out/sweep-out.json")" = 0 ] || fail "the sweep's transitions joined the state's animations"
[ "$(jq '.states[1] | has("sweep")' "$out/sweep-out.json")" = false ] || fail "a state without a sweep has one"
cmp -s "$(jq -r '.states[0].screenshot' "$out/sweep-out.json")" "$(jq -r '.states[1].screenshot' "$out/sweep-out.json")" \
	|| fail "the page did not return to rest after the sweep"
"$bin" capture "$out/sweep.json" --json > "$out/sweep-again.json"
again=$(jq -r '.states[0].sweep' "$out/sweep-again.json")
for image in rest.png 00-00.png 00-01.png; do
	cmp -s "$(dirname "$sweep")/00-idle.sweep/$image" "$(dirname "$again")/00-idle.sweep/$image" || fail "the sweep's $image differs between two runs"
done
[ "$(jq '.drift | length' "$sweep")" = 8 ] || fail "the sweep does not keep eight later rest images"
jq -n --arg url "file://$test_dir/fixtures/effects.html" '{url: $url, target: "#stage", states: [
	{name: "idle", actions: [], sweep: {cols: 1, rows: 1, dwellMs: 200}},
	{name: "sound", actions: [{do: "click", selector: "#tone"}]},
	{name: "video", actions: [{do: "click", selector: "#media"}]},
	{name: "selected", actions: [{do: "select", selector: "#words"}]}]}' > "$out/effects.json"
"$bin" capture "$out/effects.json" --json > "$out/effects-out.json" || fail "a page with effects did not record: $(cat "$out/effects-out.json")"
"$repo/contracts/check" page-recording "$out/effects-out.json" || fail "effects do not match page-recording.schema.json"
[ "$(jq -c '[.states[].effects]' "$out/effects-out.json")" = '[{},{"playback":1},{"playback":1},{}]' ] \
	|| fail "the recording does not count each state's calls: $(jq -c '[.states[].effects]' "$out/effects-out.json")"
grep -q 'selected the words' "$(jq -r '.states[3].dom' "$out/effects-out.json")" || fail "select did not select the element's text"
drifting=$(jq -r '.states[0].sweep' "$out/effects-out.json")
if cmp -s "$(dirname "$drifting")/$(jq -r .rest "$drifting")" "$(dirname "$drifting")/$(jq -r '.drift[0]' "$drifting")"; then fail "a page animating on its own shows no drift"; fi

jq -n --arg url "file://$test_dir/fixtures/drag.html" '{url: $url, states: [
	{name: "held", actions: [{do: "drag", selector: "#thumb", by: {x: 10, y: 0}}], sweep: {cols: 1, rows: 1}},
	{name: "dropped", actions: [{do: "drop"}]}]}' > "$out/held-sweep.json"
if "$bin" capture "$out/held-sweep.json" --json > "$out/held-sweep-out.json"; then fail "a sweep while the pointer is held exited 0"; fi
[ "$(jq -r .error.code "$out/held-sweep-out.json")" = invalid_args ] || fail "a sweep while the pointer is held did not report invalid_args: $(cat "$out/held-sweep-out.json")"

jq -n --arg url "file://$test_dir/fixtures/drag.html" '{url: $url, target: "body", states: [
	{name: "held", actions: [{do: "drag", selector: "#thumb", by: {x: 120, y: 0}}], frames: {everyMs: 50, forMs: 200}},
	{name: "dropped", actions: [{do: "drop"}]}]}' > "$out/drag.json"
"$bin" capture "$out/drag.json" --json > "$out/drag-out.json" || fail "a drag did not record: $(cat "$out/drag-out.json")"
held=$(jq -r '.states[0].dom' "$out/drag-out.json" | xargs cat)
case "$held" in *'data-held="true"'*) ;; *) fail "the pointer was not held through the state: $held" ;; esac
case "$held" in *'>120</output>'*) ;; *) fail "the drag did not move the pointer 120 px: $held" ;; esac
dropped=$(jq -r '.states[1].dom' "$out/drag-out.json" | xargs cat)
case "$dropped" in *data-held*) fail "the drop did not release the pointer: $dropped" ;; esac
trace() { jq -r '.tracks | to_entries[0].value.transform | map(split(", ")[4] | tonumber | . * 10 | round / 10) | join(" ")' "$(jq -r '.states[0].motion' "$1")"; }
want="79.6 93.5 102.6 108.6"
got=$(trace "$out/drag-out.json")
[ "$got" = "$want" ] || fail "a thumb stepped once per animation frame did not follow the page clock during the drag: $got"
"$bin" capture "$out/drag.json" --json > "$out/drag-again.json" || fail "a second drag did not record: $(cat "$out/drag-again.json")"
got=$(trace "$out/drag-again.json")
[ "$got" = "$want" ] || fail "a second run of the same drag recorded other frames: $got"

jq 'del(.states[1])' "$out/drag.json" > "$out/undropped.json"
if "$bin" capture "$out/undropped.json" --json > "$out/undropped-out.json"; then fail "a drag with no drop exited 0"; fi
jq -r .error.message "$out/undropped-out.json" | grep -q "no drop" || fail "a drag with no drop did not say so: $(cat "$out/undropped-out.json")"
jq 'del(.states[0])' "$out/drag.json" > "$out/lone-drop.json"
if "$bin" capture "$out/lone-drop.json" --json > "$out/lone-drop-out.json"; then fail "a drop with no drag exited 0"; fi

jq '.states[0].actions[0] = {"do": "hover"}' "$steps" > "$out/bad.json"
if "$bin" capture "$out/bad.json" --json > "$out/bad-out.json"; then fail "a hover with no selector exited 0"; fi
[ "$(jq -r .error.code "$out/bad-out.json")" = invalid_args ] || fail "a steps file that breaks the schema did not report invalid_args"
jq '.states[1].name = .states[0].name' "$steps" > "$out/repeat.json"
if "$bin" capture "$out/repeat.json" --json > "$out/repeat-out.json"; then fail "steps with a repeated state name exited 0"; fi
[ "$(jq -r .error.code "$out/repeat-out.json")" = invalid_args ] || fail "a repeated state name did not report invalid_args: $(cat "$out/repeat-out.json")"

jq -n --arg url "file://$test_dir/fixtures/overlay.html" '{url: $url, target: "#card", states: [
	{name: "idle", actions: []},
	{name: "hanging", actions: [{do: "click", selector: "#hang"}]},
	{name: "open", actions: [{do: "click", selector: "#open"}]}]}' > "$out/overlay-steps.json"
"$bin" capture "$out/overlay-steps.json" --json > "$out/overlay.json"
"$repo/contracts/check" page-recording "$out/overlay.json" || fail "a recording with overlays does not match page-recording.schema.json"
[ "$(jq -c '[.states[].overlays | length]' "$out/overlay.json")" = '[0,1,2]' ] || fail "idle should show no overlay, hanging the hint, and open the hint and the popup, not $(jq -c '[.states[].overlays | length]' "$out/overlay.json")"
[ "$(jq -c '.states[2].overlays[0] | [.offset, .at]' "$out/overlay.json")" = '[{"x":300,"y":-20},{"x":400,"y":80}]' ] \
	|| fail "the popup is not looked up through its full-viewport wrapper at 400,80: $(jq -c '.states[2].overlays[0] | [.offset, .at]' "$out/overlay.json")"
popup=$(jq -r '.states[2].overlays[0].dom' "$out/overlay.json")
grep -q 'Portal text' "$popup" || fail "the popup's DOM lacks its text"
if grep -qi '<script' "$popup"; then fail "the popup's DOM keeps a script element"; fi
[ "$(jq -r '.[":scope"].width' "$(jq -r '.states[2].overlays[0].styles' "$out/overlay.json")")" = 150px ] || fail "the popup's styles were not recorded"
[ "$(file -b "$(jq -r '.states[2].overlays[0].screenshot' "$out/overlay.json")" | cut -d, -f2)" = " 332 x 152" ] \
	|| fail "the popup's screenshot is not 150 x 60 plus the 8 px margin at scale 2: $(file -b "$(jq -r '.states[2].overlays[0].screenshot' "$out/overlay.json")")"
[ "$(jq -c '.states[1].overlays[0].offset' "$out/overlay.json")" = '{"x":0,"y":110}' ] || fail "the hint hanging off the target is not an overlay: $(jq -c .states[1].overlays "$out/overlay.json")"
[ "$(jq -c '[.states[2].animations[] | [.name, .target]]' "$out/overlay.json")" = '[["rise",":overlay(0)"]]' ] || fail "the popup's animation was not recorded: $(jq -c '[.states[2].animations[] | [.name, .target]]' "$out/overlay.json")"

echo "PASS page-record"

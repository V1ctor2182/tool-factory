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

jq '.states[0].actions[0] = {"do": "hover"}' "$steps" > "$out/bad.json"
if "$bin" capture "$out/bad.json" --json > "$out/bad-out.json"; then fail "a hover with no selector exited 0"; fi
[ "$(jq -r .error.code "$out/bad-out.json")" = invalid_args ] || fail "a steps file that breaks the schema did not report invalid_args"

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

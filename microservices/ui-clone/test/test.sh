#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fake="$work/repo"
TOOL_FACTORY_HOME="$work/home"
STUB_LOG="$work/calls"
export TOOL_FACTORY_HOME STUB_LOG
out="$work/out"
ui="$work/victor-ui"
mkdir -p "$fake/microservices/ui-clone" "$out" "$ui/scripts"
cp "$test_dir/../run" "$test_dir/../manifest.json" "$fake/microservices/ui-clone/"
jq '. + {
	stubsite: {url: "https://stub.test", keepCode: true, terms: "stub terms", catalog: "https://stub.test/components", page: "https://stub.test/components/{name}", stage: "[data-stage]", aliases: {"fancy-card": "card-x"}},
	fullsite: {url: "https://full.test", keepCode: false, terms: null, catalog: "https://full.test/components", page: "https://full.test/components/{name}", stage: "[data-stage]", viewport: {width: 1280, height: 1400}},
	pagesite: {url: "https://pages.test", catalog: "https://pages.test/components", keepCode: false, terms: null}
}' "$test_dir/../sites.json" > "$fake/microservices/ui-clone/sites.json"
run="$fake/microservices/ui-clone/run"

fail() { echo "FAIL ui-clone: $1" >&2; exit 1; }

cat > "$work/stub" <<'STUB'
#!/bin/sh
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$STUB_LOG"
case "$name $1" in
"ui-catalog registry")
	case "$2" in
	https://pages.test) echo '{"error":{"code":"unavailable","message":"HTTP 404 from https://pages.test/r/registry.json"}}'; exit 1 ;;
	https://stub.test) jq -cn '{source: "https://stub.test", index: "https://stub.test/r/registry.json", cacheHit: false, items: [
		["button", "registry:ui"], ["pro-card", "registry:ui"], ["kept-before", "registry:ui"], ["utils", "registry:lib"], ["card-x", "registry:ui"], ["secret", "registry:ui"]
	] | map({name: .[0], type: .[1], title: null, description: null, itemUrl: "https://stub.test/r/\(.[0]).json"})}'; exit 0 ;;
	esac
	jq -cn --arg s "$2" '{source: $s, index: $s, cacheHit: false, items: [
		["input-otp", "registry:ui"], ["pro-card", "registry:ui"], ["paid-block", "registry:block"],
		["utils", "registry:lib"], ["broken", "registry:ui"], ["bad-add", "registry:ui"]
	] | map({name: .[0], type: .[1], title: null, description: null, itemUrl: "https://stub.test/r/\(.[0]).json"})}' ;;
"ui-source registry")
	item=$(basename "$2" .json)
	if [ "$item" = "${STUB_RATE_LIMITED:-}" ]; then echo "{\"error\":{\"code\":\"rate_limited\",\"message\":\"HTTP 429 from $2\"}}"; exit 1; fi
	case "$item" in
	pro-card|secret) jq -cn --arg s "$2" '{source: $s, exposed: false, item: null, cacheHit: false}' ;;
	broken) echo "{\"error\":{\"code\":\"network_error\",\"message\":\"stub could not reach $2\"}}"; exit 1 ;;
	paid-block) jq -cn --arg s "$2" --arg n "$item" '{source: $s, exposed: false, item: {name: $n, files: []}, cacheHit: false}' ;;
	*) jq -cn --arg s "$2" --arg n "$item" '{source: $s, exposed: true, item: {name: $n, type: "registry:ui", files: [{path: "\($n).tsx", content: "export {}"}], cssVars: {theme: {"--ease-out": "linear", "--otp-gap": "4px"}}}, cacheHit: false}' ;;
	esac ;;
"page-record capture")
	case "$*" in
	*--url\ http://localhost:5173/missing*) echo '{"error":{"code":"invalid_source","message":"stub selector not found"}}'; exit 1 ;;
	*--url*)
		if [ -n "${STUB_PREVIEW_DOWN:-}" ]; then printf '{"error":{"code":"network_error","message":"%s: connection refused"}}\n' "$(echo "$*" | sed 's/.*--url \([^ ]*\).*/\1/')"; exit 1; fi
		echo '{"dir":"/stub/rebuild"}' ;;
	*/survey.json*)
		case "$(jq -r .url "$2")" in
		https://full.test/components/page-only)
			shot="$TOOL_FACTORY_HOME/launcher"
			mkdir -p "$shot"
			echo '<a class="x" href="/components/page-only/preview" target="_blank">Open preview</a>' > "$shot/idle.dom.html"
			jq -cn --arg dom "$shot/idle.dom.html" '{states: [{dom: $dom}]}' > "$shot/recording.json"
			echo "{\"dir\":\"$shot\"}" ;;
		*) echo "{\"dir\":\"/stub/survey/$(jq -r .url "$2" | xargs basename)\"}" ;;
		esac ;;
	*/site/*/steps.json*)
		if [ -n "${STUB_CHECK_DOWN:-}" ]; then echo '{"error":{"code":"network_error","message":"stub site down"}}'; exit 1; fi
		if grep -q '#bad' "$2"; then echo '{"error":{"code":"invalid_source","message":"state '"'hover'"' action 0 (hover): no element matches '"'#bad'"'"}}'; exit 1; fi
		echo "{\"dir\":\"/stub/checked/$(basename "$(dirname "$2")")\"}" ;;
	*) echo '{"dir":"/stub/original"}' ;;
	esac ;;
"page-links list")
	jq -cn --arg s "$2" '{source: $s, cacheHit: false, items: (["button", "pro-card", "fancy-card", "page-only", "rebuilt-before"] | map({url: "https://\($s | split("/")[2])/components/\(.)", text: .}))}' ;;
"ui-steps write")
	slug=$(basename "$(dirname "$2")")
	selector='[data-stage] button'
	case "$slug" in
	secret) selector='#bad' ;;
	pro-card) case "$*" in *--problem*) ;; *) selector='#bad' ;; esac ;;
	esac
	jq -cn --arg s "$selector" --arg slug "$slug" '{model: "stub", steps: {url: "https://stub.test/components/\($slug)", target: "[data-stage]",
		states: [{name: "idle", actions: []}, {name: "hover", actions: [{do: "hover", selector: $s}]}]}, notes: "n", costUsd: 0.05, cacheHit: false}' ;;
"page-diff compare")
	n=$(grep -c '^page-diff' "$STUB_LOG")
	score=$(echo "${STUB_SCORES:-0.95}" | cut -d' ' -f"$n")
	jq -cn --arg a "$2" --arg b "$3" --argjson s "${score:-0.95}" '{a: $a, b: $b, tolerance: 24, score: $s, states: [{name: "idle", score: $s}], cacheHit: false}' ;;
"ui-draft write")
	n=$(grep -c '^ui-draft' "$STUB_LOG")
	while [ $# -gt 0 ]; do [ "$1" = --name ] && draft_name=$2; shift; done
	if [ "$n" = "${STUB_DRAFT_FAIL:-0}" ]; then echo '{"error":{"code":"budget_exceeded","message":"stub budget"}}'; exit 1; fi
	jq -cn --arg name "$draft_name" --argjson n "$n" '{model: "stub", item: {name: $name, type: "registry:ui", title: "T", description: "D", dependencies: [],
		files: [{path: "registry/\($name)/\($name).tsx", type: "registry:ui", target: "components/ui/\($name).tsx", content: "round \($n)"}]},
		demo: "demo \($n)", notes: "n", costUsd: ($n * 0.25), cacheHit: false}' ;;
*) echo '{"error":{"code":"internal","message":"stub refused"}}'; exit 1 ;;
esac
STUB
for name in ui-catalog ui-source page-record page-diff ui-draft page-links ui-steps; do
	mkdir -p "$fake/atoms/$name/bin"
	cp "$work/stub" "$fake/atoms/$name/bin/$name"
	chmod +x "$fake/atoms/$name/bin/$name"
done

cat > "$ui/scripts/add.mjs" <<'ADD'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const result = JSON.parse(readFileSync(0, 'utf8'))
const license = process.argv[process.argv.indexOf('--license') + 1]
if (process.argv.includes('--rebuild')) {
	const content = result.item.files[0].content
	appendFileSync(new URL('../rebuilt', import.meta.url), `${JSON.stringify({ source: result.source, license, content, demo: result.demo, meta: result.meta })}\n`)
	writeFileSync(new URL('../installed', import.meta.url), content)
	if (process.env.STUB_ADD_WRITES) {
		const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
		registry.items.push({ name: result.item.name, meta: { source: result.source, method: 'rebuild' } })
		writeFileSync(new URL('../registry.json', import.meta.url), JSON.stringify(registry))
		mkdirSync(new URL(`../registry/${result.item.name}/`, import.meta.url), { recursive: true })
		writeFileSync(new URL(`../registry/${result.item.name}/x.tsx`, import.meta.url), content)
		mkdirSync(new URL('../preview/demos/', import.meta.url), { recursive: true })
		writeFileSync(new URL(`../preview/demos/${result.item.name}.tsx`, import.meta.url), result.demo)
	}
	console.log(`updated ${result.item.name}`)
	process.exit(0)
}
const site = process.argv[process.argv.indexOf('--site') + 1]
if (result.item.name === 'bad-add') { console.error('stub add refused'); process.exit(1) }
appendFileSync(new URL('../written', import.meta.url), `${result.item.name}\t${license}\t${JSON.stringify(result.item.cssVars.theme)}\t${site}\n`)
console.log(`added ${result.item.name}: registry/${result.item.name}/${result.item.name}.tsx`)
ADD
cat > "$ui/scripts/preview-install.mjs" <<'INSTALL'
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(new URL('../checks', import.meta.url), `install ${readFileSync(new URL('../installed', import.meta.url), 'utf8')}\n`)
INSTALL
cat > "$ui/scripts/tsc.mjs" <<'TSC'
import { readFileSync } from 'node:fs'
const installed = readFileSync(new URL('../installed', import.meta.url), 'utf8')
if (installed === process.env.STUB_TSC_FAIL) {
	console.log(`installed into preview/generated\ncomponents/ui/otp.tsx(1,1): error TS2322: stub type error in ${installed}`)
	process.exit(2)
}
TSC
echo '{"private": true, "scripts": {"typecheck": "node scripts/preview-install.mjs && node scripts/tsc.mjs"}, "dependencies": {"motion": "^14", "clsx": "^2"}}' > "$ui/package.json"

call() {
	: > "$STUB_LOG"
	"$run" "$@" > "$out/stdout" 2> "$out/stderr"
}
ran() { grep -c -- "^$1" "$STUB_LOG" || true; }
outcomes() { jq -c '[.items[] | [.name, .outcome]]' "$out/stdout"; }
report() {
	"$repo/contracts/check" ui-clone-report "$out/stdout" || fail "$1 does not match the ui-clone-report contract"
}

call collect kobra --into "$ui" --json || fail "collect kobra failed: $(cat "$out/stdout") $(cat "$out/stderr")"
report "collect kobra"
[ "$(outcomes)" = '[["input-otp","kept"],["pro-card","locked"],["paid-block","locked"],["utils","skipped"],["broken","failed"],["bad-add","failed"]]' ] \
	|| fail "collect kobra decided $(outcomes)"
[ "$(jq -c .counts "$out/stdout")" = '{"kept":1,"locked":2,"skipped":1,"needs-terms":0,"failed":2}' ] || fail "collect kobra counted $(jq -c .counts "$out/stdout")"
[ "$(jq -c '[.site, .into, .dryRun]' "$out/stdout")" = "[\"kobra\",\"$ui\",false]" ] || fail "collect kobra named $(jq -c '[.site, .into, .dryRun]' "$out/stdout")"
[ "$(ran 'ui-catalog registry https://kobra.systems --json')" = 1 ] || fail "collect kobra did not list kobra.systems: $(cat "$STUB_LOG")"
[ "$(ran 'ui-source registry https://stub.test/r/utils.json')" = 0 ] || fail "a registry:lib item was fetched"
[ "$(jq -r '.items[0].detail' "$out/stdout")" = "added input-otp: registry/input-otp/input-otp.tsx" ] || fail "kept did not carry what add.mjs printed"
[ "$(jq -r '.items[1].detail' "$out/stdout")" = "HTTP 401 from https://stub.test/r/pro-card.json" ] || fail "a 401 did not carry its status"
[ "$(jq -r '.items[4].detail' "$out/stdout")" = "network_error: stub could not reach https://stub.test/r/broken.json" ] || fail "failed did not carry the code and message"
[ "$(jq -r '.items[5].detail' "$out/stdout")" = "add.mjs exited 1: stub add refused" ] || fail "a failed add.mjs did not report its stderr"
[ "$(cut -f1 "$ui/written")" = input-otp ] || fail "add.mjs did not write exactly input-otp: $(cat "$ui/written")"
[ "$(cut -f2 "$ui/written")" = "$(jq -r .kobra.terms "$test_dir/../sites.json")" ] || fail "add.mjs did not get kobra's terms as --license"
[ "$(cut -f3 "$ui/written")" = '{"--ease-out":"linear","--ease-in-out":"cubic-bezier(0.77, 0, 0.175, 1)","--otp-gap":"4px"}' ] \
	|| fail "add.mjs did not get kobra's theme under the item's own: $(cut -f3 "$ui/written")"
[ "$(cut -f4 "$ui/written")" = kobra ] || fail "add.mjs did not get --site kobra: $(cut -f4 "$ui/written")"
grep -q '^ui-clone: 1/6 input-otp: kept' "$out/stderr" || fail "collect did not log progress to stderr: $(cat "$out/stderr")"

call collect kobra --into "$ui" --only input-otp --json || fail "collect kobra again failed"
[ "$(outcomes)" = '[["input-otp","kept"]]' ] || fail "a rerun with --only input-otp decided $(outcomes)"
[ "$(wc -l < "$ui/written" | tr -d ' ')" = 2 ] || fail "a rerun did not call add.mjs again"

rm "$ui/written"
call --dry-run https://www.kobra.systems/ --into "$ui" --json || fail "collect --dry-run without a verb failed: $(cat "$out/stdout")"
report "collect --dry-run"
[ "$(jq -c '[.site, .dryRun, .counts.kept, .items[0].detail]' "$out/stdout")" = '["kobra",true,2,"dry run, not written"]' ] \
	|| fail "collect --dry-run on a kobra URL printed $(jq -c '[.site, .dryRun, .counts]' "$out/stdout")"
[ ! -e "$ui/written" ] || fail "collect --dry-run wrote into victor-ui"

call collect kobra --into "$ui" --only utils,pro-card,paid-block --limit 2 --json || fail "collect --only --limit failed"
[ "$(outcomes)" = '[["pro-card","locked"],["paid-block","locked"]]' ] || fail "--only keeps the registry order and --limit cuts after it, but got $(outcomes)"
if call collect kobra --into "$ui" --only nope --json; then fail "--only with an unknown name exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "--only with an unknown name did not report invalid_args"

call collect kobra --into "$ui" --limit 1 --json || fail "collect --limit 1 failed"
[ "$(outcomes)" = '[["input-otp","kept"]]' ] || fail "--limit 1 decided $(outcomes)"
[ "$(ran ui-source)" = 1 ] || fail "--limit 1 fetched $(ran ui-source) items"

rm -f "$ui/written"
call collect https://components.example.test --into "$ui" --json || fail "collect on an unknown site failed"
report "collect on an unknown site"
[ "$(jq -c '[.site, .counts]' "$out/stdout")" = '["components.example.test",{"kept":0,"locked":0,"skipped":1,"needs-terms":5,"failed":0}]' ] \
	|| fail "an unknown site printed $(jq -c '[.site, .counts]' "$out/stdout")"
[ "$(ran ui-source)" = 0 ] || fail "an unknown site fetched code it has no terms for"
[ ! -e "$ui/written" ] || fail "an unknown site wrote into victor-ui"

call collect aceternity --into "$ui" --dry-run --json || fail "collect aceternity failed"
[ "$(ran 'ui-catalog registry https://ui.aceternity.com/registry.json --base https://ui.aceternity.com/registry/ --json')" = 1 ] \
	|| fail "aceternity was not listed from its index and base: $(cat "$STUB_LOG")"
call collect https://rareui.com --into "$ui" --dry-run --json || fail "collect on rareui.com failed"
[ "$(jq -r .site "$out/stdout")" = rareui ] || fail "rareui.com without www did not match the rareui entry"

if call collect kobra --into "$work" --json; then fail "an --into without scripts/add.mjs exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "an --into without scripts/add.mjs did not report invalid_args"
[ ! -s "$STUB_LOG" ] || fail "an --into without scripts/add.mjs called an atom"
if call collect kobra --json; then fail "collect without --into exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "collect without --into did not report invalid_args"
if call collect nowhere --into "$ui" --json; then fail "an unknown site key exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "an unknown site key did not report invalid_args"

call collect kobra --into "$ui" --dry-run || fail "text collect failed"
[ "$(tail -n 1 "$out/stdout")" = "kobra: 2 kept, 2 locked, 1 skipped, 1 failed (dry run)" ] || fail "text collect ended with $(tail -n 1 "$out/stdout")"

steps="$work/steps.json"
echo '{"url":"https://stub.test/components/x","states":[{"name":"idle","actions":[]}]}' > "$steps"
call judge "$steps" --rebuild http://localhost:5173/x --json || fail "judge exited nonzero: $(cat "$out/stderr")"
[ "$(jq -c '[.a, .b, .score]' "$out/stdout")" = '["/stub/original/recording.json","/stub/rebuild/recording.json",0.95]' ] \
	|| fail "judge did not pass page-diff's result through: $(cat "$out/stdout")"
[ "$(cut -d' ' -f1-3 "$STUB_LOG" | tr '\n' '|')" = "page-record capture $steps|page-record capture $steps|page-diff compare /stub/original/recording.json|" ] \
	|| fail "judge did not record the original, then the rebuild, then compare: $(cat "$STUB_LOG")"
call judge "$steps" --rebuild http://localhost:5173/x --original /kept/recording.json --json || fail "judge --original exited nonzero"
[ "$(ran 'page-record capture')" = 1 ] || fail "judge --original recorded the original again: $(cat "$STUB_LOG")"
[ "$(jq -r .a "$out/stdout")" = /kept/recording.json ] || fail "judge --original did not compare against the kept recording"
call judge "$steps" --rebuild http://localhost:5173/x --original /kept/recording.json || fail "judge text mode exited nonzero"
[ "$(cat "$out/stdout")" = "$(printf 'idle  0.9500\nscore 0.9500')" ] || fail "judge text output is $(cat "$out/stdout")"
if call judge "$steps" --rebuild http://localhost:5173/missing --original /kept/recording.json --json; then fail "a failed rebuild recording exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_source ] || fail "a failed rebuild recording did not pass its error through"

rebuild() {
	STUB_SCORES=$1 STUB_TSC_FAIL=$2 STUB_DRAFT_FAIL=$3
	export STUB_SCORES STUB_TSC_FAIL STUB_DRAFT_FAIL
	shift 3
	rm -f "$ui/rebuilt" "$ui/checks"
	call rebuild "$steps" --into "$ui" "$@"
}
rounds() { jq -c '[.rounds[] | [.round, .score, .costUsd, (.error != null)]]' "$out/stdout"; }
last_install() { tail -n 1 "$ui/rebuilt" | jq -c "$1"; }
drafted() { grep '^ui-draft' "$STUB_LOG" | sed -n "${1}p"; }
rounds_dir="$TOOL_FACTORY_HOME/microservices/ui-clone/rebuild/otp"

rebuild "0.9 0.98" "" 0 --name otp --target 0.97 --preview http://127.0.0.1:9999/ --json || fail "rebuild exited nonzero: $(cat "$out/stdout") $(cat "$out/stderr")"
"$repo/contracts/check" ui-rebuild "$out/stdout" || fail "rebuild does not match the ui-rebuild contract"
[ "$(rounds)" = '[[1,0.9,0.25,false],[2,0.98,0.5,false]]' ] || fail "a rebuild that reaches 0.98 in round 2 ran $(rounds)"
[ "$(jq -c '[.passed, .best, .costUsd, .source, .target]' "$out/stdout")" = '[true,{"round":2,"score":0.98},0.75,"https://stub.test/components/x",0.97]' ] \
	|| fail "the passing rebuild reported $(jq -c '[.passed, .best, .costUsd, .source, .target]' "$out/stdout")"
[ "$(ran 'page-record capture')" = 3 ] || fail "rebuild did not record the original once and each round once: $(cat "$STUB_LOG")"
[ "$(ran "page-record capture $steps --url http://127.0.0.1:9999/otp")" = 2 ] || fail "rebuild did not judge <preview>/<name>: $(cat "$STUB_LOG")"
case "$(drafted 1)" in "ui-draft write /stub/original/recording.json --name otp --packages clsx,motion --json") ;; *) fail "round 1 drafted with $(drafted 1)" ;; esac
case "$(drafted 2)" in *"--previous $rounds_dir/round-1/draft.json --diff $rounds_dir/round-1/diff.json --json") ;; *) fail "round 2 did not revise round 1's draft from its diff: $(drafted 2)" ;; esac
[ "$(jq -r .rounds[1].diff "$out/stdout")" = "$rounds_dir/round-2/diff.json" ] && [ "$(jq .score "$rounds_dir/round-2/diff.json")" = 0.98 ] \
	|| fail "round 2's diff was not kept in the data home"
[ "$(jq -r .item.files[0].content "$rounds_dir/round-1/draft.json")" = "round 1" ] || fail "round 1's draft was not kept in the data home"
[ "$(head -n 1 "$ui/rebuilt" | jq -c '[.source, .license, .content, .demo, .meta]')" = '["https://stub.test/components/x","Rebuilt from observation; no source code copied","round 1","demo 1",{"rebuild":{"round":1,"score":null,"costUsd":0.25}}]' ] \
	|| fail "round 1 was installed as $(head -n 1 "$ui/rebuilt")"
[ "$(last_install '[.content, .meta.rebuild]')" = '["round 2",{"round":2,"score":0.98,"costUsd":0.75,"rounds":[{"round":1,"score":0.9,"costUsd":0.25},{"round":2,"score":0.98,"costUsd":0.5}]}]' ] \
	|| fail "the final install did not carry the best round and the costs: $(tail -n 1 "$ui/rebuilt")"
[ "$(tail -n 1 "$ui/checks")" = "install round 2" ] || fail "the preview was not reinstalled after the final install: $(cat "$ui/checks")"

rebuild "0.85 0.91 0.99" "" 0 --name otp --json
[ "$(jq -c '[.target, .passed, .best]' "$out/stdout")" = '[0.9,true,{"round":2,"score":0.91}]' ] \
	|| fail "by default rebuild did not stop at the first round of 0.9 or more: $(jq -c '[.target, .passed, .best]' "$out/stdout")"

rebuild "0.9 0.93" "round 2" 0 --name otp --target 0.97 --rounds 3
[ "$(cat "$out/stdout")" = "$(printf 'round 1  0.9000  $0.25\nround 2  error   $0.50  components/ui/otp.tsx(1,1): error TS2322: stub type error in round 2\nround 3  0.9300  $0.75\ntotal    $1.50  best round 3 at 0.9300, below 0.97')" ] \
	|| fail "a rebuild whose round 2 fails its typecheck printed $(cat "$out/stdout")"
[ "$(ran 'page-record capture')" = 3 ] || fail "a round that failed its typecheck was judged: $(cat "$STUB_LOG")"
case "$(drafted 3)" in *"--previous $rounds_dir/round-2/draft.json --problem installed into preview/generated") ;; *) fail "round 3 did not get round 2's typecheck output as its problem: $(drafted 3)" ;; esac
grep -qx 'components/ui/otp.tsx(1,1): error TS2322: stub type error in round 2 --json' "$STUB_LOG" || fail "round 3's problem lost the type error: $(cat "$STUB_LOG")"

rebuild "0.95 0.9" "" 0 --name otp --target 0.97 --rounds 2 --json
[ "$(jq -c '[.passed, .best, .costUsd]' "$out/stdout")" = '[false,{"round":1,"score":0.95},0.75]' ] || fail "a rebuild whose best round is 1 reported $(jq -c '[.passed, .best, .costUsd]' "$out/stdout")"
[ "$(last_install '[.content, .demo, .meta.rebuild.round, .meta.rebuild.score, .meta.rebuild.costUsd]')" = '["round 1","demo 1",1,0.95,0.75]' ] \
	|| fail "the best round was not reinstalled last: $(tail -n 1 "$ui/rebuilt")"
[ "$(tail -n 1 "$ui/checks")" = "install round 1" ] || fail "the preview was not reinstalled with the best round: $(cat "$ui/checks")"

rebuild "0.9" "" 2 --name otp --target 0.97 --json
"$repo/contracts/check" ui-rebuild "$out/stdout" || fail "a rebuild that ui-draft stopped does not match the ui-rebuild contract"
[ "$(jq -c '[.rounds[1].draft, .rounds[1].error, .rounds[1].costUsd == 0, .best.round, (.rounds | length)]' "$out/stdout")" = '[null,"budget_exceeded: stub budget",true,1,2]' ] \
	|| fail "a failed ui-draft did not end the loop as its round's error: $(jq -c .rounds "$out/stdout")"

rebuild "" "" 0 --name missing --rounds 2 --json
"$repo/contracts/check" ui-rebuild "$out/stdout" || fail "a rebuild with no judged round does not match the ui-rebuild contract"
[ "$(jq -c '[.passed, .best, .costUsd]' "$out/stdout")" = '[false,null,0.75]' ] || fail "a rebuild with no judged round reported $(jq -c '[.passed, .best, .costUsd]' "$out/stdout")"
case "$(drafted 2)" in *"--problem The judge could not record the demo at http://localhost:5173/missing: stub selector not found --json") ;; *) fail "a demo the judge could not record did not become the next problem: $(drafted 2)" ;; esac
[ "$(wc -l < "$ui/rebuilt" | tr -d ' ')" = 2 ] || fail "a rebuild with no judged round installed a final draft"

if call rebuild "$steps" --into "$ui" --name otp --target 2 --json; then fail "--target 2 exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "--target 2 did not report invalid_args"
[ ! -s "$STUB_LOG" ] || fail "an invalid --target called an atom"

STUB_RATE_LIMITED=pro-card call collect kobra --into "$ui" --dry-run --json || fail "collect stopped by a 429 exited nonzero: $(cat "$out/stdout")"
report "collect stopped by a 429"
[ "$(outcomes)" = '[["input-otp","kept"],["pro-card","failed"],["paid-block","skipped"],["utils","skipped"],["broken","skipped"],["bad-add","skipped"]]' ] \
	|| fail "collect did not stop at the 429: $(outcomes)"
[ "$(ran ui-source)" = 2 ] || fail "collect kept fetching after a 429: $(cat "$STUB_LOG")"
[ "$(jq -r '.items[2].detail' "$out/stdout")" = "not tried after rate_limited: HTTP 429 from https://stub.test/r/pro-card.json" ] || fail "a skipped item did not say why: $(jq -r '.items[2].detail' "$out/stdout")"
unset STUB_RATE_LIMITED

STUB_SCORES="0.95 0.5" STUB_TSC_FAIL="" STUB_DRAFT_FAIL=0
export STUB_SCORES STUB_TSC_FAIL STUB_DRAFT_FAIL
rm -f "$ui/written" "$ui/rebuilt"
jq -n '{items: [
	{name: "kept-before", meta: {source: "https://stub.test/r/kept-before.json", method: "registry"}},
	{name: "rebuilt-before-rebuild", meta: {source: "https://stub.test/components/rebuilt-before", method: "rebuild"}},
	{name: "page-only-rebuild", meta: {source: "https://elsewhere.test/page-only", method: "rebuild"}}
]}' > "$ui/registry.json"
edit_registry() { jq "$1" "$ui/registry.json" > "$ui/registry.next" && mv "$ui/registry.next" "$ui/registry.json"; }
site_rows() { jq -c '[.items[] | [.name, .outcome, .score, .costUsd * 1]]' "$out/stdout"; }
site_report() { "$repo/contracts/check" ui-site-report "$out/stdout" || fail "$1 does not match the ui-site-report contract"; }
site_dir="$TOOL_FACTORY_HOME/microservices/ui-clone/site/stubsite"

call site stubsite --into "$ui" --dry-run --json || fail "site --dry-run failed: $(cat "$out/stdout") $(cat "$out/stderr")"
site_report "site --dry-run"
[ "$(jq -c '[.items[] | [.name, .itemUrl, .pageUrl]]' "$out/stdout")" = '[["button","https://stub.test/r/button.json","https://stub.test/components/button"],["pro-card","https://stub.test/r/pro-card.json","https://stub.test/components/pro-card"],["kept-before","https://stub.test/r/kept-before.json","https://stub.test/components/kept-before"],["utils","https://stub.test/r/utils.json","https://stub.test/components/utils"],["card-x","https://stub.test/r/card-x.json","https://stub.test/components/fancy-card"],["secret","https://stub.test/r/secret.json","https://stub.test/components/secret"],["page-only",null,"https://stub.test/components/page-only"],["rebuilt-before",null,"https://stub.test/components/rebuilt-before"]]' ] \
	|| fail "the inventory is not the registry in its order, then pages no item or alias covers: $(jq -c '[.items[] | [.name, .itemUrl, .pageUrl]]' "$out/stdout")"
[ "$(jq -c '[.items[] | [.name, .outcome]]' "$out/stdout")" = '[["button","kept"],["pro-card","would-rebuild"],["kept-before","exists"],["utils","skipped"],["card-x","kept"],["secret","would-rebuild"],["page-only","would-rebuild"],["rebuilt-before","exists"]]' ] \
	|| fail "site --dry-run decided $(jq -c '[.items[] | [.name, .outcome]]' "$out/stdout")"
grep -qxF 'page-links list https://stub.test/components --match ^/components/[^/]+/?$ --json' "$STUB_LOG" || fail "the catalog was not listed with the default match: $(cat "$STUB_LOG")"
[ "$(ran ui-steps)$(ran ui-draft)$(ran page-record)" = 000 ] || fail "site --dry-run surveyed a page or called a model: $(cat "$STUB_LOG")"
[ "$(ran 'ui-source registry https://stub.test/r/kept-before.json')" = 0 ] || fail "site fetched an item victor-ui already has"
[ ! -e "$ui/written" ] && [ ! -e "$site_dir" ] || fail "site --dry-run wrote something"
[ "$(jq -c '[.dryRun, .target, .costUsd == 0, .counts["would-rebuild"]]' "$out/stdout")" = '[true,0.9,true,3]' ] || fail "site --dry-run reported $(jq -c '[.dryRun, .target, .costUsd, .counts]' "$out/stdout")"

call site stubsite --into "$ui" --rounds 1 --json || fail "site failed: $(cat "$out/stdout") $(cat "$out/stderr")"
site_report "site"
[ "$(site_rows)" = '[["button","kept",null,0],["pro-card","rebuilt",0.95,0.35],["kept-before","exists",null,0],["utils","skipped",null,0],["card-x","kept",null,0],["secret","no-steps",null,0.1],["page-only","below-target",0.5,0.55],["rebuilt-before","exists",null,0]]' ] \
	|| fail "site decided $(site_rows)"
[ "$(jq '.costUsd * 1' "$out/stdout")" = 1 ] || fail "the total cost is not the sum of ui-steps and the rebuilds: $(jq .costUsd "$out/stdout")"
[ "$(cut -f1 "$ui/written" | tr '\n' ' ')" = "button card-x " ] || fail "site did not keep the exposed code: $(cat "$ui/written")"
[ "$(jq -c . "$site_dir/page-only/survey.json")" = '{"url":"https://stub.test/components/page-only","target":"[data-stage] > *","states":[{"name":"idle","actions":[]}]}' ] \
	|| fail "the survey did not record the demo inside the page's stage idle: $(cat "$site_dir/page-only/survey.json")"
[ "$(ran 'ui-steps write /stub/survey/page-only/recording.json --json')" = 1 ] || fail "ui-steps did not get the survey: $(cat "$STUB_LOG")"
[ "$(jq -r '.items[1].stepsFile' "$out/stdout")" = "$site_dir/pro-card/steps.json" ] && [ "$(jq -r '.states[1].actions[0].selector' "$site_dir/pro-card/steps.json")" = '[data-stage] button' ] \
	|| fail "pro-card's working steps were not saved in the data home"
[ "$(jq -c '[.target, .states[1].actions[0].selector]' "$site_dir/pro-card/rebuild-steps.json")" = '["[data-slot=\"preview-stage\"]","[data-slot=\"preview-stage\"] button"]' ] \
	|| fail "the rebuild's steps do not swap the site's stage for the preview's: $(cat "$site_dir/pro-card/rebuild-steps.json")"
[ "$(ran "page-record capture $site_dir/pro-card/rebuild-steps.json --url")" = 1 ] || fail "the rebuild was not recorded with the preview's stage: $(grep page-record "$STUB_LOG")"
[ "$(ran "ui-steps write /stub/survey/pro-card/recording.json --problem page-record: state 'hover' action 0 (hover): no element matches '#bad' --json")" = 1 ] \
	|| fail "steps that failed to record were not revised with page-record's message: $(grep ui-steps "$STUB_LOG")"
[ "$(ran 'ui-steps write /stub/survey/secret/')" = 2 ] && [ "$(jq -r '.items[5].detail' "$out/stdout")" = "the steps failed 2 times, last with page-record: state 'hover' action 0 (hover): no element matches '#bad'" ] \
	|| fail "steps that fail twice did not end as no-steps after 2 tries: $(jq -r '.items[5].detail' "$out/stdout")"
[ "$(drafted 1)" = "ui-draft write /stub/checked/pro-card/recording.json --name pro-card-rebuild --packages clsx,motion --json" ] \
	|| fail "the rebuild did not reuse the recording that checked its steps: $(drafted 1)"
case "$(drafted 2)" in "ui-draft write /stub/checked/page-only/recording.json --name stubsite-page-only-rebuild "*) ;; *) fail "a taken rebuild name was not prefixed with the site: $(drafted 2)" ;; esac
[ "$(ran 'page-record capture') $(ran 'page-record capture /stub')" = "10 0" ] || fail "site recorded more than 3 surveys, 5 checks, and 2 judged rounds: $(grep page-record "$STUB_LOG")"
[ "$(jq -c '[.items[1].detail, .items[6].detail]' "$out/stdout")" = '["pro-card-rebuild, best round 1 of 1","stubsite-page-only-rebuild, best round 1 of 1"]' ] \
	|| fail "the rebuilt rows did not name the item and round: $(jq -c '[.items[1].detail, .items[6].detail]' "$out/stdout")"

call site stubsite --into "$ui" --rounds 1 --only secret || fail "text site failed"
[ "$(tail -n 1 "$out/stdout")" = 'stubsite: 1 no-steps, $0.10 in all' ] || fail "text site ended with $(tail -n 1 "$out/stdout")"

STUB_CHECK_DOWN=1 call site stubsite --into "$ui" --only page-only,button --json || fail "site with a check that cannot reach the page exited nonzero: $(cat "$out/stdout")"
unset STUB_CHECK_DOWN
[ "$(jq -c '[.items[] | [.name, .outcome]]' "$out/stdout")" = '[["button","kept"],["page-only","no-steps"]]' ] && [ "$(jq -r '.items[1].detail' "$out/stdout")" = "page-record could not record with the steps: network_error: stub site down" ] \
	|| fail "a check that cannot reach the page did not end that component as no-steps: $(jq -c .items "$out/stdout")"

STUB_ADD_WRITES=1 STUB_TSC_FAIL="round 1" call site stubsite --into "$ui" --rounds 1 --only pro-card --json || fail "site with a draft that never typechecks exited nonzero: $(cat "$out/stdout")"
[ "$(jq -c '[.items[] | [.name, .outcome, .score]]' "$out/stdout")" = '[["pro-card","rebuild-failed",null]]' ] || fail "a draft that never typechecks decided $(jq -c .items "$out/stdout")"
[ "$(jq -c '[.items[].name]' "$ui/registry.json")" = '["kept-before","rebuilt-before-rebuild","page-only-rebuild"]' ] || fail "an unjudged rebuild stayed in the registry: $(cat "$ui/registry.json")"
[ ! -e "$ui/registry/pro-card-rebuild" ] && [ ! -e "$ui/preview/demos/pro-card-rebuild.tsx" ] || fail "an unjudged rebuild left its files behind"
unset STUB_ADD_WRITES
STUB_TSC_FAIL=""

call site fullsite --into "$ui" --only page-only --rounds 1 --json || fail "site on a launcher demo failed: $(cat "$out/stdout")"
full_dir="$TOOL_FACTORY_HOME/microservices/ui-clone/site/fullsite/page-only"
[ "$(jq -c . "$full_dir/survey.json")" = '{"url":"https://full.test/components/page-only/preview","target":"body > *","viewport":{"width":1280,"height":1400},"states":[{"name":"idle","actions":[]}]}' ] \
	|| fail "a demo that only links to its preview was not surveyed there at the site's viewport: $(cat "$full_dir/survey.json")"
[ "$(ran 'ui-steps write /stub/survey/preview/recording.json --json')" = 1 ] || fail "ui-steps did not get the preview's survey: $(grep ui-steps "$STUB_LOG")"

edit_registry '.items += [{name: "preview-rebuild", meta: {source: "https://stub.test/components/pro-card/preview", method: "rebuild"}}]'
call site stubsite --into "$ui" --only pro-card --dry-run --json || fail "site --dry-run with a rebuilt preview page failed"
[ "$(jq -c '[.items[] | [.outcome, .detail]]' "$out/stdout")" = '[["exists","in victor-ui as preview-rebuild"]]' ] || fail "a component rebuilt from its preview page did not count as rebuilt: $(jq -c .items "$out/stdout")"
edit_registry 'del(.items[] | select(.name == "preview-rebuild"))'

edit_registry '.items += [{name: "pro-card-rebuild", meta: {source: "https://stub.test/components/pro-card", method: "rebuild"}}]'
call site stubsite --into "$ui" --only pro-card,button --rounds 1 --dry-run --json || fail "site --dry-run with a rebuild failed"
[ "$(jq -c '[.items[] | .outcome]' "$out/stdout")" = '["kept","exists"]' ] || fail "without --redo a rebuilt component was not skipped: $(jq -c .items "$out/stdout")"
call site stubsite --into "$ui" --only pro-card --rounds 1 --redo --json || fail "site --redo failed: $(cat "$out/stdout")"
[ "$(jq -c '[.items[] | [.outcome, .detail]]' "$out/stdout")" = '[["rebuilt","pro-card-rebuild, best round 1 of 1"]]' ] || fail "--redo did not rebuild under the same name: $(jq -c .items "$out/stdout")"
call site stubsite --into "$ui" --only kept-before --redo --dry-run --json || fail "site --redo on a kept item failed"
[ "$(jq -c '[.items[] | .outcome]' "$out/stdout")" = '["exists"]' ] || fail "--redo touched code that was kept, not rebuilt: $(jq -c .items "$out/stdout")"
mkdir -p "$ui/registry/pro-card-rebuild"
echo kept > "$ui/registry/pro-card-rebuild/x.tsx"
STUB_ADD_WRITES=1 STUB_TSC_FAIL="round 1" call site stubsite --into "$ui" --only pro-card --rounds 1 --redo --json || fail "site --redo with a draft that never typechecks exited nonzero"
unset STUB_ADD_WRITES
STUB_TSC_FAIL=""
[ "$(jq -c '[.items[] | [.outcome]]' "$out/stdout")" = '[["rebuild-failed"]]' ] && [ "$(jq -c '[.items[] | select(.name == "pro-card-rebuild")] | length' "$ui/registry.json")" = 1 ] && [ "$(cat "$ui/registry/pro-card-rebuild/x.tsx")" = kept ] \
	|| fail "a failed --redo did not put the last rebuild back: $(cat "$ui/registry.json")"
rm -rf "$ui/registry/pro-card-rebuild"
edit_registry 'del(.items[] | select(.name == "pro-card-rebuild"))'

STUB_PREVIEW_DOWN=1
export STUB_PREVIEW_DOWN
call site stubsite --into "$ui" --only pro-card,page-only --rounds 1 --preview http://127.0.0.1:9999/ --json || fail "site with its preview down exited nonzero: $(cat "$out/stdout")"
unset STUB_PREVIEW_DOWN
[ "$(jq -c '[.items[] | .outcome]' "$out/stdout")" = '["failed","skipped"]' ] && jq -r '.items[0].detail' "$out/stdout" | grep -q '^preview_down: ' \
	|| fail "site did not stop when its preview went down: $(jq -c .items "$out/stdout")"

STUB_RATE_LIMITED=pro-card call site stubsite --into "$ui" --dry-run --json || fail "site stopped by a 429 exited nonzero"
[ "$(jq -c '[.items[] | .outcome]' "$out/stdout")" = '["kept","failed","skipped","skipped","skipped","skipped","skipped","skipped"]' ] && [ "$(ran ui-source)" = 2 ] \
	|| fail "site did not stop at the 429: $(jq -c '[.items[] | .outcome]' "$out/stdout") $(cat "$STUB_LOG")"
unset STUB_RATE_LIMITED

call site pagesite --into "$ui" --dry-run --json || fail "site on a site without a registry failed: $(cat "$out/stdout")"
site_report "site without a registry"
[ "$(jq -c '[([.items[].itemUrl] | unique), .counts.skipped, .items[0].detail]' "$out/stdout")" = '[[null],5,"no registry item, and sites.json has no stage for pagesite"]' ] \
	|| fail "a site without a registry or stage decided $(jq -c '[.items[] | [.name, .outcome, .detail]]' "$out/stdout")"
if call site stubsite --into "$ui" --target 0 --json; then fail "site --target 0 exited 0"; fi
[ ! -s "$STUB_LOG" ] || fail "an invalid --target made site call an atom"

echo "PASS ui-clone"

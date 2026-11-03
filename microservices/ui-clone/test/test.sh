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
cp "$test_dir/../run" "$test_dir/../manifest.json" "$test_dir/../sites.json" "$fake/microservices/ui-clone/"
run="$fake/microservices/ui-clone/run"

fail() { echo "FAIL ui-clone: $1" >&2; exit 1; }

cat > "$work/stub" <<'STUB'
#!/bin/sh
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$STUB_LOG"
case "$name $1" in
"ui-catalog registry")
	jq -cn --arg s "$2" '{source: $s, index: $s, cacheHit: false, items: [
		["input-otp", "registry:ui"], ["pro-card", "registry:ui"], ["paid-block", "registry:block"],
		["utils", "registry:lib"], ["broken", "registry:ui"], ["bad-add", "registry:ui"]
	] | map({name: .[0], type: .[1], title: null, description: null, itemUrl: "https://stub.test/r/\(.[0]).json"})}' ;;
"ui-source registry")
	item=$(basename "$2" .json)
	case "$item" in
	pro-card) jq -cn --arg s "$2" '{source: $s, exposed: false, item: null, cacheHit: false}' ;;
	broken) echo "{\"error\":{\"code\":\"network_error\",\"message\":\"stub could not reach $2\"}}"; exit 1 ;;
	paid-block) jq -cn --arg s "$2" --arg n "$item" '{source: $s, exposed: false, item: {name: $n, files: []}, cacheHit: false}' ;;
	*) jq -cn --arg s "$2" --arg n "$item" '{source: $s, exposed: true, item: {name: $n, type: "registry:ui", files: [{path: "\($n).tsx", content: "export {}"}], cssVars: {theme: {"--ease-out": "linear", "--otp-gap": "4px"}}}, cacheHit: false}' ;;
	esac ;;
"page-record capture")
	case "$*" in
	*--url\ http://localhost:5173/missing*) echo '{"error":{"code":"invalid_source","message":"stub selector not found"}}'; exit 1 ;;
	*--url*) echo '{"dir":"/stub/rebuild"}' ;;
	*) echo '{"dir":"/stub/original"}' ;;
	esac ;;
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
for name in ui-catalog ui-source page-record page-diff ui-draft; do
	mkdir -p "$fake/atoms/$name/bin"
	cp "$work/stub" "$fake/atoms/$name/bin/$name"
	chmod +x "$fake/atoms/$name/bin/$name"
done

cat > "$ui/scripts/add.mjs" <<'ADD'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const result = JSON.parse(readFileSync(0, 'utf8'))
const license = process.argv[process.argv.indexOf('--license') + 1]
if (process.argv.includes('--rebuild')) {
	const content = result.item.files[0].content
	appendFileSync(new URL('../rebuilt', import.meta.url), `${JSON.stringify({ source: result.source, license, content, demo: result.demo, meta: result.meta })}\n`)
	writeFileSync(new URL('../installed', import.meta.url), content)
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

rebuild "0.9 0.98" "" 0 --name otp --preview http://127.0.0.1:9999/ --json || fail "rebuild exited nonzero: $(cat "$out/stdout") $(cat "$out/stderr")"
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

rebuild "0.9 0.93" "round 2" 0 --name otp --rounds 3
[ "$(cat "$out/stdout")" = "$(printf 'round 1  0.9000  $0.25\nround 2  error   $0.50  components/ui/otp.tsx(1,1): error TS2322: stub type error in round 2\nround 3  0.9300  $0.75\ntotal    $1.50  best round 3 at 0.9300, below 0.97')" ] \
	|| fail "a rebuild whose round 2 fails its typecheck printed $(cat "$out/stdout")"
[ "$(ran 'page-record capture')" = 3 ] || fail "a round that failed its typecheck was judged: $(cat "$STUB_LOG")"
case "$(drafted 3)" in *"--previous $rounds_dir/round-2/draft.json --problem installed into preview/generated") ;; *) fail "round 3 did not get round 2's typecheck output as its problem: $(drafted 3)" ;; esac
grep -qx 'components/ui/otp.tsx(1,1): error TS2322: stub type error in round 2 --json' "$STUB_LOG" || fail "round 3's problem lost the type error: $(cat "$STUB_LOG")"

rebuild "0.95 0.9" "" 0 --name otp --rounds 2 --json
[ "$(jq -c '[.passed, .best, .costUsd]' "$out/stdout")" = '[false,{"round":1,"score":0.95},0.75]' ] || fail "a rebuild whose best round is 1 reported $(jq -c '[.passed, .best, .costUsd]' "$out/stdout")"
[ "$(last_install '[.content, .demo, .meta.rebuild.round, .meta.rebuild.score, .meta.rebuild.costUsd]')" = '["round 1","demo 1",1,0.95,0.75]' ] \
	|| fail "the best round was not reinstalled last: $(tail -n 1 "$ui/rebuilt")"
[ "$(tail -n 1 "$ui/checks")" = "install round 1" ] || fail "the preview was not reinstalled with the best round: $(cat "$ui/checks")"

rebuild "0.9" "" 2 --name otp --json
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

echo "PASS ui-clone"

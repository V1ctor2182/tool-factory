#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fake="$work/repo"
TOOL_FACTORY_HOME="$work/home"
export TOOL_FACTORY_HOME
STUB_LOG="$work/calls"
SEARCH_FIXTURE="$work/search.json"
export STUB_LOG SEARCH_FIXTURE
out="$work/out"
mkdir -p "$fake/microservices/youtube" "$out"
cp "$test_dir/../run" "$test_dir/../manifest.json" "$fake/microservices/youtube/"
run="$fake/microservices/youtube/run"
zoo="https://www.youtube.com/watch?v=jNQXAC9IVRw"
playlist="https://www.youtube.com/playlist?list=PLstub"

fail() { echo "FAIL youtube routing: $1" >&2; exit 1; }
matches() {
	"$repo/contracts/check" "$1" "$2" || fail "$3 does not match the $1 contract"
}

"$repo/atoms/find-url/bin/find-url" parse "$repo/atoms/find-url/test/fixtures/ytsearch3-me-at-the-zoo.json" --json > "$SEARCH_FIXTURE"

cat > "$work/stub" <<'STUB'
#!/bin/sh
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$STUB_LOG"
fail() { echo "{\"error\":{\"code\":\"$1\",\"message\":\"stub $name refused\"}}"; exit 1; }
arg() { shift "$1"; echo "$1"; }
limit=$(echo "$*" | sed -n 's/.*--limit \([0-9]*\).*/\1/p')
case "$name $1" in
"find-url search")
	case "$2" in
	nothing*) jq -c --arg s "$2" '{source: $s, items: [], cacheHit: false}' "$SEARCH_FIXTURE" ;;
	broken*) jq -c --arg s "$2" '.source = $s | .items = [.items[0], (.items[0] | .url = "https://www.youtube.com/watch?v=broken" | .id = "broken")]' "$SEARCH_FIXTURE" ;;
	all-broken*) jq -c --arg s "$2" '.source = $s | .items = [.items[0] | .url = "https://www.youtube.com/watch?v=broken" | .id = "broken"]' "$SEARCH_FIXTURE" ;;
	*) jq -c --arg s "$2" --argjson n "${limit:-5}" '.source = $s | .items |= .[:$n]' "$SEARCH_FIXTURE" ;;
	esac ;;
"find-url list") jq -c --arg s "$2" --argjson n "${limit:-3}" '.source = $s | .items |= .[:$n]' "$SEARCH_FIXTURE" ;;
"captions get")
	case "$2" in *broken*) fail unavailable ;; esac
	case "$2" in http://*|https://*) ;; *) fail invalid_source ;; esac
	jq -cn --arg s "$2" '{source: $s, method: "captions", language: "en", model: null, text: "Elephants.", segments: [{start: 0, end: 2, text: "Elephants."}], cacheHit: false}'
	exit "${CAPTIONS_EXIT:-0}" ;;
"download get") jq -cn --arg s "$2" '{source: $s, path: "/stub/video.mp4", kind: "video", extractor: "stub", id: "stub", title: null, durationSec: 19, bytes: 1, cacheHit: false}' ;;
"frames get") echo '{"source":"/stub/video.mp4","threshold":0.3,"frames":[{"time":0,"path":"/stub/f0.jpg"},{"time":9,"path":"/stub/f9.jpg"}],"cacheHit":false}' ;;
"see describe") echo '{"model":"haiku","images":[{"path":"/stub/f0.jpg","description":"A man by elephants.","text":""},{"path":"/stub/f9.jpg","description":"Elephants.","text":"ZOO"}],"costUsd":0,"cacheHit":false}' ;;
"digest make")
	transcript=$(arg 3 "$@")
	visual=null
	case "$*" in *--image-notes*) visual='[{"start":0,"note":"A man by elephants."}]' ;; esac
	jq -c --arg p "$transcript" --argjson v "$visual" '{source, transcriptPath: $p, model: "stub", summary: "A man at the zoo.", chapters: [{start: 0, title: "Elephants"}], keyPoints: ["Long trunks."], costUsd: 0, cacheHit: false} + (if $v then {visual: $v} else {} end)' "$transcript"
	exit "${DIGEST_EXIT:-0}" ;;
*) fail internal ;;
esac
STUB
for name in find-url captions download transcribe frames see digest; do
	mkdir -p "$fake/atoms/$name/bin"
	cp "$work/stub" "$fake/atoms/$name/bin/$name"
	chmod +x "$fake/atoms/$name/bin/$name"
done

call() {
	: > "$STUB_LOG"
	"$run" "$@" > "$out/stdout" 2> "$out/stderr"
}
ran() { grep -c -- "^$1" "$STUB_LOG" || true; }

call "$zoo" --json || fail "run <video url> failed: $(cat "$out/stdout")"
matches digest "$out/stdout" "run <video url>"
[ "$(ran "captions get $zoo")" = 1 ] || fail "run <video url> did not call captions get on it: $(cat "$STUB_LOG")"
[ "$(ran find-url)" = 0 ] || fail "run <video url> called find-url"

call --json "$zoo&list=PLstub" || fail "run <video url in a list> failed"
matches digest "$out/stdout" "run <video url in a list>"
[ "$(ran find-url)" = 0 ] || fail "a watch URL with a list called find-url"

call "me at the zoo" --limit 2 --json || fail "run <words> --limit 2 failed: $(cat "$out/stdout")"
matches digest-list "$out/stdout" "run <words> --limit 2"
[ "$(ran 'find-url search me at the zoo --site ytsearch --limit 2')" = 1 ] || fail "run <words> did not search with --limit 2: $(cat "$STUB_LOG")"
[ "$(jq '.items | length' "$out/stdout")" = 2 ] || fail "run <words> --limit 2 did not print two digests"
[ "$(jq -r '.items[0].source' "$out/stdout")" = "$zoo" ] || fail "the first search digest is not the first search result"

call --json "me at the zoo" || fail "run <words> failed"
[ "$(ran 'find-url search me at the zoo --site ytsearch --limit 1')" = 1 ] || fail "run <words> without --limit did not take 1 result"
[ "$(jq '.items | length' "$out/stdout")" = 1 ] || fail "run <words> without --limit did not print one digest"

call "$playlist" --limit 2 --json || fail "run <playlist url> failed"
matches digest-list "$out/stdout" "run <playlist url>"
[ "$(ran "find-url list $playlist --limit 2")" = 1 ] || fail "run <playlist url> did not call find-url list: $(cat "$STUB_LOG")"
[ "$(ran 'find-url search')" = 0 ] || fail "run <playlist url> searched"
call "https://www.youtube.com/watch?list=PLstub" --json || fail "run <watch url with only a list> failed"
[ "$(ran 'find-url list')" = 1 ] || fail "a watch URL with a list and no video did not call find-url list"
call "https://www.youtube.com/@jawed" --json || fail "run <channel url> failed"
[ "$(jq '.items | length' "$out/stdout")" = 3 ] || fail "run <channel url> without --limit did not take every video"

call "broken mix" --json 2> /dev/null || fail "a search where one of two videos fails exited 1"
matches digest-list "$out/stdout" "a search with one failed video"
[ "$(jq -c '[(.items | length), .failed[0].url, .failed[0].error.code]' "$out/stdout")" = '[1,"https://www.youtube.com/watch?v=broken","unavailable"]' ] \
	|| fail "a search with one failed video printed $(jq -c . "$out/stdout")"

if call all-broken --json; then fail "a search where every video fails exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = unavailable ] || fail "a search where every video fails did not print the first error"
if call "nothing here" --json; then fail "an empty search exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = no_results ] || fail "an empty search did not report no_results"

call get "$zoo" --visual --json || fail "get --visual failed: $(cat "$out/stdout")"
matches digest "$out/stdout" "get --visual"
[ "$(jq '.visual | length' "$out/stdout")" = 1 ] || fail "get --visual has no visual field"
[ "$(ran 'see describe /stub/f0.jpg /stub/f9.jpg')" = 1 ] || fail "get --visual did not describe the frames"

call transcript "$zoo" --json || fail "run transcript failed"
matches transcript "$out/stdout" "run transcript"
cp "$out/stdout" "$out/transcript.json"
call --json "$zoo" --no-digest || fail "run --no-digest failed"
[ "$(jq -c . "$out/stdout")" = "$(jq -c . "$out/transcript.json")" ] || fail "run <url> --no-digest differs from run transcript <url>"
[ "$(ran digest)" = 0 ] || fail "--no-digest called digest"

if call "$zoo" --no-digest --visual --json; then fail "--no-digest --visual exited 0"; fi
[ "$(jq -r .error.code "$out/stdout")" = invalid_args ] || fail "--no-digest --visual did not report invalid_args"
[ ! -s "$STUB_LOG" ] || fail "--no-digest --visual called an atom: $(cat "$STUB_LOG")"

call "me at the zoo" --limit 2 || fail "text search failed"
[ "$(grep -c '^# ' "$out/stdout")" = 2 ] || fail "text search did not print a header per video"

if CAPTIONS_EXIT=1 "$run" transcript "$zoo" --json > "$out/stdout" 2> /dev/null; then fail "captions that printed JSON and exited 1 exited 0"; fi
[ "$(jq -r .error.message "$out/stdout")" = "captions exited 1 without an error object on stdout" ] \
	|| fail "captions that printed JSON and exited 1 did not report it as internal: $(cat "$out/stdout")"
[ "$(jq -r .error.code "$out/stdout")" = internal ] || fail "captions that printed JSON and exited 1 did not report internal"
DIGEST_EXIT=3 "$run" "$zoo" > /dev/null 2>&1 && code=0 || code=$?
[ "$code" = 1 ] || fail "plain get exited $code when digest exited 3"

echo "PASS youtube routing"

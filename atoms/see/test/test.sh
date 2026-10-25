#!/bin/sh
set -eu
test_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$test_dir/../../.." && pwd)
bin="$test_dir/../bin/see"
TOOL_FACTORY_HOME=$(cd "$(mktemp -d)" && pwd -P)
export TOOL_FACTORY_HOME
trap 'rm -rf "$TOOL_FACTORY_HOME"' EXIT
out="$TOOL_FACTORY_HOME/out"
mkdir "$out"
runs="$TOOL_FACTORY_HOME/runs.jsonl"

fail() { echo "FAIL see: $1" >&2; exit 1; }

uv run -q --with pillow python - "$out" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
for word, background in (("FACTORY", "white"), ("ATOMS", "yellow")):
    image = Image.new("RGB", (640, 240), background)
    ImageDraw.Draw(image).text((40, 70), word, fill="black", font=ImageFont.load_default(size=110))
    image.save(f"{sys.argv[1]}/{word.lower()}.png")
PY

TOOL_FACTORY_CALLER=see-test "$bin" describe "$out/factory.png" "$out/atoms.png" --json > "$out/notes.json"
"$repo/contracts/check" image-notes "$out/notes.json" \
	|| fail "describe output does not match image-notes.schema.json"
[ "$(jq -r '.images[0].path' "$out/notes.json")" = "$out/factory.png" ] || fail "the first note is not for factory.png"
case "$(jq -r '.images[0].text' "$out/notes.json")" in *FACTORY*) ;; *) fail "factory.png notes miss FACTORY: $(jq -c '.images[0]' "$out/notes.json")" ;; esac
case "$(jq -r '.images[1].text' "$out/notes.json")" in *ATOMS*) ;; *) fail "atoms.png notes miss ATOMS: $(jq -c '.images[1]' "$out/notes.json")" ;; esac
[ "$(jq -r .model "$out/notes.json")" = haiku ] || fail "the model is not haiku"
[ "$(jq .cacheHit "$out/notes.json")" = false ] || fail "first describe reported a cache hit"
paid=$(tail -n 1 "$runs")
[ "$(echo "$paid" | jq '.costUsd > 0')" = true ] || fail "the paid run logged no cost: $paid"
[ "$(echo "$paid" | jq -r .caller)" = see-test ] || fail "the run log did not record the caller: $paid"

cp "$out/factory.png" "$out/same-bytes.png"
"$bin" describe "$out/same-bytes.png" --json > "$out/again.json"
[ "$(jq .cacheHit "$out/again.json")" = true ] || fail "an image with the same bytes missed the cache"
[ "$(jq '.costUsd == 0' "$out/again.json")" = true ] || fail "a cache hit reported model spend"
[ "$(jq -c '.images[0] | del(.path)' "$out/again.json")" = "$(jq -c '.images[0] | del(.path)' "$out/notes.json")" ] \
	|| fail "the cached note differs from the first note"

uv run -q --with pillow python -c "from PIL import Image; Image.new('RGB', (64, 64), 'red').save('$out/red.png')"
if TOOL_FACTORY_BUDGET_USD=0.0001 "$bin" describe "$out/red.png" --json > "$out/over.json"; then fail "over budget exited 0"; fi
[ "$(jq -r .error.code "$out/over.json")" = budget_exceeded ] || fail "over budget did not report budget_exceeded"
[ "$(tail -n 1 "$runs" | jq ".costUsd == 0")" = true ] || fail "the refused run logged a cost"

printf 'not an image' > "$out/notes.txt"
for source in "$out/notes.txt" "$out/no-such-file.png"; do
	if "$bin" describe "$source" --json > "$out/bad.json"; then fail "$source exited 0"; fi
	[ "$(jq -r .error.code "$out/bad.json")" = invalid_source ] || fail "$source did not report invalid_source"
done
if "$bin" describe --json > "$out/no-arg.json"; then fail "no image exited 0"; fi
[ "$(jq -r .error.code "$out/no-arg.json")" = invalid_args ] || fail "no image did not report invalid_args"

echo "PASS see"

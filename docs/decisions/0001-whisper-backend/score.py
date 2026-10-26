import difflib
import json
import re
import sys


def words(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9\s]", " ", text.lower()).split()


source = words(open(sys.argv[1], encoding="utf-8").read())
for path in sys.argv[2:]:
    heard = words(json.load(open(path, encoding="utf-8"))["text"])
    matcher = difflib.SequenceMatcher(None, source, heard, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    print(f"{path}\t{len(source)}\t{100 * matched / len(source):.1f}")

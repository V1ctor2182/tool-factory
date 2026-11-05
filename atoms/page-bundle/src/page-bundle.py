# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
import re
import shutil
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urldefrag, urljoin, urlparse

from factory_kit import cli, paths, web

MAX_FILES = 80
MAX_BYTES = 20 * 1024 * 1024
LOCAL = "http://page.invalid/index.html"
Q = r"[\"'`]"

SIGNATURES = (
    ("vite", "build", "html", r"/assets/index-[\w-]+\.js"),
    ("vite", "build", "script", rf"supports\(\s*{Q}modulepreload"),
    ("next", "build", "html", r"/_next/[\w/.-]+"),
    ("nuxt", "build", "html", r"/_nuxt/[\w/.-]+"),
    ("astro", "build", "html", r"/_astro/[\w/.-]+|<astro-island"),
    ("webpack", "build", "script", r"webpackChunk\w*"),
    ("react", "view", "script", r"react\.dev/errors|reactjs\.org/docs/error-decoder|__REACT_DEVTOOLS_GLOBAL_HOOK__"),
    ("preact", "view", "script", r"__PREACT_DEVTOOLS__"),
    ("vue", "view", "script", r"__VUE_PROD_DEVTOOLS__|__vue_app__"),
    ("svelte", "view", "script", r"__svelte\w*"),
    ("solid", "view", "script", r"_\$HY\b|\$DX_DELEGATE"),
    ("snabbdom", "view", "script", r"hook\?\.destroy\?\.\(|data\.hook\.destroy"),
    ("pixi", "render", "script", r"\[PixiJS\]"),
    ("three", "render", "script", r"__THREE__|three\.module|THREE\.WebGLRenderer"),
    ("webgl", "render", "script", rf"getContext\(\s*{Q}(?:webgl2?|experimental-webgl){Q}"),
    ("canvas 2d", "render", "script", rf"getContext\(\s*{Q}2d{Q}"),
    ("tailwind", "style", "stylesheet", r"/\*! tailwindcss v[\d.]+"),
    ("bootstrap", "style", "stylesheet", r"Bootstrap\s+v\d[\d.]*"),
    ("cloudflare insights", "analytics", "html", r"static\.cloudflareinsights\.com[\w/.-]*|data-cf-beacon"),
    ("google analytics", "analytics", "html script", r"googletagmanager\.com/gtag[\w/.?=-]*|google-analytics\.com[\w/.-]*"),
    ("plausible", "analytics", "html", r"plausible\.io/js[\w/.-]*"),
    ("posthog", "analytics", "html script", r"posthog\.com|posthog\.init"),
    ("vercel analytics", "analytics", "html", r"/_vercel/insights[\w/.-]*|va\.vercel-scripts\.com[\w/.-]*"),
)

LINK_TYPES = {"stylesheet": "stylesheet", "modulepreload": "script"}
IMPORT = re.compile(rf"\bimport\s*\(\s*({Q})([^\"'`]+?)\1\s*\)|\b(?:from|import)\s*({Q})([^\"'`]+?)\3")
CSS_IMPORT = re.compile(r"@import\s+(?:url\()?\s*[\"']?([^\"')\s;]+)")
SOURCEMAP = re.compile(r"[#@]\s*sourceMappingURL=([^\s*\"'`]+)")
MODULE = re.compile(r"(?<![\w/.@-])(?:\.\./)*(?:src|app|lib|packages|components|pages)/[\w./@-]+?\.(?:tsx?|jsx?|mjs|vue|svelte)(?![\w])(?:#([\w$]+))?")
ASSIGN = re.compile(rf"(?<![\w$.])([\w$]+)=(?!=)(?:({Q})((?:(?!\2).)*?)\2)?")
STORAGE = re.compile(rf"(?:local|session)Storage\.(?:get|set|remove)Item\(\s*(?:({Q})((?:(?!\1).)*?)\1|([\w$]+))")
KEY = re.compile(rf"\bcase\s*({Q})((?:(?!\1).){{1,12}})\1\s*:|\.(?:key|code)\s*[!=]==?\s*({Q})((?:(?!\3).){{1,12}})\3|({Q})((?:(?!\5).){{1,12}})\5\s*[!=]==?\s*[\w$]+\.(?:key|code)\b")
NAMED_KEY = re.compile(r"Escape|Enter|Tab|Backspace|Delete|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-2])|Key[A-Z]|Digit\d")
ROUTE = re.compile(rf"({Q})(/[a-z][\w-]*(?:/[\w:-]+)*/?)\1")
ASSET_EXT = r"\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a|mp4|webm|mov)(?:[?#][^\"'`\s)]*)?"
ASSET = re.compile(rf"^[^\s\"'`()<>]+{ASSET_EXT}$")
JS_ASSET = re.compile(rf"({Q})([^\"'`\s()<>]+{ASSET_EXT})\1")
CSS_URL = re.compile(r"url\(\s*[\"']?([^\"')]+?)[\"']?\s*\)")
THEME = re.compile(r"(?:^|,)\s*(?::root|:host|html)\s*(?=,|$)|\.(?:dark|light)(?:-[\w-]*)?(?![\w\\])|data-theme")


class _Page(HTMLParser):
    def __init__(self, text: str):
        super().__init__()
        self.meta, self.refs, self.styles, self.values, self._tag = {}, [], [], [], None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        self._tag = tag
        self.values += a.values()
        if tag == "meta" and (a.get("name") or a.get("property")) and "content" in a:
            self.meta[a.get("name") or a["property"]] = a["content"]
        if tag == "script" and a.get("src"):
            self.refs.append(("script", a["src"]))
        for rel in a.get("rel", "").lower().split():
            if rel in LINK_TYPES and a.get("href"):
                self.refs.append((LINK_TYPES[rel], a["href"]))

    def handle_endtag(self, tag):
        self._tag = None

    def handle_data(self, data):
        if self._tag == "title":
            self.meta.setdefault("title", data.strip())
        elif self._tag == "style":
            self.styles.append(data)


def _refs(kind: str, text: str) -> list[tuple[str, str]]:
    if kind == "html":
        return _Page(text).refs
    maps = [("sourcemap", m) for m in SOURCEMAP.findall(text) if not m.startswith("data:")]
    if kind == "script":
        specs = (m.group(2) or m.group(4) for m in IMPORT.finditer(text))
        return [("script", s) for s in specs if s.startswith((".", "/", "http"))] + maps
    if kind == "stylesheet":
        return [("stylesheet", s) for s in CSS_IMPORT.findall(text)] + maps
    return []


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _path(url: str, kind: str) -> str | None:
    if kind == "html":
        return "index.html"
    path = urlparse(url).path.lstrip("/")
    return path if path and ".." not in path.split("/") else None


def _crawl(page_url: str, load) -> list[dict]:
    def get(ref):
        path = _path(ref[1], ref[0])
        return path, load(ref[1], path) if path else None

    files, seen, level = [], {page_url}, [("html", page_url)]
    with ThreadPoolExecutor(8) as pool:
        while level and len(files) < MAX_FILES:
            level, found = level[: MAX_FILES - len(files)], []
            for (kind, url), (path, body) in zip(level, pool.map(get, level)):
                if body is None or len(body) > MAX_BYTES:
                    continue
                text = body.decode("utf-8", "replace")
                files.append({"path": path, "url": url, "type": kind, "bytes": len(body), "body": body, "text": text})
                for ref_kind, ref in _refs(kind, text):
                    target = urldefrag(urljoin(url, ref))[0]
                    if _origin(target) == _origin(page_url) and target not in seen:
                        seen.add(target)
                        found.append((ref_kind, target))
            level = found
    return files


def _stack(texts) -> list[dict]:
    found = {}
    for name, layer, kind, pattern in SIGNATURES:
        for f, text in texts:
            m = name not in found and f["type"] in kind.split() and re.search(pattern, text)
            if m:
                found[name] = {"name": name, "layer": layer, "evidence": f"{m.group(0).strip()[:60]} in {f['path']}"}
    return list(found.values())


def _modules(scripts, maps) -> list[dict]:
    found: dict[str, set] = {}
    sources = [s for _, t in maps for s in json.loads(t).get("sources", []) if isinstance(s, str) and "node_modules" not in s]
    texts = [t for _, t in scripts] + [re.sub(r"^[a-z]+://[^/]*/|^\./", "", s) for s in sources]
    for text in texts:
        for m in MODULE.finditer(text):
            names = found.setdefault(m.group(0).split("#")[0], set())
            if m.group(1):
                names.add(m.group(1))
    return [{"path": p, "names": sorted(found[p])} for p in sorted(found)]


def _storage_keys(scripts) -> list[str]:
    keys = set()
    for _, text in scripts:
        names = set()
        for m in STORAGE.finditer(text):
            if m.group(3):
                names.add(m.group(3))
            elif "${" not in m.group(2):
                keys.add(m.group(2))
        values: dict[str, list] = {}
        for m in ASSIGN.finditer(text) if names else ():
            if m.group(1) in names:
                values.setdefault(m.group(1), []).append(m.group(3) if m.group(2) else None)
        keys |= {v[0] for v in values.values() if None not in v}
    return sorted(keys)


def _keys(scripts) -> list[str]:
    keys = set()
    for _, text in scripts:
        if "keydown" in text or "keyup" in text:
            for m in KEY.finditer(text):
                key = m.group(2) or m.group(4) or m.group(6)
                if (len(key) == 1 and key.isprintable()) or NAMED_KEY.fullmatch(key):
                    keys.add(key)
    return sorted(keys)


def _routes(scripts) -> list[str]:
    return sorted({m.group(2) for _, text in scripts for m in ROUTE.finditer(text)})


def _rules(css):
    """Yields each innermost rule with the @media, @supports, and @container conditions around it."""
    for _, text in css:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        blocks, start = [], 0
        for m in re.finditer(r"[{};]", text):
            if m.group() == "{":
                if blocks:
                    blocks[-1][2] = True
                blocks.append([text[start : m.start()].strip(), m.end(), False])
            elif m.group() == "}" and blocks:
                selector, body_at, nested = blocks.pop()
                if not nested:
                    conditions = [p for p, _, _ in blocks if p.startswith(("@media", "@supports", "@container"))]
                    yield conditions, selector, text[body_at : m.start()]
            start = m.end()


def _tokens(css) -> dict:
    tokens: dict[str, dict] = {}
    for conditions, selector, body in _rules(css):
        # Tailwind's --tw-* properties are its own plumbing, not the site's design tokens.
        props = {k: v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+)", body) if not k.startswith("--tw-")}
        if props and THEME.search(selector):
            tokens.setdefault(" ".join([*conditions, selector]), {}).update(props)
    return tokens


def _keyframes(css) -> list[str]:
    return list(dict.fromkeys(n for _, t in css for n in re.findall(r"@(?:-webkit-)?keyframes\s+([\w-]+)", t)))


def _easings(css) -> list[dict]:
    counts = Counter(re.sub(r"\s+", "", m) for _, t in css for m in re.findall(r"cubic-bezier\([^)]*\)", t))
    return [{"value": v, "count": c} for v, c in counts.most_common()]


def _fonts(css, page: _Page) -> list[str]:
    faces = (f.strip().strip("'\"") for _, t in css for f in re.findall(r"@font-face\s*\{[^}]*?font-family\s*:\s*([^;}]+)", t))
    google = (fam.split(":")[0] for v in page.values if "fonts.googleapis.com/css" in v for fam in parse_qs(urlparse(v).query).get("family", []))
    return sorted(set(faces) | set(google))


def _assets(texts, css, page: _Page, html: dict) -> list[str]:
    refs = [(html, v) for v in page.values if ASSET.match(v)]
    refs += [(f, u) for f, t in css for u in CSS_URL.findall(t) if ASSET.match(u)]
    refs += [(f, m.group(2)) for f, t in texts if f["type"] == "script" for m in JS_ASSET.finditer(t)]
    return sorted({urljoin(f["url"], ref) if f["url"] else ref for f, ref in refs if not ref.startswith("data:")})


def read(crawled: list[dict]) -> dict:
    files = [{k: v for k, v in f.items() if k not in ("body", "text")} for f in crawled]
    texts = list(zip(files, (f["text"] for f in crawled)))
    html = texts[0]
    page = _Page(html[1])
    scripts = [(f, t) for f, t in texts if f["type"] == "script"]
    css = [(f, t) for f, t in texts if f["type"] == "stylesheet"] + [(html[0], s) for s in page.styles]
    try:
        modules = _modules(scripts, [(f, t) for f, t in texts if f["type"] == "sourcemap"])
    except ValueError as e:
        raise cli.AtomError("invalid_source", f"A source map is not JSON: {e}") from None
    return {
        "files": files,
        "meta": page.meta,
        "stack": _stack(texts),
        "modules": modules,
        "routes": _routes(scripts),
        "keys": _keys(scripts),
        "storageKeys": _storage_keys(scripts),
        "tokens": _tokens(css),
        "keyframes": _keyframes(css),
        "easings": _easings(css),
        "fonts": _fonts(css, page),
        "assets": _assets(texts, css, page, html[0]),
        "cacheHit": False,
    }


def fetch(url: str) -> dict:
    def load(target: str, path: str) -> bytes | None:
        if target == url:
            return web.get_bytes(url, "page-bundle", "text/html")
        return web.get_bytes(target, "page-bundle", none_on=(401, 403, 404, 410))

    files = _crawl(url, load)
    staging = Path(tempfile.mkdtemp(dir=paths.atom_dir("page-bundle", "tmp")))
    final = paths.atom_dir("page-bundle") / urlparse(url).netloc
    try:
        for f in files:
            (staging / f["path"]).parent.mkdir(parents=True, exist_ok=True)
            (staging / f["path"]).write_bytes(f["body"])
        shutil.rmtree(final, ignore_errors=True)
        staging.rename(final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {"source": url, "dir": str(final), **read(files)}


def parse(dir: str) -> dict:
    root = Path(dir).expanduser()
    if not (root / "index.html").is_file():
        raise cli.AtomError("invalid_source", f"No index.html in {dir}")

    def load(target: str, path: str) -> bytes | None:
        file = root / path
        return file.read_bytes() if file.is_file() else None

    files = [{**f, "url": None} for f in _crawl(LOCAL, load)]
    return {"source": dir, "dir": str(root.absolute()), **read(files)}


def _text(result: dict) -> str:
    return "\n".join(f"{s['layer']} {s['name']}" for s in result["stack"])


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"fetch": cli.Verb(fetch, _text), "parse": cli.Verb(parse, _text)},
    )

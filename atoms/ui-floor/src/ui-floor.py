# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path
from urllib.parse import urlparse

from factory_kit import chrome, cli
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

LOAD_MS = 45_000
WIDTHS = (1280, 390)
SAMPLES = 5
CONTEXT = {"locale": "en-US", "timezone_id": "UTC", "service_workers": "block"}

# Runs in the page. Returns [floor line, rule, selector, detail] for each element that breaks a line of vstack's design floor
# that a script can see. The other lines (motion, focus, extra text, boxes, fake materials) need judgment.
FINDINGS_JS = r"""
() => {
  const out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); break; }
      const cls = [...e.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      parts.unshift(e.tagName.toLowerCase() + cls);
    }
    return parts.join(' > ');
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const rgba = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const background = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor);
      if (c.length >= 3 && (c.length === 3 || c[3] === 1)) return c;
    }
    return [255, 255, 255];
  };
  const emoji = /\p{Extended_Pictographic}/u;
  const onlyEmoji = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u;

  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg'].includes(el.tagName)) continue;
    const s = getComputedStyle(el);
    const text = ownText(el);

    // 8. Emoji as icons: an emoji alone in an element, or inside a control.
    if (text && emoji.test(text) && (onlyEmoji.test(text) || el.closest('button, a, [role=button], [role=menuitem], [role=tab]'))) {
      out.push([8, 'emoji-icon', path(el), text.slice(0, 40)]);
    }
    // 6. Dead black text or fill.
    if (text && /^rgba?\(0, 0, 0(, 1)?\)$/.test(s.color)) out.push([6, 'pure-black', path(el), 'color']);
    if (/^rgba?\(0, 0, 0(, 1)?\)$/.test(s.backgroundColor)) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= 0.1 * innerWidth * innerHeight) out.push([6, 'pure-black', path(el), 'background']);
    }
    // 7. Low contrast, against the nearest solid background. Skipped over images and gradients.
    if (text) {
      const bg = background(el);
      const fg = rgba(s.color);
      if (bg && fg.length >= 3 && (fg.length === 3 || fg[3] === 1)) {
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b + 0.05);
        const size = parseFloat(s.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push([7, 'low-contrast', path(el), `${ratio.toFixed(2)}:1`]);
      }
    }
    // 4. Clipping: text cut off by its own box, or a control past the right edge of the screen.
    if (text && /hidden|clip/.test(s.overflowX + s.overflowY) && s.textOverflow !== 'ellipsis' &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      out.push([4, 'clipped', path(el), text.slice(0, 40)]);
    }
    if (el.matches('button, a, input, select, textarea, [role=button]')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) out.push([4, 'off-screen', path(el), `${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth}`]);
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    out.push([4, 'page-scrolls-sideways', 'html', `${document.documentElement.scrollWidth} of ${innerWidth}`]);
  }
  return out;
}
"""


def _findings(url: str) -> list[dict]:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except PlaywrightError as e:
            raise cli.AtomError("unavailable", f"Headless Chromium is missing. Run: uv run --with playwright==1.63.0 playwright install chromium ({e.message.splitlines()[0]})") from None
        try:
            found: dict[tuple, dict] = {}
            for width in WIDTHS:
                page = browser.new_context(viewport={"width": width, "height": 800}, **CONTEXT).new_page()
                try:
                    response = page.goto(url, wait_until="networkidle", timeout=LOAD_MS)
                except PlaywrightTimeout:
                    raise cli.AtomError("network_error", f"{url} did not go network idle within {LOAD_MS // 1000}s") from None
                except PlaywrightError as e:
                    raise cli.AtomError("network_error", f"{url}: {e.message.splitlines()[0]}") from None
                chrome.refuse_bot_check(page, response, url, "ui-floor")
                if response and response.status >= 400:
                    raise cli.AtomError("unavailable", f"{url} answered HTTP {response.status}")
                for line, rule, selector, detail in page.evaluate(FINDINGS_JS):
                    key = (rule, selector, detail)
                    if key in found:
                        found[key]["widths"].append(width)
                    else:
                        found[key] = {"line": line, "rule": rule, "selector": selector, "detail": detail, "widths": [width]}
                page.context.close()
            return list(found.values())
        finally:
            browser.close()


def check(url: str) -> dict:
    if urlparse(url).scheme not in ("http", "https", "file"):
        raise cli.AtomError("invalid_source", f"Not an http, https, or file URL: {url}")
    findings = _findings(url)
    findings.sort(key=lambda f: (f["line"], f["rule"]))
    return {"source": url, "widths": list(WIDTHS), "findings": findings, "cacheHit": False}


def _text(result: dict) -> str:
    if not result["findings"]:
        return "PASS ui-floor: no floor line a script can see is broken"
    rows = {}
    for f in result["findings"]:
        rows.setdefault((f["line"], f["rule"]), []).append(f)
    lines = []
    for (line, rule), fs in rows.items():
        lines.append(f"floor {line} {rule}: {len(fs)}")
        lines += [f"  {f['selector']}  {f['detail']}  at {','.join(map(str, f['widths']))}px" for f in fs[:SAMPLES]]
    return "\n".join(lines)


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"check": cli.Verb(check, _text)})

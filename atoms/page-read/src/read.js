() => {
  const LIMIT = 400;
  const clean = (s, n = 160) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const box = (r) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  const attrs = (el) => Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, clean(a.value, 80)]));
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && document.querySelectorAll(`#${e.id}`).length === 1) {
        parts.unshift(`#${e.id}`);
        break;
      }
      const same = [...(e.parentElement?.children || [])].filter((c) => c.tagName === e.tagName);
      parts.unshift(same.length > 1 ? `${e.tagName.toLowerCase()}:nth-of-type(${same.indexOf(e) + 1})` : e.tagName.toLowerCase());
    }
    return parts.join(' > ');
  };
  const signature = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`.slice(0, 120);

  const labels = [...document.querySelectorAll('canvas[aria-label], video[aria-label], [role="img"][aria-label], svg[aria-label]')]
    .slice(0, 80)
    .map((e) => ({ role: e.getAttribute('role') || e.tagName.toLowerCase(), label: clean(e.getAttribute('aria-label'), 400) }));

  const sections = [...document.querySelectorAll('section, main > *, [id]:not(script):not(style):not(svg *)')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.height > innerHeight / 2 && r.width > innerWidth / 2)
    .slice(0, 60)
    .map(({ e, r }) => ({ tag: e.tagName.toLowerCase(), id: e.id, y: Math.round(r.top + scrollY), height: Math.round(r.height), heading: clean(e.querySelector('h1, h2, h3')?.textContent, 80) }));

  const seen = new Set();
  const targets = [];
  const pick = (el, kind) => {
    if (seen.has(el) || targets.length >= LIMIT) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || style.visibility === 'hidden' || style.display === 'none') return;
    const href = el.getAttribute('href') || '';
    const samePage = href.startsWith('#') || (el.href && el.hash && el.pathname === location.pathname);
    const inForm = !!el.closest('form');
    const safe = el.tagName === 'A' ? !!samePage : !inForm && el.getAttribute('type') !== 'submit';
    targets.push({ id: `t${String(targets.length).padStart(3, '0')}`, kind, selector: path(el), text: clean(el.textContent || el.getAttribute('aria-label'), 60), href, rect: box(r), y: Math.round(r.top + scrollY), cursor: style.cursor, signature: signature(el), safe });
  };
  document.querySelectorAll('a[href], button, summary, [role="button"], [role="tab"], [aria-expanded], [tabindex]:not([tabindex="-1"])').forEach((el) => pick(el, el.tagName === 'A' ? 'link' : 'button'));
  for (const el of document.querySelectorAll('body *')) {
    if (targets.length >= LIMIT) break;
    if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) pick(el, 'cursor');
  }

  const running = document.getAnimations();
  const scrollDriven = running.filter((a) => a.timeline && a.timeline !== document.timeline);
  const names = [...new Set(running.map((a) => a.animationName || a.transitionProperty || '').filter(Boolean))].slice(0, 60);
  const fonts = [...new Set([...document.querySelectorAll('h1, h2, h3, p, a, button')].slice(0, 200).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))];
  const gl = document.createElement('canvas');

  return {
    title: document.title,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    labels,
    dataAttributes: { html: attrs(document.documentElement), body: attrs(document.body) },
    sections,
    canvases: [...document.querySelectorAll('canvas')].slice(0, 30).map((c) => ({ rect: box(c.getBoundingClientRect()), label: clean(c.getAttribute('aria-label'), 300) })),
    media: { video: document.querySelectorAll('video').length, img: document.images.length, svg: document.querySelectorAll('svg').length, iframe: document.querySelectorAll('iframe').length },
    animations: { scrollDriven: scrollDriven.length, clock: running.length - scrollDriven.length, names },
    capabilities: { webgl2: !!gl.getContext('webgl2'), webgpu: !!navigator.gpu, htmlInCanvas: 'requestPaint' in HTMLCanvasElement.prototype, lenis: !!window.lenis || document.documentElement.classList.contains('lenis'), scrollTimeline: 'ScrollTimeline' in window, finePointer: matchMedia('(hover: hover) and (pointer: fine)').matches },
    fonts,
    targets,
  };
}

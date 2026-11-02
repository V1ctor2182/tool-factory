(() => {
  const PROPS = [
    'display', 'position', 'box-sizing', 'width', 'height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'color', 'background-color', 'background-image',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
    'opacity', 'transform', 'transition', 'animation',
    'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
    'grid-template-columns', 'grid-template-rows', 'cursor',
  ];

  const STYLE = 'style';
  const root = (selector) => document.querySelector(selector);

  const path = (el, top) => {
    const steps = [];
    for (let node = el; node !== top; node = node.parentElement) steps.unshift(`:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
    return [':scope', ...steps].join(' > ');
  };

  const finite = (a) => Number.isFinite(a.effect?.getComputedTiming().endTime);

  // Under the virtual clock document.timeline only moves when Chromium happens to draw a main frame, and it can stall for
  // hundreds of milliseconds after an animation starts. So every animation is paused when first seen and its currentTime
  // set from performance.now(), which virtual time moves exactly. Reaching its end, it is finished, so finish and
  // animationend fire as usual. Virtual time moves in whole milliseconds, and rounding drops the jitter Chromium adds to
  // performance.now(), which would otherwise shift edges by a fraction of a pixel from run to run.
  const DRIVE_MS = 4;
  const driven = new Map();
  const running = (a) => a.playState === 'running' || driven.has(a);
  const drive = () => {
    const now = Math.round(performance.now());
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running' || driven.has(a)) continue;
      driven.set(a, now);
      a.pause();
    }
    for (const [a, start] of driven) {
      if (a.playState !== 'paused') {
        driven.delete(a);
        continue;
      }
      const t = (now - start) * a.playbackRate;
      if (t >= a.effect.getComputedTiming().endTime) {
        driven.delete(a);
        a.finish();
      } else {
        a.currentTime = t;
      }
    }
  };
  setInterval(drive, DRIVE_MS);

  const timeouts = new Set();
  const { setTimeout: set, clearTimeout: clear } = window;
  window.setTimeout = function (fn, ...rest) {
    if (typeof fn !== 'function') return set.call(this, fn, ...rest);
    const id = set.call(this, (...args) => {
      timeouts.delete(id);
      return fn(...args);
    }, ...rest);
    timeouts.add(id);
    return id;
  };
  window.clearTimeout = function (id) {
    timeouts.delete(id);
    return clear.call(this, id);
  };

  window.__uiRecord = {
    drive,

    unsettled: () => timeouts.size > 0 || document.getAnimations().some((a) => running(a) && finite(a)),

    animations(selector) {
      const top = root(selector);
      return document.getAnimations().flatMap((a) => {
        const el = a.effect?.target;
        if (!running(a) || !el || !top.contains(el)) return [];
        const t = a.effect.getTiming();
        return [{
          target: path(el, top),
          pseudoElement: a.effect.pseudoElement ?? null,
          type: a.constructor.name in { CSSAnimation: 1, CSSTransition: 1 } ? a.constructor.name : 'Animation',
          name: a.animationName ?? a.transitionProperty ?? a.id,
          keyframes: a.effect.getKeyframes().map(({ computedOffset, ...k }) => k),
          duration: typeof t.duration === 'number' ? t.duration : 0,
          delay: t.delay,
          endDelay: t.endDelay,
          easing: t.easing,
          iterations: Number.isFinite(t.iterations) ? t.iterations : 'infinite',
          direction: t.direction,
          fill: t.fill,
        }];
      });
    },

    dom(selector) {
      const clone = root(selector).cloneNode(true);
      clone.querySelectorAll('script').forEach((s) => s.remove());
      [clone, ...clone.querySelectorAll('*')].forEach((el) => el.getAttribute(STYLE) === '' && el.removeAttribute(STYLE));
      return clone.outerHTML;
    },

    styles(selector) {
      const top = root(selector);
      const out = {};
      for (const el of [top, ...top.querySelectorAll('*')]) {
        if (el.tagName === 'SCRIPT') continue;
        const cs = getComputedStyle(el);
        out[path(el, top)] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
      }
      return out;
    },

    motion(selector) {
      const top = root(selector);
      const out = {};
      for (const el of [top, ...top.querySelectorAll('*')]) {
        if (el.tagName === 'SCRIPT') continue;
        const cs = getComputedStyle(el);
        out[path(el, top)] = { transform: cs.transform, opacity: cs.opacity };
      }
      return out;
    },

    box(selector, margin) {
      const r = root(selector).getBoundingClientRect();
      const x = Math.max(0, Math.floor(r.left - margin));
      const y = Math.max(0, Math.floor(r.top - margin));
      return {
        x, y,
        width: Math.min(innerWidth, Math.ceil(r.right + margin)) - x,
        height: Math.min(innerHeight, Math.ceil(r.bottom + margin)) - y,
      };
    },

    paste(text) {
      const target = document.activeElement ?? document.body;
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      return target.dispatchEvent(event);
    },
  };
})();

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

  // A popup usually renders in a portal outside the target, so nothing recorded for the target shows it. A piece is the
  // outermost element that was not visible at load and is now, outside the target or hanging off it. A wrapper or backdrop
  // that fills the viewport is looked through, since behind it each page shows something different.
  const INERT = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
  const MIN_PX = 4;
  const SLACK_PX = 2;
  const FILLS = 0.9;
  let baseline = new WeakSet();
  const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const hollow = (r) => r.width < MIN_PX || r.height < MIN_PX || (r.width >= innerWidth * FILLS && r.height >= innerHeight * FILLS);
  const onScreen = (r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;

  const hangsOff = (el, top, box) => {
    const r = el.getBoundingClientRect();
    if (!['absolute', 'fixed'].includes(getComputedStyle(el).position) || hollow(r)) return false;
    if (r.left >= box.left - SLACK_PX && r.top >= box.top - SLACK_PX && r.right <= box.right + SLACK_PX && r.bottom <= box.bottom + SLACK_PX) return false;
    for (let node = el.parentElement; node !== top.parentElement; node = node.parentElement) {
      if (getComputedStyle(node).overflow !== 'visible') return false;
    }
    return true;
  };

  const pieces = (top) => {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (INERT.has(child.tagName) || top.contains(child)) continue;
        if (child.contains(top) || baseline.has(child) || getComputedStyle(child).display === 'contents') {
          walk(child);
        } else if (shown(child)) {
          const r = child.getBoundingClientRect();
          if (hollow(r)) walk(child);
          else if (onScreen(r)) out.push(child);
        }
      }
    };
    walk(document.body);
    const box = top.getBoundingClientRect();
    for (const el of top.querySelectorAll('*')) {
      if (!baseline.has(el) && !INERT.has(el.tagName) && shown(el) && !out.some((p) => p.contains(el)) && hangsOff(el, top, box)) out.push(el);
    }
    return out;
  };

  const domOf = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script').forEach((s) => s.remove());
    [clone, ...clone.querySelectorAll('*')].forEach((c) => c.getAttribute(STYLE) === '' && c.removeAttribute(STYLE));
    return clone.outerHTML;
  };

  const stylesOf = (top) => {
    const out = {};
    for (const el of [top, ...top.querySelectorAll('*')]) {
      if (el.tagName === 'SCRIPT') continue;
      const cs = getComputedStyle(el);
      out[path(el, top)] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  };

  const clip = (r, margin) => {
    const x = Math.max(0, Math.floor(r.left - margin));
    const y = Math.max(0, Math.floor(r.top - margin));
    return {
      x, y,
      width: Math.min(innerWidth, Math.ceil(r.right + margin)) - x,
      height: Math.min(innerHeight, Math.ceil(r.bottom + margin)) - y,
    };
  };

  window.__uiRecord = {
    drive,

    baseline() {
      baseline = new WeakSet([...document.querySelectorAll('*')].filter(shown));
    },

    overlays(selector, margin) {
      const box = root(selector).getBoundingClientRect();
      return pieces(root(selector)).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          dom: domOf(el),
          styles: stylesOf(el),
          clip: clip(r, margin),
          offset: { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top) },
          at: { x: Math.round(r.left), y: Math.round(r.top) },
        };
      });
    },

    unsettled: () => timeouts.size > 0 || document.getAnimations().some((a) => running(a) && finite(a)),

    animations(selector) {
      const top = root(selector);
      const outside = pieces(top);
      const where = (el) => {
        if (top.contains(el)) return path(el, top);
        const i = outside.findIndex((p) => p.contains(el));
        return i < 0 ? null : path(el, outside[i]).replace(':scope', `:overlay(${i})`);
      };
      return document.getAnimations().flatMap((a) => {
        const el = a.effect?.target;
        const target = el && running(a) ? where(el) : null;
        if (!target) return [];
        const t = a.effect.getTiming();
        return [{
          target,
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

    dom: (selector) => domOf(root(selector)),

    styles: (selector) => stylesOf(root(selector)),

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

    box: (selector, margin) => clip(root(selector).getBoundingClientRect(), margin),

    paste(text) {
      const target = document.activeElement ?? document.body;
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      return target.dispatchEvent(event);
    },
  };
})();

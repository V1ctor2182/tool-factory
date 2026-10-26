// usage: node f6-review-capture.mjs <out-dir> <seeded-url> <corrupt-log-url> <zero-budget-url>
// Drives headless Chrome over CDP against running dashboards, writes the lane 2, 3, 7, and 8 screenshots,
// and writes video frames plus an ffconcat list for ffmpeg.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, seeded, corrupt, zeroBudget] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const frames = join(out, 'frames');
mkdirSync(frames, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync('/private/tmp/f6-review-chrome-')}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((list) => list.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  pending.get(msg.id)?.(msg);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
}
async function scheme(value) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}
async function open(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 50 && !(await run("performance.getEntriesByName('rendered').length")); i++) await wait(100);
}
async function png(full) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  return Buffer.from(data, 'base64');
}

const list = [];
let count = 0;
async function frame(seconds) {
  const name = `${String(count++).padStart(4, '0')}.png`;
  writeFileSync(join(frames, name), await png(false));
  list.push(`file 'frames/${name}'`, `duration ${seconds}`);
}
async function scrollTo(selector, steps = 12) {
  const [from, to] = await run(`[scrollY, Math.min(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY - 16, document.documentElement.scrollHeight - innerHeight)]`);
  for (let i = 1; i <= steps; i++) {
    await run(`scrollTo(0, ${from + ((to - from) * i) / steps})`);
    await frame(0.1);
  }
}
const expand = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).open = true`);
const shot = async (name, full) => writeFileSync(join(out, name), await png(full));

await send('Page.enable');
await send('Runtime.enable');
await viewport(1280, 900);
await scheme('light');
await open(seeded);
await shot('f6-review-home.png', true);
await expand('[data-tool="youtube"] [data-atom="transcribe"]');
await run(`document.querySelector('[data-tool="youtube"] [data-atom="transcribe"]').scrollIntoView({ block: 'center' })`);
await shot('f6-review-used-by.png', false);
await scheme('dark');
await open(seeded);
await shot('f6-review-dark.png', true);
await scheme('light');
await viewport(375, 812, true);
await open(seeded);
const phoneWidth = await run('[document.documentElement.scrollWidth, innerWidth]');
await shot('f6-review-phone.png', true);

await viewport(1280, 800);
await open(seeded);
await frame(4);
await scrollTo('[data-tool="youtube"] .stats');
await frame(5);
await expand('[data-tool="youtube"] [data-atom="transcribe"]');
await frame(3);
await expand('[data-tool="youtube"] [data-atom="digest"]');
await scrollTo('[data-tool="youtube"] [data-atom="digest"]', 6);
await frame(3);
await scrollTo('[data-tool="meeting-notes"]');
await frame(4);
await scrollTo('[data-tool="writing-style"]');
await frame(4);
await run('scrollTo(0, 0)');
await scheme('dark');
await frame(4);
await scrollTo('[data-tool="youtube"] .stats');
await frame(3);
await scheme('light');
await open(corrupt);
await frame(5);
await open(zeroBudget);
await frame(4);
await viewport(375, 812, true);
await open(seeded);
await frame(3);
await scrollTo('[data-tool="youtube"] .stats');
await frame(3);
list.push(list.at(-2));
writeFileSync(join(out, 'frames.ffconcat'), `ffconcat version 1.0\n${list.join('\n')}\n`);
console.log(JSON.stringify({ phoneWidth, frames: count }));
ws.close();
chrome.kill();

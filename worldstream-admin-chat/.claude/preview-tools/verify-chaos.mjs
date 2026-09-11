import assert from 'node:assert/strict';
import { chromium } from './node_modules/playwright/index.mjs';
const root = process.cwd();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const scene = await (await fetch('http://127.0.0.1:4401/scene?case=load-busy')).json();
  let socket;
  let revision = 0;
  let current = structuredClone(scene);
  current.chaos = 0;
  const send = () => socket.send(JSON.stringify({ t: 'state', rev: ++revision, serverTime: 0, scene: current }));
  await page.routeWebSocket('**/ws*', ws => { socket = ws; send(); });
  await page.goto('http://127.0.0.1:4401/');
  await page.waitForFunction(() => document.fonts.check('20px "JetBrains Mono"'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-quiet.png` });
  for (const [name, amount] of [['busy', 0.55], ['max', 1]]) {
    current.chaos = amount; send();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-${name}.png` });
  }
  const pixels = region => page.evaluate(({x,y,w,h}) => Array.from(document.querySelector('canvas').getContext('2d').getImageData(x,y,w,h).data), region);
  const rack = { x: 68, y: 564, w: 120, h: 132 };
  const frames = [];
  for (let i = 0; i < 10; i++) { frames.push(await pixels(rack)); await page.waitForTimeout(160); }
  assert.ok(frames.some(frame => JSON.stringify(frame) !== JSON.stringify(frames[0])), 'live servers should pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-reduced.png` });
  const top = { x: 448, y: 52, w: 816, h: 12 };
  const stable = await pixels(top);
  await page.waitForTimeout(1200);
  assert.deepEqual(await pixels(top), stable, 'reduced motion freezes new ceiling flicker');
  current.protagonist.pose = 'stand'; current.protagonist.x = 520; send();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-standing.png` });
  current = await (await fetch('http://127.0.0.1:4401/scene?case=overload-pull')).json();
  current.chaos = 1; send();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-outage.png` });
  current = structuredClone(scene); current.chaos = 0; send();
  await page.waitForTimeout(8500);
  await page.screenshot({ path: `${root}/.claude/preview-tools/chaos-recovered.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ screenshots: 7, serverAnimation: true, reducedMotionCeiling: true, errors }));
} finally { await browser.close(); }

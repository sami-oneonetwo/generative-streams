import assert from 'node:assert/strict';
import { chromium } from './node_modules/playwright/index.mjs';
const root = process.cwd();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fixtures = {};
  for (const name of ['quiet', 'busy', 'strained', 'max', 'upgraded', 'walking']) {
    fixtures[name] = await (await fetch(`http://127.0.0.1:4401/scene?case=chaos-${name}`)).json();
  }
  assert.ok(fixtures.quiet.chaos < fixtures.busy.chaos && fixtures.busy.chaos < fixtures.strained.chaos && fixtures.strained.chaos < fixtures.max.chaos);
  const traffic = scene => scene.entities.find(e => e.kind === 'trafficReadout').props.traffic;
  assert.equal(traffic(fixtures.max).demand, traffic(fixtures.upgraded).demand);
  assert.ok(fixtures.upgraded.chaos < fixtures.max.chaos);
  assert.ok(!fixtures.max.power, 'max preview must show powered chaos, not just an outage');
  let current = fixtures.quiet, socket, revision = 0;
  const send = () => socket.send(JSON.stringify({ t: 'state', rev: ++revision, serverTime: 0, scene: current }));
  await page.routeWebSocket('**/ws*', ws => { socket = ws; send(); });
  await page.goto('http://127.0.0.1:4401');
  await page.waitForTimeout(350);
  await page.clock.install({ time: new Date(0) });
  const pixels = (x, y, w, h) => page.evaluate(({x,y,w,h}) => Array.from(document.querySelector('canvas').getContext('2d').getImageData(x,y,w,h).data), {x,y,w,h});
  for (const name of ['quiet', 'busy', 'strained', 'max', 'upgraded', 'walking']) {
    current = fixtures[name]; send();
    await page.clock.runFor(name === 'upgraded' ? 10000 : 2500);
    await page.screenshot({ path: `${process.env.PREVIEW_OUTPUT ?? `${root}/.claude/preview-tools`}/fixture-chaos-${name}.png` });
  }
  current = fixtures.max; send(); await page.clock.runFor(2500);
  const firstServer = current.entities.find(e => e.kind === 'server');
  const serverRegion = [firstServer.x - 12, firstServer.y - 8, firstServer.w + 28, firstServer.h + 8];
  const regions = { ceiling: [448,56,816,4], lamp: [1136,656,48,40], city: [616,340,12,16], server: serverRegion };
  const seen = Object.fromEntries(Object.keys(regions).map(k => [k,new Set()]));
  for (let i = 0; i < 42; i++) {
    for (const [k, region] of Object.entries(regions)) seen[k].add(JSON.stringify(await pixels(...region)));
    await page.clock.runFor(120);
  }
  for (const [k, values] of Object.entries(seen)) assert.ok(values.size > 1, `${k} animates under max pressure`);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(100);
  const ceiling = await pixels(...regions.ceiling), lamp = await pixels(...regions.lamp);
  const edge = await pixels(serverRegion[0],serverRegion[1],4,serverRegion[3]);
  await page.clock.runFor(4000);
  assert.deepEqual(await pixels(...regions.ceiling), ceiling);
  assert.deepEqual(await pixels(...regions.lamp), lamp);
  assert.deepEqual(await pixels(serverRegion[0],serverRegion[1],4,serverRegion[3]), edge, 'chassis silhouette stops pulsing under reduced motion');
  current = await (await fetch('http://127.0.0.1:4401/scene?case=noodles')).json(); send(); await page.clock.runFor(200);
  assert.equal(current.chaos, undefined);
  await page.screenshot({ path: `${process.env.PREVIEW_OUTPUT ?? `${root}/.claude/preview-tools`}/fixture-chaos-noodles.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ levels: Object.fromEntries(Object.entries(fixtures).map(([k,v]) => [k,v.chaos])), maxDemand: traffic(fixtures.max).demand, upgradedDemand: traffic(fixtures.upgraded).demand, animatedRegions: Object.fromEntries(Object.entries(seen).map(([k,v])=>[k,v.size])), reducedMotion: true, errors }));
} finally { await browser.close(); }

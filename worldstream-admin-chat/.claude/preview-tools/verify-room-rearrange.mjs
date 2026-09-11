import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from './node_modules/playwright/index.mjs';

const origin = 'http://127.0.0.1:4401';
const output = `${process.cwd()}/.preview/room-rearrange`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let socket, revision = 0;
  const send = (scene, serverTime = 0) => socket.send(JSON.stringify({ t: 'state', rev: ++revision, serverTime, scene }));
  const fixture = async name => (await fetch(`${origin}/scene?case=${name}`)).json();
  let current = await fixture('normal');
  await page.routeWebSocket('**/ws*', ws => { socket = ws; send(current); });
  await page.goto(origin);
  await page.waitForTimeout(400);
  await page.clock.install();
  const pixels = (x, y, w, h) => page.evaluate(({ x, y, w, h }) =>
    Array.from(document.querySelector('canvas').getContext('2d').getImageData(x, y, w, h).data), { x, y, w, h });
  for (const name of ['normal', 'empty', 'full', 'chaos-upgraded', 'chaos-walking', 'failure', 'outage', 'overload-pull', 'overload-carry', 'overload-install', 'overload-boot', 'overload-reset', 'screens-long', 'noodles']) {
    current = await fixture(name);
    if (name !== 'noodles') {
      assert.ok(!current.entities.some(e => ['door', 'cooling', 'uptimeSign', 'memorialWall', 'powerPanel', 'uplinkPanel', 'uplinkCable', 'infoMonitor'].includes(e.kind)));
      const cabinet = current.entities.find(e => e.id === 'aquarium-cabinet');
      const tank = current.entities.find(e => e.id === 'fish-tank');
      const board = current.entities.find(e => e.kind === 'whiteboard');
      assert.ok(cabinet.x + cabinet.w + 28 < 456, 'cabinet clears window-seat furniture');
      assert.equal(tank.y + tank.h, cabinet.y);
      assert.ok(board.y + board.h + 8 < tank.y);
    }
    send(current);
    await page.clock.runFor(400);
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  current = await fixture('normal');
  send(current);
  await page.clock.runFor(200);
  const board = current.entities.find(e => e.kind === 'whiteboard');
  const writing = await pixels(board.x + 8, board.y + 8, board.w - 16, board.h - 16);
  await page.clock.runFor(19000);
  assert.deepEqual(await pixels(board.x + 8, board.y + 8, board.w - 16, board.h - 16), writing, 'whiteboard writing does not cycle or flash');
  current = await fixture('full');
  const monitor = current.entities.find(e => e.kind === 'chatMonitor');
  const outlet = [monitor.x + monitor.w - 24, monitor.y + monitor.h - 12];
  monitor.props.receipts = [];
  send(current);
  await page.clock.runFor(200);
  const portPixel = target => target.kind === 'server'
    ? [target.x + target.w - 8, target.y + 8]
    : [target.x + 724, target.y + 112];
  const targets = ['preview-0', 'preview-8', 'preview-16', 'station'];
  let sequence = 0;
  for (const id of targets) {
    const target = current.entities.find(e => e.id === id);
    const [x, y] = portPixel(target);
    const baseline = await pixels(x, y, 4, 4);
    const receipt = { sequence: ++sequence, at: 0, label: id, targetId: id };
    monitor.props.receipts = [receipt];
    monitor.props.messages = [{ username: 'preview_chat', text: `Message to ${id}`, receipt }];
    send(current);
    await page.clock.runFor(300);
    if (id === 'preview-0') await page.screenshot({ path: `${output}/packet-travelling.png` });
    await page.clock.runFor(1100);
    assert.notDeepEqual(await pixels(x, y, 4, 4), baseline, `${id} acknowledges its own receipt`);
    await page.screenshot({ path: `${output}/packet-${id}.png` });
    await page.clock.runFor(300);
    assert.deepEqual(await pixels(x, y, 4, 4), baseline, `${id} packet expires`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const target = current.entities.find(e => e.id === targets[0]);
  const [x, y] = portPixel(target);
  const baseline = await pixels(x, y, 4, 4);
  monitor.props.receipts = [{ sequence: ++sequence, at: 0, label: 'reduced', targetId: target.id }];
  send(current);
  await page.clock.runFor(1400);
  assert.deepEqual(await pixels(x, y, 4, 4), baseline, 'reduced motion keeps static cable without a pulse');
  await page.screenshot({ path: `${output}/reduced-motion.png` });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.screenshot({ path: `${output}/half-size.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtures: 14, receiptTargets: targets, reducedMotion: true, outlet, errors }));
} finally {
  await browser.close();
}

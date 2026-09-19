import assert from 'node:assert/strict';
import { chromium } from './node_modules/playwright/index.mjs';

const root = process.cwd();
const context = await chromium.launchPersistentContext(`${root}/.claude/preview-tools/profile`, {
  headless: true, viewport: { width: 1920, height: 1080 },
});
try {
  const page = context.pages()[0];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const scene = await (await fetch('http://127.0.0.1:4402/scene?case=screens')).json();
  const monitor = scene.entities.find(e => e.id === 'telemetry-monitor');
  assert.notEqual(monitor.props.layer, 'fore');
  let socket;
  let revision = 0;
  const send = current => socket.send(JSON.stringify({ t: 'state', rev: ++revision, serverTime: 0, scene: current }));
  await page.routeWebSocket('**/ws*', ws => { socket = ws; send(scene); });
  await page.goto('http://127.0.0.1:4402/?case=screens');
  await page.waitForFunction(() => document.querySelector('canvas')?.getContext('2d').getImageData(500, 500, 1, 1).data[0] > 20);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${root}/.claude/preview-tools/plant-flat-room.png` });
  const pixels = () => page.evaluate(() => Array.from(document.querySelector('canvas').getContext('2d').getImageData(1700, 800, 196, 260).data));
  const baseline = await pixels();
  const leaves = [];
  for (let i = 0; i < baseline.length; i += 4) {
    if ((baseline[i] === 73 && baseline[i+1] === 116 && baseline[i+2] === 90) ||
        (baseline[i] === 130 && baseline[i+1] === 160 && baseline[i+2] === 113)) leaves.push(i);
  }
  assert.ok(leaves.length > 100, 'foreground leaves should be visible');
  const door = scene.entities.find(e => e.kind === 'door');
  const doorX = door.x + door.w / 2;
  const walking = structuredClone(scene);
  Object.assign(walking.protagonist, {
    x: scene.protagonist.x, state: 'walking', pose: 'stand',
    walk: { fromX: scene.protagonist.x, toX: doorX, startedAt: 0, durationMs: 1200 },
  });
  send(walking);
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${root}/.claude/preview-tools/plant-flat-walking.png` });
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${root}/.claude/preview-tools/plant-flat-door.png` });
  const atDoor = await pixels();
  for (const i of leaves) assert.deepEqual(atDoor.slice(i, i+4), baseline.slice(i, i+4), 'Ray must not paint over plant leaves');
  const withoutPlant = structuredClone(walking);
  withoutPlant.entities = withoutPlant.entities.filter(e => e.kind !== 'apartmentForeground');
  withoutPlant.protagonist.x = doorX;
  delete withoutPlant.protagonist.walk;
  send(withoutPlant);
  await page.waitForTimeout(100);
  const bareDoor = await pixels();
  const rayColors = new Set(['77,60,87', '113,80,106', '48,61,88', '70,86,113']);
  const rayBehindLeaf = leaves.filter(i => rayColors.has(bareDoor.slice(i, i+3).join(',')));
  assert.ok(rayBehindLeaf.length > 0, 'walking Ray must physically overlap the plant silhouette');
  // Plant leaves must cover the CRT's right edge, including its screen pass.
  const crt = () => page.evaluate(() => Array.from(document.querySelector('canvas').getContext('2d').getImageData(1700, 820, 44, 68).data));
  const bareCrt = await crt();
  const restored = structuredClone(withoutPlant);
  restored.entities = scene.entities;
  send(restored);
  await page.waitForTimeout(100);
  const coveredCrt = await crt();
  let leafPixelsOverMonitor = 0;
  for (let i = 0; i < coveredCrt.length; i += 4) {
    const isLeaf = (coveredCrt[i] === 73 && coveredCrt[i+1] === 116 && coveredCrt[i+2] === 90) ||
      (coveredCrt[i] === 130 && coveredCrt[i+1] === 160 && coveredCrt[i+2] === 113);
    if (isLeaf && coveredCrt.slice(i, i+3).some((v, c) => v !== bareCrt[i+c])) leafPixelsOverMonitor++;
  }
  assert.ok(leafPixelsOverMonitor > 0, 'plant leaf must render in front of the monitor right edge');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ leafPixelsChecked: leaves.length, rayPixelsBehindLeaves: rayBehindLeaf.length, leafPixelsOverMonitor, plantInFront: true, errors }));
} finally {
  await context.close();
}

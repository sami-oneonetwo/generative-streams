// Drive an already-running safehouse server. Fixture mode only; never spends on AI.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('../.claude/preview-tools/node_modules/playwright')); }
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const headers = { 'Content-Type': 'application/json', ...(process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) };
const output = path.resolve('.claude/preview-tools/safehouse-smoke');
fs.mkdirSync(output, { recursive: true });
let latest;
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
ws.on('message', data => { const msg = JSON.parse(String(data)); if (msg.t === 'state') latest = msg.scene.safehouse; });
async function until(predicate, description, timeout = 90_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out: ' + description);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function api(endpoint, body) {
  const r = await fetch(base + '/admin/api' + endpoint, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  assert.ok(r.ok, `${endpoint}: ${r.status} ${await r.clone().text()}`);
  return r.json();
}
let browser;
try {
  await until(() => latest, 'initial socket scene', 15000);
  assert.equal(latest.fixture, true, 'Only run this smoke against explicit fixture mode');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) external.push(r.url()); });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  const admin = await browser.newPage();
  await admin.goto(base + '/admin');
  if (process.env.ADMIN_TOKEN) { await admin.locator('#operator-token').fill(process.env.ADMIN_TOKEN); await admin.locator('#operator-connect').click(); }
  await admin.locator('#inj-user').fill('smoke-builder');
  await admin.locator('#inj-text').fill('Build a small duck-shaped watchtower in the rear yard');
  const before = latest.objects.length;
  await admin.locator('#inj-send').click();
  await until(() => latest.current?.status === 'building' || latest.objects.length > before, 'build progression');
  await page.screenshot({ path: path.join(output, 'building.png') });
  await until(() => latest.objects.length > before, 'completed creation');
  assert.ok(latest.objects.at(-1).blueprint.partCount > 0);
  const built = latest.objects.at(-1);
  await page.screenshot({ path: path.join(output, 'complete.png') });
  await api('/chat', { username: 'smoke-editor', text: `Make ${built.blueprint.name} pink` });
  await until(() => latest.objects.find(o => o.id === built.id)?.revision > built.revision, 'shared edit');
  const edited = latest.objects.find(o => o.id === built.id);
  assert.equal(edited.createdBy, built.createdBy);
  assert.notEqual(edited.editedBy, built.editedBy);
  const status = await api('/status');
  const night = status.adminActions.find(a => /night|dark/i.test(a.label));
  if (night) { await api('/action', { id: night.id }); await until(() => latest.lighting === 'night', 'night lighting'); await page.screenshot({ path: path.join(output, 'night.png') }); }
  const undo = status.adminActions.find(a => /undo/i.test(a.label));
  assert.ok(undo, 'operator undo action');
  await api('/action', { id: undo.id });
  await until(() => latest.objects.find(o => o.id === built.id)?.blueprint.color === built.blueprint.color, 'undo restores design');
  await api('/save', {});
  const second = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await second.goto(base);
  await second.locator('canvas').waitFor();
  await second.screenshot({ path: path.join(output, 'mobile.png') });
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no mobile horizontal overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'no runtime CDN/assets needed');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ objectId: built.id, objectName: built.blueprint.name, count: latest.objects.length, errors, external }, null, 2));
  console.log(JSON.stringify({ ok: true, screenshots: output, object: built.blueprint.name }));
} finally { ws.close(); await browser?.close(); }

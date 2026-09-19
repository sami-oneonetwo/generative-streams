// Explicit live smoke: exactly one submitted chat request per invocation.
// Requires SAFEHOUSE_LIVE_APPROVED=1. No automatic retries or test loops.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
if (process.env.SAFEHOUSE_LIVE_APPROVED !== '1') throw new Error('Live smoke incurs API charges. Set SAFEHOUSE_LIVE_APPROVED=1 only after approval.');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4411';
const text = process.argv.slice(2).join(' ') || 'Build a small duck-shaped watchtower in the rear yard, with wooden legs and a yellow duck head';
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
let submitted = false, before = 0, finished = false;
const priorJobs = new Set();
const timeout = setTimeout(() => { console.error('TIMEOUT waiting for live request; inspect app status before sending another.'); ws.terminate(); process.exitCode = 1; }, 180000);
ws.on('error', error => { console.error(error.message); clearTimeout(timeout); process.exitCode = 1; });
ws.on('message', async data => {
  try {
    const msg = JSON.parse(String(data));
    if (msg.t !== 'state' || !msg.scene.safehouse || finished) return;
    const state = msg.scene.safehouse;
    assert.equal(state.fixture, false, 'Live smoke must not target fixtures');
    if (!submitted) {
      submitted = true;
      before = state.worldRevision;
      state.recent.forEach(j => priorJobs.add(j.id));
      const response = await fetch(base + '/admin/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) }, body: JSON.stringify({ username: 'live-smoke', text }) });
      assert.ok(response.ok, `Request rejected: ${response.status}`);
      console.log('SUBMITTED one real request:', text);
      return;
    }
    if (state.current) console.log(state.current.status, state.current.label, state.current.progress.toFixed(2));
    const failure = state.recent.find(j => j.requestedBy === 'live-smoke' && j.status === 'failed' && !priorJobs.has(j.id));
    if (failure) throw new Error('Generation/build failed: ' + failure.error);
    if (state.worldRevision > before && !state.current) {
      finished = true; clearTimeout(timeout);
      console.log(JSON.stringify({ ok: true, worldRevision: state.worldRevision, objects: state.objects.map(o => ({ id: o.id, name: o.blueprint.name, parts: o.blueprint.partCount, revision: o.revision })) }, null, 2));
      ws.close();
    }
  } catch (error) { finished = true; clearTimeout(timeout); console.error(error.message); ws.close(); process.exitCode = 1; }
});

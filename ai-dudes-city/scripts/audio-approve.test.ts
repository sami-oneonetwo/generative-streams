// Sami's Approve on /sounds (FK-160): the admin action that writes client/dudes/audio-approved.json
// (src/worlds/ai-dudes/audioApproval.ts), the operator guard in front of it, the layout of the file, the
// page's side (client/sounds/approve.ts: the approvals it reads, the Approve it sends, the renders it
// keeps for A/B) and the renders themselves, which play each sound from its fingerprint's seed.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { CUES, type AudioHandles, type AudioLevels } from '../client/dudes/audio';
import { ACTION, ACTION_URL, APPROVED_URL, loadApproved, pack, sendApproval, trim, unpack } from '../client/sounds/approve';
import { VOICES } from '../client/sounds/board';
import { FakeContext, FakeNode, FakeOfflineContext, FakeParam, type Ev } from '../client/sounds/fake';
import { ITEMS, RATE, RENDER_LINE, SETTLE, printPlay, renderOn, renderPlan } from '../client/sounds/prints';
import { makeAdminRouter } from '../src/server/admin';
import { operatorGuard } from '../src/server/operatorGuard';
import { VOICE, dayOf, formatApproved, type Approved, type Item } from '../src/shared/audioApproved';
import { applyAide } from '../src/worlds/ai-dudes/aide';
import { APPROVED_FILE, SERVED_FILE, approve, audioApproveAction, parseApproval } from '../src/worlds/ai-dudes/audioApproval';
import { harness } from './harness';

const ROOT = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const H = (c: string) => c.repeat(64);
const value = (o: unknown) => JSON.stringify(o);

/** A scratch copy of the approvals as committed, and a public/sounds/ beside it for the page's copy. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk160-'));
  const file = path.join(dir, 'audio-approved.json');
  fs.copyFileSync(APPROVED_FILE, file);
  fs.mkdirSync(path.join(dir, 'public', 'sounds'), { recursive: true });
  return { dir, file, served: path.join(dir, 'public', 'sounds', 'approved.json') };
}
const ctxLog = () => {
  const lines: string[] = [];
  return { lines, ctx: { log: (l: string) => void lines.push(l) } as never };
};

// --- the action ---

test('an approval is {"kind", "name", "hash"} as /sounds sends it; anything else is refused', () => {
  assert.deepEqual(parseApproval(value({ kind: 'cue', name: 'play:strum', hash: H('a') })), { kind: 'cue', name: 'play:strum', hash: H('a') });
  assert.deepEqual(parseApproval(value({ kind: 'voice', name: VOICE, hash: H('b') })), { kind: 'voice', name: 'speech', hash: H('b') });
  assert.deepEqual(parseApproval(value({ kind: 'mix', name: 'scene', hash: H('c') })), { kind: 'mix', name: 'scene', hash: H('c') });
  const refused: [unknown, RegExp][] = [
    ['not json', /JSON/],
    ['[1]', /object/],
    ['null', /object/],
    [value({ kind: 'song', name: 'x', hash: H('a') }), /kind is one of voice, cue, mix/],
    [value({ kind: 'cue', name: 'x'.repeat(41), hash: H('a') }), /40 characters/],
    [value({ kind: 'cue', name: '', hash: H('a') }), /name/],
    [value({ kind: 'cue', name: '__proto__', hash: H('a') }), /name/],
    [value({ kind: 'cue', name: 'door bell', hash: H('a') }), /name/],
    [value({ kind: 'cue', name: 42, hash: H('a') }), /name/],
    [value({ kind: 'voice', name: 'wren', hash: H('a') }), /as one, under the name "speech"/],
    [value({ kind: 'cue', name: 'doorbell', hash: H('A') }), /lower-case hex/],
    [value({ kind: 'cue', name: 'doorbell', hash: 'abc' }), /hash/],
    [value({ kind: 'cue', name: 'doorbell' }), /hash/],
  ];
  for (const [v, why] of refused) assert.match(String(parseApproval(v)), why, String(v));
  assert.equal(parseApproval(value({ kind: 'cue', name: 'x'.repeat(40), hash: H('a') })).constructor, Object, '40 characters is fine');
});

test("Approve writes Sami's approval, dated, a line each and the names in order, and keeps the rest of the file as it was", () => {
  const { file, served } = scratch();
  const was = fs.readFileSync(file, 'utf8');
  const day = new Date(2026, 9, 25, 23, 30).getTime(); // late in the evening where the server is
  assert.deepEqual(approve({ kind: 'cue', name: 'play:strum', hash: H('1') }, day, file, served), { changed: true });
  assert.deepEqual(approve({ kind: 'cue', name: 'doorbell', hash: H('2') }, day, file, served), { changed: true });
  const text = fs.readFileSync(file, 'utf8');
  const voiceLine = was.split('\n')[1];
  assert.equal(
    text,
    `{\n${voiceLine}\n  "cues": {\n` +
      `    "doorbell": { "hash": "${H('2')}", "by": "Sami", "date": "2026-10-25" },\n` +
      `    "play:strum": { "hash": "${H('1')}", "by": "Sami", "date": "2026-10-25" }\n` +
      '  }\n}\n',
    'the voice untouched, the cues a line each, in order',
  );
  assert.equal(fs.readFileSync(served, 'utf8'), text, 'the copy /sounds reads is refreshed with it');
  // Approving the sound already approved writes nothing.
  assert.deepEqual(approve({ kind: 'cue', name: 'doorbell', hash: H('2') }, day + 86_400_000, file, served), { changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  // A changed cue approved again: its new hash and day.
  approve({ kind: 'cue', name: 'doorbell', hash: H('3') }, day + 86_400_000, file, served);
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`"doorbell": \\{ "hash": "${H('3')}", "by": "Sami", "date": "2026-10-26" \\}`));
  // The voices: a new hash replaces the entry, and the old note goes with the old hash.
  approve({ kind: 'voice', name: VOICE, hash: H('4') }, day, file, served);
  const voice = (JSON.parse(fs.readFileSync(file, 'utf8')) as Approved).voice;
  assert.deepEqual(voice, { hash: H('4'), by: 'Sami', date: '2026-10-25' });
  // A mix state (FK-163) starts its own map; anything a later card keeps in the file stays as it is.
  const withCast = { ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Approved), castVoices: { wren: { seed: 4, low: false } } };
  fs.writeFileSync(file, formatApproved(withCast));
  approve({ kind: 'mix', name: 'scene', hash: H('5') }, day, file, served);
  const after = JSON.parse(fs.readFileSync(file, 'utf8')) as Approved;
  assert.deepEqual(Object.keys(after), ['voice', 'cues', 'mix', 'castVoices']);
  assert.deepEqual(after.mix, { scene: { hash: H('5'), by: 'Sami', date: '2026-10-25' } });
  assert.deepEqual(after.castVoices, { wren: { seed: 4, low: false } });
  // No public/sounds/ (the board not built): the approval stands, and no copy is made.
  const bare = scratch();
  fs.rmSync(path.dirname(bare.served), { recursive: true });
  assert.deepEqual(approve({ kind: 'cue', name: 'bray', hash: H('6') }, day, bare.file, bare.served), { changed: true });
  assert.ok(!fs.existsSync(bare.served));
});

test('the file as committed reads back byte for byte: the first Approve is a one-line diff', () => {
  const committed = fs.readFileSync(APPROVED_FILE, 'utf8');
  assert.equal(formatApproved(JSON.parse(committed) as Approved), committed);
  assert.equal(dayOf(new Date(2026, 0, 2, 0, 5).getTime()), '2026-01-02', "the server's own day");
});

test("Approve refuses, and writes nothing, when the file doesn't read or would pass 64 KB", () => {
  const { file, served } = scratch();
  fs.writeFileSync(file, '{ "voice": ');
  assert.match(approve({ kind: 'cue', name: 'doorbell', hash: H('1') }, Date.now(), file, served).refused!, /doesn't read/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "voice": ');
  assert.ok(!fs.existsSync(served));
  // As many approvals as fit in 64 KB: one more doesn't.
  const cues: NonNullable<Approved['cues']> = {};
  const entry = { hash: H('f'), by: 'Sami', date: '2026-10-24' };
  for (let i = 1000; Buffer.byteLength(formatApproved({ cues: { ...cues, [`cue${i}`]: entry } })) <= 64 * 1024; i++) cues[`cue${i}`] = entry;
  fs.writeFileSync(file, formatApproved({ cues }));
  const big = fs.readFileSync(file, 'utf8');
  assert.ok(Buffer.byteLength(big) <= 64 * 1024 && Object.keys(cues).length > 400, `${Object.keys(cues).length} approvals, ${Buffer.byteLength(big)} bytes`);
  assert.match(approve({ kind: 'cue', name: 'one-more', hash: H('1') }, Date.now(), file, served).refused!, /would pass 64 KB/);
  assert.equal(fs.readFileSync(file, 'utf8'), big);
});

test('the action logs what Sami approved and hands a refusal back to the page', () => {
  const { file, served } = scratch();
  const action = audioApproveAction(file, served);
  assert.equal(action.id, 'audio-approve');
  assert.equal(action.id, ACTION, 'the id the page sends');
  assert.deepEqual(action.input, { kind: 'text', label: 'approval from /sounds', maxLength: 200 });
  const { lines, ctx } = ctxLog();
  assert.equal(action.run(ctx, value({ kind: 'cue', name: 'fanfare', hash: H('9') })), undefined);
  assert.match(lines.at(-1)!, /Sami approved the cue fanfare \(999999999999…\): client\/dudes\/audio-approved\.json is ready to commit/);
  assert.equal((JSON.parse(fs.readFileSync(file, 'utf8')) as Approved).cues!.fanfare.date, dayOf(Date.now()));
  assert.equal(action.run(ctx, value({ kind: 'cue', name: 'fanfare', hash: H('9') })), undefined);
  assert.match(lines.at(-1)!, /already approved/);
  assert.match(String(action.run(ctx, value({ kind: 'cue', name: 'fanfare', hash: 'nope' }))), /hash/);
  assert.match(lines.at(-1)!, /audio-approve refused/);
  // The longest approval the page can send fits the action's 200 characters.
  const longest = Math.max(...ITEMS.map((i) => value({ kind: i.kind, name: i.name, hash: H('0') }).length));
  assert.ok(longest <= 200, `${longest} characters`);
  // The files it writes: the approvals in this checkout, and the copy express.static serves at /sounds/approved.json.
  assert.equal(APPROVED_FILE, path.join(ROOT, 'client', 'dudes', 'audio-approved.json'));
  assert.equal(SERVED_FILE, path.resolve('public', 'sounds', 'approved.json'));
});

test("the world has the action (the hook in index.ts), and the Mayor's aide can't reach it", () => {
  const { world, ctx } = harness();
  const action = world.adminActions!.find((a) => a.id === 'audio-approve');
  assert.ok(action, "index.ts's admin actions include audio-approve");
  assert.match(read('src/worlds/ai-dudes/index.ts'), /audioApproveAction<DudesState>\(\), \/\/ hook FK-160/);
  let ran = false;
  const spy = { ...action, run: () => void (ran = true) };
  const problems = applyAide(ctx, [{ do: 'admin', id: 'audio-approve', value: 'x' }], [spy]);
  assert.deepEqual(problems, ['no town control "audio-approve"']);
  assert.equal(ran, false);
});

// --- through the operator guard ---

/** The admin API as src/server/http.ts mounts it, with this action alone, on a port of its own. */
async function adminApi(token: string | undefined, file: string, served: string) {
  const engine = { world: { adminActions: [audioApproveAction(file, served)] }, ctx: { log: () => {} }, markDirty: () => {}, log: { push: () => {} } };
  const app = express();
  app.use('/admin/api', operatorGuard(token), express.json({ limit: '16kb' }), makeAdminRouter({ engine } as never));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
/** A POST to the admin API, as a browser (or the tunnel) would send it. */
function post(server: http.Server, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
  const { port } = server.address() as AddressInfo;
  const data = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, path: ACTION_URL, method: 'POST', headers: { host: `localhost:${port}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => ok({ status: res.statusCode!, text }));
    });
    req.on('error', fail);
    req.end(data);
  });
}

test('Approve goes through /admin/api and its operator guard: refused without the operator token, or from an untrusted address', async () => {
  assert.match(read('src/server/http.ts'), /app\.use\('\/admin\/api', operatorGuard\(config\.ADMIN_TOKEN\), express\.json\(\{ limit: '16kb' \}\), makeAdminRouter\(adminDeps\)\);/, 'mounted so in the server');
  const body = (hash: string) => ({ id: ACTION, value: value({ kind: 'cue', name: 'doorbell', hash }) });
  const { file, served } = scratch();
  const committed = fs.readFileSync(file, 'utf8');
  const unchanged = (what: string) => assert.equal(fs.readFileSync(file, 'utf8'), committed, `${what}: nothing written`);

  // No ADMIN_TOKEN (4600 today): this machine and the trusted addresses only.
  const open = await adminApi(undefined, file, served);
  try {
    for (const [what, headers] of [
      ['through the tunnel (forwarded)', { 'x-forwarded-for': '203.0.113.7' }],
      ['under another name (a rebinding site)', { host: 'town.example.com' }],
      ['from another site', { origin: 'http://evil.example' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ] as const) {
      const r = await post(open, headers, body(H('1')));
      assert.equal(r.status, 403, `${what}: ${r.text}`);
      unchanged(what);
    }
    const ok = await post(open, {}, body(H('1')));
    assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { ok: true }], 'from this machine');
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`"doorbell": \\{ "hash": "${H('1')}"`));
    const bad = await post(open, {}, { id: ACTION, value: value({ kind: 'cue', name: 'doorbell', hash: 'short' }) });
    assert.equal(bad.status, 409, 'a bad approval is refused with its reason');
    assert.match(JSON.parse(bad.text).error, /hash/);
  } finally {
    open.close();
  }

  // With ADMIN_TOKEN set: the token, even from this machine.
  fs.writeFileSync(file, committed);
  const token = 'fk160-operator-token-xyz';
  const shut = await adminApi(token, file, served);
  try {
    for (const [what, headers] of [
      ['no token', {}],
      ['the wrong token', { authorization: 'Bearer fk160-operator-token-xyw' }],
    ] as const) {
      const r = await post(shut, headers, body(H('2')));
      assert.equal(r.status, 401, `${what}: ${r.text}`);
      unchanged(what);
    }
    const ok = await post(shut, { authorization: `Bearer ${token}` }, body(H('2')));
    assert.equal(ok.status, 200, 'with the token');
  } finally {
    shut.close();
  }
});

// --- the page's side ---

test('the page reads the copy the build makes, and sends Approve as /admin sends its token', async () => {
  // The build copies the approvals next to the page (a hook in scripts/build-client.mjs).
  assert.ok(read('scripts/build-client.mjs').split('\n').some((l) => l.startsWith("PAGES['client/dudes/audio-approved.json'] = 'public/sounds/approved.json'; // hook FK-160")));
  assert.equal(APPROVED_URL, '/sounds/approved.json');
  const calls: { url: string; init?: RequestInit }[] = [];
  let reply = new Response('{}');
  const keep = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => (calls.push({ url, init }), reply)) as typeof fetch;
  try {
    reply = new Response(fs.readFileSync(APPROVED_FILE));
    assert.deepEqual(await loadApproved(), JSON.parse(fs.readFileSync(APPROVED_FILE, 'utf8')));
    assert.deepEqual(calls[0], { url: '/sounds/approved.json', init: { cache: 'no-store' } }, 'never a cached copy');
    reply = new Response('{"ok":true}');
    await sendApproval({ kind: 'cue', name: 'doorbell' }, H('1'));
    await sendApproval({ kind: 'voice', name: VOICE }, H('2'), 'sekrit');
    const [plain, tokened] = calls.slice(1);
    assert.equal(plain.url, '/admin/api/action');
    assert.equal(plain.init!.method, 'POST');
    assert.deepEqual(plain.init!.headers, { 'Content-Type': 'application/json' }, 'no token typed, none sent');
    assert.deepEqual(JSON.parse(String(plain.init!.body)), { id: 'audio-approve', value: value({ kind: 'cue', name: 'doorbell', hash: H('1') }) });
    assert.deepEqual(tokened.init!.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer sekrit' }, 'as client/admin/main.ts sends it');
    // A refusal comes back with the server's reason and its status (401 and 403 open the token field).
    reply = new Response('{"error":"Enter the operator token to use admin controls"}', { status: 401 });
    await assert.rejects(sendApproval({ kind: 'cue', name: 'doorbell' }, H('1')), (e: Error & { status?: number }) => e.status === 401 && /operator token/.test(e.message));
  } finally {
    globalThis.fetch = keep;
  }
  // The admin page still sends its token this way (client/admin/main.ts:14-19).
  assert.match(read('client/admin/main.ts'), /Authorization: `Bearer \$\{\(\$\('operator-token'\) as HTMLInputElement\)\.value\}`/);
});

// --- renders, for A/B ---

/** Events as rows two contexts can share: a node by its place among the town's (made the same way in both) or among the call's own. */
function plain(ctx: FakeContext, evs: Ev[], t0: number) {
  const own = new Map<FakeNode, string>();
  const id = (n: FakeNode) => own.get(n) ?? `town${ctx.nodes.indexOf(n)}`;
  return evs.map((e) => {
    if (e.op === 'create') own.set(e.node, `#${own.size}`);
    const v = e.v instanceof FakeNode ? id(e.v) : e.v instanceof FakeParam ? `${id(e.v.node)}.${e.v.name}` : typeof e.v === 'number' ? Number(e.v.toPrecision(9)) : e.v;
    return [id(e.node), e.op, v, e.t === undefined ? undefined : Math.round((e.t - t0) * 1e6) / 1e6, e.tc];
  });
}
/** Two event lists row for row; a failure shows the first row that differs, not thousands. */
function same(a: unknown[][], b: unknown[][], what: string) {
  let i = 0;
  while (i < a.length && i < b.length && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
  assert.deepEqual({ rows: a.length, [`row ${i}`]: a[i] }, { rows: b.length, [`row ${i}`]: b[i] }, what);
}
/** `item`'s render on the fake: the plan, and what each of its steps asked for, from the moment it played. */
async function rendered(item: Item) {
  const ctx = new FakeOfflineContext();
  const plan = renderPlan(item);
  const parts: { at: number; evs: Ev[] }[] = [];
  const steps = plan.steps.map((s) => ({
    at: s.at,
    run: (a: AudioHandles) => {
      const from = ctx.log.length;
      s.run(a);
      parts.push({ at: ctx.currentTime, evs: ctx.log.slice(from) });
    },
  }));
  const out = await renderOn(ctx as unknown as OfflineAudioContext, { ...plan, steps });
  return { ctx, plan, parts, out };
}

test("a cue's render is the sound its fingerprint describes: the same events, from the same seed, once the buses have settled", async () => {
  for (const cue of CUES.filter((c) => c.name !== 'music' && c.name !== 'birds')) {
    const { ctx, plan, parts } = await rendered({ kind: 'cue', name: cue.name });
    assert.equal(parts[0].at, SETTLE, `${cue.name}: it plays ${SETTLE} s in`);
    const print = printPlay(cue, cue.placed ? 'near' : undefined);
    same(plain(ctx, parts[0].evs, SETTLE), plain(print.s.ctx, print.evs, print.t0), `${cue.name}: event for event`);
    // Only its own bus comes up (the board plays it so): the others stay at 0.
    const levels: AudioLevels = { music: 0, sfx: 0.8, ambience: 0, [cue.bus]: { music: 0.5, sfx: 0.8, ambience: 0.6 }[cue.bus as 'sfx'] };
    assert.deepEqual(plan.levels, levels, `${cue.name}: on the ${cue.bus} bus`);
    assert.equal(plan.from, SETTLE - 0.05, 'the render kept from just before it');
  }
  // A bed holds 4 s, then goes; the tune and the birds play as their tiles do, for a while.
  const bed = await rendered({ kind: 'cue', name: 'beds:fountain' });
  assert.deepEqual(bed.parts.map((p) => p.at), [SETTLE, SETTLE + 4]);
  assert.ok(bed.parts[1].evs.some((e) => e.op === 'gain.setTargetAtTime' && e.v === 0), 'beds(0, 0): the fountain off');
  assert.deepEqual([renderPlan({ kind: 'cue', name: 'music' }).seconds, renderPlan({ kind: 'cue', name: 'birds' }).seconds], [SETTLE + 24, SETTLE + 20]);
  const tune = await rendered({ kind: 'cue', name: 'music' });
  const tunePrint = printPlay(CUES.find((c) => c.name === 'music')!);
  same(plain(tune.ctx, tune.parts[0].evs, SETTLE), plain(tunePrint.s.ctx, tunePrint.evs, tunePrint.t0), 'the tune: its fingerprinted bars, of which the render hears the first 24 s');
  assert.equal(RATE, 48_000, "the fake's rate, so the reverb and the noise are the fingerprint's");
});

test('the voices render as all ten saying the board line, 1.2 s apart, on the voice bus alone', async () => {
  const { ctx, plan, parts } = await rendered({ kind: 'voice', name: VOICE });
  assert.deepEqual(
    parts.map((p) => Math.round(p.at * 10) / 10),
    VOICES.map((_, i) => Math.round((SETTLE + i * 1.2) * 10) / 10),
  );
  assert.deepEqual(plan.levels, { music: 0, sfx: 0.8, ambience: 0 });
  for (const [i, p] of parts.entries()) {
    const tri = p.evs.filter((e) => e.op === 'type' && e.v === 'triangle').length;
    assert.equal(tri, 5, `voice ${VOICES[i].label}: "${RENDER_LINE}" is five syllables`);
  }
  // The low voice's notes sit under the others'.
  const first = (p: (typeof parts)[number]) => p.evs.find((e) => e.op === 'frequency.setValueAtTime')!.v as number;
  assert.ok(first(parts[9]) < Math.min(...parts.slice(0, 9).map(first)), "the Mayor's low voice");
  // Every syllable on the voices' own bus: the gain the voices' oscillators feed, which feeds the master.
  const into = new Set(parts.flatMap((p) => p.evs.filter((e) => e.op === 'connect' && e.v instanceof FakeNode && e.v.kind === 'gain' && !p.evs.some((c) => c.op === 'create' && c.node === e.v)).map((e) => e.v as FakeNode)));
  assert.equal(into.size, 1, 'one bus');
  assert.equal(ctx.nodes.indexOf([...into][0]) < ctx.nodes.indexOf(ctx.nodes.find((n) => n.kind === 'convolver')!), true, "one of the town's buses, made before the reverb");
});

test('a render kept for A/B: from just before the sound to its last audible sample, as 16-bit', () => {
  const rate = 1000;
  const ch = (f: (i: number) => number) => Float32Array.from({ length: 3000 }, (_, i) => f(i));
  const pcm = [ch((i) => (i >= 2000 && i < 2100 ? 0.5 : i === 2400 ? 2e-5 : 0)), ch((i) => (i === 2300 ? -0.25 : 0))];
  const kept = trim(pcm, 1.95, rate);
  assert.deepEqual(
    kept.map((d) => d.length),
    [400, 400],
    'from 1.95 s to the last sample over −90 dBFS (2.3 s), and 50 ms on: the 2e-5 at 2.4 s is under it',
  );
  assert.equal(kept[0][50], 0.5);
  assert.equal(kept[1][350], -0.25);
  const back = unpack(pack([Float32Array.of(0, 0.5, -0.5, 1, -1, 1.7, -3)]))[0];
  assert.deepEqual(
    [...back].map((x) => Math.round(x * 1e4) / 1e4),
    [0, 0.5, -0.5, 1, -1, 1, -1],
    'within 1/32767, and clamped',
  );
  assert.ok(pack([Float32Array.of(0.5)])[0] instanceof Int16Array);
});

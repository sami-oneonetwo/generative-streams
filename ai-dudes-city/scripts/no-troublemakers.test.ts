// The troublemakers are gone (painters, thieves, tow trucks, the decree). A copy of the live save from
// just before still boots: their saved fields (npcs, happening, nextHappeningAt, hatPiles, ai.events)
// drop on load, a build they repainted goes back as it was, and nothing of them reaches the page,
// the agents or /admin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadState, saveState, statePath } from '../src/engine/persistence';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { harness } from './harness';

const LIVE = path.join(import.meta.dirname, 'fixtures', 'world-ai-dudes.live-2026-10-24-troublemakers.json');

test('the live save from before the troublemakers went boots, ticks, draws and saves clean', async () => {
  const raw = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  // The worst case on top of the real save: one mid-round, his banner up, a hat pile, the switch on,
  // and someone on the way to punch him.
  raw.ai.events = true;
  raw.npcs = [{ id: 'n999', kind: 'painter', name: 'Ochre Ug', look: raw.dudes[0].look, position: { x: 0, z: 0 }, facing: 0, path: [], speed: 4.2, plan: [{ do: 'say', text: 'Fresh coat.' }] }];
  raw.happening = { kind: 'painter', npcId: 'n999', title: 'OCHRE UG', text: 'is repainting builds.', startedAt: 0 };
  raw.hatPiles = { b999: { [raw.dudes[0].id]: { hat: 'cap', color: '#ffffff' } } };
  raw.dudes[1].attack = { with: 'punch', kind: 'npc', targetId: 'n999', phase: 'going', giveUpAt: Number.MAX_SAFE_INTEGER };
  const painted = Object.entries(raw.vandalised ?? {}).find(([, v]) => (v as { kind: string }).kind === 'painted');
  assert.ok(painted, 'the live save has a build Ochre Ug repainted');
  const [paintedId, { original }] = painted as [string, { original: unknown }];

  const { world, ctx, h, tick } = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-notrouble-'));
  fs.writeFileSync(statePath(dir, world.meta.id), JSON.stringify(raw));
  h.state = loadState(world, dir, () => {});
  for (const key of ['npcs', 'happening', 'nextHappeningAt', 'hatPiles']) assert.ok(!(key in h.state), `${key} dropped on load`);
  assert.ok(!('events' in h.state.ai), 'the switch dropped');
  world.start!(ctx);
  // Whatever they repainted is put back.
  assert.deepEqual(h.state.objects.find((o) => o.id === paintedId)!.blueprint, original);
  assert.equal(h.state.vandalised?.[paintedId], undefined);
  await tick(5000);
  assert.equal(h.state.dudes[1].attack, undefined, 'an attack on a troublemaker just gives up');
  const scene = world.buildScene(h.state, { now: h.now } as never) as { happening?: { kind: string }; ai: Record<string, unknown> };
  assert.ok(!scene.happening || ['party', 'project'].includes(scene.happening.kind), 'no troublemaker banner');
  assert.ok(!('events' in scene.ai));
  const admin = world.adminStatus?.(h.state, h.now) as unknown as Record<string, unknown>;
  assert.ok(!('happening' in admin) && !('nextHappeningInS' in admin));
  const ids = (world.adminActions ?? []).map((a) => a.id);
  for (const gone of ['event-now', 'events-on', 'events-off']) assert.ok(!ids.includes(gone), `no ${gone} action`);
  saveState(world, dir, h.state);
  const saved = JSON.parse(fs.readFileSync(statePath(dir, world.meta.id), 'utf8'));
  assert.ok(stateSchema.safeParse(saved).success, 'what it saves loads again');
  for (const key of ['npcs', 'happening', 'nextHappeningAt', 'hatPiles']) assert.ok(!(key in saved), `${key} not saved`);
  fs.rmSync(dir, { recursive: true, force: true });
});

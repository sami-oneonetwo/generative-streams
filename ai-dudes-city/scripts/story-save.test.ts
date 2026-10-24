// Finders Keepers' save contracts (FK-001): the Story switch defaults OFF and Story OFF draws today's
// town; both live saves still load; every new field survives a save and a boot; lists over their caps
// are trimmed before saving, so the next boot never refuses; a show cut off mid-scene boots released;
// and no saved enum gains or loses a value (a save with a new value would not boot on older code).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Engine } from '../src/engine/engine';
import { loadState, saveState, statePath } from '../src/engine/persistence';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { STORY_CAPS, dropBadStory, freshState, stateSchema, storyOn, trimStory, type DudesState } from '../src/worlds/ai-dudes/state';
import type { DudesScene } from '../src/shared/dudesTypes';
import { SCENES, SCENE_IDS } from '../src/shared/scenes';
import { STORY_SCENES } from '../src/shared/storyScenes';
import { STORY_RECTS, STORY_SITES } from '../src/shared/storyMap';
import { CITY_BOUNDS, allPlots } from '../src/shared/city';
import { harness } from './harness';

const FIXTURES = ['2026-10-23', '2026-10-24'].map((day) => path.join(import.meta.dirname, 'fixtures', `world-ai-dudes.live-${day}.json`));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-story-'));
const STORY_KEYS = ['story', 'board', 'show', 'spotlight', 'cast', 'folly'] as const;

/** A harness running on a copy of a save on disk, loaded the way the server loads it, and started. */
function booted(file: string) {
  const hs = harness();
  const dir = tmpDir();
  fs.copyFileSync(file, statePath(dir, hs.world.meta.id));
  hs.h.state = loadState(hs.world, dir, () => {});
  hs.world.start!(hs.ctx);
  return { ...hs, dir, view: () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene };
}

/** Every Finders Keepers field, set. */
function storied(state: DudesState, now: number): void {
  state.ai.story = true;
  cityOf(state).story = {
    scene: { id: 'test', at: now - 2000, shift: 1200, heldAt: 3000, beat: 2, vars: { head: 'The Chief' } },
    bridgeIntact: true,
    folly: { age: 0, pct: 42.5, startedAt: now - 60_000, plaque: ['kev', 'dana'] },
    cue: [{ id: 'unveil', state: 'armed', at: now }],
    sideLog: [
      { at: now - 500, id: 'dev:kev', name: 'kev', side: 'red' },
      { at: now, id: 'dev:dana', name: 'dana', side: 'gold', from: 'red' },
    ],
    verdicts: [{ age: 0, side: 'red' }],
    helped: true,
    choices: { huts: 'tents' },
  };
  const d = state.dudes[0];
  Object.assign(d, { side: 'gold', sideAge: 0, seenAge: 0, gather: { slot: { x: 54, z: 58 }, face: Math.PI, until: now + 30_000 }, queuedLine: { text: 'build me a hut', at: now - 3000 } });
  cityOf(state).townies[0].role = 'wren';
  const o = state.objects[0];
  Object.assign(o, { folly: 'stone', silhouette: true, past: [{ age: 0, name: 'Mud Hut' }] });
  const pet = state.objects.find((x) => x.creature)!;
  pet.creature!.follows = d.id;
  Object.assign(state.mayor!, { lock: { at: { ...STORY_SITES.headMark.at }, facing: STORY_SITES.headMark.facing, since: now }, forcedHidden: true });
}

// ---- the live saves and the switch -------------------------------------------------------------------

test('both live saves parse, have no story in them, and boot with Story OFF', () => {
  for (const file of FIXTURES) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parsed = stateSchema.safeParse(raw);
    assert.ok(parsed.success, parsed.success ? '' : `${path.basename(file)}: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`);
    assert.equal(raw.ai.story, undefined, 'no live save carries the switch yet');
    const { h, view } = booted(file);
    assert.equal(storyOn(h.state), false, `${path.basename(file)} boots with Story OFF`);
    const scene = view();
    for (const k of STORY_KEYS) assert.equal(scene.town?.[k], undefined, `no town.${k} with Story OFF`);
    assert.ok(scene.dudes.every((d) => d.side === undefined), 'no sides');
    assert.equal(scene.mayor?.lock, undefined);
    assert.equal(scene.mayor?.show, undefined);
  }
  assert.equal(freshState(0, 10).ai.story, undefined, 'a fresh town starts with Story OFF too');
});

test('Story OFF ignores the story state: the town, its people and the head draw exactly as without it', () => {
  const plain = booted(FIXTURES[0]);
  const off = booted(FIXTURES[0]);
  storied(off.h.state, off.h.now);
  off.h.state.ai.story = false;
  // (A build's own fields, a Folly's included, travel with the build: what they draw is their cards'.)
  const drawn = (s: ReturnType<typeof plain.view>) => JSON.stringify({ town: s.town, dudes: s.dudes, mayor: s.mayor });
  assert.equal(drawn(off.view()), drawn(plain.view()), 'Story OFF draws today’s town whatever story state the save holds');
});

test('Story ON: town.story is set and the pieces come through the one spread each', () => {
  const { h, view } = booted(FIXTURES[1]);
  h.state.ai.story = true;
  const scene = view();
  assert.equal(scene.town?.story, true);
  assert.ok(scene.town?.board?.ticker.length, 'the Board comes through boardView (FK-011)'); // hook FK-011
  h.state.mayor!.lock = { at: { x: 54, z: 50.5 }, facing: Math.PI, since: h.now };
  assert.deepEqual(view().mayor?.lock, { at: { x: 54, z: 50.5 }, facing: Math.PI }, 'the head’s lock reaches /mayor');
  h.state.ai.story = false;
  assert.equal(view().mayor?.lock, undefined, 'and only while Story is on');
});

// ---- saves -------------------------------------------------------------------------------------------

test('a save with every new field set round-trips through disk and loads', () => {
  const { world, h } = booted(FIXTURES[0]);
  storied(h.state, h.now);
  const before = structuredClone(h.state);
  assert.ok(stateSchema.safeParse(h.state).success, 'the schema takes every field');
  const dir = tmpDir();
  world.beforeSave!(h.state);
  saveState(world, dir, h.state);
  const back = loadState(world, dir, () => {});
  assert.equal(back.ai.story, true);
  assert.deepEqual(back.city!.story, before.city!.story);
  const [d0, b0] = [back.dudes[0], before.dudes[0]];
  assert.deepEqual([d0.side, d0.sideAge, d0.seenAge, d0.gather, d0.queuedLine], [b0.side, b0.sideAge, b0.seenAge, b0.gather, b0.queuedLine]);
  assert.equal(back.city!.townies[0].role, 'wren');
  assert.deepEqual([back.objects[0].folly, back.objects[0].silhouette, back.objects[0].past], ['stone', true, [{ age: 0, name: 'Mud Hut' }]]);
  assert.equal(back.objects.find((x) => x.creature)!.creature!.follows, d0.id);
  assert.deepEqual(back.mayor!.lock, before.mayor!.lock);
  assert.equal(back.mayor!.forcedHidden, true);
  assert.equal(back.version, 1, 'STATE_VERSION stays 1');
});

test('a save with every new list over its max is trimmed before saving, and boots', () => {
  const { world } = harness();
  const dir = tmpDir();
  fs.copyFileSync(FIXTURES[0], statePath(dir, world.meta.id));
  const engine = new Engine(world, { dataDir: dir, confidenceThreshold: 0.6, flags: { kickRepliesEnabled: false, devTimeScale: 1 } });
  try {
    const s = engine.state;
    const now = Date.now();
    storied(s, now);
    const story = cityOf(s).story!;
    const names = (n: number) => Array.from({ length: n }, (_, i) => `name${i}`);
    story.folly!.plaque = ['x'.repeat(60), ...names(STORY_CAPS.plaque + 5)];
    story.sideLog = names(STORY_CAPS.sideLog + 10).map((name, i) => ({ at: now + i, id: `dev:${name}`, name, side: i % 2 ? ('red' as const) : ('gold' as const) }));
    story.cue = names(STORY_CAPS.cue + 5).map((id) => ({ id, state: 'locked' }));
    story.verdicts = Array.from({ length: STORY_CAPS.verdicts + 2 }, (_, i) => ({ age: i % 6, side: 'gold' as const }));
    story.choices = Object.fromEntries(names(STORY_CAPS.choices + 5).map((k) => [k, 'yes']));
    s.objects[0].past = Array.from({ length: STORY_CAPS.past + 3 }, (_, i) => ({ age: i % 6, name: `Home ${i}` }));
    assert.equal(stateSchema.safeParse(structuredClone(s)).success, false, 'untrimmed, this save would refuse to boot');

    engine.save(); // the engine's own save: the world's beforeSave runs first
    const back = loadState(world, dir, () => {});
    const st = back.city!.story!;
    assert.equal(st.folly!.plaque.length, STORY_CAPS.plaque);
    assert.deepEqual(st.folly!.plaque.slice(0, 2), ['x'.repeat(40), 'name0'], 'the plaque keeps its first names, clipped');
    assert.equal(st.sideLog!.length, STORY_CAPS.sideLog);
    assert.equal(st.sideLog!.at(-1)!.name, `name${STORY_CAPS.sideLog + 9}`, 'the side log keeps its newest');
    assert.equal(st.cue!.length, STORY_CAPS.cue);
    assert.equal(st.cue![0].id, 'name0', 'the beat queue keeps its order');
    assert.equal(st.verdicts!.length, STORY_CAPS.verdicts);
    assert.equal(Object.keys(st.choices!).length, STORY_CAPS.choices);
    assert.equal(back.objects[0].past!.length, STORY_CAPS.past);
    assert.equal(back.objects[0].past!.at(-1)!.name, `Home ${STORY_CAPS.past + 2}`, 'a build keeps its latest ages');
  } finally {
    engine.stop();
  }
});

test('the save guard drops a story field that still would not load, and says so', () => {
  const { world, h } = booted(FIXTURES[0]);
  storied(h.state, h.now);
  const d = h.state.dudes[0] as unknown as Record<string, unknown>;
  d.side = 'purple';
  cityOf(h.state).story!.scene!.beat = -1;
  h.state.mayor!.lock = { at: { x: NaN, z: 0 }, facing: 0, since: 0 };
  cityOf(h.state).story!.sideLog!.push({ at: h.now, id: 'dev:zed', name: 'zed', side: 'purple' as never });
  assert.deepEqual(trimStory(structuredClone(h.state)).sort(), ['city.story.scene', 'city.story.sideLog (1 of 3)', `dude ${h.state.dudes[0].id}.side`, 'mayor.lock'].sort());
  world.beforeSave!(h.state);
  assert.equal(d.side, undefined);
  assert.equal(cityOf(h.state).story!.scene, undefined);
  assert.equal(h.state.mayor!.lock, undefined);
  assert.deepEqual(cityOf(h.state).story!.sideLog!.map((e) => e.name), ['kev', 'dana'], 'a list loses only the entry that would not load');
  assert.ok(cityOf(h.state).story!.folly, 'the rest of the story stays');
  assert.ok(stateSchema.safeParse(h.state).success, 'and the save loads');
  assert.ok(h.logs.some((l) => /story: dropped .*city\.story\.scene/.test(l)), 'the log says what went');
});

test('a story in a shape the code never writes (null entries, a folly with no plaque, a list that is not one, over-long keys) still saves a file that boots', () => {
  const { world } = harness();
  const dir = tmpDir();
  fs.copyFileSync(FIXTURES[0], statePath(dir, world.meta.id));
  const engine = new Engine(world, { dataDir: dir, confidenceThreshold: 0.6, flags: { kickRepliesEnabled: false, devTimeScale: 1 } });
  try {
    const s = engine.state;
    storied(s, Date.now());
    const story = cityOf(s).story!;
    story.sideLog!.push(null as never);
    story.folly = { age: 0, pct: 10, startedAt: 0 } as never;
    story.cue = 'armed' as never;
    story.choices = { huts: 'tents', ['k'.repeat(60)]: 'yes' };
    story.scene!.vars = { head: 'The Chief', ['v'.repeat(50)]: 'x' };
    s.objects[0].past = [null, { age: 0, name: 'Mud Hut' }] as never;
    const plaque = structuredClone(s);
    cityOf(plaque).story!.folly = { age: 0, pct: 10, startedAt: 0, plaque: ['kev', null as never, 'dana'] };
    trimStory(plaque);
    assert.deepEqual(cityOf(plaque).story!.folly!.plaque, ['kev', 'dana'], 'a plaque loses only the name that is not one');

    engine.save();
    const back = loadState(world, dir, () => {});
    const st = back.city!.story!;
    assert.deepEqual(st.sideLog!.map((e) => e.name), ['kev', 'dana'], 'the null entry goes, the log stays');
    assert.equal(st.folly, undefined, 'a folly with no plaque goes');
    assert.equal(st.cue, undefined, 'a list that is not one goes');
    assert.deepEqual(st.choices, { huts: 'tents' }, 'an over-long key goes alone, not every choice');
    assert.deepEqual(st.scene!.vars, { head: 'The Chief' }, 'and the scene keeps its other vars');
    assert.deepEqual(back.objects[0].past, [{ age: 0, name: 'Mud Hut' }]);
    assert.equal(st.helped, true, 'the rest of the story stays');
  } finally {
    engine.stop();
  }
});

test('if the save guard itself throws, the story fields the loader would refuse still go before the write', () => {
  const { world, h } = booted(FIXTURES[0]);
  storied(h.state, h.now);
  const bad = structuredClone(h.state);
  cityOf(bad).story!.scene!.beat = -1;
  assert.deepEqual(dropBadStory(bad), ['city.story.scene'], 'the fallback drops whole fields');
  assert.ok(cityOf(bad).story!.folly, 'and keeps the good ones');
  cityOf(bad).story = 'junk' as never;
  assert.deepEqual(dropBadStory(bad), ['city.story']);
  assert.ok(stateSchema.safeParse(bad).success);

  const boom = () => {
    throw new Error('boom');
  };
  Object.defineProperty(cityOf(h.state).story!, 'folly', { enumerable: true, configurable: true, get: boom });
  world.beforeSave!(h.state);
  assert.equal(cityOf(h.state).story, undefined, 'a story nothing can read is not written');
  assert.ok(stateSchema.safeParse(h.state).success, 'so the save loads');
  assert.ok(h.logs.some((l) => /story: save guard failed \(boom\); dropped city\.story/.test(l)), 'the log says so');
});

test('a save cut off mid-scene boots released: no scene, no gather, no lock, the head not force-hidden', () => {
  for (const on of [true, false]) {
    const { world, h } = booted(FIXTURES[0]);
    storied(h.state, h.now);
    h.state.ai.story = on;
    const dir = tmpDir();
    world.beforeSave!(h.state);
    saveState(world, dir, h.state);
    const again = harness();
    again.h.state = loadState(again.world, dir, () => {});
    assert.ok(cityOf(again.h.state).story!.scene && again.h.state.dudes[0].gather && again.h.state.mayor!.lock, 'all saved');
    again.world.start!(again.ctx);
    const s = again.h.state;
    assert.equal(cityOf(s).story!.scene, undefined, `Story ${on ? 'ON' : 'OFF'}: the scene is over`);
    assert.ok(s.dudes.every((d) => !d.gather), 'nobody is held in a gathering');
    assert.equal(s.mayor!.lock, undefined, 'WASD is his again');
    assert.equal(s.mayor!.forcedHidden, undefined);
    assert.ok(cityOf(s).story!.folly && s.dudes[0].side === 'gold', 'what the story keeps stays');
    assert.ok(again.h.logs.some((l) => /story: released 4 held things/.test(l)), again.h.logs.join('\n'));
  }
});

// ---- the show input, the sites, the test scene --------------------------------------------------------

test('a {t:"show"} key from /mayor reaches story/beats.ts and changes nothing until its card lands', () => {
  const { h } = harness();
  for (const on of [false, true]) {
    h.state.ai.story = on;
    const before = JSON.stringify(h.state.city ?? {});
    assert.equal(mayorInput(h.state, { t: 'show', k: 'go' }, h.now), undefined, 'nothing to broadcast');
    assert.equal(mayorInput(h.state, { t: 'show', k: 7 }, h.now), undefined, 'a malformed key is ignored');
    assert.equal(JSON.stringify(h.state.city ?? {}), before);
  }
});

test('the story sites: the Folly sits in the SE corner park on nobody’s lot, everything on the ground', () => {
  const f = STORY_SITES.folly.rect;
  const overlaps = (a: typeof f, b: typeof f) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
  for (const r of STORY_RECTS) for (const lot of allPlots()) assert.ok(!overlaps(r, lot.rect), `story ground clear of lot ${lot.id}`);
  assert.ok(f.minX >= 27 && f.maxX <= 63 && f.minZ >= 27 && f.maxZ <= 63, 'inside the SE park’s green');
  for (const p of [STORY_SITES.folly.at, STORY_SITES.camp.at, STORY_SITES.headMark.at, STORY_SITES.crowd.at, STORY_SITES.wrenFire.at, STORY_SITES.wrenVantage.near, STORY_SITES.redSign.at])
    assert.ok(p.x >= CITY_BOUNDS.minX && p.x <= CITY_BOUNDS.maxX && p.z >= CITY_BOUNDS.minZ && p.z <= CITY_BOUNDS.maxZ, `${JSON.stringify(p)} is on the town's ground`);
  assert.ok(STORY_SITES.wrenVantage.far.x > CITY_BOUNDS.maxX, 'the far vantage is across the river');
});

test('STORY_SCENES holds the test scene: three shots, 10 s, one subtitle, and an id that is never saved in city.scene', () => {
  assert.ok(Object.hasOwn(STORY_SCENES, 'test'));
  // hook FK-026: every story scene's id is its own, never a saved city.scene one.
  for (const id of Object.keys(STORY_SCENES)) assert.ok(!(SCENE_IDS as string[]).includes(id) && STORY_SCENES[id].id === id, id);
  const t = STORY_SCENES.test;
  assert.equal(t.id, 'test');
  assert.equal(t.ms, 10_000);
  assert.equal(t.shots.length, 3);
  assert.equal(t.lines.length, 1);
  assert.ok(t.lines[0].text.length <= 42, 'a subtitle is one line of 42 characters at most');
  assert.ok(t.shots.every((s) => s.at < t.ms) && t.lines.every((l) => l.at + l.ms <= t.ms));
  assert.ok(!(SCENE_IDS as string[]).includes(t.id));
  assert.equal(SCENES[t.id], undefined, 'the caravan’s scenes don’t know it: the page looks it up in STORY_SCENES');
});

// ---- the enum freeze ---------------------------------------------------------------------------------
// Every enum in the saved state, by where it sits. Widening one makes a save that older code refuses
// to boot (engine/persistence.ts), and narrowing one makes older saves refuse: new state goes in new
// optional fields instead. A new saved enum is added here once, and never changes after it ships.
const EMOTES = ['wave', 'cheer', 'dance', 'sit', 'lie', 'jump', 'punch', 'bow', 'think', 'point', 'kick', 'hug', 'push', 'lean', 'drive', 'highfive', 'handshake', 'laugh', 'shrug', 'stagger', 'chop', 'hammer', 'cast', 'shoot', 'swing', 'strum', 'swim', 'lift', 'paint'];
const HATS = ['none', 'cap', 'beanie', 'tophat', 'cowboy', 'crown', 'bucket', 'helmet', 'party', 'headband', 'wizard', 'propeller'];
const ACCESSORIES = ['none', 'backpack', 'cape', 'scarf', 'glasses', 'toolbelt'];
const LINE_FROM = ['chatter', 'dude', 'world'];
const VENUES = ['home', 'cafe', 'restaurant', 'bakery', 'bar', 'club', 'shop', 'market', 'workshop', 'apartments', 'gym', 'park', 'library', 'florist', 'venue', 'decor'];
const NPC_KINDS = ['painter', 'squasher', 'tow', 'thief', 'mayor'];
const SIDES = ['red', 'gold'];
const BLUEPRINT: Record<string, string[]> = {
  'parts[].shape': ['box', 'cylinder', 'sphere', 'cone'],
  'animations[].kind': ['sway', 'drift', 'spin', 'bob'],
  'animations[].axis': ['x', 'y', 'z'],
  'abilities[]': ['floats', 'flies', 'vehicle', 'weapon', 'trap', 'smash'],
  moves: ['roam', 'drive', 'fly'],
  'interaction.pose': ['shoot', 'swing', 'strum', 'swim', 'lift', 'paint', 'jump', 'kick', 'dance', 'sit', 'lie', 'cheer', 'punch', 'wave', 'think'],
  'interaction.spot': ['on', 'beside'],
};
const FROZEN: Record<string, string[]> = {
  'dudes[].look.hat': HATS,
  'dudes[].look.accessory': ACCESSORIES,
  'dudes[].history[].from': LINE_FROM,
  'dudes[].inbox[].from': LINE_FROM,
  'dudes[].walkingFor': ['move', 'job', 'wander', 'visit', 'design'],
  'dudes[].emote.pose': EMOTES,
  'dudes[].use.how': ['drive', 'ride', 'sit', 'lie', 'stand', 'enter', 'push', 'hug', 'kick', 'punch', 'lean', 'look', 'dance', 'fix', 'fire'],
  'dudes[].use.phase': ['going', 'doing'],
  'dudes[].attack.with': ['shove', 'punch', 'kick', 'shoot', 'throw', 'bomb'],
  'dudes[].attack.kind': ['dude', 'npc', 'object', 'boss'],
  'dudes[].attack.phase': ['going', 'fuse'],
  'dudes[].meet.how': ['highfive', 'handshake', 'hug', 'wave', 'bow'],
  'dudes[].visit.phase': ['going', 'in'],
  'dudes[].visit.why': ['need', 'asked', 'work', 'party'],
  'dudes[].visit.need': ['hunger', 'energy', 'fun', 'social'],
  'dudes[].labour.phase': ['going', 'working'],
  'dudes[].labour.site': ['bridge'],
  'dudes[].bit.steps[].pose': EMOTES,
  'dudes[].bit.target.kind': ['dude', 'mayor', 'townie', 'object', 'point'],
  'dudes[].bit.prop': ['sign', 'drink', 'flowers', 'megaphone'],
  'dudes[].bit.burst': ['sparkles', 'smoke', 'confetti', 'hearts'],
  'dudes[].bit.giveHat': HATS,
  'dudes[].bit.phase': ['going', 'doing'],
  'dudes[].side': SIDES,
  'objects[].venue': VENUES,
  'objects[].creature.behaviour': ['rampage', 'fight', 'zoom', 'roam'],
  'jobs[].kind': ['build', 'edit', 'remove'],
  'jobs[].status': ['queued', 'designing', 'ready', 'walking', 'building', 'done', 'failed'],
  'jobs[].venue': VENUES,
  'effects[].kind': ['shake', 'shot', 'throw', 'bomb', 'boom', 'ko', 'splash', 'slam', 'coins', 'pop', 'burst', 'shell', 'hit', 'collapse'],
  'listener.buffer[].kind': ['chat', 'failed', 'refused'],
  'listener.wishes[].status': ['works-now', 'needs-feature', 'blocked'],
  'npcs[].kind': NPC_KINDS,
  'npcs[].look.hat': HATS,
  'npcs[].look.accessory': ACCESSORIES,
  'npcs[].emote.pose': EMOTES,
  'npcs[].loot[].hat': HATS,
  'happening.kind': NPC_KINDS,
  'vandalised{}.kind': ['painted', 'squashed', 'wrecked', 'damaged'],
  'hatPiles{}{}.hat': HATS,
  'city.project.status': ['designing', 'gathering', 'done', 'failed'],
  'city.townies[].look.hat': HATS,
  'city.townies[].look.accessory': ACCESSORIES,
  'city.townies[].doing': ['stroll', 'going', 'in', 'chat'],
  'city.townies[].emote.pose': EMOTES,
  'city.caravan.asks[].kind': ['build', 'serve', 'operate', 'party', 'project', 'bridge'],
  'city.caravan.asks[].venues[]': VENUES,
  'city.scene.id': ['opening', 'crossing', 'ageTurn', 'arrival', 'finale'],
  'city.story.sideLog[].side': SIDES,
  'city.story.sideLog[].from': SIDES,
  'city.story.verdicts[].side': SIDES,
  'mayor.emote.pose': EMOTES,
  'mayor.hatGift.hat': HATS,
  'mayor.look.hat': HATS,
  'mayor.look.accessory': ACCESSORIES,
  ...Object.fromEntries(['objects[].blueprint', 'jobs[].blueprint', 'vandalised{}.original', 'city.project.blueprint'].flatMap((at) => Object.entries(BLUEPRINT).map(([k, v]) => [`${at}.${k}`, v]))),
};

/** Every enum (and literal) in a zod schema, by path: `a.b[]` an array's items, `a{}` a record's values. */
function savedEnums(schema: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen = new Set<unknown>();
  type Def = { type: string; [k: string]: unknown };
  const def = (s: unknown) => (s as { _zod: { def: Def } })._zod.def;
  const walk = (s: unknown, at: string): void => {
    const d = def(s);
    switch (d.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'readonly':
      case 'nonoptional':
        return walk(d.innerType, at);
      case 'lazy':
        if (seen.has(s)) return;
        seen.add(s);
        return walk((d.getter as () => unknown)(), at);
      case 'pipe':
        walk(d.in, at);
        return walk(d.out, at);
      case 'object':
        for (const [k, v] of Object.entries(d.shape as Record<string, unknown>)) walk(v, at ? `${at}.${k}` : k);
        return;
      case 'array':
        return walk(d.element, `${at}[]`);
      case 'tuple':
        return (d.items as unknown[]).forEach((item, i) => walk(item, `${at}[${i}]`));
      case 'record':
        walk(d.keyType, `${at}{key}`);
        return walk(d.valueType, `${at}{}`);
      case 'union':
        return (d.options as unknown[]).forEach((o, i) => walk(o, `${at}|${i}`));
      case 'enum':
        out[at] = Object.values(d.entries as Record<string, string>);
        return;
      case 'literal':
        out[at] = (d.values as unknown[]).map(String);
    }
  };
  walk(schema, '');
  return out;
}

test('no saved enum gains or loses a value (Visit.why, effects.kind, city.scene.id, ask kinds, EMOTES and every other)', () => {
  const found = savedEnums(stateSchema);
  const sorted = (v: string[]) => [...v].sort();
  // The ones the story is most likely to be tempted to widen, by name.
  assert.deepEqual(sorted(found['dudes[].visit.why']), sorted(['need', 'asked', 'work', 'party']), 'Visit.why: a gathering is `dude.gather`, never a visit');
  assert.deepEqual(sorted(found['effects[].kind']), sorted(FROZEN['effects[].kind']), 'effects.kind');
  assert.deepEqual(sorted(found['city.scene.id']), sorted(SCENE_IDS), 'city.scene.id: story scenes save in city.story.scene');
  assert.deepEqual(sorted(found['city.caravan.asks[].kind']), sorted(['build', 'serve', 'operate', 'party', 'project', 'bridge']), 'ask kinds');
  assert.deepEqual(sorted(found['dudes[].emote.pose']), sorted(EMOTES), 'EMOTES');
  for (const [at, values] of Object.entries(found)) {
    assert.ok(FROZEN[at], `a new saved enum at ${at}: add it to FROZEN (and never change it once it ships)`);
    assert.deepEqual(sorted(values), sorted(FROZEN[at]), `the saved enum at ${at} changed`);
  }
  for (const at of Object.keys(FROZEN)) assert.ok(found[at], `the saved enum at ${at} is gone`);
});

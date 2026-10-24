// Cast renames and the daughter clean-up (FK-128): nobody else in town is called Wren, Ash or Oak (not a
// townie, a traveller, a street); with Story on the old band's Toma and Ama never speak or get named
// (the cast's leader speaks for the band, Wren is the daughter, a new band's greetings are dropped);
// /admin's name-daughter refuses with Story on and works as today with it off; and a save from before the
// renames is put right where it stands.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { TOWNIE_NAMES, TOWN_NAMES, ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { DAUGHTER, RENAMED_TRAVELLERS, caravanLine, caravanOf, daughterOf, resumeCaravan, skipVisit } from '../src/worlds/ai-dudes/caravan';
import { hashOf } from '../src/worlds/ai-dudes/agent';
import { CAST, CAST_ROLES, castTownie, clashesWithCast } from '../src/worlds/ai-dudes/story/cast';
import { stateSchema, type DudesState } from '../src/worlds/ai-dudes/state';
import { AGES, LAST_AGE, venueName } from '../src/shared/ages';
import { CITY, DISTRICT_NAMES, VENUE_KINDS, allPlots, avenueName, streetName } from '../src/shared/city';
import { SCENES, fillLine, sceneLine } from '../src/shared/scenes';
import type { DudesScene } from '../src/shared/dudesTypes';

/** Anything the old band would say or be called with Story on. */
const OLD_BAND = /\b(Toma|Ama|Mammoth|little daughter|little girl|little one)\b/;

async function town(story: boolean) {
  const hs = harness({ town: true });
  hs.h.state.ai.story = story;
  for (const n of ['kim', 'lee', 'max', 'sol']) await hs.say(n, 'hi');
  await hs.tick(2000);
  const view = () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene;
  const run = (id: string, value?: string) => hs.world.adminActions!.find((a) => a.id === id)!.run({ state: hs.h.state, now: hs.h.now, log: () => {} } as never, value as never);
  return { ...hs, view, run };
}
/** The subtitle on screen `t` ms into the scene playing, as the page fills it in (main.ts). */
function subtitle(scene: DudesScene, t: number): string | undefined {
  const sc = scene.town?.scene;
  const s = sc && SCENES[sc.id];
  if (!sc || !s) return undefined;
  const vars = { leader: sc.leader ?? '', ...sc.vars };
  const line = sceneLine(s, t, vars);
  return line && `${fillLine(line.who, vars)}: ${fillLine(line.text, vars)}`;
}
/** Through Stone's visits (admin skips) to the moment the Wonder stands and the age turn starts. */
async function toAgeTurn(h: { state: DudesState; now: number }, tick: (ms: number) => Promise<void>) {
  for (let i = 0; i < 30 && !cityOf(h.state).caravan?.turn; i++) {
    skipVisit(h.state, h.now);
    await tick(1000);
  }
  assert.ok(cityOf(h.state).caravan?.turn && ageOf(h.state) === 0, 'the Wonder stands');
}
/** Every subtitle a scene shows, in order. */
const subtitles = (scene: DudesScene) => (SCENES[scene.town!.scene!.id]?.lines ?? []).map((l) => subtitle(scene, l.at + 1)).filter((s): s is string => !!s);

test('every name table: no townie, traveller, street or district goes by a cast name', () => {
  const clash = (what: string, names: string[]) => {
    const bad = names.filter(clashesWithCast);
    assert.deepEqual(bad, [], `${what} share a name with the cast`);
  };
  clash('residents', TOWNIE_NAMES);
  assert.ok(!TOWNIE_NAMES.includes('Wren') && TOWNIE_NAMES.includes('Hattie'), '"Wren" off the bus is now Hattie');
  assert.equal(new Set(TOWNIE_NAMES).size, TOWNIE_NAMES.length, 'no name twice');
  clash('town names', TOWN_NAMES);
  for (let age = 0; age <= LAST_AGE; age++) {
    const c = caravanOf(age);
    clash(`${c.name} (age ${age})`, [c.name, c.leader, ...c.travellers, c.specialist]);
    clash(`${AGES[age].id} places`, VENUE_KINDS.map((k) => venueName(age, k)));
  }
  clash('the daughter', [DAUGHTER]);
  assert.deepEqual(
    [caravanOf(1).travellers[0], caravanOf(2).travellers[1], caravanOf(3).leader, caravanOf(5).leader],
    ['Hori the Boatman', 'Minstrel Robin', 'Mr Hargreaves', 'Road Boss Roxy'],
    'Ashur, Minstrel Wren, Mr Ashby and Road Boss Mara are renamed',
  );
  // Streets and avenues: every name on the list, and every address in town.
  const roads: string[] = [];
  for (let i = 0; i < 8; i++) roads.push(streetName(i - CITY.rings - 1), avenueName(i - CITY.rings - 1));
  clash('streets and avenues', roads);
  assert.ok(roads.includes('Alder Street'), 'Oak Street is Alder Street');
  clash('addresses', allPlots().map((p) => p.address));
  clash('districts', Object.values(DISTRICT_NAMES).flat());
  // The rule itself, and the cast are the only ones it matches.
  assert.ok(['Wren', 'Minstrel Wren', 'Ashur the Boatman', 'Mr Ashby', 'Oak Street', 'Oakley', 'Old Moss', 'Kit'].every(clashesWithCast));
  assert.ok(!['Mrs Okafor', 'Washington', 'Kwame', 'the Kitchen Quarter', 'Hattie', 'Toma'].some(clashesWithCast));
  assert.ok(CAST_ROLES.every((r) => clashesWithCast(CAST[r].name)));
  // The old names, for saves from before: each new one is clear.
  clash('renamed travellers', [...RENAMED_TRAVELLERS.values()]);
});

test("name-daughter: refused with Story ON (the town's name for her kept), as today with Story OFF", async () => {
  const { h, tick, run } = await town(false);
  assert.equal(run('name-daughter', 'Nell'), undefined, 'Story OFF: done');
  assert.equal(cityOf(h.state).daughter, 'Nell');
  assert.ok(cityOf(h.state).townies.some((t) => t.daughter && t.name === 'Nell'), 'the daughter renamed');
  assert.ok(h.state.feed.some((f) => f.text === 'The girl at the river is called Nell'));

  h.state.ai.story = true;
  await tick(1000);
  const feed = h.state.feed.length;
  assert.equal(run('name-daughter', 'Bea'), 'Story is on: Wren is the daughter', 'Story ON: refused, and says why');
  assert.equal(run('name-daughter', ''), 'Story is on: Wren is the daughter', 'whatever is typed');
  assert.equal(cityOf(h.state).daughter, 'Nell', 'city.daughter left alone');
  assert.equal(daughterOf(h.state), 'Wren');
  assert.ok(!cityOf(h.state).townies.some((t) => t.name === 'Bea'), 'nobody renamed');
  assert.equal(castTownie(h.state, 'wren')!.name, 'Wren');
  assert.equal(h.state.feed.length, feed, 'nothing in the feed');

  h.state.ai.story = false;
  await tick(1000);
  assert.ok(cityOf(h.state).townies.some((t) => t.daughter && t.name === 'Nell'), 'Story OFF: she is Nell again');
  assert.equal(daughterOf(h.state), 'Nell');
});

test('Story ON, at the river: the opening is Ash\'s, and nobody names Toma or Ama (subtitles, bubbles, feed, agents, Kick)', async () => {
  const { h, tick, run, view } = await town(true);
  run('scene-opening');
  assert.equal(view().town?.scene?.leader, 'Ash', 'the leader is Ash');
  assert.deepEqual(subtitles(view()), ['Ash: Hello.', "Ash: We've been travelling.", 'Ash: We need your help.', "Ash: The bridge is gone. We can't cross."]);
  // The scene, then the bridge asks for hands, and the band waits a good while.
  const said: string[] = [];
  for (let i = 0; i < 400; i++) {
    await tick(500, 500);
    for (const t of cityOf(h.state).townies) if (t.say && !said.includes(t.say.text)) said.push(t.say.text);
  }
  assert.ok(cityOf(h.state).caravan!.asks.some((a) => a.kind === 'bridge'), 'the bridge is asking');
  assert.ok(said.includes("Mend the bridge, and we'll mend the rest."), `Ash calls over with his own line: ${JSON.stringify(said)}`);
  assert.deepEqual(said.filter((s) => OLD_BAND.test(s)), [], 'no bubble about the little one');
  assert.deepEqual(h.state.feed.map((f) => f.text).filter((s) => OLD_BAND.test(s)), [], 'no feed line names the old band');
  assert.ok(h.state.feed.some((f) => f.text.startsWith('Ash of the travellers: "The bridge is gone.')), 'Ash asks');
  assert.ok(h.announced.some((l) => /bridge/i.test(l)), 'the crier posted');
  assert.deepEqual(h.announced.filter((l) => OLD_BAND.test(l)), [], 'nor any Kick line');
  const line = caravanLine(h.state)!;
  assert.match(line, /^the travellers \(Ash the hunter, Wren, Old Moss, Oak the builder and Kit\) are stuck across the river/, 'agents hear of the cast');
  assert.doesNotMatch(line, OLD_BAND);
  const told = h.state.dudes.flatMap((d) => d.history.filter((m) => m.from === 'world').map((m) => m.text));
  assert.ok(told.some((t) => t.startsWith('Ash of the travellers is stuck across the river with his people')), 'every agent told');
  assert.deepEqual(told.filter((t) => OLD_BAND.test(t)), []);
  const scene = view();
  assert.equal(scene.town?.caravan?.leader, 'Ash', "the board's leader");
  assert.ok(!scene.dudes.some((d) => d.title), 'no "his daughter" or "leader of the travellers" under any tag');
});

test('Story OFF, at the river: Toma and Ama as today', async () => {
  const { h, tick, run, view } = await town(false);
  run('scene-opening');
  assert.equal(subtitles(view())[0], 'Toma: Hello.');
  await tick(SCENES.opening.ms + 1000);
  assert.match(caravanLine(h.state)!, /^the Mammoth Herders \(Toma and Ama, his little daughter, with their people\)/);
  assert.ok(h.state.feed.some((f) => f.text.startsWith('Toma of the Mammoth Herders:')));
  assert.equal(view().dudes.find((d) => d.name === 'Ama')?.title, 'his daughter');
});

test('Story ON, the age turn: no goodbye, and the cast walk back in without a new band\'s greeting', async () => {
  const { h, tick, view } = await town(true);
  await toAgeTurn(h, tick);
  // The age turn: the head's line, Ash's "Look", the title and the heroes, but no farewell.
  if (cityOf(h.state).scene?.id !== 'ageTurn') assert.fail(`the age turn is playing: ${cityOf(h.state).scene?.id}`);
  assert.equal(cityOf(h.state).scene!.vars!.farewell, '');
  const turn = subtitles(view());
  assert.ok(turn.includes('Ash: Look. Look at it.'), JSON.stringify(turn));
  assert.ok(!turn.some((s) => s.startsWith('Ash:') && /goodbye|tell every river/i.test(s)), `no goodbye: ${JSON.stringify(turn)}`);
  assert.equal(subtitle(view(), 22_000), undefined, 'the goodbye slot is empty');
  // The breather, then Bronze walks in: the arrival, with neither "Ho, the town!" nor the daughter's arrival line.
  for (let i = 0; i < 30 && cityOf(h.state).scene?.id !== 'arrival'; i++) await tick(5000);
  if (cityOf(h.state).scene?.id !== 'arrival') assert.fail('the arrival is playing');
  assert.equal(cityOf(h.state).caravan!.age, 1);
  assert.deepEqual(subtitles(view()), [], 'no greeting and no "I was small when we crossed your bridge"');
  assert.equal(view().town?.scene?.leader, 'Ash');
  assert.deepEqual(h.state.feed.map((f) => f.text).filter((s) => /River Traders|Nebet|Mammoth|Toma\b|Ama\b/.test(s)), [], 'no new band in the feed');
  assert.deepEqual(h.announced.filter((l) => /River Traders|Nebet|Mammoth|Toma\b|Ama\b/.test(l)), [], 'nor on Kick');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save takes the empty lines');
});

test("Story OFF, the age turn: today's goodbye and the River Traders' greeting", async () => {
  const { h, tick, view } = await town(false);
  await toAgeTurn(h, tick);
  assert.equal(subtitle(view(), 22_000), "Toma: We'll tell every river about this town. Goodbye, and thank you.");
  for (let i = 0; i < 30 && cityOf(h.state).scene?.id !== 'arrival'; i++) await tick(5000);
  assert.deepEqual(subtitles(view()), ['Captain Nebet: Ho, the town! We heard there was a furnace here. We have grain to trade.', 'Ama: I was small when we crossed your bridge. I remember the fire pits.']);
});

test('a save from before the renames: old travellers renamed where they stand; a resident Wren takes a free name with Story ON', async () => {
  const { h, tick, run } = await town(false);
  run('set-age', 'bronze');
  await tick(2000);
  // Bronze's band as an older save had them: Ashur the Boatman.
  const hori = cityOf(h.state).townies.find((t) => t.name === 'Hori the Boatman')!;
  hori.name = 'Ashur the Boatman';
  const id = hori.id;
  // And a resident Wren off the bus before the rename.
  cityOf(h.state).townies.push({ id: 'tzzwren', name: 'Wren', look: { ...CAST.wren.look }, position: { x: 0, z: 0 }, facing: 0, path: [], doing: 'stroll', until: h.now });
  await tick(1000);
  assert.equal(hori.name, 'Hori the Boatman', 'the boatman renamed in place');
  assert.equal(hori.id, id, 'same townie, same id');
  assert.ok(cityOf(h.state).caravan!.travellers.includes(id), 'still one of the band');
  const wren = () => cityOf(h.state).townies.find((t) => t.id === 'tzzwren');
  assert.equal(wren()?.name, 'Wren', 'Story OFF: the resident Wren stays herself (no cast to clash with)');

  h.state.ai.story = true;
  await tick(1000);
  const used = new Set(cityOf(h.state).townies.filter((t) => t.id !== 'tzzwren').map((t) => t.name));
  assert.equal(wren()?.name, TOWNIE_NAMES.find((n) => !used.has(n)), 'Story ON: she takes the first free name');
  assert.deepEqual(cityOf(h.state).townies.filter((t) => !t.role && clashesWithCast(t.name)).map((t) => t.name), [], 'only the cast go by cast names');
  assert.equal(cityOf(h.state).townies.filter((t) => t.name === 'Wren').length, 1, 'one Wren, the cast\'s');
  h.state.ai.story = false;
  await tick(1000);
  assert.notEqual(wren()?.name, 'Wren', 'and keeps it');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('a save from before the renames: a traveller under the id of his old name is still the one in the band (caravan back on, town life off and on)', async () => {
  const { h, tick, run } = await town(false);
  run('set-age', 'bronze');
  await tick(2000);
  const city = () => cityOf(h.state);
  const band = () => city().caravan!.travellers.map((id) => city().townies.find((t) => t.id === id)?.name);
  const all = ['Captain Nebet', 'Ama', 'Hori the Boatman', 'Mina'];
  const one = (name: string) => assert.equal(city().townies.filter((t) => t.name === name).length, 1, `one ${name}`);
  // As an older save had him: Ashur the Boatman, under the id made from that name.
  const old = `c${hashOf('Ashur the Boatman:1').toString(36)}`.slice(0, 20);
  const hori = city().townies.find((t) => t.name === 'Hori the Boatman')!;
  city().caravan!.travellers = city().caravan!.travellers.map((id) => (id === hori.id ? old : id));
  city().townies = city().townies.filter((t) => t !== hori);
  city().townies.push({ ...hori, id: old, name: 'Ashur the Boatman' });
  await tick(1000);
  assert.deepEqual(band(), all, 'renamed where he stands');
  // The caravan back on while he stands (or the band brought back mid-visit): no second Hori.
  resumeCaravan(h.state, h.now);
  await tick(1000);
  assert.deepEqual(band(), all);
  assert.ok(city().caravan!.travellers.includes(old), 'the same townie');
  one('Hori the Boatman');
  // Town life off and on: the band comes back under ids the caravan knows, Hori third (the elder's place).
  run('town-off');
  await tick(1000);
  assert.ok(!city().townies.some((t) => t.traveller), 'the band has gone');
  run('town-on');
  await tick(1000);
  assert.deepEqual(band(), all, 'every id in the band is in town');
  one('Hori the Boatman');
  // And sandbox and back.
  run('caravan-off');
  await tick(1000);
  run('caravan-on');
  await tick(1000);
  assert.deepEqual(band(), all);
  one('Hori the Boatman');
  // The daughter named by admin is the same case: renamed where she stands, then the caravan brought back.
  run('name-daughter', 'Nell');
  resumeCaravan(h.state, h.now);
  await tick(1000);
  assert.deepEqual(band(), ['Captain Nebet', 'Nell', 'Hori the Boatman', 'Mina']);
  one('Nell');
});

test("the finale: Story ON, Wren has no line of Ama's; Story OFF, Ama's line as today", async () => {
  for (const story of [true, false]) {
    const { h, tick, run, view } = await town(story);
    run('set-age', AGES[LAST_AGE].id);
    await tick(2000);
    for (let i = 0; i < 30 && !cityOf(h.state).caravan?.turn; i++) {
      skipVisit(h.state, h.now);
      await tick(1000);
    }
    if (cityOf(h.state).scene?.id !== 'finale') assert.fail(`the finale is playing: ${cityOf(h.state).scene?.id}`);
    const line = subtitle(view(), 34_601);
    if (story) {
      assert.equal(cityOf(h.state).scene!.vars!.daughterLine, '');
      assert.equal(line, undefined, 'the daughter\'s slot is empty');
      assert.ok(!subtitles(view()).some((s) => OLD_BAND.test(s)), JSON.stringify(subtitles(view())));
    } else assert.equal(line, `Ama: ${caravanOf(0).daughterLine}`);
  }
});

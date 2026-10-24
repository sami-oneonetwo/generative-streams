// The town without a model: everyone who turns up gets a lot, builds on it (or on any lot but the square), and what they build is
// for something other people use and pay for; needs send characters out on their own; community
// projects get designed, paid for, built together and opened; residents keep places busy; and
// whoever was away hears what happened when they come back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAgentReply, type AgentReply } from '../src/worlds/ai-dudes/agent';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { allPlots, homePlots, civicPlots, projectPlots, plotById, courtyards, layoutPlots, isBridgeLane, isOpenSquare, isPark, wonderLot, BLOCK_ORDER, CURRENT_LAYOUT, CITY, CITY_BOUNDS, BLOCK_HALF, OPEN_SQUARE, PITCH, WONDER, type PlotInfo } from '../src/shared/city';
import { cityOf, districtsOf, headName, placesOf, proposeWonder, wantsOf, TOWN } from '../src/worlds/ai-dudes/city';
import { AWAKE_MS, seatHeight } from '../src/worlds/ai-dudes/sim';
import { altitudeOf, flies } from '../src/worlds/ai-dudes/movers';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { harness } from './harness';
import type { DesignFn, DesignInput } from '../src/worlds/ai-dudes/design';
import { validateDesign } from '../src/worlds/ai-dudes/blueprint';
import type { SafehouseObject } from '../src/shared/objectTypes';

const inside = (p: { x: number; z: number }, r: { minX: number; maxX: number; minZ: number; maxZ: number }) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

test('the layout: lots never overlap the roads or each other, every address is distinct, and the square holds the community lots', () => {
  const lots = allPlots();
  assert.equal(lots.length, 4 * 8 + 4, 'four blocks of eight lots round their courtyards (the corners are parks), and the square\'s four');
  assert.equal(lots.filter((l) => l.civic).length, 4);
  assert.equal(new Set(lots.map((l) => l.address)).size, lots.length);
  for (const a of lots) {
    assert.ok(inside({ x: a.rect.minX, z: a.rect.minZ }, CITY_BOUNDS) && inside({ x: a.rect.maxX, z: a.rect.maxZ }, CITY_BOUNDS), 'inside({ x: a.rect.minX, z: a.rect.minZ }, CITY_BOUNDS) && i');
    // Within its block, inside the pavement.
    const bx = a.bx * PITCH,
      bz = a.bz * PITCH;
    assert.ok(a.rect.minX >= bx - BLOCK_HALF && a.rect.maxX <= bx + BLOCK_HALF && a.rect.minZ >= bz - BLOCK_HALF && a.rect.maxZ <= bz + BLOCK_HALF, a.id);
    for (const b of lots) if (a !== b) assert.ok(a.rect.maxX <= b.rect.minX || b.rect.maxX <= a.rect.minX || a.rect.maxZ <= b.rect.minZ || b.rect.maxZ <= a.rect.minZ, `${a.id} overlaps ${b.id}`);
  }
  const home = homePlots();
  // No lot on a courtyard; every lot fronts a road.
  for (const c of courtyards()) assert.ok(!lots.some((l) => inside(c, l.rect)), `courtyard ${c.x},${c.z} is no lot`);
  for (const l of home) assert.ok(Math.abs(l.centre.x + l.front.x * (CITY.plot / 2 + CITY.sidewalk + CITY.road / 2) - (l.bx * PITCH + l.front.x * PITCH / 2)) < 0.01 || l.front.z !== 0, `${l.id} fronts its avenue`);
});

test('lots are handed out block by block from the bridge (layout A+): river-side cells first, the square as before, Bridge Lane last', () => {
  const lots = allPlots();
  lots.forEach((l, i) => assert.equal(l.rank, i, `${l.id} ranks where it stands`));
  // The square's four come first, round from the north-west as they always have (community projects take the first free one).
  assert.deepEqual(lots.slice(0, 4).map((l) => l.id), ['q0_0_-1_-1', 'q0_0_1_-1', 'q0_0_1_1', 'q0_0_-1_1']);
  const home = homePlots();
  // Bridge Lane's two cells go last, so they are still free when FK-076 takes them out.
  assert.deepEqual(home.slice(-2).map((l) => l.id), ['q1_0_1_0', 'q1_0_-1_0']);
  assert.ok(home.slice(-2).every(isBridgeLane) && !home.slice(0, -2).some(isBridgeLane), 'only the last two are on Bridge Lane');
  /** The blocks in the order they are handed out, and each block's lots in that order. */
  const blocks = (ls: PlotInfo[]) => {
    const out: { key: string; lots: PlotInfo[] }[] = [];
    for (const l of ls) {
      const key = `${l.bx},${l.bz}`;
      if (out.at(-1)?.key === key) out.at(-1)!.lots.push(l);
      else out.push({ key, lots: [l] });
    }
    return out;
  };
  const filled = blocks(home.filter((l) => !isBridgeLane(l)));
  // East (between the square and the river), then south, north and west: the corners are parks, with no lots.
  assert.deepEqual(filled.map((b) => b.key), ['1,0', '0,1', '0,-1', '-1,0'], 'one block at a time, never back to one already started');
  assert.deepEqual(BLOCK_ORDER.filter(([bx, bz]) => !isPark(bx, bz)).map(([bx, bz]) => `${bx},${bz}`), filled.map((b) => b.key));
  for (const b of filled)
    b.lots.forEach((l, i) => {
      const prev = b.lots[i - 1];
      if (!prev) return;
      // River-side (east) cells first; along a column, the one nearest Bridge Lane (z = 0) first, south before north.
      assert.ok(l.centre.x < prev.centre.x || (l.centre.x === prev.centre.x && (Math.abs(l.centre.z) > Math.abs(prev.centre.z) || (Math.abs(l.centre.z) === Math.abs(prev.centre.z) && l.centre.z < prev.centre.z))), `${prev.id} before ${l.id}`);
    });
  assert.deepEqual(home.slice(0, 6).map((l) => l.id), ['q1_0_1_1', 'q1_0_1_-1', 'q1_0_0_1', 'q1_0_0_-1', 'q1_0_-1_1', 'q1_0_-1_-1'], 'the first six fill the east block, river side first');
  assert.equal(home[6].id, 'q0_1_1_-1', 'then the south block, at its corner nearest the east block');
  // The first three live next door to each other (one lot across, two along), not 66 m apart round the square.
  const first = home.slice(0, 3).map((l) => l.centre);
  assert.ok(Math.max(...first.map((p) => p.x)) - Math.min(...first.map((p) => p.x)) <= CITY.plot && Math.max(...first.map((p) => p.z)) - Math.min(...first.map((p) => p.z)) <= 2 * CITY.plot, 'the first three are neighbours');
  // When the corner parks open (FK-081), they take their turn in the same order.
  const open = blocks(layoutPlots({ ...CURRENT_LAYOUT, parks: false }).filter((l) => !l.civic && !isBridgeLane(l)));
  assert.deepEqual(open.map((b) => b.key), BLOCK_ORDER.map(([bx, bz]) => `${bx},${bz}`));
});

test('the first chatters move in together by the river; a lot claimed under the old order stays put through a restart', async () => {
  const a = harness();
  await a.say('Sami', 'hi');
  const sami = a.h.state.dudes[0];
  // The live save was laid out by the old order: Sami holds its first lot, the north block's nearest the square.
  const c = cityOf(a.h.state);
  delete c.plots[sami.plot!];
  c.plots['q0_-1_0_1'] = { owner: sami.id, coOwners: [], claimedAt: a.h.now };
  sami.plot = 'q0_-1_0_1';
  // A restart: the save goes through the schema and the world boots on it.
  const b = harness();
  b.h.state = stateSchema.parse(JSON.parse(JSON.stringify(a.h.state)));
  b.world.start!(b.ctx);
  for (const name of ['test-kev', 'test-dana', 'test-bo', 'test-nia', 'test-ash', 'test-ru', 'test-jo']) await b.say(name, 'hi');
  const town = cityOf(b.h.state);
  assert.equal(town.plots['q0_-1_0_1']?.owner, sami.id, "Sami's lot is untouched");
  assert.equal(b.h.state.dudes.find((d) => d.id === sami.id)?.plot, 'q0_-1_0_1');
  const lotOf = (name: string) => b.h.state.dudes.find((d) => d.name === name)!.plot;
  assert.deepEqual(
    ['test-kev', 'test-dana', 'test-bo', 'test-nia', 'test-ash', 'test-ru', 'test-jo'].map(lotOf),
    ['q1_0_1_1', 'q1_0_1_-1', 'q1_0_0_1', 'q1_0_0_-1', 'q1_0_-1_1', 'q1_0_-1_-1', 'q0_1_1_-1'],
    'newcomers fill the east block by the river, then start on the south block',
  );
  for (const name of ['test-kev', 'test-dana']) assert.equal(town.plots[lotOf(name)!]?.owner, b.h.state.dudes.find((d) => d.name === name)!.id);
  assert.ok(b.h.state.feed.some((f) => f.text === `test-kev moved into ${plotById('q1_0_1_1')!.address}`), 'and the feed says where');
});

test('the square keeps its river-side half open (layout A+): community projects get only the west two lots', () => {
  const civic = civicPlots();
  // All four lots are still there with their ids and addresses, so a save with a project on the river side loads as it was.
  assert.deepEqual(civic.map((l) => l.id), ['q0_0_-1_-1', 'q0_0_1_-1', 'q0_0_1_1', 'q0_0_-1_1']);
  assert.deepEqual(civic.filter(isOpenSquare).map((l) => l.id), ['q0_0_1_-1', 'q0_0_1_1'], 'the river side (east) is kept open');
  assert.deepEqual(projectPlots().map((l) => l.id), ['q0_0_-1_-1', 'q0_0_-1_1'], 'projects take the west half, north-west first as ever');
  assert.ok(!homePlots().some(isOpenSquare) && !isOpenSquare(wonderLot()), "only the square's own lots");
  // About 20 × 39 m to gather in: from the middle of the cross to the pavement's edge, the whole length of the square.
  assert.equal(OPEN_SQUARE.maxX - OPEN_SQUARE.minX, BLOCK_HALF);
  assert.equal(OPEN_SQUARE.maxZ - OPEN_SQUARE.minZ, 2 * BLOCK_HALF);
  const overlaps = (a: PlotInfo['rect'], b: PlotInfo['rect']) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
  for (const l of civic.filter(isOpenSquare)) assert.ok(inside({ x: l.rect.minX, z: l.rect.minZ }, OPEN_SQUARE) && inside({ x: l.rect.maxX, z: l.rect.maxZ }, OPEN_SQUARE), `${l.id} lies in the open half`);
  for (const l of allPlots().filter((x) => !isOpenSquare(x))) assert.ok(!overlaps(l.rect, OPEN_SQUARE), `${l.id} stays out of the open half`);
  // The Wonder in the middle of the cross leans in by half its footprint, no more.
  assert.equal(wonderLot().rect.maxX - OPEN_SQUARE.minX, WONDER.size / 2);
});

test("community projects go up in the square's west half; with it full the square says no, though the river side is free", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  // A save from before layout A+: the old order gave a town's second project the north-east lot, by the river. It stays put.
  const ne = plotById('q0_0_1_-1')!;
  const old: SafehouseObject = {
    id: 'old1',
    revision: 1,
    blueprint: { name: 'Old Bandstand', description: 'a bandstand', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [4, 1, 4], rotation: [0, 0, 0], color: '#888888' }] },
    position: { ...ne.centre },
    footprint: { width: 4, depth: 4 },
    createdBy: 'lee',
    editedBy: 'lee',
    createdAt: h.now,
    plot: ne.id,
    venue: 'park',
    civic: true,
  };
  h.state.objects.push(old);
  /** Proposed in chat (the fixture designer answers at once). */
  const propose = async (name: string, what: string) => {
    script = [{ do: 'propose', what }];
    await say(name, `the town needs ${what}`);
    await tick(1000);
    script = [];
    return cityOf(h.state).project;
  };
  /** Paid for and built: the money and hands are filled in here, the opening is the town's own. */
  const finish = async () => {
    const p = cityOf(h.state).project!;
    p.coins = p.coinsNeed;
    p.work = p.workNeed;
    await tick(1000);
    assert.equal(cityOf(h.state).project, undefined, `${p.name} is finished`);
    return h.state.objects.find((o) => o.civic && o.plot === p.plot)!;
  };
  assert.equal((await propose('mo', 'a public swimming pool'))?.plot, 'q0_0_-1_-1', 'the first goes north-west, as ever');
  const pool = await finish();
  assert.ok(pool.position.x < 0, 'and goes up in the west half');
  // The old order would have taken the south-east lot next, the river side's other half.
  assert.equal((await propose('zed', 'a railway station'))?.plot, 'q0_0_-1_1', 'the second goes south-west, not across the cross');
  await finish();
  // The west half is full: a third is turned away, though the river side's south-east lot is free.
  assert.equal(await propose('mo', 'a bandstand'), undefined, 'no third project');
  assert.ok(h.state.dudes.find((d) => d.name === 'mo')!.history.some((l) => /no room left/.test(l.text)), 'mo hears the square is full');
  assert.deepEqual(h.state.objects.filter((o) => o.civic).map((o) => o.plot).sort(), ['q0_0_-1_-1', 'q0_0_-1_1', 'q0_0_1_-1'].sort());
  assert.ok(!h.state.objects.some((o) => o.plot === 'q0_0_1_1'), 'the south-east lot stays open');
  assert.equal(old.plot, ne.id, 'the old project keeps its lot');
  assert.deepEqual(old.position, ne.centre);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it all');
});

test("an old Wonder kept as a keepsake goes to the square's west half, never the river side", async () => {
  const { h, tick } = harness();
  const furnace: SafehouseObject = {
    id: 'furnace',
    revision: 1,
    blueprint: { name: 'The Furnace', description: 'a great stone furnace', parts: [{ shape: 'box', position: [0, 1, 0], size: [5, 2, 5], rotation: [0, 0, 0], color: '#886644' }] },
    position: { x: WONDER.x, z: WONDER.z },
    footprint: { width: 5, depth: 5 },
    createdBy: 'the town',
    editedBy: 'the town',
    createdAt: h.now,
    plot: WONDER.plot,
    venue: 'decor',
    civic: true,
    wonder: 0,
  };
  h.state.objects.push(furnace);
  // The next age's Wonder is designed: with both west lots free, the Furnace moves to the first of them.
  assert.ok(proposeWonder(h.state, 1, 'a great stone keep', h.now), 'proposed');
  await tick(1000);
  const keep = cityOf(h.state).project!;
  assert.equal(keep.status, 'gathering', 'designed');
  assert.equal(furnace.plot, 'q0_0_-1_-1');
  assert.deepEqual(furnace.position, plotById('q0_0_-1_-1')!.centre);
  // The Keep goes up, then the age after's Wonder comes. One west lot is left, so the Keep is taken down
  // rather than moved across to the river side (the old rule took any free lot while two were free).
  keep.coins = keep.coinsNeed;
  keep.work = keep.workNeed;
  await tick(1000);
  assert.equal(h.state.objects.find((o) => o.wonder === 1)?.plot, WONDER.plot, 'the Keep stands');
  assert.ok(proposeWonder(h.state, 2, 'a high castle', h.now), 'proposed');
  await tick(1000);
  assert.ok(!h.state.objects.some((o) => o.wonder === 1), 'the Keep made way');
  assert.ok(h.state.feed.some((f) => /is taken down to make way for the new Wonder/.test(f.text)), 'taken down, not moved');
  assert.ok(!h.state.objects.some((o) => o.plot === 'q0_0_1_-1' || o.plot === 'q0_0_1_1'), 'nothing stands on the open half');
  assert.equal(furnace.plot, 'q0_0_-1_-1', 'the Furnace stays where it was kept');
});

test('everyone who turns up gets their own lot, walks over to it, and starts with coins and needs', async () => {
  const { h, say, tick } = harness();
  await say('alex', 'hi');
  await say('blair', 'hello');
  const [a, b] = h.state.dudes;
  assert.ok(a.plot && b.plot && a.plot !== b.plot, 'a.plot && b.plot && a.plot !== b.plot');
  assert.equal(cityOf(h.state).plots[a.plot!].owner, a.id);
  assert.equal(a.coins, TOWN.startCoins);
  assert.ok(a.needs && a.needs.hunger > 0, 'a.needs && a.needs.hunger > 0');
  assert.ok(h.state.feed.some((f) => f.text.startsWith('alex moved into ')), "h.state.feed.some((f) => f.text.startsWith('alex moved into ");
  await tick(40_000);
  // On it, or just off it (lots are small; they may be chatting with the neighbour at the fence).
  const r = plotById(a.plot)!.rect;
  assert.ok(inside(a.position, { minX: r.minX - 2, maxX: r.maxX + 2, minZ: r.minZ - 2, maxZ: r.maxZ + 2 }), `alex is on their lot (${JSON.stringify(a.position)})`);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).s');
});

test('a build goes up on its owner\'s lot, inside it, with what it is for', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  script = [{ do: 'build', what: 'a cosy cafe with a striped awning', kind: 'cafe' }];
  await say('kim', 'I am opening a cafe');
  await tick(80_000);
  const o = h.state.objects[0];
  assert.ok(o, 'built');
  const kim = h.state.dudes[0];
  assert.equal(o.plot, kim.plot);
  assert.equal(o.venue, 'cafe');
  const lot = plotById(kim.plot)!.rect;
  assert.ok(o.position.x - o.footprint.width / 2 >= lot.minX && o.position.x + o.footprint.width / 2 <= lot.maxX, 'inside the lot across');
  assert.ok(o.position.z - o.footprint.depth / 2 >= lot.minZ && o.position.z + o.footprint.depth / 2 <= lot.maxZ, 'inside the lot along');
  // Without a kind, the words decide.
  script = [{ do: 'build', what: 'a little house with a red door' }];
  await say('kim', 'and a house');
  await tick(80_000);
  assert.equal(h.state.objects[1]?.venue, 'home');
});

test('visiting someone else\'s place costs its price, pays the owner, does the visitor good, and an away owner hears about it when they come back', async () => {
  let script: AgentReply['actions'] = [];
  const nudged: string[][] = [];
  const { h, say, tick } = harness({
    reply: (turn) => {
      if (/nudge|happenedToYou/.test(turn.content) && !turn.messages.length) nudged.push(JSON.parse(turn.content).happenedToYou ?? []);
      return { actions: turn.messages.length ? script : [] };
    },
  });
  script = [{ do: 'build', what: 'a bakery', kind: 'bakery' }];
  await say('owner', 'build a bakery');
  await tick(80_000);
  const owner = h.state.dudes[0];
  const bakery = h.state.objects[0];
  assert.equal(bakery.venue, 'bakery');
  // The owner's chatter goes quiet.
  owner.lastHeardAt = h.now - AWAKE_MS - 1000;
  const before = owner.coins!;
  script = [{ do: 'visit', target: bakery.blueprint.name }];
  await say('guest', 'I am hungry, off to the bakery');
  const guest = h.state.dudes.find((d) => d.name === 'guest')!;
  guest.needs!.hunger = 20;
  const guestCoins = guest.coins!;
  await tick(60_000);
  assert.equal(guest.visit, undefined, 'the visit is over');
  assert.ok(guest.needs!.hunger > 40, `fed (${guest.needs!.hunger})`);
  assert.ok(guest.coins! <= guestCoins - 4 + 2, 'paid (less a minute or two of odd jobs)');
  assert.equal(owner.coins, before + 4, 'the owner got the price');
  assert.equal(cityOf(h.state).stats[bakery.id].visits, 1);
  assert.equal(owner.ledger?.visits, 1);
  assert.deepEqual(owner.ledger?.visitors, ['guest']);
  // Back: the ledger becomes something for the agent to react to.
  script = [];
  await say('owner', 'back');
  await tick(1000);
  assert.equal(owner.ledger, undefined);
  assert.ok(owner.history.some((l) => l.from === 'world' && /While you were away/.test(l.text) && /guest/.test(l.text)), "owner.history.some((l) => l.from === 'world' && /While you w");
  assert.ok(h.state.feed.some((f) => /owner is back: 1 visitor/.test(f.text)), 'h.state.feed.some((f) => /owner is back: 1 visitor/.test(f.t');
});

test('nobody walks into someone else\'s home, and a place you cannot afford is a glass of water', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a house', kind: 'home' }];
  await say('host', 'build a house');
  await tick(80_000);
  script = [{ do: 'build', what: 'a fancy restaurant', kind: 'restaurant' }];
  await say('host', 'and a restaurant');
  await tick(80_000);
  const [home, restaurant] = h.state.objects;
  script = [{ do: 'visit', target: home.blueprint.name }];
  await say('nosy', 'let me in');
  await tick(1000);
  const nosy = h.state.dudes.find((d) => d.name === 'nosy')!;
  assert.equal(nosy.visit, undefined);
  assert.ok(nosy.history.some((l) => /home; you cannot just walk in/.test(l.text)), 'nosy.history.some((l) => /home; you cannot just walk in/.tes');
  // Broke: asking for dinner is refused up front; an outing of their own gets water.
  nosy.coins = 0;
  script = [{ do: 'visit', target: restaurant.blueprint.name }];
  await say('nosy', 'dinner time');
  await tick(1000);
  assert.ok(nosy.history.some((l) => /cannot afford/.test(l.text)), 'nosy.history.some((l) => /cannot afford/.test(l.text))');
});

test('a hungry character goes out on their own to the best place for it, preferring somebody else\'s', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  h.state.city!.townies = [];
  script = [{ do: 'build', what: 'a noodle restaurant', kind: 'restaurant' }];
  await say('chef', 'build a noodle bar');
  await tick(80_000);
  script = [];
  await say('eater', 'hi');
  const eater = h.state.dudes.find((d) => d.name === 'eater')!;
  Object.assign(eater.needs!, { hunger: 10, energy: 90, fun: 90, social: 90 });
  let went: string | undefined;
  for (let i = 0; i < 160 && !went; i++) {
    await tick(500);
    if (eater.visit) went = eater.visit.placeId;
  }
  assert.equal(went, h.state.objects[0].id, 'off to the chef\'s restaurant');
  await tick(60_000);
  assert.ok(eater.needs!.hunger > 50, `fed (${eater.needs!.hunger})`);
  assert.ok((cityOf(h.state).stats[h.state.objects[0].id]?.visits ?? 0) >= 1, 'counted');
});

test('a community project: proposed, designed, paid for and built together, then a grand opening and badges', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'propose', what: 'a public swimming pool with a diving board' }];
  await say('mo', 'the town needs a pool');
  await tick(1000);
  const p = cityOf(h.state).project!;
  assert.ok(p, 'proposed');
  assert.equal(p.status, 'gathering', 'designed (the fixture designer answers at once)');
  assert.ok(plotById(p.plot)!.civic, 'plotById(p.plot)!.civic');
  // A second proposal waits its turn.
  script = [{ do: 'propose', what: 'a railway station' }];
  await say('zed', 'and a station');
  await tick(1000);
  assert.ok(h.state.dudes.find((d) => d.name === 'zed')!.history.some((l) => /already building/.test(l.text)), "h.state.dudes.find((d) => d.name === 'zed')!.history.some((l");
  // Money and hands.
  for (const d of h.state.dudes) d.coins = 1000;
  script = [{ do: 'contribute', coins: 1000 }];
  await say('mo', 'here is my money');
  await tick(1000);
  assert.equal(p.coins, p.coinsNeed, 'capped at what it needs');
  script = [{ do: 'help' }];
  await say('mo', 'I will help build it');
  await say('zed', 'me too');
  for (let i = 0; i < 400 && cityOf(h.state).project; i++) await tick(500);
  const pool = h.state.objects.find((o) => o.civic);
  assert.ok(pool, 'built');
  assert.equal(pool!.plot, p.plot);
  assert.equal(cityOf(h.state).done.length, 1);
  const mo = h.state.dudes.find((d) => d.name === 'mo')!;
  const zed = h.state.dudes.find((d) => d.name === 'zed')!;
  assert.ok(mo.badges?.some((b) => b.kind === 'project'), "mo.badges?.some((b) => b.kind === 'project')");
  assert.ok(mo.badges?.some((b) => b.kind === 'host'), "mo.badges?.some((b) => b.kind === 'host')");
  assert.ok(zed.badges?.some((b) => b.kind === 'project'), 'labour counts');
  assert.ok(cityOf(h.state).party, 'grand opening');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).s');
});

test('a lot can be shared: a friend with a key builds there too', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('sam', 'hi');
  script = [{ do: 'share', target: 'sam' }];
  await say('ria', 'move in with me sam');
  await tick(1000);
  const ria = h.state.dudes.find((d) => d.name === 'ria')!;
  assert.deepEqual(cityOf(h.state).plots[ria.plot!].coOwners, ['dev:sam']);
  script = [{ do: 'build', what: 'a garden shed', near: 'ria' }];
  await say('sam', 'I will put a shed at ria\'s');
  await tick(80_000);
  const shed = h.state.objects.find((o) => o.owner === 'dev:sam');
  assert.equal(shed?.plot, ria.plot);
});

test('the town\'s residents turn up, use people\'s places and pay for them', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a busy little cafe', kind: 'cafe' }];
  await say('barista', 'build a cafe');
  const barista = h.state.dudes[0];
  // Keep the owner home and fed, so only residents are custom.
  Object.assign(barista.needs!, { hunger: 100, energy: 100, fun: 100, social: 100 });
  await tick(80_000);
  const cafe = h.state.objects[0];
  const coins = barista.coins!;
  const before = cityOf(h.state).stats[cafe.id]?.visits ?? 0;
  for (let i = 0; i < 1200 && (cityOf(h.state).stats[cafe.id]?.visits ?? 0) <= before; i++) {
    Object.assign(barista.needs!, { hunger: 100, energy: 100, fun: 100, social: 100 });
    await tick(500);
  }
  assert.ok(cityOf(h.state).townies.length >= 2, 'residents arrived');
  assert.ok((cityOf(h.state).stats[cafe.id]?.visits ?? 0) >= 1, 'somebody came in');
  assert.ok(barista.coins! > coins, 'and paid');
});

test('the town notices what it is missing, and streets become known for what is on them', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('a', 'hi');
  assert.ok(wantsOf(h.state, h.now).includes('somewhere to eat'), "wantsOf(h.state, h.now).includes('somewhere to eat')");
  // Two food places on one block: that block becomes a district.
  script = [{ do: 'build', what: 'a cafe', kind: 'cafe' }];
  await say('a', 'cafe');
  await tick(80_000);
  script = [{ do: 'build', what: 'a pizzeria', kind: 'restaurant' }];
  await say('a', 'pizza place too');
  await tick(80_000);
  assert.ok(!wantsOf(h.state, h.now).includes('somewhere to eat'), "!wantsOf(h.state, h.now).includes('somewhere to eat')");
  const districts = districtsOf(h.state);
  assert.equal(districts.length, 1);
  assert.match(districts[0].name, /Food Street|Kitchen Quarter|Supper Row/);
  assert.ok(placesOf(h.state).some((p) => p.id === 'town:market'), 'the square always feeds people');
});


test('chat brings a character out of an outing of their own, and owners use their own places for free', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  h.state.city!.townies = [];
  script = [{ do: 'build', what: 'a house', kind: 'home' }];
  await say('sleepy', 'build a house');
  await tick(80_000);
  const d = h.state.dudes[0];
  const coins = d.coins!;
  Object.assign(d.needs!, { hunger: 90, energy: 5, fun: 90, social: 90 });
  for (let i = 0; i < 120 && !d.hidden; i++) await tick(500);
  assert.equal(d.hidden, true, 'gone home to rest');
  script = [];
  await say('sleepy', 'hello?');
  assert.equal(d.hidden, undefined, 'out again at once');
  assert.equal(d.visit, undefined);
  assert.ok(d.coins! >= coins, 'resting at home costs nothing');
  assert.ok(!d.history.some((l) => /could not pay/.test(l.text)), 'no glass of water at home');
});

test('a chatter can greet one of the town\'s residents', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('friendly', 'hi');
  for (let i = 0; i < 400 && !h.state.city!.townies.length; i++) await tick(500);
  const t = h.state.city!.townies[0];
  assert.ok(t, 'a resident is about');
  script = [{ do: 'greet', target: t.name, how: 'wave' }];
  await say('friendly', `hello ${t.name}`);
  await tick(1000);
  const d = h.state.dudes[0];
  assert.ok(!d.history.some((l) => /there is nobody called/.test(l.text)), 'found them');
  assert.equal(d.meet?.dudeId ?? t.id, t.id);
});

test('the Mayor walks where the operator page says, is drawn while it is open, and the town hears him', async () => {
  const { h, say, tick, world } = harness({ town: true, reply: () => ({ actions: [] }) });
  await say('kim', 'hi');
  await tick(1000);
  const kim = h.state.dudes[0];
  kim.position = { x: 10, z: 10 };
  kim.path = [];
  const view = mayorInput(h.state, { t: 'move', x: 11, z: 10, facing: 0, moving: true, yaw: 1, half: 12 }, h.now)?.view;
  assert.equal(view?.live, true);
  assert.deepEqual(view?.position, { x: 11, z: 10 });
  assert.ok(world.buildScene(h.state, { now: h.now } as never).dudes.some((d) => d.mayor), 'drawn while the operator page is open');
  // Out of bounds is pulled back into town.
  mayorInput(h.state, { t: 'move', x: 9999, z: 0, facing: 0, moving: false }, h.now);
  assert.ok(h.state.mayor!.position.x < 200, 'kept in town');
  mayorInput(h.state, { t: 'move', x: 11, z: 10, facing: 0, moving: false }, h.now);
  // Speaking: overheard nearby, and the named chatter is told directly.
  mayorInput(h.state, { t: 'say', text: 'kim, how is the cafe going?' }, h.now);
  assert.equal(h.state.mayor!.say?.text, 'kim, how is the cafe going?');
  assert.ok(kim.overheard.some((o) => o.from === headName(h.state)), 'overheard (by what this age calls the Mayor)');
  assert.ok(kim.nudges?.some((n) => /The Mayor .* said to you/.test(n)), 'told');
  // Gone quiet: no longer drawn.
  h.now += 60_000;
  assert.ok(!world.buildScene(h.state, { now: h.now } as never).dudes.some((d) => d.mayor), 'gone when the page closes');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'save validates');
});

test('the Mayor can be hidden: not drawn, not heard, the camera carries on', async () => {
  const { h, world } = harness({ town: true });
  const scene = () => world.buildScene(h.state, { now: h.now } as never);
  mayorInput(h.state, { t: 'move', x: 5, z: 5, facing: 0, moving: false }, h.now);
  assert.ok(scene().dudes.some((d) => d.mayor), 'drawn');
  mayorInput(h.state, { t: 'visible', on: false }, h.now);
  assert.ok(!scene().dudes.some((d) => d.mayor), 'hidden');
  assert.equal(scene().mayor?.hidden, true);
  assert.equal(scene().mayor?.live, true, 'the camera still follows him');
  assert.equal(mayorInput(h.state, { t: 'say', text: 'hello?' }, h.now), undefined, 'says nothing while hidden');
  mayorInput(h.state, { t: 'move', x: 8, z: 5, facing: 0, moving: true }, h.now);
  assert.equal(scene().mayor?.position.x, 8, 'still moves (the camera goes with him)');
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  assert.ok(scene().dudes.some((d) => d.mayor), 'back');
});

/** A designer that draws a plain block of the given size, whatever was asked. */
const blockDesign = (size: (input: DesignInput) => number): DesignFn => async (input) => {
  const side = size(input);
  return validateDesign({ action: 'build', reply: 'ok', blueprint: { name: input.request.slice(0, 30), description: 'a block', parts: [{ shape: 'box', position: [0, 1.5, 0], size: [side, 3, side], rotation: [0, 0, 0], color: '#aa8866' }] } }, false);
};

test('a build too big for the room left is shrunk into it, and the designer is told the space', async () => {
  const asked: (number | undefined)[] = [];
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }), design: blockDesign((i) => (asked.push(i.lot), i.request.includes('villa') ? 7 : 6)) });
  script = [{ do: 'build', what: 'a grand villa', kind: 'home' }];
  await say('huseyin', 'Güzel ihtişamlı bir villa yap');
  await tick(80_000);
  script = [{ do: 'build', what: 'a pool with a dog kennel', kind: 'decor' }];
  await say('huseyin', 'Bahçede küçük bir havuz ve yanında güzel bir köpek kulübesi');
  await tick(80_000);
  assert.equal(h.state.objects.length, 2, 'both went up');
  assert.ok(asked[0]! >= CITY.plot - 2, `an empty lot is offered whole (${asked[0]})`);
  assert.ok(asked[1]! < CITY.plot - 2, `the second design is asked for the room that is left (${asked[1]})`);
  const pool = h.state.objects[1];
  assert.ok(pool.footprint.width < 6, `shrunk to fit (${pool.footprint.width})`);
});

test('a build that cannot fit at all is said so, in the feed and by the character', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }), design: blockDesign(() => 30) });
  script = [{ do: 'build', what: 'a huge villa', kind: 'home' }];
  await say('huseyin', 'build a huge villa');
  await tick(80_000);
  script = [{ do: 'build', what: 'a pool', kind: 'decor' }];
  await say('huseyin', 'build a pool');
  await tick(40_000);
  const d = h.state.dudes[0];
  assert.ok(h.state.feed.some((f) => /didn't fit on their lot/.test(f.text)), 'in the feed');
  assert.ok(d.history.some((l) => /could not go up/.test(l.text)), 'the character knows');
});

test('an agent does not knock a build down to make room unless asked', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a villa', kind: 'home' }];
  await say('huseyin', 'build a villa');
  await tick(80_000);
  const villa = h.state.objects[0];
  script = [{ do: 'remove', target: villa.blueprint.name }, { do: 'build', what: 'a pool', kind: 'decor' }];
  await say('huseyin', 'a pool in the garden of my villa');
  await tick(80_000);
  assert.ok(h.state.objects.some((o) => o.id === villa.id), 'the villa is still there');
});

test('while a build is being designed, its builder is at the site on their lot with the plans out', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({
    reply: (turn) => ({ actions: turn.messages.length ? script : [] }),
    design: async (input, signal) => {
      await gate;
      return blockDesign(() => 6)(input, signal);
    },
  });
  script = [{ do: 'build', what: 'a cosy cafe', kind: 'cafe' }];
  await say('kim', 'build a cafe');
  await tick(45_000);
  const view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.name === 'kim')!;
  assert.equal(view.job?.status, 'designing');
  assert.equal(view.activity, 'designing', 'drafting at the site');
  const lot = plotById(h.state.dudes[0].plot)!.rect;
  assert.ok(inside(view.job!.at!, lot), 'the site is on their lot');
  release();
  await tick(60_000);
  assert.equal(h.state.objects.length, 1, 'and then it goes up');
});

test('builds that move: a donkey roams, a car drives the roads, a spaceship flies over; the save keeps them', async () => {
  const wants: Record<string, string> = { sami: 'a grey donkey that roams the streets', kim: 'a red car that drives around town', mo: 'a little spaceship that flies around' };
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? [{ do: 'build', what: wants[turn.name], kind: 'decor' }] : [] }) });
  for (const name of Object.keys(wants)) await say(name, `build ${wants[name]}`);
  await tick(80_000);
  const byWord = (w: string) => h.state.objects.find((o) => o.blueprint.name.toLowerCase().includes(w))!;
  const donkey = byWord('donkey'),
    car = byWord('car'),
    ship = byWord('spaceship');
  assert.equal(donkey?.blueprint.moves, 'roam');
  assert.equal(car?.blueprint.moves, 'drive');
  assert.equal(ship?.blueprint.moves, 'fly');
  assert.ok(donkey.passable && car.passable, 'never in anyone\'s way');
  const start = { donkey: { ...donkey.position }, car: { ...car.position } };
  await tick(40_000);
  assert.ok(Math.hypot(donkey.position.x - start.donkey.x, donkey.position.z - start.donkey.z) > 1, 'the donkey wandered');
  assert.ok(Math.hypot(car.position.x - start.car.x, car.position.z - start.car.z) > 10, 'the car drove off');
  assert.ok((ship.creature?.altitude ?? 0) > 5, 'the spaceship is up');
  assert.ok(!placesOf(h.state).some((p) => p.id === donkey.id), 'not a place to visit');
  const saved = stateSchema.safeParse(JSON.parse(JSON.stringify(h.state)));
  assert.ok(saved.success, 'save validates');
  assert.ok(saved.data!.objects.find((o) => o.id === car.id)?.creature, 'and keeps them moving after a restart');
});

test('a chatter can ride the donkey, and it carries on wandering when they get off', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a donkey that roams the streets', kind: 'decor' }];
  await say('sami', 'donkey please');
  await tick(80_000);
  const donkey = h.state.objects[0];
  script = [{ do: 'use', target: 'donkey', how: 'ride' }];
  await say('kim', 'ride the donkey');
  let rode = false;
  for (let i = 0; i < 120 && !rode; i++) {
    await tick(500);
    rode = h.state.dudes.find((d) => d.name === 'kim')!.riding === donkey.id;
  }
  assert.ok(rode, 'aboard');
  script = [{ do: 'stop' }];
  await say('kim', 'get off');
  await tick(2000);
  assert.equal(h.state.dudes.find((d) => d.name === 'kim')!.riding, undefined);
  const at = { ...donkey.position };
  await tick(30_000);
  assert.equal(donkey.driven, undefined, 'back on its own');
  assert.ok(Math.hypot(donkey.position.x - at.x, donkey.position.z - at.z) > 1, 'and wandering again');
});

test('the Mayor gets on the nearest ride, steers it, and gets off; it goes back to roaming', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a donkey that roams the streets', kind: 'decor' }];
  await say('sami', 'donkey please');
  await tick(80_000);
  const donkey = h.state.objects[0];
  // Too far: nothing to get on.
  mayorInput(h.state, { t: 'move', x: donkey.position.x + 30, z: donkey.position.z, facing: 0, moving: false }, h.now);
  assert.equal(mayorInput(h.state, { t: 'ride' }, h.now), undefined, 'nothing in reach');
  mayorInput(h.state, { t: 'move', x: donkey.position.x + 1, z: donkey.position.z, facing: 0, moving: false }, h.now);
  const on = mayorInput(h.state, { t: 'ride' }, h.now)?.view;
  assert.equal(on?.riding?.id, donkey.id, 'aboard');
  const view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.mayor)!;
  assert.ok((view.y ?? 0) > 0 && view.riding === donkey.id, 'sat on it');
  mayorInput(h.state, { t: 'move', x: donkey.position.x + 5, z: donkey.position.z + 5, facing: 1, moving: true }, h.now);
  await tick(2000);
  assert.ok(Math.abs(donkey.driven!.at.x - h.state.mayor!.position.x) < 0.01, 'it goes where he steers');
  assert.equal(donkey.creature!.moving, false, 'and does not wander off under him');
  const off = mayorInput(h.state, { t: 'ride' }, h.now)?.view;
  assert.equal(off?.riding, undefined, 'off again');
  const at = { ...h.state.mayor!.position };
  await tick(30_000);
  assert.equal(donkey.driven, undefined, 'back on its own');
  assert.ok(Math.hypot(donkey.position.x - at.x, donkey.position.z - at.z) > 1, 'wandering again');
});

test('the Mayor builds: a gift on a chatter\'s lot is theirs, a clicked street spot is the town\'s; no builder walks over', async () => {
  const { h, say, tick, world } = harness({ reply: () => ({ actions: [] }) });
  await say('kim', 'hi');
  await tick(1000);
  const kim = h.state.dudes[0];
  mayorInput(h.state, { t: 'move', x: 0, z: 9, facing: 0, moving: false }, h.now);
  mayorInput(h.state, { t: 'build', what: 'a little garden fountain', for: 'kim' }, h.now);
  mayorInput(h.state, { t: 'build', what: 'a donkey that roams the streets', at: { x: 20, z: 20 } }, h.now);
  await tick(1000);
  const scene = world.buildScene(h.state, { now: h.now } as never);
  assert.ok((scene.mayorBuilds?.length ?? 0) >= 1, 'in flight, for the page');
  await tick(20_000);
  const gift = h.state.objects.find((o) => /fountain/i.test(o.blueprint.name));
  const donkey = h.state.objects.find((o) => /donkey/i.test(o.blueprint.name));
  assert.ok(gift && donkey, 'both went up');
  assert.equal(gift!.owner, kim.id, 'the gift is kim\'s');
  assert.equal(gift!.plot, kim.plot, 'on kim\'s lot');
  assert.equal(gift!.createdBy, 'The Mayor');
  assert.equal(donkey!.owner, undefined, 'the street donkey is the town\'s');
  assert.equal(donkey!.blueprint.moves, 'roam', 'and it roams');
  assert.ok(kim.history.some((l) => l.text.includes(`${headName(h.state)} built you`)), 'kim is told');
  assert.ok(h.state.feed.some((f) => new RegExp(`${headName(h.state)} built .* for kim`).test(f.text)), 'in the feed');
});

test('a basketball court is for shooting hoops: chatters play there when asked, the Mayor has a go with T, shouts float up', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a basketball court with two hoops', kind: 'park' }];
  await say('kim', 'build a basketball court');
  await tick(80_000);
  const court = h.state.objects[0];
  assert.ok(/basketball/i.test(court.blueprint.name), 'built');
  const place = placesOf(h.state).find((p) => p.id === court.id)!;
  assert.equal(place.spec.visit, 'play', 'a place you do something at');
  assert.equal(place.spec.pose, 'shoot');
  script = [{ do: 'play', target: 'hoops' }];
  await say('mo', 'lets shoot some hoops');
  const mo = h.state.dudes.find((d) => d.name === 'mo')!;
  let shooting = false;
  for (let i = 0; i < 160 && !shooting; i++) {
    await tick(500);
    shooting = mo.visit?.phase === 'in' && mo.emote?.pose === 'shoot';
  }
  assert.ok(shooting, 'mo is shooting hoops');
  assert.ok(h.state.effects?.some((e) => e.kind === 'pop' && e.label === 'SWISH'), 'SWISH');
  // The Mayor: too far does nothing; beside it, T puts him on the court in the pose.
  mayorInput(h.state, { t: 'move', x: court.position.x + 60, z: court.position.z, facing: 0, moving: false }, h.now);
  assert.equal(mayorInput(h.state, { t: 'play' }, h.now), undefined, 'nothing in reach');
  mayorInput(h.state, { t: 'move', x: court.position.x + court.footprint.width / 2 + 1, z: court.position.z, facing: 0, moving: false }, h.now);
  const view = mayorInput(h.state, { t: 'play' }, h.now)?.view;
  assert.equal(view?.emote?.pose, 'shoot', 'the Mayor shoots hoops');
  assert.ok((view?.moved ?? 0) > 0, 'and was put on the court');
  const figure = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.mayor)!;
  assert.equal(figure.emote?.pose, 'shoot');
  mayorInput(h.state, { t: 'move', x: court.position.x + 20, z: court.position.z, facing: 0, moving: true }, h.now);
  assert.equal(h.state.mayor!.playing, undefined, 'walking off stops it');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'save validates');
});

test('bits: chat asks for something no action covers, and the character acts it out (the Mayor too)', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('notjoker', 'hi');
  await tick(1000);
  const nj = h.state.dudes[0];
  nj.path = [];
  nj.position = { x: 30, z: 30 };
  mayorInput(h.state, { t: 'move', x: 0, z: 9, facing: 0, moving: false }, h.now);
  // A placard at the Mayor, with a swing at the end: he stumbles.
  script = [{ do: 'bit', caption: 'is protesting the Mayor', to: 'the Mayor', steps: [{ pose: 'point', seconds: 2 }, { pose: 'punch', seconds: 1.5 }], prop: 'sign', sign: 'CLOSE THE STAND' }];
  await say('notjoker', 'protest the mayor');
  await tick(1000);
  let view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.name === 'notjoker')!;
  assert.equal(view.bit?.caption, 'is protesting the Mayor', 'the caption is on the tag');
  assert.equal(view.bit?.prop, 'sign');
  let staggered = false,
    placard = false;
  for (let i = 0; i < 80 && nj.bit; i++) {
    mayorInput(h.state, { t: 'move', x: 0, z: 9, facing: 0, moving: false }, h.now);
    await tick(500);
    placard ||= !!nj.say?.placard && nj.say.text === 'CLOSE THE STAND';
    staggered ||= h.state.mayor?.emote?.pose === 'stagger';
  }
  assert.ok(Math.hypot(nj.position.x, nj.position.z - 9) < 3, 'walked over to the Mayor');
  assert.ok(placard, 'held up the placard');
  assert.ok(staggered, 'the Mayor stumbled');
  assert.equal(nj.bit, undefined, 'and it ended');
  // A teleport and a hat for the Mayor.
  nj.position = { x: -40, z: -40 };
  script = [{ do: 'bit', caption: 'crowns the Mayor', to: 'the Mayor', teleport: true, giveHat: 'crown', steps: [{ pose: 'bow', seconds: 1 }] }];
  await say('notjoker', 'teleport to the mayor and give him a crown');
  await tick(1000);
  assert.ok(Math.hypot(nj.position.x, nj.position.z - 9) < 3, 'teleported');
  assert.ok(h.state.effects?.some((e) => e.kind === 'burst' && e.label === 'smoke'), 'in a puff of smoke');
  await tick(3000);
  const mayor = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.mayor)!;
  assert.equal(mayor.look.hat, 'crown', 'the Mayor is wearing the crown');
  // Somewhere that does not exist: done where they stand, and told.
  script = [{ do: 'bit', caption: 'hunts the town zombie', to: 'the zombie', steps: [{ pose: 'think', seconds: 1 }] }];
  await say('notjoker', 'hunt down the town zombie');
  await tick(1000);
  assert.ok(nj.history.some((l) => /nobody and nothing called "the zombie"/.test(l.text)), 'told it is not there');
  assert.ok(nj.bit, 'but acted out anyway');
  const saved = stateSchema.safeParse(JSON.parse(JSON.stringify(h.state)));
  assert.ok(saved.success, `save validates: ${saved.error?.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
});

test('bit phrasing parses: steps, props, signs, bursts, teleport, hats', () => {
  const r = normalizeAgentReply({ actions: [{ do: 'act', caption: 'founds a teleport cult', to: 'square', steps: [{ pose: 'cast', seconds: 9, say: 'Join us' }, 'cheer', { pose: 'nonsense' }], prop: 'banner', sign: 'atoms optional', burst: 'magic' }, { do: 'teleport', to: 'Teleport Tacos', caption: 'teleports' }, { do: 'bit', caption: 'hats the mayor', to: 'the mayor', giveHat: 'top hat', steps: [] }] });
  assert.deepEqual(r.actions[0], { do: 'bit', caption: 'founds a teleport cult', to: 'square', steps: [{ pose: 'cast', seconds: 6, say: 'Join us' }, { pose: 'cheer', seconds: 3 }], prop: 'sign', sign: 'ATOMS OPTIONAL', burst: 'sparkles' });
  assert.equal((r.actions[1] as { teleport?: boolean }).teleport, true);
  assert.equal((r.actions[2] as { giveHat?: string }).giveHat, 'tophat');
});

test('the chatter\'s own words reach the designer, so "it must drive around and fly" survives the agent\'s rewording', async () => {
  const seen: DesignInput[] = [];
  const { h, say, tick } = harness({
    reply: (turn) => ({ actions: turn.messages.length ? [{ do: 'build', what: 'a sleek red and black Tesla Roadster with a low-slung body', kind: 'decor' }] : [] }),
    design: async (input, signal) => {
      seen.push(input);
      return blockDesign(() => 4)(input, signal);
    },
  });
  await say('nocoso', 'build me the new tesla roadster and it must drive around and fly');
  await tick(80_000);
  assert.equal(seen[0]?.asked, 'build me the new tesla roadster and it must drive around and fly', 'the designer saw their words');
  const car = h.state.objects[0];
  assert.equal(car?.blueprint.moves, 'fly', 'and it flies about town, though the agent left that out');
});

test('flying: a helicopter takes off when flown and lands when left; the Mayor sets the height; riders sit inside', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({
    reply: (turn) => ({ actions: turn.messages.length ? script : [] }),
    design: async (input, signal) => {
      // A 5 m tall helicopter-ish block with a name that says what it is.
      const r = await blockDesign(() => 5)(input, signal);
      if (r.action !== 'decline') {
        r.blueprint.name = input.request.includes('helicopter') ? 'Red Helicopter' : 'Old Donkey';
        r.blueprint.parts[0].size[1] = 5;
        r.blueprint.parts[0].position[1] = 2.5;
      }
      return r;
    },
  });
  script = [{ do: 'build', what: 'a red helicopter', kind: 'decor' }];
  await say('pilot', 'build a helicopter');
  await tick(80_000);
  const heli = h.state.objects[0];
  assert.ok(flies(heli), 'it can fly');
  assert.equal(heli.blueprint.moves, undefined, 'but does not fly about on its own');
  script = [{ do: 'use', target: 'helicopter', how: 'drive', to: 'square' }];
  await say('pilot', 'fly the helicopter to the square');
  let up = 0;
  const pilot = h.state.dudes[0];
  for (let i = 0; i < 60; i++) {
    await tick(500);
    up = Math.max(up, altitudeOf(heli));
    if (pilot.riding) assert.ok((pilot.y ?? 0) < altitudeOf(heli) + 2.6, 'sat in it, not on its roof');
  }
  assert.ok(up >= 5, `it took off (${up.toFixed(1)} m)`);
  script = [{ do: 'stop' }];
  await say('pilot', 'land');
  await tick(1500);
  assert.equal(altitudeOf(heli), 0, 'and landed');
  // The Mayor flies it, as high as his page says, and it lands when he gets off.
  mayorInput(h.state, { t: 'move', x: heli.driven?.at.x ?? heli.position.x, z: (heli.driven?.at.z ?? heli.position.z) + 2, facing: 0, moving: false }, h.now);
  const on = mayorInput(h.state, { t: 'ride' }, h.now)?.view;
  assert.equal(on?.riding?.moves, 'fly');
  mayorInput(h.state, { t: 'move', x: on!.position.x + 3, z: on!.position.z, facing: 0, moving: true, alt: 14 }, h.now);
  assert.equal(altitudeOf(heli), 14, 'up where he took it');
  const seat = seatHeight(heli, false, false);
  assert.ok(seat < 2, `in the cabin, not on top (${seat.toFixed(2)} m of a 5 m machine)`);
  mayorInput(h.state, { t: 'ride' }, h.now);
  assert.equal(altitudeOf(heli), 0, 'down when he gets off');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'save validates');
});

test('a build is not made twice when the agent repeats an earlier message on its next turn (the double McDonald\'s)', async () => {
  // Reproduces 2026-10-22: "Can I have a mcdonalds?", then while it was being designed "Also get rid
  // of my cave"; the second turn asked for the restaurant again alongside the removal.
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a cosy stone cave home', kind: 'home' }];
  await say('sami', 'build me a cave');
  await tick(80_000);
  const cave = h.state.objects.find((o) => o.venue === 'home')!;
  assert.ok(cave, 'the cave went up');
  script = [{ do: 'build', what: 'a modern fast-food restaurant with a red and yellow exterior', kind: 'restaurant' }];
  await say('sami', 'Can I have a mcdonalds?');
  await tick(1000);
  script = [
    { do: 'build', what: 'a bright modern fast-food restaurant with red and yellow exterior and golden arches', kind: 'restaurant' },
    { do: 'remove', target: cave.blueprint.name },
  ];
  await say('sami', 'Also get rid of my cave');
  await tick(80_000);
  const restaurants = h.state.objects.filter((o) => o.venue === 'restaurant');
  assert.equal(restaurants.length, 1, `one restaurant, not two (${restaurants.map((o) => o.blueprint.name).join(', ')})`);
  assert.ok(!h.state.objects.some((o) => o.id === cave.id), 'and the cave came down: "get rid of" is asking');
  const dude = h.state.dudes[0];
  assert.ok(dude.history.some((l) => /did not build .* again/.test(l.text)), 'the agent is told why');
  // Asking for another one still works.
  script = [{ do: 'build', what: 'a bright modern fast-food restaurant with red and yellow exterior', kind: 'restaurant' }];
  await say('sami', 'build another one of those');
  await tick(80_000);
  assert.equal(h.state.objects.filter((o) => o.venue === 'restaurant').length, 2, '"another" builds a second');
});

test('anyone can build on any lot but the square: a street, a friend’s lot, a free lot; their own when they say nowhere', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('ana', 'hi');
  await say('ben', 'hi');
  await tick(1000);
  const ana = h.state.dudes.find((d) => d.name === 'ana')!,
    ben = h.state.dudes.find((d) => d.name === 'ben')!;
  /** Ana asks for a build; the lot its job went on (undefined when refused). */
  const build = async (what: string, near?: string) => {
    script = [{ do: 'build', what, kind: 'decor', ...(near ? { near } : {}) }];
    await say('ana', what);
    await tick(500);
    return h.state.jobs.find((j) => j.request === what)?.plot;
  };
  assert.equal(await build('a shed'), ana.plot, 'said nowhere: their own lot');
  assert.equal(await build('a fountain', 'the square'), undefined, 'never the square');
  assert.ok(ana.history.some((l) => /square is kept for community projects/.test(l.text)), 'and they are told why');
  assert.equal(await build('a birdhouse', "ben's lot"), ben.plot, "on ben's lot");
  assert.ok(ben.history.some((l) => /ana is building a birdhouse on your lot/.test(l.text)), 'ben hears about it');
  const street = homePlots().find((l) => l.id !== ana.plot && l.id !== ben.plot && !cityOf(h.state).plots[l.id])!.address.replace(/^\d+\s+/, '');
  assert.ok(plotById(await build('a kiosk', street))!.address.endsWith(street), 'on the street named');
  const windmill = (await build('a windmill', 'a free lot'))!;
  assert.ok(!cityOf(h.state).plots[windmill] && !plotById(windmill)!.civic, 'on a free lot');
});

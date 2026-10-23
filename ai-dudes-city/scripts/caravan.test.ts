// The caravan (slice 2 v1): it arrives with the first chatter, its asks fill from what happens in
// town, the specialist settles, and finishing the third visit moves the town into the next age.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { ageOf, cityOf, setAge, wonderCost } from '../src/worlds/ai-dudes/city';
import { WONDER } from '../src/shared/city';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';

test('the caravan arrives, its asks fill from the town, and the third visit moves the age on', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('kim', 'hi');
  await tick(2000);
  const cv = cityOf(h.state).caravan!;
  assert.ok(cv, 'the caravan made camp');
  assert.ok(cv.stranded, 'stuck across the river');
  // The Stone Age band starts stuck across the river: mend the bridge and let them cross first.
  skipVisit(h.state, h.now);
  await tick(21_000);

  assert.equal(cv.visit, 0);
  assert.ok(cityOf(h.state).townies.some((t) => t.leader), 'its leader is in town');
  assert.ok(world.buildScene(h.state, { now: h.now } as never).town?.caravan?.asks.length, 'the board shows the asks');
  // A new place to eat counts; so does feeding a traveller there.
  script = [{ do: 'build', what: 'a roasting pit restaurant', kind: 'restaurant' }];
  await say('kim', 'build a restaurant');
  await tick(80_000);
  // They walk in from the river now, right across town, so give them a while to get there.
  for (let i = 0; i < 24 && cv.visit === 0 && !(cv.asks.find((a) => a.id === 'fed')?.have ?? 0); i++) await tick(10_000);
  // The travellers wait on the square; one goes to eat at the new restaurant, which counts twice over.
  assert.ok(cv.visit >= 1 || cv.asks.find((a) => a.id === 'food')!.have >= 1, 'the new restaurant counted');
  assert.ok(cv.visit >= 1 || cv.asks.find((a) => a.id === 'fed')!.have >= 1, 'a traveller ate there');
  // The rest by hand, visit by visit, until the Wonder moves the age on (the specialist settles on the way).
  for (let i = 0; i < 6 && ageOf(h.state) === 0; i++) {
    skipVisit(h.state, h.now);
    await tick(40_000);
  }
  assert.ok(cityOf(h.state).townies.some((t) => t.name === 'Kesa the Potter'), 'the specialist settled');
  assert.equal(ageOf(h.state), 1, 'the town moved into the Bronze Age');
  // The age turns on screen: the Stone Age band is still about (no vanishing mid-confetti), and they head home.
  const turning = cityOf(h.state).caravan!;
  assert.equal(turning.age, 0, 'the old caravan stays for the goodbye');
  assert.ok(turning.turn, 'the age is turning');
  assert.ok(cityOf(h.state).townies.some((t) => t.traveller && t.leader), 'the old leader is still here');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps a turn under way');
  // A breather, then the next caravan walks in from the camp and its first visit opens once they're across.
  for (let i = 0; i < 20 && cityOf(h.state).caravan!.age === 0; i++) await tick(10_000);
  const next = cityOf(h.state).caravan!;
  assert.equal(next.age, 1, 'and the Bronze Age caravan arrived');
  assert.equal(cityOf(h.state).scene?.id, 'arrival', 'walking in, with a line from the daughter');
  await tick(20_000);
  assert.ok(next.asks.length, 'its first visit is open');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it all');
});

test("the Wonder: the leader proposes it, only it finishes the ask, it goes up in the middle of the square, and the next age's replaces it", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('kim', 'hi');
  await tick(2000);
  skipVisit(h.state, h.now); // the bridge
  await tick(21_000);
  skipVisit(h.state, h.now); // visit one
  await tick(25_000);
  skipVisit(h.state, h.now); // visit two
  await tick(25_000);
  const cv = cityOf(h.state).caravan!;
  assert.equal(cv.visit, 2, 'the Wonder visit');
  const p = cityOf(h.state).project!;
  assert.equal(p?.wonder, 0, "the leader proposed the age's Wonder");
  assert.equal(p.plot, WONDER.plot, 'on its own spot, not a community lot');
  assert.ok(p.coinsNeed >= wonderCost(0, 1).coins, 'priced for the age');
  assert.ok(wonderCost(5, 3).coins > wonderCost(0, 3).coins * 2, 'later Wonders cost more');
  // Paid for and built by the town: it stands in the middle of the square and the age turns.
  for (const d of h.state.dudes) d.coins = 5000;
  script = [{ do: 'contribute', coins: 5000 }];
  await say('kim', 'take my money');
  await tick(1000);
  script = [{ do: 'help' }];
  await say('kim', 'I will help build it');
  for (let i = 0; i < 600 && ageOf(h.state) === 0; i++) await tick(1000);
  const furnace = h.state.objects.find((o) => o.wonder === 0)!;
  assert.ok(furnace, 'the Furnace stands');
  assert.equal(furnace.plot, WONDER.plot);
  assert.deepEqual(furnace.position, { x: WONDER.x, z: WONDER.z });
  assert.equal(ageOf(h.state), 1, 'and the age turned');
  assert.equal(cityOf(h.state).scene?.id, 'ageTurn');
  assert.ok(cityOf(h.state).heroes?.some((x) => x.age === 0 && x.names.includes('kim')), 'kim is a hero of the Stone Age');
  // Into the Bronze Age's Wonder visit: a chat project does not finish it; the Keep replaces the Furnace.
  for (let i = 0; i < 20 && cityOf(h.state).caravan!.age === 0; i++) await tick(10_000);
  await tick(20_000);
  skipVisit(h.state, h.now);
  await tick(25_000);
  skipVisit(h.state, h.now);
  await tick(25_000);
  const keep = cityOf(h.state).project!;
  assert.equal(keep.wonder, 1);
  assert.ok(!h.state.objects.some((o) => o.plot === WONDER.plot && o.wonder === 0), 'the Furnace made way');
  assert.ok(h.state.objects.some((o) => o.wonder === 0), 'kept as a keepsake on a free community lot');
  assert.equal(cityOf(h.state).caravan!.asks[0].have, 0, 'not done until the Keep stands');
  // Say chat's own project got in first: it goes up, and the Wonder ask is still open.
  cityOf(h.state).project = undefined;
  script = [{ do: 'propose', what: 'a bandstand' }];
  await say('kim', 'the town needs a bandstand');
  await tick(1000);
  assert.equal(cityOf(h.state).project?.wonder, undefined, "chat's project");
  script = [{ do: 'contribute', coins: 5000 }];
  await say('kim', 'take my money');
  await tick(1000);
  script = [{ do: 'help' }];
  await say('kim', 'I will help build it');
  for (let i = 0; i < 600 && cityOf(h.state).project?.wonder === undefined && cityOf(h.state).project; i++) await tick(1000);
  assert.ok(h.state.objects.some((o) => o.civic && o.wonder === undefined), 'the bandstand stands');
  assert.equal(ageOf(h.state), 1, 'and the age did not turn for it');
  await tick(61_000);
  assert.equal(cityOf(h.state).project?.wonder, 1, 'the leader puts the Keep forward again');
});

test('a "build" ask counts a place done up since the visit opened, and a town with places to eat needs fewer new ones', async () => {
  const { h, say, tick } = harness({ town: true, reply: () => ({ actions: [] }) });
  await say('kim', 'hi');
  await tick(2000);
  const stand = (id: string, venue: 'restaurant' | 'cafe') =>
    h.state.objects.push({ id, revision: 1, blueprint: { name: id, description: id, parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], color: '#888888' }] }, position: { x: 30 + h.state.objects.length * 3, z: 30 }, footprint: { width: 1, depth: 1 }, createdBy: 'kim', editedBy: 'kim', createdAt: h.now, venue } as never);
  for (let i = 0; i < 6; i++) stand(`b${i}`, i % 2 ? 'cafe' : 'restaurant');
  skipVisit(h.state, h.now); // the bridge
  await tick(21_000);
  const cv = cityOf(h.state).caravan!;
  const food = cv.asks.find((a) => a.id === 'food')!;
  assert.equal(food.need, 1, 'six places to eat already: one more (or one done up) will do');
  assert.match(food.label, /do up/);
  h.state.objects[0].revision++;
  await tick(1000);
  assert.ok(food.have >= 1 || cv.visit > 0, 'doing one up counted');
});

test("the Mayor reworks a chatter's build in place: redesigned with the change, still theirs", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a stone castle', kind: 'decor' }];
  await say('kim', 'build me a castle');
  await tick(80_000);
  const castle = h.state.objects[0];
  const at = { ...castle.position };
  mayorInput(h.state, { t: 'edit', target: castle.id, change: 'put a trebuchet on the wall' }, h.now);
  assert.ok(h.state.jobs.some((j) => j.dudeId === 'mayor' && j.kind === 'edit' && j.targetId === castle.id), 'a rework job');
  await tick(30_000);
  assert.equal(castle.revision, 2, 'redesigned');
  assert.equal(castle.owner, h.state.dudes[0].id, 'still kim’s');
  assert.deepEqual(castle.position, at, 'where it stood');
  assert.ok(h.state.dudes[0].history.some((l) => /reworked your/.test(l.text)), 'kim hears about it');
});

test('a chatter can throw a party (and the caravan counts it)', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('kim', 'hi');
  await tick(2000);
  // The Stone Age band starts stuck across the river: mend the bridge and let them cross first.
  skipVisit(h.state, h.now);
  await tick(21_000);
  skipVisit(h.state, h.now); // on to visit two: the smithy, the shifts, the party
  await tick(25_000);
  const party = cityOf(h.state).caravan!.asks.find((a) => a.kind === 'party')!;
  assert.ok(party, 'visit two wants a party');
  script = [{ do: 'party', at: 'square' }];
  await say('kim', 'throw a party on the square!');
  await tick(1000);
  assert.ok(cityOf(h.state).party, 'a party is on');
  assert.equal(party.have, 1, 'and the caravan counted it');
  // Not twice in a row.
  await say('kim', 'another party!');
  await tick(1000);
  assert.ok(h.state.dudes[0].history.some((l) => /already a party on|only a few minutes ago/.test(l.text)));
});

test('when the age moves on, older builds are remade for it in the background, in place', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a cosy hut', kind: 'home' }, { do: 'build', what: 'a fire pit cafe', kind: 'cafe' }];
  await say('kim', 'build me a hut and a cafe');
  await tick(120_000);
  assert.equal(h.state.objects.length, 2);
  for (const o of h.state.objects) assert.equal(o.age, 0, 'made in the Stone Age');
  const before = h.state.objects.map((o) => ({ id: o.id, at: { ...o.position }, owner: o.owner }));
  setAge(h.state, 1, h.now);
  await tick(60_000);
  for (const o of h.state.objects) {
    const was = before.find((b) => b.id === o.id)!;
    assert.equal(o.age, 1, `${o.blueprint.name} remade for the Bronze Age`);
    assert.equal(o.revision, 2);
    assert.equal(o.owner, was.owner, 'still its owner’s');
  }
  assert.ok(!h.state.jobs.some((j) => j.dudeId === 'town' && j.status !== 'done' && j.status !== 'failed'), 'nothing left in flight');
});

// Troublemakers. Every few minutes someone who is not a chatter runs onto the field and does
// something the whole chat has to deal with: repaints builds, squashes them, tows them to the
// edge, steals hats, or issues a decree and comes back to check. Zero AI calls of their own: the
// lines and the plans are the app's. What makes it land is that every character it touched gets a
// nudge, and its agent reacts on a turn of its own (index.ts), and the fixes are real actions:
// `use … fix` restores a build, a towed build is driven back, the hat pile hands hats back.
import type { Blueprint, GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import type { DudeLook, HappeningView } from '../../shared/dudesTypes';
import { clampToGround, route } from './placement'; // hook FK-078 (GROUND no longer needed here)
import { choosePlacement } from './placement';
import { CITY_BOUNDS } from '../../shared/city'; // hook FK-078
import { measureBlueprint } from './blueprint';
import { damageNote, heal } from './damage';
import { addEffect, awake, face, inUse, parkObject, shake, step } from './sim';
import { LIMITS, nextId, pushFeed, pushLine, type Dude, type DudesState, type Npc, type NpcKind, type NpcStep } from './state';

export const EVENTS = {
  firstAfterMs: 2 * 60_000, // after the field wakes up
  gapMs: [4 * 60_000, 7 * 60_000] as const,
  minAwake: 1, // nobody to bother, nobody comes
  victims: 5, // builds or characters one troublemaker gets through
  decreeMs: 3 * 60_000,
  runSpeed: 4.2,
  walkSpeed: 2.2,
  towSpeed: 2,
};

const LOOKS: Record<NpcKind, DudeLook> = {
  painter: { skin: '#e0ac85', shirt: '#f2f0e8', pants: '#f2f0e8', hair: '#5a3a22', hat: 'cap', hatColor: '#ff3fd2', accessory: 'toolbelt', accessoryColor: '#7dff3a', height: 1.02, build: 1 },
  squasher: { skin: '#c68b5f', shirt: '#6a3a2a', pants: '#2f3236', hair: '#1d1d1d', hat: 'helmet', hatColor: '#e2c14a', accessory: 'none', accessoryColor: '#000000', height: 1.15, build: 1.2 },
  tow: { skin: '#f1c9a5', shirt: '#e07a4a', pants: '#3a4a5e', hair: '#a8743a', hat: 'beanie', hatColor: '#e07a4a', accessory: 'toolbelt', accessoryColor: '#3a3a3a', height: 1.05, build: 1.1 },
  thief: { skin: '#d8a07a', shirt: '#2a2a2a', pants: '#2a2a2a', hair: '#2b2018', hat: 'beanie', hatColor: '#2a2a2a', accessory: 'backpack', accessoryColor: '#5a3a22', height: 0.9, build: 0.9 },
  mayor: { skin: '#f5d6c0', shirt: '#3a2f5e', pants: '#2a2a2a', hair: '#7a7a7a', hat: 'tophat', hatColor: '#1d1d1d', accessory: 'scarf', accessoryColor: '#c4402f', height: 1.0, build: 1.1 },
};
const NAMES: Record<NpcKind, string> = {
  painter: 'Gary the Painter',
  squasher: 'Big Steve',
  tow: 'The Tow Guy',
  thief: 'Sticky Mick',
  mayor: 'Councillor Pemberton',
};
/** The same five sorts of trouble, as each age has them (stone, bronze, medieval, industrial; the Modern age uses NAMES; the Wasteland last). */
const AGE_NAMES: Partial<Record<number, Record<NpcKind, string>>> = {
  0: { painter: 'Ochre Ug', squasher: 'Big Grak', tow: 'The Dragger', thief: 'Sticky Ug', mayor: 'Elder Bramm' },
  1: { painter: 'Daubus the Dyer', squasher: 'The River Bull', tow: 'The Barge Puller', thief: 'A River Raider', mayor: 'The Tax Collector' },
  2: { painter: 'Gilbert the Limner', squasher: 'Sir Squatsalot', tow: "The Reeve's Ox-Cart", thief: 'Cutpurse Mick', mayor: 'The Sheriff' },
  3: { painter: 'Whitewash Willy', squasher: 'The Steamroller Man', tow: 'The Bailiff', thief: 'Artful Mick', mayor: 'Alderman Pemberton' },
  5: { painter: 'Spray Can Sal', squasher: 'Crusher', tow: 'The Scrap Hauler', thief: 'A Scavenger', mayor: 'Warlord Pemberton' },
};
/** Who this sort of trouble is in the town's age (everyday names in the sandbox, or before ages). */
export function troublemakerName(state: DudesState, kind: NpcKind): string {
  const age = state.ai.themes === false ? undefined : state.city?.age;
  return (age !== undefined ? AGE_NAMES[age]?.[kind] : undefined) ?? NAMES[kind];
}
const LINES: Record<NpcKind, { enter: string[]; act: string[]; leave: string[] }> = {
  painter: {
    enter: ['Right. This whole field needs a fresh coat.', 'Who approved these colours? Nobody. Fixing it.'],
    act: ['Much better.', 'There. Now it pops.', 'You can thank me later.', 'A vast improvement.'],
    leave: ['My work here is done.', 'Same time next week.'],
  },
  squasher: {
    enter: ['Too tall. All of it. Too tall.', 'Somebody said there were tall things here.'],
    act: ['Flatter.', 'That is a better height.', 'Hm. Squishy.', 'Down you go.'],
    leave: ['Nice and low. Good.', 'Call me if anything gets tall again.'],
  },
  tow: {
    enter: ['Parking enforcement. Nobody move.', 'I have a list and you are all on it.'],
    act: ['This one is coming with me.', 'Illegally parked.', 'Towed.'],
    leave: ['Collect them from the edge. No refunds.', 'Have a nice day.'],
  },
  thief: {
    enter: ['Nice hats. Very nice hats.', 'Don’t mind me. Just passing through.'],
    act: ['Mine now.', 'Thank you kindly.', 'Ooh, that one.'],
    leave: ['Gotta run.', 'Lovely doing business.'],
  },
  mayor: {
    enter: ['Citizens! Gather round.', 'Order! Order in the field!'],
    act: [],
    leave: ['The council has spoken.', 'Carry on, citizens.'],
  },
};
/** What the councillor's fine costs anyone not in the decreed colour. */
const DECREE_FINE = 15;
const GARISH = ['#ff3fd2','#7dff3a', '#ffe11a', '#28e0ff', '#ff7a1a'];
const DECREES: { colour: string; hex: string; hue: number }[] = [
  { colour: 'red', hex: '#c4402f', hue: 5 },
  { colour: 'blue', hex: '#3f6fb0', hue: 215 },
  { colour: 'green', hex: '#4f8a4b', hue: 115 },
  { colour: 'yellow', hex: '#e2c14a', hue: 50 },
  { colour: 'purple', hex: '#7d4fa3', hue: 275 },
  { colour: 'orange', hex: '#e07a4a', hue: 25 },
  { colour: 'pink', hex: '#e07aa8', hue: 330 },
];

const pick = <T>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** A spot just inside the window's edge nearest `p`, or a random edge point. */
function edgeNear(p: GroundPoint | undefined, rng: () => number): GroundPoint {
  const FIELD = CITY_BOUNDS; // hook FK-078: the town's own edge, not the River Bank down to the water
  if (!p) {
    const side = Math.floor(rng() * 4);
    const t = rng();
    return [
      { x: FIELD.minX + 1, z: FIELD.minZ + 2 + t * (FIELD.maxZ - FIELD.minZ - 4) },
      { x: FIELD.maxX - 1, z: FIELD.minZ + 2 + t * (FIELD.maxZ - FIELD.minZ - 4) },
      { x: FIELD.minX + 2 + t * (FIELD.maxX - FIELD.minX - 4), z: FIELD.minZ + 1 },
      { x: FIELD.minX + 2 + t * (FIELD.maxX - FIELD.minX - 4), z: FIELD.maxZ - 1 },
    ].map((q) => clampToGround(q, 1))[side];
  }
  const options = [
    { x: FIELD.minX + 1, z: p.z },
    { x: FIELD.maxX - 1, z: p.z },
    { x: p.x, z: FIELD.minZ + 1 },
    { x: p.x, z: FIELD.maxZ - 1 },
  ];
  return options.map((q) => clampToGround(q, 1)).sort((a, b) => dist(a, p) - dist(b, p))[0];
}

/** Where the crowd is: the middle of everyone awake, or the square when nobody is. */
function campOf(state: DudesState, now: number): GroundPoint {
  const up = state.dudes.filter((d) => awake(d, now) && !d.hidden);
  if (!up.length) return { x: 0, z: -4.5 };
  const x = up.reduce((a, d) => a + d.position.x, 0) / up.length,
    z = up.reduce((a, d) => a + d.position.z, 0) / up.length;
  return clampToGround({ x, z }, 2);
}

/** Tell a character's agent what happened to it; it reacts on a turn of its own. */
export function nudge(state: DudesState, dude: Dude, text: string, now: number): void {
  dude.nudges ??= [];
  pushLine(dude.nudges, text.slice(0, 240), 4);
  pushLine(dude.history, { from: 'world', text: text.slice(0, 240), at: now }, LIMITS.history);
}

function hue(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
/** Is this character wearing the decreed colour: shirt, or a hat or accessory they actually have on. */
export function wearing(look: DudeLook, colour: string): boolean {
  const target = DECREES.find((d) => d.colour === colour);
  if (!target) return false;
  const close = (hex: string) => {
    const c = hue(hex);
    const dh = Math.min(Math.abs(c.h - target.hue), 360 - Math.abs(c.h - target.hue));
    return c.s > 0.28 && c.l > 0.15 && c.l < 0.9 && dh < 28;
  };
  return close(look.shirt) || (look.hat !== 'none' && close(look.hatColor)) || (look.accessory !== 'none' && close(look.accessoryColor));
}

/** Send a troublemaker in: who it picks on, and the plan it will work through. */
export function startHappening(state: DudesState, now: number, rng: () => number, kind?: NpcKind): string | undefined {
  if (state.happening) return 'something is already happening';
  const awakeDudes = state.dudes.filter((d) => awake(d, now) && !d.muted);
  const builds = state.objects.filter((o) => !state.hatPiles?.[o.id] && !inUse(state, o.id) && !o.folly); // hook FK-023: never the head's Folly (no repaint, squash or tow of the evidence)
  // Pick a kind that has something to do; prefer builds whose chatters are here to see it.
  const options: NpcKind[] = [];
  if (builds.length) options.push('painter', 'squasher', 'tow');
  if (awakeDudes.some((d) => d.look.hat !== 'none')) options.push('thief');
  if (awakeDudes.length >= 2) options.push('mayor');
  const chosen = kind ?? (options.length ? pick(options, rng) : undefined);
  if (!chosen) return 'nobody here to bother';
  const enter = edgeNear(undefined, rng);
  const npc: Npc = {
    id: nextId(state, 'n'),
    kind: chosen,
    name: troublemakerName(state, chosen),
    look: LOOKS[chosen],
    position: enter,
    facing: 0,
    path: [],
    speed: chosen === 'mayor' ? EVENTS.walkSpeed : EVENTS.runSpeed,
    plan: [],
  };
  const lines = LINES[chosen];
  const plan: NpcStep[] = [{ do: 'say', text: pick(lines.enter, rng) }];
  const awakeIds = new Set(awakeDudes.map((d) => d.id));
  const targetBuilds = [...builds]
    .sort((a, b) => Number(awakeIds.has(b.owner ?? '')) - Number(awakeIds.has(a.owner ?? '')) || rng() - 0.5)
    .slice(0, EVENTS.victims);
  // Visit them in a sensible order: nearest next.
  const ordered: SafehouseObject[] = [];
  let at = enter;
  const left = [...targetBuilds];
  while (left.length) {
    left.sort((a, b) => dist(a.position, at) - dist(b.position, at));
    const next = left.shift()!;
    ordered.push(next);
    at = next.position;
  }
  let title = npc.name.toUpperCase(),
    text = '';
  switch (chosen) {
    case 'painter':
      for (const o of ordered) plan.push({ do: 'goto-object', objectId: o.id }, { do: 'paint', objectId: o.id }, { do: 'emote', pose: 'punch', ms: 1500 });
      text = 'is repainting builds. Ask your character to fix yours.';
      break;
    case 'squasher':
      for (const o of ordered) plan.push({ do: 'goto-object', objectId: o.id }, { do: 'squash', objectId: o.id }, { do: 'emote', pose: 'jump', ms: 1500 });
      text = 'is squashing builds flat. Ask your character to fix yours.';
      break;
    case 'tow':
      for (const o of ordered.slice(0, 3)) plan.push({ do: 'goto-object', objectId: o.id }, { do: 'tow', objectId: o.id, to: edgeNear(o.position, rng) });
      text = 'is towing builds to the edge. Drive yours back.';
      break;
    case 'thief': {
      const marks = awakeDudes.filter((d) => d.look.hat !== 'none').slice(0, EVENTS.victims);
      for (const d of marks) plan.push({ do: 'goto-dude', dudeId: d.id }, { do: 'steal-hat', dudeId: d.id });
      plan.push({ do: 'drop-hats' });
      text = 'is stealing hats. Find the pile to get yours back.';
      break;
    }
    case 'mayor': {
      const decree = pick(DECREES, rng);
      plan.push(
        { do: 'goto', to: campOf(state, now), camp: true },
        { do: 'say', text: `By order of the council: everyone wears ${decree.colour}. I will be back in three minutes.` },
        { do: 'emote', pose: 'point', ms: 3000 },
        { do: 'leave', to: enter },
        { do: 'wait', ms: EVENTS.decreeMs - 25_000 },
        { do: 'goto', to: campOf(state, now), camp: true },
        { do: 'decree-check' },
      );
      title = npc.name.toUpperCase();
      text = `decrees: everyone wears ${decree.colour}. Three minutes.`;
      state.happening = { kind: chosen, npcId: npc.id, title, text, startedAt: now, until: now + EVENTS.decreeMs, decree: { colour: decree.colour, hex: decree.hex } };
      for (const d of awakeDudes) nudge(state, d, `${npc.name} has decreed that everyone must wear ${decree.colour} within three minutes, or be fined. Change your look if you want to comply.`, now);
      break;
    }
  }
  plan.push({ do: 'say', text: pick(lines.leave, rng) }, { do: 'leave', to: edgeNear(undefined, rng) });
  npc.plan = plan;
  state.npcs ??= [];
  state.npcs.push(npc);
  state.happening ??= { kind: chosen, npcId: npc.id, title, text, startedAt: now };
  pushFeed(state, now, `${npc.name} ${text}`);
  return undefined;
}

function vandalise(state: DudesState, npc: Npc, o: SafehouseObject, kind: 'painted' | 'squashed', rng: () => number, now: number): void {
  state.vandalised ??= {};
  // The first vandal's original is the one worth keeping: fixing a painted-then-squashed build gets the real one back.
  state.vandalised[o.id] ??= { by: npc.name, kind, original: structuredClone(o.blueprint) };
  state.vandalised[o.id].kind = kind;
  state.vandalised[o.id].by = npc.name;
  const next: Blueprint = structuredClone(o.blueprint);
  if (kind === 'painted') {
    const a = pick(GARISH, rng),
      b = pick(GARISH.filter((c) => c !== a), rng);
    next.parts.forEach((p, i) => (p.color = i % 3 === 2 ? b : a));
  } else {
    for (const p of next.parts) {
      p.position[1] *= 0.3;
      p.size[1] = Math.max(0.02, p.size[1] * 0.3);
    }
  }
  o.blueprint = next;
  o.revision++;
  state.worldRevision++;
  shake(state, o.id, now);
  const owner = state.dudes.find((d) => d.id === o.owner);
  if (owner)
    nudge(state, owner, `${npc.name} ${kind} your build ${o.blueprint.name}. You can use it with "fix" to put it back.`, now);
}

/** Put a vandalised build back the way it was (the `fix` use). */
export function restore(state: DudesState, o: SafehouseObject): boolean {
  const v = state.vandalised?.[o.id];
  if (!v) return false;
  o.blueprint = v.original;
  o.revision++;
  delete state.vandalised![o.id];
  heal(state, o);
  state.worldRevision++;
  return true;
}

/** Someone used the hat pile: hand back their hat if it is in there; the pile goes when it is empty. */
export function claimHat(state: DudesState, dude: Dude, pileId: string): string | undefined {
  const pile = state.hatPiles?.[pileId];
  if (!pile) return undefined;
  const mine = pile[dude.id];
  if (!mine) return 'your hat is not in this pile';
  dude.look = { ...dude.look, hat: mine.hat, hatColor: mine.color };
  delete pile[dude.id];
  if (!Object.keys(pile).length) {
    delete state.hatPiles![pileId];
    state.objects = state.objects.filter((o) => o.id !== pileId);
    state.worldRevision++;
  }
  return 'you got your hat back';
}

function hatPileBlueprint(hats: { hat: string; color: string }[]): Blueprint {
  const parts: Blueprint['parts'] = [{ shape: 'cylinder', position: [0, 0.08, 0], size: [1.8, 0.16, 1.8], color: '#6a5a43', rotation: [0, 0, 0] }];
  hats.slice(0, 12).forEach((h, i) => {
    const a = i * 2.4,
      r = 0.25 + (i % 4) * 0.15,
      y = 0.25 + Math.floor(i / 4) * 0.22;
    parts.push({ shape: i % 2 ? 'cone' : 'cylinder', position: [Math.cos(a) * r, y, Math.sin(a) * r], size: [0.45, 0.3, 0.45], color: h.color, rotation: [0.3 * (i % 3), a, 0] });
  });
  return { name: 'Pile of stolen hats', description: 'Sticky Mick dumped everyone’s hats here. Use it to get yours back.', parts };
}

function npcSay(npc: Npc, text: string, now: number): void {
  npc.say = { text, until: now + Math.max(3500, Math.min(9000, 2000 + text.length * 70)) };
}

function goTo(state: DudesState, npc: Npc, to: GroundPoint): void {
  npc.path = (route(npc.position, to, state.objects) ?? [npc.position, to]).slice(1);
}

/** Work through the plan: one step at a time, walking between them. Returns false when the troublemaker is gone. */
function runNpc(state: DudesState, npc: Npc, dt: number, now: number, rng: () => number): boolean {
  if (npc.say && npc.say.until <= now) npc.say = undefined;
  if (npc.emote && npc.emote.until <= now) npc.emote = undefined;
  if (npc.ko && npc.ko > now) return true; // knocked down: lies there, then gives up (combat.ts)
  if (npc.towing) return tow(state, npc, dt, now);
  if (npc.path.length) {
    step(npc, dt, npc.speed);
    return true;
  }
  const s = npc.plan[0];
  if (!s) return false;
  const lines = LINES[npc.kind];
  const done = () => npc.plan.shift();
  switch (s.do) {
    case 'say':
      npcSay(npc, s.text, now);
      done();
      break;
    case 'emote':
      npc.emote = { pose: s.pose, until: now + s.ms };
      npc.plan[0] = { do: 'wait', ms: s.ms };
      break;
    case 'wait':
      if (s.until === undefined) s.until = now + s.ms;
      if (now >= s.until) done();
      break;
    case 'goto':
      // Back to wherever the group has got to by now, if that is where it was going.
      goTo(state, npc, s.camp ? campOf(state, now) : s.to);
      done();
      break;
    case 'leave':
      npc.speed = EVENTS.runSpeed;
      goTo(state, npc, s.to);
      done();
      if (!npc.plan.length) npc.plan.push({ do: 'wait', ms: 0 }); // walk off, then go
      break;
    case 'goto-object': {
      const o = state.objects.find((x) => x.id === s.objectId);
      if (!o || inUse(state, o.id)) {
        // Gone or someone is driving it: skip it and the thing we were going to do there.
        done();
        if (npc.plan[0] && 'objectId' in npc.plan[0] && npc.plan[0].objectId === s.objectId) done();
        break;
      }
      const at = o.driven?.at ?? o.position;
      const reach = Math.max(o.footprint.width, o.footprint.depth) / 2 + 0.7;
      const dx = npc.position.x - at.x,
        dz = npc.position.z - at.z,
        d = Math.hypot(dx, dz) || 1;
      goTo(state, npc, { x: at.x + (dx / d) * reach, z: at.z + (dz / d) * reach });
      done();
      break;
    }
    case 'goto-dude': {
      const d = state.dudes.find((x) => x.id === s.dudeId);
      if (!d || d.hidden || d.riding) {
        done();
        done();
        break;
      }
      const dx = npc.position.x - d.position.x,
        dz = npc.position.z - d.position.z,
        dd = Math.hypot(dx, dz) || 1;
      goTo(state, npc, { x: d.position.x + (dx / dd) * 0.9, z: d.position.z + (dz / dd) * 0.9 });
      done();
      break;
    }
    case 'paint':
    case 'squash': {
      const o = state.objects.find((x) => x.id === s.objectId);
      if (o && !inUse(state, o.id)) {
        face(npc, o.driven?.at ?? o.position);
        vandalise(state, npc, o, s.do === 'paint' ? 'painted' : 'squashed', rng, now);
        npcSay(npc, pick(lines.act, rng), now);
      }
      done();
      break;
    }
    case 'tow': {
      const o = state.objects.find((x) => x.id === s.objectId);
      if (!o || inUse(state, o.id)) {
        done();
        break;
      }
      const at = o.driven?.at ?? o.position;
      o.driven = { at, turn: o.driven?.turn ?? 0, by: npc.name, until: Number.MAX_SAFE_INTEGER };
      s.route = (route(at, s.to, state.objects.filter((x) => x.id !== o.id)) ?? [at, s.to]).slice(1);
      npc.towing = o.id;
      npcSay(npc, pick(lines.act, rng), now);
      const owner = state.dudes.find((d) => d.id === o.owner);
      if (owner) nudge(state, owner, `${npc.name} is towing your build ${o.blueprint.name} to the edge of the field. You can drive it back with "use".`, now);
      break;
    }
    case 'steal-hat': {
      const d = state.dudes.find((x) => x.id === s.dudeId);
      // They wandered off while he was on his way: after them, a few times.
      if (d && d.look.hat !== 'none' && !d.hidden && !d.riding && dist(d.position, npc.position) >= 3 && (s.tries ?? 0) < 4) {
        s.tries = (s.tries ?? 0) + 1;
        npc.plan.unshift({ do: 'goto-dude', dudeId: d.id });
        break;
      }
      if (d && d.look.hat !== 'none' && dist(d.position, npc.position) < 3) {
        npc.loot ??= [];
        npc.loot.push({ dudeId: d.id, hat: d.look.hat, color: d.look.hatColor });
        d.look = { ...d.look, hat: 'none' };
        face(npc, d.position);
        npcSay(npc, pick(lines.act, rng), now);
        nudge(state, d, `${npc.name} just stole your hat and ran off with it.`, now);
      }
      done();
      break;
    }
    case 'drop-hats': {
      done();
      if (!npc.loot?.length) break;
      const blueprint = hatPileBlueprint(npc.loot);
      const size = measureBlueprint(blueprint);
      let position: GroundPoint;
      try {
        position = choosePlacement(size, state.objects, edgeNear(npc.position, rng));
      } catch {
        // No room anywhere: the hats come back on their own.
        for (const l of npc.loot) {
          const d = state.dudes.find((x) => x.id === l.dudeId);
          if (d) d.look = { ...d.look, hat: l.hat, hatColor: l.color };
        }
        break;
      }
      const pile: SafehouseObject = {
        id: nextId(state, 'b'),
        revision: 1,
        blueprint,
        position,
        footprint: size,
        createdBy: npc.name,
        editedBy: npc.name,
        createdAt: now,
      };
      state.objects.push(pile);
      state.hatPiles ??= {};
      state.hatPiles[pile.id] = Object.fromEntries(npc.loot.map((l) => [l.dudeId, { hat: l.hat, color: l.color }]));
      state.worldRevision++;
      for (const l of npc.loot) {
        const d = state.dudes.find((x) => x.id === l.dudeId);
        if (d) nudge(state, d, `${npc.name} dumped the stolen hats in a "Pile of stolen hats". Use it (any way) to get yours back.`, now);
      }
      npc.loot = [];
      goTo(state, npc, edgeNear(position, rng));
      break;
    }
    case 'decree-check': {
      done();
      const h = state.happening;
      if (!h?.decree) break;
      const ok: string[] = [],
        fined: string[] = [];
      for (const d of state.dudes.filter((x) => awake(x, now) && !x.muted)) {
        if (wearing(d.look, h.decree.colour)) {
          ok.push(d.name);
          d.emote = { pose: 'cheer', until: now + 4000 };
          nudge(state, d, `${npc.name} inspected the field and praised you for wearing ${h.decree.colour}.`, now);
        } else {
          fined.push(d.name);
          d.title = 'fined by the council';
          // A real fine (as far as they can pay), floated up in red over them.
          const fine = Math.min(DECREE_FINE, d.coins ?? 150);
          if (fine > 0) {
            d.coins = (d.coins ?? 150) - fine;
            addEffect(state, { kind: 'coins', at: now, to: { ...d.position }, amount: -fine });
          }
          nudge(state, d, `${npc.name} fined you ${fine > 0 ? `§${fine} ` : ''}for not wearing ${h.decree.colour}. Your title is now "fined by the council" until you choose a new one.`, now);
        }
      }
      const verdict = !fined.length
        ? `Splendid. Everyone in ${h.decree.colour}.`
        : !ok.length
          ? `Not one of you in ${h.decree.colour}. Disgraceful. Fines all round.`
          : `Well done ${ok.slice(0, 3).join(', ')}. The rest of you are fined.`;
      npcSay(npc, verdict, now);
      npc.plan.unshift({ do: 'wait', ms: 4000 });
      pushFeed(state, now, `${npc.name}: ${ok.length} obeyed, ${fined.length} fined`);
      break;
    }
  }
  return true;
}

/** Towing: the build goes along its route with the tow guy hauling it; it parks at the edge. */
function tow(state: DudesState, npc: Npc, dt: number, now: number): boolean {
  const s = npc.plan[0] as Extract<NpcStep, { do: 'tow' }>;
  const o = state.objects.find((x) => x.id === npc.towing);
  if (!o || !o.driven || s?.do !== 'tow') {
    npc.towing = undefined;
    if (s?.do === 'tow') npc.plan.shift();
    return true;
  }
  const r = s.route ?? [];
  let budget = (EVENTS.towSpeed * dt) / 1000;
  while (budget > 0 && r.length) {
    const next = r[0];
    const dx = next.x - o.driven.at.x,
      dz = next.z - o.driven.at.z,
      d = Math.hypot(dx, dz);
    if (d <= budget) {
      o.driven.at = { ...next };
      r.shift();
      budget -= d;
    } else {
      o.driven.at = { x: o.driven.at.x + (dx / d) * budget, z: o.driven.at.z + (dz / d) * budget };
      budget = 0;
    }
    if (d > 1e-6) npc.facing = Math.atan2(dx, dz);
  }
  // Out in front, hauling it.
  const reach = Math.max(o.footprint.width, o.footprint.depth) / 2 + 0.6;
  npc.position = { x: o.driven.at.x + Math.sin(npc.facing) * reach, z: o.driven.at.z + Math.cos(npc.facing) * reach };
  npc.emote = { pose: 'push', until: now + 1000 };
  if (!r.length) {
    parkObject(state, o, npc.name);
    npc.towing = undefined;
    npc.emote = undefined;
    npc.plan.shift();
    pushFeed(state, now, `${npc.name} dumped ${o.blueprint.name} at the edge`);
  }
  return true;
}

/** The clock for troublemakers: when the next one comes, and every one on the field doing its thing. */
export function tickEvents(state: DudesState, dt: number, now: number, rng: () => number): void {
  const enabled = state.ai.events !== false;
  const awakeCount = state.dudes.filter((d) => awake(d, now) && !d.muted).length;
  if (state.nextHappeningAt === undefined || (awakeCount < EVENTS.minAwake && !state.happening))
    state.nextHappeningAt = now + EVENTS.firstAfterMs;
  // Troublemakers come by now and then, never in the middle of a grand opening, a caravan's scene,
  // the bridge being mended, or while a crowd is building the community project: they wait for a lull.
  const c = state.city;
  const crowded = !!c?.party || !!c?.scene || (!!c?.caravan?.stranded && !!c.caravan.asks.length) || state.dudes.filter((d) => d.labour?.phase === 'working').length >= 2;
  if (enabled && crowded && !state.happening && now >= state.nextHappeningAt) state.nextHappeningAt = now + 30_000;
  if (enabled && !crowded && !state.happening && now >= state.nextHappeningAt && awakeCount >= EVENTS.minAwake) {
    startHappening(state, now, rng);
    state.nextHappeningAt = now + EVENTS.gapMs[0] + rng() * (EVENTS.gapMs[1] - EVENTS.gapMs[0]);
  }
  for (const npc of [...(state.npcs ?? [])]) {
    const alive = runNpc(state, npc, dt, now, rng);
    if (!alive && !npc.path.length) {
      state.npcs = state.npcs!.filter((n) => n !== npc);
      if (state.happening?.npcId === npc.id) state.happening = undefined;
    }
  }
}

export function happeningView(state: DudesState): HappeningView | undefined {
  const h = state.happening;
  return h ? { kind: h.kind, title: h.title, text: h.text, ...(h.until ? { until: h.until } : {}) } : undefined;
}

/** What the agents see about the event in progress. */
export function happeningLine(state: DudesState, now: number): string | undefined {
  const h = state.happening;
  if (!h) return undefined;
  const left = h.until ? ` (${Math.max(0, Math.round((h.until - now) / 1000))} s left)` : '';
  return `${state.npcs?.find((n) => n.id === h.npcId)?.name ?? NAMES[h.kind]} ${h.text}${left}`;
}

/** How a vandalised build reads to an agent. */
export function damageOf(state: DudesState, objectId: string): string | undefined {
  const v = state.vandalised?.[objectId];
  const o = state.objects.find((x) => x.id === objectId);
  const hurt = o && damageNote(o);
  if (v && hurt) return `${hurt} (by ${v.by})`;
  if (v) return `${v.kind === 'wrecked' ? 'blown up' : v.kind} by ${v.by}; use it with "fix" to restore it`;
  if (state.hatPiles?.[objectId]) return 'a pile of stolen hats; use it to get your hat back if it is in there';
  return undefined;
}

// The boss: something huge comes out of the forest and stands in the path, and the group has to
// bring it down together. It has a lot of health (more the more people there are), it lumbers after
// whoever is bunched up, and every few seconds it slams the ground and knocks out everyone near it
// for twenty seconds, so nobody can help for a while. Bare hands work, slowly; guns, catapults and
// cannons that people build and fire do more; traps it walks into hurt it and stun it; ramming it
// with a vehicle hurts both. When its health runs out it falls, and everyone who hurt it earns its
// face for their name tag. Zero AI: the agents pick attack / use … fire / build; the app owns the
// health, the slam, the odds and the damage.
import type { DudeLook } from '../../shared/dudesTypes';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { trailX } from '../../shared/trail';
import { abilitiesOf } from './blueprint';
import { challengeOf, finishChallenge, registerChallenge, allowChallengeKinds } from './challenge';
import { journeyOf } from './journey';
import { clampToGround } from './placement';
import { addEffect, awake, endUse, face, step } from './sim';
import { knockOut, knockedOut, stagger, wreck } from './combat';
import { nudge } from './events';
import { LIMITS, pushFeed, pushLine, type Boss, type Dude, type DudesState } from './state';

export interface BossKind {
  id: string;
  name: string;
  /** The collectable's name ("the Moss Troll's face"). */
  badge: string;
  look: DudeLook;
  scale: number;
  lines: { enter: string[]; slam: string[]; hurt: string[]; fall: string[]; leave: string[] };
}

export const BOSSES: BossKind[] = [
  {
    id: 'moss-troll',
    name: 'The Moss Troll',
    badge: "the Moss Troll's face",
    look: { skin: '#6f9a4a', shirt: '#4c6b34', pants: '#3a3226', hair: '#4f7a33', hat: 'none', hatColor: '#4f7a33', accessory: 'none', accessoryColor: '#4f7a33', height: 1.15, build: 1.2 },
    scale: 3.2,
    lines: {
      enter: ['WHO WALKS ON MY PATH', 'You are all very small.'],
      slam: ['SQUASH.', 'Down you go.', 'Hah.'],
      hurt: ['Ow. OW.', 'That stings.'],
      fall: ['Fine. Walk on, then...'],
      leave: ['Bored now. Going back to sleep.'],
    },
  },
  {
    id: 'iron-boar',
    name: 'The Iron Boar',
    badge: 'the Iron Boar tusk',
    look: { skin: '#7e8790', shirt: '#5a636b', pants: '#3a3f44', hair: '#2c3238', hat: 'helmet', hatColor: '#9aa4ad', accessory: 'none', accessoryColor: '#c43', height: 1.15, build: 1.2 },
    scale: 2.8,
    lines: {
      enter: ['SNORT.', 'Nobody passes the boar.'],
      slam: ['CHARGE.', 'Snort, snort, SNORT.'],
      hurt: ['Grr.', 'Rusty, not weak.'],
      fall: ['Clank.'],
      leave: ['The boar has better things to do.'],
    },
  },
  {
    id: 'old-gnarl',
    name: 'Old Gnarl',
    badge: "Old Gnarl's knot",
    look: { skin: '#7a5a3a', shirt: '#5c4128', pants: '#4a3420', hair: '#5f7a3a', hat: 'none', hatColor: '#5f7a3a', accessory: 'cape', accessoryColor: '#5f7a3a', height: 1.15, build: 1.15 },
    scale: 3.6,
    lines: {
      enter: ['Creak. Who disturbs the forest?', 'Leave my trees alone.'],
      slam: ['ROOTS.', 'Creeeak.'],
      hurt: ['My bark.', 'Splinters.'],
      fall: ['Timber...'],
      leave: ['The forest sleeps again.'],
    },
  },
];
export const bossKind = (id: string) => BOSSES.find((b) => b.id === id) ?? BOSSES[0];

export const BOSS = {
  hp: (awake: number) => 30 + 25 * Math.max(1, awake),
  speed: 1.2,
  chargeSpeed: 3.6,
  slamEveryMs: 6000,
  slamRadius: 4,
  slamReach: 5, // starts a slam when its target is this close
  koMs: 20_000,
  /** Damage per landed hit, by how. */
  damage: { shove: 0.5, punch: 1, kick: 1, throw: 2, shoot: 3, bomb: 8 } as Record<string, number>,
  fireEveryMs: 1500,
  fireRange: 40, // a built gun reaches across the glade
  fireDamage: 3,
  fireOdds: 0.8,
  trapDamage: 15,
  trapStunMs: 4000,
  ramDamage: 5,
  ms: 12 * 60_000,
};

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
export const bossOf = (state: DudesState): Boss | undefined => journeyOf(state).boss;
const reach = (b: Boss) => 0.6 * bossKind(b.kindId).scale;

function say(b: Boss, text: string, now: number) {
  b.say = { text, until: now + 3500 };
}
const pick = <T>(list: T[], rng: () => number) => list[Math.floor(rng() * list.length)];

/** It walks out of the forest ahead of the group. */
function start(state: DudesState, now: number): void {
  const j = journeyOf(state);
  const group = state.dudes.filter((d) => awake(d, now) && !d.muted);
  const kind = BOSSES[(j.met ?? 0) % BOSSES.length];
  const z = j.campZ - 18;
  const hp = BOSS.hp(group.length);
  j.boss = {
    id: `boss-${kind.id}`,
    kindId: kind.id,
    position: clampToGround({ x: trailX(j.seed, z) + 18, z }, 2),
    facing: Math.PI,
    hp,
    maxHp: hp,
    damagers: {},
    nextSlamAt: now + 8000,
  };
  say(j.boss, kind.lines.enter[0], now);
  pushFeed(state, now, `${kind.name} blocks the path`);
  for (const d of group)
    nudge(
      state,
      d,
      `${kind.name}, a huge creature, has stepped out of the forest and blocks the path. The group has to bring it down together: punch, kick, throw things and shoot it (attack "${kind.name}"); build guns, cannons or catapults and fire them (use … fire); build traps for it to walk into; ram it with a vehicle. It slams the ground and knocks out anyone near it for a while. Everyone who hurts it earns ${kind.badge}.`,
      now,
    );
}

/** Hurt it; whoever did it is on the list for the collectable. */
export function hurtBoss(state: DudesState, by: Dude | undefined, amount: number, now: number, rng: () => number = Math.random): void {
  const b = bossOf(state);
  if (!b || b.hp <= 0 || challengeOf(state)?.outcome) return;
  b.hp = Math.max(0, b.hp - amount);
  if (by) b.damagers[by.id] = (b.damagers[by.id] ?? 0) + amount;
  if (rng() < 0.15 && (!b.say || b.say.until < now)) say(b, pick(bossKind(b.kindId).lines.hurt, rng), now);
  if (b.hp <= 0) fall(state, b, now, rng);
}

function fall(state: DudesState, b: Boss, now: number, rng: () => number): void {
  const kind = bossKind(b.kindId);
  b.downAt = now;
  say(b, kind.lines.fall[0], now);
  addEffect(state, { kind: 'boom', from: { ...b.position }, radius: 5, at: now });
  pushFeed(state, now, `${kind.name} is down`);
  const earned = Object.entries(b.damagers)
    .filter(([, dmg]) => dmg > 0)
    .map(([id]) => id);
  finishChallenge(state, now, 'won', earned, { kind: `boss:${kind.id}`, name: kind.badge }, rng);
}

function tick(state: DudesState, dt: number, now: number, rng: () => number): void {
  const b = bossOf(state);
  const c = challengeOf(state);
  if (!b || !c) return;
  if (b.say && b.say.until <= now) b.say = undefined;
  if (now >= c.until) {
    // It gets bored and wanders back into the forest: nobody earns anything.
    const kind = bossKind(b.kindId);
    say(b, kind.lines.leave[0], now);
    pushFeed(state, now, `${kind.name} wandered off into the forest`);
    finishChallenge(state, now, 'timeout', [], { kind: `boss:${kind.id}`, name: kind.badge }, rng);
    return;
  }
  // Traps it walks into: a big hit, a stun, and the trap is done for.
  for (const o of state.objects) {
    if (!abilitiesOf(o.blueprint).has('trap') || state.vandalised?.[o.id]) continue;
    const at = o.driven?.at ?? o.position;
    if (Math.abs(at.x - b.position.x) < o.footprint.width / 2 + reach(b) && Math.abs(at.z - b.position.z) < o.footprint.depth / 2 + reach(b)) {
      const owner = state.dudes.find((d) => d.id === o.owner);
      hurtBoss(state, owner, BOSS.trapDamage, now, rng);
      b.stunUntil = now + BOSS.trapStunMs;
      b.path = [];
      say(b, 'A TRAP?', now);
      addEffect(state, { kind: 'slam', from: { ...at }, radius: 2, at: now });
      pushFeed(state, now, `${bossKind(b.kindId).name} walked into ${owner ? `${owner.name}'s` : 'a'} ${o.blueprint.name}`);
      if (owner) {
        wreck(state, o, owner, rng, now);
        pushLine(owner.history, { from: 'world', text: `the boss walked into your ${o.blueprint.name}`, at: now }, LIMITS.history);
      }
      if (b.hp <= 0) return;
    }
  }
  if (b.stunUntil && b.stunUntil > now) return;
  // Whoever is bunched up with the most others, among those still standing.
  const standing = state.dudes.filter((d) => awake(d, now) && !d.hidden && !knockedOut(d, now) && !d.y);
  if (!standing.length) return;
  let target = standing.find((d) => d.id === b.targetId);
  if (!target || now >= (b.retargetAt ?? 0)) {
    const crowd = (d: Dude) => standing.filter((o) => dist(o.position, d.position) < 6).length;
    target = [...standing].sort((a, b2) => crowd(b2) - crowd(a) || dist(a.position, b.position) - dist(b2.position, b.position))[0];
    b.targetId = target.id;
    b.retargetAt = now + 4000;
    b.chargeUntil = rng() < 0.2 ? now + 2500 : undefined;
  }
  const gap = dist(b.position, target.position);
  if (gap > BOSS.slamReach - 1) {
    const mover = { path: [target.position], position: b.position, facing: b.facing };
    step(mover, dt, b.chargeUntil && b.chargeUntil > now ? BOSS.chargeSpeed : BOSS.speed);
    b.position = clampToGround(mover.position, 1);
    b.facing = mover.facing;
  } else face(b, target.position);
  if (now >= b.nextSlamAt && gap <= BOSS.slamReach) {
    b.nextSlamAt = now + BOSS.slamEveryMs;
    b.slamAt = now;
    say(b, pick(bossKind(b.kindId).lines.slam, rng), now);
    addEffect(state, { kind: 'slam', from: { ...b.position }, radius: BOSS.slamRadius, at: now });
    const flattened: string[] = [];
    for (const d of state.dudes)
      if (!d.hidden && dist(d.position, b.position) <= BOSS.slamRadius + reach(b) && !knockedOut(d, now)) {
        knockOut(state, d, undefined, `slammed by ${bossKind(b.kindId).name}`, now, { ms: BOSS.koMs, quiet: true });
        pushLine(d.history, { from: 'world', text: `${bossKind(b.kindId).name} slammed the ground and knocked you out for twenty seconds`, at: now }, LIMITS.history);
        flattened.push(d.name);
      }
    if (flattened.length) pushFeed(state, now, `${bossKind(b.kindId).name} slammed ${flattened.length === 1 ? flattened[0] : `${flattened.length} people`} flat`);
  }
}

/** A manned weapon: every second and a half, a shot at the boss if it is in range. */
export function fireWeapon(state: DudesState, dude: Dude, o: SafehouseObject, now: number, rng: () => number = Math.random): void {
  if (now < (dude.nextShotAt ?? 0)) return;
  dude.nextShotAt = now + BOSS.fireEveryMs;
  const at = o.driven?.at ?? o.position;
  const b = bossOf(state);
  const aim = b && b.hp > 0 && dist(at, b.position) <= BOSS.fireRange ? b.position : undefined;
  // Nothing to shoot at: a shot into the trees, for the noise.
  const to = aim ?? { x: at.x + Math.sin(dude.facing) * 12, z: at.z + Math.cos(dude.facing) * 12 };
  if (aim) face(dude, aim);
  addEffect(state, { kind: 'shot', from: { ...at }, to: { ...to }, at: now });
  if (aim && rng() < BOSS.fireOdds) hurtBoss(state, dude, BOSS.fireDamage, now, rng);
}

/** A vehicle on a run that hits the boss: it hurts, and the driver is thrown off. */
export function ramBoss(state: DudesState, driver: Dude, at: GroundPoint, now: number, rng: () => number = Math.random): boolean {
  const b = bossOf(state);
  if (!b || b.hp <= 0 || dist(at, b.position) > reach(b) + 1.2) return false;
  hurtBoss(state, driver, BOSS.ramDamage, now, rng);
  endUse(state, driver, now);
  stagger(driver, b.position, now);
  pushLine(driver.history, { from: 'world', text: `you rammed ${bossKind(b.kindId).name} and were thrown off`, at: now }, LIMITS.history);
  return true;
}

registerChallenge('boss', {
  start,
  tick,
  end: (state) => {
    journeyOf(state).boss = undefined;
  },
  view: (state) => {
    const b = bossOf(state);
    const c = challengeOf(state);
    if (!b || !c) return undefined;
    const kind = bossKind(b.kindId);
    if (c.outcome)
      return {
        kind: 'boss',
        title: c.outcome === 'won' ? `${kind.name.toUpperCase()} IS DOWN` : `${kind.name.toUpperCase()} WANDERED OFF`,
        text: c.awarded?.length ? `${c.awarded.length} earned ${kind.badge}. The walk goes on.` : 'Nobody earned anything. The walk goes on.',
      };
    const helpers = Object.keys(b.damagers).length;
    return {
      kind: 'boss',
      title: kind.name.toUpperCase(),
      text: 'It is blocking the path. Bring it down together: fists, thrown things, guns and traps you build. It knocks out anyone near it.',
      until: c.until,
      bars: [{ label: 'health', value: b.hp / b.maxHp, note: `${Math.ceil(b.hp)}/${b.maxHp}${helpers ? ` · ${helpers} fighting` : ''}` }],
    };
  },
  line: (state, dude) => {
    const b = bossOf(state);
    if (!b) return '';
    const kind = bossKind(b.kindId);
    const mine = b.damagers[dude.id] ?? 0;
    return `${kind.name.toUpperCase()}: a huge creature blocks the path, ${Math.round(dist(b.position, dude.position))} m from you, with ${Math.ceil(b.hp)} of ${b.maxHp} health left. Bring it down together: attack "${kind.name}" (punch and kick up close, throw or shoot from range, bombs do the most), build a gun, cannon or catapult and use it with "fire", build a trap where it will walk, or drive something into it. Every few seconds it slams the ground and knocks out anyone within about ${BOSS.slamRadius + 2} m for twenty seconds, so keep some distance or come at it from range. You have done ${Math.round(mine)} damage so far${mine ? '' : ': hurting it at all earns ' + kind.badge}.`;
  },
});
allowChallengeKinds(['river', 'boss']);

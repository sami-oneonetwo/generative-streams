// Cartoon violence, because chat asks for it more than anything: punch, kick, shoot, throw, bomb,
// and running people over. Nobody bleeds and nobody stays down: a knocked-out character lies there
// seeing stars for a few seconds and gets back up. Builds rattle when hit and blow apart in a bomb
// (fixable, like a troublemaker's work). Troublemakers can be fought off. Zero AI: the agent picks a
// target and a way, the app owns the ranges, the odds, the fuse and the blast.
import type { AttackWith } from '../../shared/dudesTypes';
import type { Blueprint, GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { GROUND, clampToGround, walkableSegment } from './placement';
import { addEffect, awake, endUse, face, shake, walkTo } from './sim';
import { nudge } from './events';
import { LIMITS, pushFeed, pushLine, type Dude, type DudesState, type Npc } from './state';
import { leaveVisit } from './city';
import { damageBuild } from './damage';
import { WEAPON, armedBuild, blast, fire } from './weapons';

export const COMBAT = {
  range: { shove: 1.3, punch: 1.3, kick: 1.3, shoot: 14, throw: 9, bomb: 2 } as Record<AttackWith, number>,
  hit: { shove: 1, punch: 0.7, kick: 0.7, shoot: 0.75, throw: 0.6, bomb: 1 } as Record<AttackWith, number>,
  koMs: 10_000,
  /** Back up after a knockout: nobody can knock them flat again for this long (no chain knockouts). */
  koGuardMs: 7000,
  npcKoMs: 4000,
  fuseMs: 3000,
  blast: 3, // metres
  runFrom: 6, // a bomber runs this far from a lit bomb
  giveUpMs: 60_000, // can't get in range in this long, forget it (the town is a minute's walk across)
  runOverReach: 1.3,
  /** At a build: how much each blow takes off (damage.ts), and how many blows one attack lands. */
  buildDamage: { shove: 0, punch: 2, kick: 2, shoot: 3, throw: 2, bomb: 45 } as Record<AttackWith, number>,
  blows: { shove: 1, punch: 5, kick: 5, shoot: 6, throw: 4, bomb: 1 } as Record<AttackWith, number>,
  blowMs: 700,
  /** Aboard a build with a gun: shells per attack. */
  shells: 4,
};

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
export const knockedOut = (d: Dude, now: number) => !!d.ko && d.ko.until > now;
/** Knocked out, then back up: not again before this (server time). */
const koGuard = new WeakMap<Dude, number>();
export const koGuarded = (d: Dude, now: number) => (koGuard.get(d) ?? 0) > now;

type Target = { kind: 'dude'; dude: Dude } | { kind: 'npc'; npc: Npc } | { kind: 'object'; object: SafehouseObject };
function find(state: DudesState, kind: 'dude' | 'npc' | 'object' | 'boss', id: string): Target | undefined {
  if (kind === 'boss') return undefined;
  if (kind === 'dude') {
    const dude = state.dudes.find((d) => d.id === id);
    return dude ? { kind, dude } : undefined;
  }
  if (kind === 'npc') {
    const npc = state.npcs?.find((n) => n.id === id);
    return npc ? { kind, npc } : undefined;
  }
  const object = state.objects.find((o) => o.id === id);
  return object ? { kind, object } : undefined;
}
const where = (t: Target): GroundPoint =>
  t.kind === 'dude' ? t.dude.position : t.kind === 'npc' ? t.npc.position : (t.object.driven?.at ?? t.object.position);
const reachOf = (t: Target): number =>
  t.kind === 'object' ? Math.max(t.object.footprint.width, t.object.footprint.depth) / 2 : 0;
const nameOf = (t: Target): string => (t.kind === 'dude' ? t.dude.name : t.kind === 'npc' ? t.npc.name : t.object.blueprint.name);

function score(state: DudesState, id: string, field: 'kos' | 'downs'): void {
  state.scores ??= {};
  state.scores[id] ??= { kos: 0, downs: 0 };
  state.scores[id][field]++;
}

/** Knock a character out: flat on its back for a few seconds, whatever it was doing set aside. */
export function knockOut(state: DudesState, victim: Dude, by: Dude | undefined, how: string, now: number, opts: { ms?: number; quiet?: boolean } = {}): void {
  if (knockedOut(victim, now) || victim.hidden || koGuarded(victim, now)) return;
  const ms = opts.ms ?? COMBAT.koMs;
  koGuard.set(victim, now + ms + COMBAT.koGuardMs);
  endUse(state, victim, now);
  victim.attack = undefined;
  leaveVisit(victim);
  victim.path = [];
  victim.walkingFor = undefined;
  victim.ko = { until: now + ms, by: by?.name ?? 'something' };
  victim.emote = { pose: 'lie', until: now + ms };
  addEffect(state, { kind: 'ko', dudeId: victim.id, at: now });
  score(state, victim.id, 'downs');
  if (by && by.id !== victim.id) score(state, by.id, 'kos');
  const line = by ? (by.id === victim.id ? `${victim.name} ${how} themselves` : `${by.name} ${how} ${victim.name}`) : `${victim.name} got ${how}`;
  if (!opts.quiet) pushFeed(state, now, line);
  if (by && by.id !== victim.id) {
    nudge(state, victim, `${by.name} ${how} you and knocked you out. You are back up in a few seconds.`, now);
    pushLine(by.history, { from: 'world', text: `you ${how} ${victim.name} and knocked them out`, at: now }, LIMITS.history);
  }
}

/** A troublemaker who gets beaten gives up and leaves, dropping whatever they were carrying. */
export function knockOutNpc(state: DudesState, npc: Npc, by: Dude, how: string, now: number): void {
  if (npc.ko && npc.ko > now) return;
  npc.ko = now + COMBAT.npcKoMs;
  npc.path = [];
  npc.emote = { pose: 'lie', until: npc.ko };
  npc.say = { text: pick(['Alright! Alright! I am going.', 'Ow. Fine. You win.', 'This is not over.']), until: now + 5000 };
  // Whatever was left of the plan is off: drop the loot, let go of a towed build, and go.
  const leave = [...npc.plan].reverse().find((s) => s.do === 'leave') ?? { do: 'leave' as const, to: clampToGround({ x: GROUND.bounds.minX, z: npc.position.z }, 1) };
  npc.plan = [{ do: 'wait', ms: COMBAT.npcKoMs }, ...(npc.loot?.length ? [{ do: 'drop-hats' as const }] : []), leave];
  npc.towing = undefined;
  if (npc.kind === 'mayor' && state.happening?.npcId === npc.id) state.happening = { ...state.happening, text: 'was chased off. No fines today.', until: undefined, decree: undefined };
  score(state, by.id, 'kos');
  addEffect(state, { kind: 'ko', dudeId: npc.id, at: now });
  pushFeed(state, now, `${by.name} ${how} ${npc.name} and chased them off`);
  pushLine(by.history, { from: 'world', text: `you ${how} ${npc.name} and chased them off the field`, at: now }, LIMITS.history);
  for (const d of state.dudes) if (d !== by && awake(d, now) && dist(d.position, npc.position) < 15) d.emote = { pose: 'cheer', until: now + 3000 };
}
function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Start an attack: resolve nothing here but the target; walk into range in `runAttack`. */
export function startAttack(state: DudesState, dude: Dude, kind: 'dude' | 'npc' | 'object' | 'boss', targetId: string, how: AttackWith, now: number): void {
  // Aboard a tank, a shot (or a bomb, or a throw) is its cannon: they stay in it.
  if (!gunAboard(state, dude) || (how !== 'shoot' && how !== 'bomb' && how !== 'throw')) endUse(state, dude, now);
  dude.emote = undefined;
  dude.attack = { with: how, kind, targetId, phase: 'going', giveUpAt: now + COMBAT.giveUpMs, ...(kind === 'object' ? { left: COMBAT.blows[how] } : {}) };
  dude.path = [];
}
/** The build with a gun this character is driving or riding, if any. */
function gunAboard(state: DudesState, dude: Dude) {
  const o = dude.riding && dude.use && (dude.use.how === 'drive' || dude.use.how === 'ride') ? state.objects.find((x) => x.id === dude.riding) : undefined;
  return o && armedBuild(o) ? o : undefined;
}

/** Aboard a tank: drive into range of the target, then fire its cannon every beat until the shells are spent. */
function runTank(state: DudesState, dude: Dude, tank: NonNullable<ReturnType<typeof gunAboard>>, t: Target, now: number): void {
  const a = dude.attack!;
  const target = where(t);
  const from = tank.driven?.at ?? tank.position;
  const range = WEAPON.cannon.range * 0.85 + reachOf(t);
  const use = dude.use!;
  if (dist(from, target) > range) {
    // Head for it: the run's route is pointed at the target, and the run goes on a while longer.
    const last = use.route?.at(-1);
    if (!last || dist(last, target) > range * 0.6) {
      const dx = from.x - target.x,
        dz = from.z - target.z,
        d = Math.hypot(dx, dz) || 1;
      use.route = [clampToGround({ x: target.x + (dx / d) * range * 0.6, z: target.z + (dz / d) * range * 0.6 }, 2)];
    }
    use.until = Math.max(use.until ?? now, now + 20_000);
    return;
  }
  use.route = [];
  use.until = Math.max(use.until ?? now, now + 6000);
  if ((a.nextAt ?? 0) > now) return;
  a.nextAt = now + 1500;
  tank.driven = { ...tank.driven!, turn: Math.atan2(target.x - from.x, target.z - from.z) };
  dude.facing = tank.driven.turn;
  fire(state, { id: dude.id, name: dude.name, position: dude.position, facing: dude.facing, dude, vehicle: tank }, 'cannon', target, now);
  a.left = (a.left ?? COMBAT.shells) - 1;
  if (a.left <= 0 || (t.kind === 'object' && t.object.destroyedAt !== undefined)) dude.attack = undefined;
}

/** Walk into range, then strike, shoot, throw, or plant the bomb and run. */
export function runAttack(state: DudesState, dude: Dude, now: number, rng: () => number): void {
  const a = dude.attack!;
  if (a.phase === 'fuse') {
    if (now >= (a.fuseUntil ?? now)) {
      explode(state, dude, a.bombAt!, now, rng);
      dude.attack = undefined;
    }
    return;
  }
  const t = find(state, a.kind, a.targetId);
  if (!t || now > a.giveUpAt || (t.kind === 'dude' && (t.dude.hidden || knockedOut(t.dude, now))) || (t.kind === 'object' && t.object.destroyedAt !== undefined)) {
    if (t && now <= a.giveUpAt) pushLine(dude.history, { from: 'world', text: `${nameOf(t)} was out of reach`, at: now }, LIMITS.history);
    dude.attack = undefined;
    return;
  }
  const tank = gunAboard(state, dude);
  if (tank && (a.with === 'shoot' || a.with === 'bomb' || a.with === 'throw')) return runTank(state, dude, tank, t, now);
  const at = where(t);
  const range = COMBAT.range[a.with] + reachOf(t);
  if (dist(dude.position, at) > range) {
    // Re-aim every so often: people move.
    const last = dude.path.at(-1);
    if (!dude.path.length || !last || dist(last, at) > range * 0.6) {
      const dx = dude.position.x - at.x,
        dz = dude.position.z - at.z,
        d = Math.hypot(dx, dz) || 1,
        stand = Math.max(0.9, range * 0.8);
      if (!walkTo(state, dude, { x: at.x + (dx / d) * stand, z: at.z + (dz / d) * stand }, 'job')) dude.attack = undefined;
    }
    return;
  }
  dude.path = [];
  dude.walkingFor = undefined;
  face(dude, at);
  if ((a.nextAt ?? 0) > now) return; // between blows on a build
  const verb = { shove: 'shoved', punch: 'punched', kick: 'kicked', shoot: 'shot', throw: 'hit', bomb: 'bombed' }[a.with];
  if (a.with === 'bomb') {
    // Plant it, light it, run.
    a.phase = 'fuse';
    a.bombAt = { ...dude.position };
    a.fuseUntil = now + COMBAT.fuseMs;
    addEffect(state, { kind: 'bomb', from: a.bombAt, at: now, until: a.fuseUntil });
    const dx = dude.position.x - at.x,
      dz = dude.position.z - at.z,
      d = Math.hypot(dx, dz) || 1;
    walkTo(state, dude, clampToField({ x: dude.position.x + (dx / d) * COMBAT.runFrom, z: dude.position.z + (dz / d) * COMBAT.runFrom }), 'job');
    pushFeed(state, now, `${dude.name} lit a bomb next to ${nameOf(t)}`);
    return;
  }
  if (a.with === 'shove') {
    // A shove: no knockout, just a stumble a metre back, and the one shoved knows who did it.
    dude.emote = { pose: 'push', until: now + 1200 };
    dude.attack = undefined;
    if (t.kind === 'object') return shake(state, t.object.id, now);
    stagger(t.kind === 'dude' ? t.dude : t.npc, dude.position, now);
    if (t.kind === 'dude') nudge(state, t.dude, `${dude.name} shoved you`, now);
    return;
  }
  dude.emote = { pose: a.with === 'kick' ? 'kick' : a.with === 'shoot' ? 'point' : 'punch', until: now + 1500 };
  // At a build, the line lands on its near side.
  const near = t.kind === 'object' ? edgeOf(t.object, dude.position) : at;
  if (a.with === 'shoot' || a.with === 'throw') addEffect(state, { kind: a.with === 'shoot' ? 'shot' : 'throw', from: dude.position, to: near, at: now });
  const hit = rng() < COMBAT.hit[a.with];
  if (t.kind === 'object') {
    // A few blows, a beat apart: each takes a little off (damage.ts).
    if (hit || a.with !== 'shoot') damageBuild(state, t.object, COMBAT.buildDamage[a.with], { name: dude.name, id: dude.id }, now, near, a.with === 'kick' ? 0.5 : 1.2);
    else shake(state, t.object.id, now);
    a.left = (a.left ?? 1) - 1;
    a.nextAt = now + COMBAT.blowMs;
    if (a.left <= 0 || t.object.destroyedAt !== undefined) dude.attack = undefined;
    return;
  }
  dude.attack = undefined;
  if (!hit) {
    pushLine(dude.history, { from: 'world', text: `you ${a.with === 'shoot' ? 'shot at' : 'swung at'} ${nameOf(t)} and missed`, at: now }, LIMITS.history);
    if (t.kind === 'dude') t.dude.emote = { pose: 'jump', until: now + 1200 };
    return;
  }
  if (t.kind === 'dude') knockOut(state, t.dude, dude, verb, now);
  else knockOutNpc(state, t.npc, dude, verb, now);
}

/** Everything within the blast: characters out, troublemakers off, builds blown apart (fixable). */
function explode(state: DudesState, bomber: Dude, at: GroundPoint, now: number, rng: () => number): void {
  addEffect(state, { kind: 'boom', from: at, radius: COMBAT.blast, at: now });
  for (const d of state.dudes) if (!d.hidden && dist(d.position, at) <= COMBAT.blast) knockOut(state, d, bomber, 'blew up', now);
  for (const n of state.npcs ?? []) if (dist(n.position, at) <= COMBAT.blast) knockOutNpc(state, n, bomber, 'blew up', now);
  // Builds: the nearest takes the full charge, the rest less the further off (damage.ts).
  blast(state, { id: bomber.id, name: bomber.name, position: bomber.position, facing: bomber.facing, dude: bomber }, at, COMBAT.buildDamage.bomb, COMBAT.blast, undefined, now, 'blew up');
  void rng;
}

/** The point on a build's edge nearest `from`. */
function edgeOf(o: SafehouseObject, from: GroundPoint): GroundPoint {
  const c = o.driven?.at ?? o.position;
  return {
    x: Math.max(c.x - o.footprint.width / 2, Math.min(c.x + o.footprint.width / 2, from.x)),
    z: Math.max(c.z - o.footprint.depth / 2, Math.min(c.z + o.footprint.depth / 2, from.z)),
  };
}

/** Blown apart: the parts tumble outward and down. The design before is kept so `fix` puts it back. */
export function wreck(state: DudesState, o: SafehouseObject, by: Dude, rng: () => number, now: number): void {
  if (state.hatPiles?.[o.id]) return;
  state.vandalised ??= {};
  state.vandalised[o.id] ??= { by: by.name, kind: 'wrecked', original: structuredClone(o.blueprint) };
  state.vandalised[o.id].kind = 'wrecked';
  state.vandalised[o.id].by = by.name;
  const next: Blueprint = structuredClone(o.blueprint);
  const clamp = (v: number, n: number) => Math.max(-n, Math.min(n, v));
  for (const p of next.parts) {
    const spread = 0.4 + rng() * 0.8;
    const len = Math.hypot(p.position[0], p.position[2]) || 1;
    p.position = [
      clamp(p.position[0] + (p.position[0] / len) * spread, 11),
      Math.max(p.size[1] / 2, p.position[1] * 0.25),
      clamp(p.position[2] + (p.position[2] / len) * spread, 11),
    ];
    p.rotation = p.rotation.map((r) => clamp(r + (rng() - 0.5) * 1.2, Math.PI * 2 - 0.01)) as typeof p.rotation;
  }
  o.blueprint = next;
  o.revision++;
  state.worldRevision++;
  const owner = state.dudes.find((d) => d.id === o.owner);
  if (owner && owner.id !== by.id) nudge(state, owner, `${by.name} blew up your build ${o.blueprint.name}. Use it with "fix" to put it back.`, now);
}

/** A vehicle on a run knocks down whoever is in its way. */
export function runOver(state: DudesState, driver: Dude, at: GroundPoint, now: number, vehicle?: SafehouseObject): void {
  const reach = vehicle ? Math.max(COMBAT.runOverReach, Math.min(vehicle.footprint.width, vehicle.footprint.depth) / 2 + 0.5) : COMBAT.runOverReach;
  for (const d of state.dudes)
    if (d !== driver && !d.riding && !d.hidden && !d.y && !knockedOut(d, now) && dist(d.position, at) < reach)
      knockOut(state, d, driver, 'ran over', now);
  for (const n of state.npcs ?? []) if (!(n.ko && n.ko > now) && dist(n.position, at) < reach) knockOutNpc(state, n, driver, 'ran over', now);
}

/** Knocked back a step from `from` (if there is ground there), stumbling. */
export function stagger(who: { position: GroundPoint; facing: number; path: GroundPoint[]; emote?: { pose: import('../../shared/dudesTypes').Emote; until: number } }, from: GroundPoint, now: number): void {
  const dx = who.position.x - from.x,
    dz = who.position.z - from.z,
    d = Math.hypot(dx, dz) || 1;
  const to = clampToGround({ x: who.position.x + (dx / d) * 1.1, z: who.position.z + (dz / d) * 1.1 }, 1);
  if (walkableSegment(who.position, to, [])) who.position = to;
  who.facing = Math.atan2(-dx, -dz);
  who.path = [];
  who.emote = { pose: 'stagger', until: now + 1200 };
}

/** Back up after a knockout. */
export function recover(dude: Dude, now: number): void {
  if (dude.ko && dude.ko.until <= now) {
    dude.ko = undefined;
    dude.emote = { pose: 'think', until: now + 2000 };
  }
}

function clampToField(p: GroundPoint): GroundPoint {
  return clampToGround(p, 1);
}

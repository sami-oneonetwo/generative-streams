import type {
  CombatState,
  CreatureBehaviour,
  SafehouseObject,
  GroundPoint,
  Primitive,
  WaveState,
  Zombie,
  ZombieKind,
} from '../../shared/safehouseTypes';
import { footprint, contains, HOUSE_ID } from '../../shared/safehouseLayout';
import { route, walkableSegment } from './placement';
export const MAX_ZOMBIES = 24,
  ARCHIVE_CAP = 100;
/** Wave pacing. Prep is long enough for a couple of chat builds and Rook's repair round. */
export const PREP_MS = 180000,
  WAVE_CAP_MS = 150000, // after the last spawn, whatever is still standing loses interest and shambles off
  SPAWN_EVERY_MS = 6000,
  SPAWN_BATCH = 2;
/** Server-owned zombie profiles; the model never picks these numbers. `from` is the first wave they appear in. */
export const ZOMBIE_KINDS: Record<
  ZombieKind,
  { health: number; speed: number; damage: number; cooldown: number; from: number }
> = {
  walker: { health: 60, speed: 0.7, damage: 8, cooldown: 1200, from: 1 },
  runner: { health: 35, speed: 1.5, damage: 5, cooldown: 800, from: 3 },
  brute: { health: 220, speed: 0.45, damage: 24, cooldown: 1600, from: 5 },
};
/**
 * Server-owned profiles for chat's living builds (creatures.ts runs them); the model
 * only names the behaviour. Speeds in m/s, cooldowns in ms.
 */
export const CREATURES: Record<
  CreatureBehaviour,
  { health: number; speed: number; damage: number; cooldownMs: number; hostile: boolean }
> = {
  rampage: { health: 300, speed: 2.2, damage: 12, cooldownMs: 1500, hostile: true }, // runs around breaking things
  fight: { health: 150, speed: 3, damage: 10, cooldownMs: 1000, hostile: false }, // bites rampagers and zombies, else sticks with Rook
  zoom: { health: 60, speed: 6, damage: 0, cooldownMs: 0, hostile: false }, // tears around the neighborhood, harmless
  roam: { health: 60, speed: 1, damage: 0, cooldownMs: 0, hostile: false }, // ambles about, harmless
};
/**
 * Living things standing at once across the block; a neighborhood, not a zoo. Raised from 12 with
 * the neighbours' own budget (NEIGHBOUR_CREATURE_BUDGET, 5) so their menagerie never comes out of
 * chat's share: viewers keep the ten they always had.
 */
export const MAX_CREATURES = 15;
export const isHostile = (o: SafehouseObject) => !!o.creature && CREATURES[o.creature.behaviour].hostile;
export const healthFor = (role: SafehouseObject['role']) =>
  role === 'barrier' ? 240 : role === 'turret' ? 120 : 80;
export const intact = (o: SafehouseObject) => o.destroyedAt === undefined;
/** Standing, solid things a zombie could hit; floors are never targets. */
const attackable = (o: SafehouseObject) => intact(o) && !o.passable;
/** The fence lines and everything inside them. Backdrop scenery beyond (neighbor houses, street trees,
 *  abandoned cars) still blocks movement and shots but is never a target: a horde that wanders off to
 *  chew a tree two lots over never meets the defenses, and the wave drags on until the cut-off. */
const FENCED_YARD = { minX: -11.5, maxX: 13.5, minZ: -18.5, maxZ: 5 };
// What the neighbours build (`owner`) is theirs to defend against chat's creatures; the horde
// walks past it the way it walks past their houses.
const worthAttacking = (o: SafehouseObject) =>
  !o.owner && (!o.fixed || o.role !== 'decoration' || contains(FENCED_YARD, o.position));
const stats = (z: Zombie) => ZOMBIE_KINDS[z.kind ?? 'walker'];

/** Wave n: 3+n walkers, runners from wave 3, brutes from wave 5, capped at MAX_ZOMBIES by trimming walkers. */
export function waveRoster(n: number): ZombieKind[] {
  const counts: Record<ZombieKind, number> = {
    walker: 3 + n,
    runner: n >= ZOMBIE_KINDS.runner.from ? Math.floor((n - 1) / 2) : 0,
    brute: n >= ZOMBIE_KINDS.brute.from ? Math.floor((n - 3) / 2) : 0,
  };
  // Big waves fill the cap with the nastier kinds: trim walkers first, then runners, then brutes.
  for (const kind of Object.keys(counts) as ZombieKind[]) {
    const over = counts.walker + counts.runner + counts.brute - MAX_ZOMBIES;
    if (over <= 0) break;
    counts[kind] -= Math.min(counts[kind], over);
  }
  // Interleave so the mix arrives together instead of all walkers first.
  const pools: [ZombieKind, number][] = [
    ['walker', counts.walker],
    ['runner', counts.runner],
    ['brute', counts.brute],
  ];
  const roster: ZombieKind[] = [];
  while (pools.some(([, left]) => left > 0))
    for (const pool of pools)
      if (pool[1] > 0) {
        roster.push(pool[0]);
        pool[1]--;
      }
  return roster;
}
export function describeRoster(roster: ZombieKind[]): string {
  const counts = new Map<ZombieKind, number>();
  for (const kind of roster) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return (Object.keys(ZOMBIE_KINDS) as ZombieKind[])
    .filter((kind) => counts.get(kind))
    .map((kind) => `${counts.get(kind)} ${kind}${counts.get(kind) === 1 ? '' : 's'}`)
    .join(', ');
}
export function freshWave(time = 0): WaveState {
  return {
    number: 1,
    phase: 'prep',
    phaseEndsAt: time + PREP_MS,
    queue: [],
    nextSpawnAt: 0,
    spawned: 0,
    killed: 0,
    best: 0,
  };
}
export function freshCombat(paused = true): CombatState {
  return { paused, time: 0, sequence: 0, kills: 0, zombies: [], shots: [], archive: [], wave: freshWave(0) };
}
export function initializeObject(o: SafehouseObject): SafehouseObject {
  const full = o.creature ? CREATURES[o.creature.behaviour].health : healthFor(o.role);
  return {
    ...o,
    role: o.role ?? 'decoration',
    health: o.health ?? full,
    maxHealth: o.maxHealth ?? full,
    damageRevision: o.damageRevision ?? 0,
    lifecycle: o.lifecycle ?? 1,
    nextShotAt: o.nextShotAt ?? 0,
  };
}
export function fenceObjects(): SafehouseObject[] {
  const objects: SafehouseObject[] = [];
  function run(x: number, z: number, length: number, axis: 'x' | 'z') {
    for (let i = 0; i < length; i += 3) {
      const len = Math.min(3, length - i);
      const p = { x: x + (axis === 'x' ? i + len / 2 : 0), z: z + (axis === 'z' ? i + len / 2 : 0) };
      const parts: Primitive[] = [];
      for (let k = -len / 2 + 0.15; k < len / 2; k += 0.3)
        parts.push({
          shape: 'box',
          position: [axis === 'x' ? k : 0, 0.9, axis === 'z' ? k : 0],
          size: axis === 'x' ? [0.24, 1.8, 0.12] : [0.12, 1.8, 0.24],
          rotation: [0, 0, 0],
          color: '#8c8164',
        });
      for (const y of [0.5, 1.3])
        parts.push({
          shape: 'box',
          position: [0, y, 0],
          size: axis === 'x' ? [len, 0.12, 0.16] : [0.16, 0.12, len],
          rotation: [0, 0, 0],
          color: '#746b55',
        });
      objects.push(
        initializeObject({
          id: `fence-${objects.length}`,
          revision: 1,
          blueprint: {
            name: `Fence section ${objects.length + 1}`,
            description: 'Salvaged perimeter fence',
            parts,
          },
          position: p,
          footprint: {
            width: axis === 'x' ? Math.max(0.5, len) : 0.5,
            depth: axis === 'z' ? Math.max(0.5, len) : 0.5,
          },
          createdBy: 'Neighborhood',
          editedBy: 'Neighborhood',
          createdAt: 0,
          role: 'barrier',
          fixed: true,
        }),
      );
    }
  }
  run(-11, -18, 24, 'x');
  run(-11, -18, 22.6, 'z');
  run(13, -18, 22.6, 'z');
  run(-11, 4.6, 15, 'x');
  run(9.8, 4.6, 3.2, 'x');
  return objects;
}
function objectDistance(p: GroundPoint, o: SafehouseObject) {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
}
export function lineOfSight(
  a: GroundPoint,
  b: GroundPoint,
  objects: SafehouseObject[],
  ignore?: string,
): boolean {
  const blocks = objects
    .filter((o) => attackable(o) && o.id !== ignore)
    .map((o) => footprint(o.position, o.footprint.width, o.footprint.depth));
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15);
  for (let i = 1; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
    if (blocks.some((r) => contains(r, p))) return false;
  }
  return true;
}
// Around the block: across the street from the gate, the far side of the street by the shop and
// the park, both street ends and the back lanes. Near and far mixed, so a wave arrives in a
// trickle over a minute rather than all at once or all late.
export const SPAWN_POINTS: GroundPoint[] = [
  { x: 1, z: 18 },
  { x: 7, z: 18 },
  { x: -20, z: 18 },
  { x: 28, z: 18 },
  { x: -53, z: 2 },
  { x: 53, z: 2 },
  { x: -40, z: 18 },
  { x: 44, z: 18 },
  { x: -53, z: -10 },
  { x: 53, z: -10 },
  { x: -53, z: 12 },
  { x: 53, z: 12 },
];
export function spawnZombie(combat: CombatState, kind: ZombieKind = 'walker'): Zombie | undefined {
  if (combat.zombies.length >= MAX_ZOMBIES) return undefined;
  const id = ++combat.sequence,
    p = SPAWN_POINTS[(id - 1) % SPAWN_POINTS.length],
    profile = ZOMBIE_KINDS[kind];
  const zombie: Zombie = {
    id: `z${id}`,
    kind,
    position: { ...p },
    health: profile.health,
    maxHealth: profile.health,
    facing: Math.PI,
    attackAt: combat.time + 1000,
    path: [],
    replanAt: 0,
  };
  combat.zombies.push(zombie);
  return zombie;
}
/** The operator's "send a few": walkers on top of whatever the wave is doing. */
export function spawnGroup(combat: CombatState, count = 3): void {
  for (let i = 0; i < count; i++) if (!spawnZombie(combat, 'walker')) break;
}
export function damageObject(o: SafehouseObject, amount: number, time: number) {
  if (!intact(o)) return;
  o.health = Math.max(0, (o.health ?? 80) - amount);
  o.damageRevision = (o.damageRevision ?? 0) + 1;
  if (o.health === 0) {
    o.destroyedAt = time;
    o.lifecycle = (o.lifecycle ?? 1) + 1;
  }
}
/**
 * One substep of the wave clock. Prep counts down (with two warnings), the wave
 * spawns its roster in small batches, and the wave ends when everything is down
 * or the stragglers time out. Losing the house ends the run: the counter goes
 * back to 1 once that wave is over. Returns true when something durable changed.
 */
function tickWave(combat: CombatState, objects: SafehouseObject[], events: string[]): boolean {
  const w = combat.wave;
  let changed = false;
  if (w.phase === 'prep') {
    const left = w.phaseEndsAt - combat.time;
    if (left <= 60000 && left > 10000 && w.warned === undefined) {
      w.warned = 60000;
      events.push(`One minute until wave ${w.number}. Get your defenses up.`);
    }
    if (left <= 10000 && left > 0 && w.warned !== 10000) {
      w.warned = 10000;
      events.push(`Wave ${w.number} in ten seconds. Brace.`);
    }
    if (left > 0) return false;
    w.phase = 'wave';
    w.queue = waveRoster(w.number);
    w.nextSpawnAt = combat.time;
    w.phaseEndsAt = combat.time + WAVE_CAP_MS;
    w.spawned = 0;
    w.killed = 0;
    w.fellThisWave = false;
    events.push(`Wave ${w.number} incoming — ${describeRoster(w.queue)}.`);
    changed = true; // and fall through: the first batch arrives with the announcement
  }
  if (w.queue.length && combat.time >= w.nextSpawnAt) {
    for (let i = 0; i < SPAWN_BATCH && w.queue.length; i++) {
      if (!spawnZombie(combat, w.queue[0])) break; // at the cap: try again next batch
      w.queue.shift();
      w.spawned++;
    }
    w.nextSpawnAt = combat.time + SPAWN_EVERY_MS;
    w.phaseEndsAt = combat.time + WAVE_CAP_MS;
    changed = true;
  }
  const house = objects.find((o) => o.id === HOUSE_ID);
  if (house && !intact(house) && !w.fellThisWave) {
    w.fellThisWave = true;
    w.fell = w.number;
    events.push(`The house fell on wave ${w.number}. Hold what you can; we start over after this one.`);
    changed = true;
  }
  if (combat.time >= w.phaseEndsAt) w.queue = []; // spawns blocked at the cap never arrive
  if (w.queue.length || (combat.zombies.length && combat.time < w.phaseEndsAt)) return changed;
  if (combat.zombies.length) {
    combat.zombies = [];
    events.push(`The stragglers shambled off. Wave ${w.number} is over.`);
  } else events.push(`Wave ${w.number} cleared — ${w.killed} down.`);
  if (w.fellThisWave) {
    events.push("Starting over from wave 1. Rook's on the house.");
    w.number = 1;
  } else {
    w.best = Math.max(w.best, w.number);
    w.number++;
  }
  w.phase = 'prep';
  w.phaseEndsAt = combat.time + PREP_MS;
  w.warned = undefined;
  w.fellThisWave = false;
  return true;
}
export function tickCombat(
  combat: CombatState,
  objects: SafehouseObject[],
  dt: number,
): { objects: SafehouseObject[]; changed: boolean; events: string[] } {
  const events: string[] = [];
  if (combat.paused) return { objects, changed: false, events };
  if (combat.archive.length >= ARCHIVE_CAP) {
    combat.paused = true;
    return { objects, changed: true, events };
  }
  let changed = false;
  let remaining = Math.min(Math.max(dt, 0), 1000);
  while (remaining > 0) {
    const step = Math.min(250, remaining);
    remaining -= step;
    combat.time += step;
    if (tickWave(combat, objects, events)) changed = true;
    // Creatures neither block zombies nor draw them: the horde is after the structures.
    const living = objects.filter((o) => attackable(o) && !o.creature);
    const hostiles = objects.filter((o) => isHostile(o) && intact(o));
    // Defenses and chat creations draw zombies first; parked cars and furniture only when nothing better is near.
    const lure = (z: GroundPoint, o: SafehouseObject) =>
      objectDistance(z, o) + (o.fixed && o.role === 'decoration' ? 6 : 0);
    for (const turret of living.filter((o) => o.role === 'turret')) {
      if ((turret.nextShotAt ?? 0) > combat.time) continue;
      const range = (p: GroundPoint) => Math.hypot(p.x - turret.position.x, p.z - turret.position.z);
      // Zombies and rampaging creatures alike; a turret does not care what is wrecking the yard.
      const marks: { position: GroundPoint; zombie?: Zombie; creature?: SafehouseObject }[] = [
        ...combat.zombies.filter((z) => z.health > 0).map((z) => ({ position: z.position, zombie: z })),
        ...hostiles.map((o) => ({ position: o.position, creature: o })),
      ];
      const victim = marks
        .filter((m) => range(m.position) <= 9)
        .sort((a, b) => range(a.position) - range(b.position))
        .find((m) => lineOfSight(turret.position, m.position, living, turret.id));
      if (victim) {
        if (victim.zombie) {
          victim.zombie.health -= 20;
          if (victim.zombie.health <= 0) {
            combat.kills++;
            combat.wave.killed++;
          }
        } else if (victim.creature) {
          damageObject(victim.creature, 20, combat.time);
          changed = true;
        }
        turret.nextShotAt = combat.time + 1000;
        combat.shots.push({
          id: ++combat.sequence,
          from: { ...turret.position },
          to: { ...victim.position },
          ...(victim.creature?.creature?.flying ? { toY: Math.max(1.1, victim.creature.creature.altitude ?? 0) } : {}),
          at: combat.time,
        });
      }
    }
    combat.zombies = combat.zombies.filter((z) => z.health > 0);
    for (const zombie of combat.zombies) {
      const profile = stats(zombie);
      let target = living.find((o) => o.id === zombie.targetId && intact(o));
      if (combat.time >= zombie.replanAt || (zombie.targetId && !target)) {
        zombie.replanAt = combat.time + 4000;
        zombie.path = [];
        target = undefined;
        const choices = living
          .filter(worthAttacking)
          .sort((a, b) => lure(zombie.position, a) - lure(zombie.position, b))
          .slice(0, 5);
        for (const candidate of choices) {
          const r = footprint(candidate.position, candidate.footprint.width, candidate.footprint.depth);
          const approach = [
            { x: candidate.position.x, z: r.maxZ + 0.75 },
            { x: candidate.position.x, z: r.minZ - 0.75 },
            { x: r.minX - 0.75, z: candidate.position.z },
            { x: r.maxX + 0.75, z: candidate.position.z },
          ].sort(
            (a, b) =>
              Math.hypot(a.x - zombie.position.x, a.z - zombie.position.z) -
              Math.hypot(b.x - zombie.position.x, b.z - zombie.position.z),
          );
          for (const p of approach) {
            const path = route(zombie.position, p, living);
            if (path) {
              target = candidate;
              zombie.path = path;
              break;
            }
          }
          if (target) break;
        }
        zombie.targetId = target?.id;
      }
      if (target && intact(target) && objectDistance(zombie.position, target) <= 1.05) {
        zombie.facing = Math.atan2(
          target.position.x - zombie.position.x,
          target.position.z - zombie.position.z,
        );
        if (combat.time >= zombie.attackAt) {
          damageObject(target, profile.damage, combat.time);
          zombie.attackAt = combat.time + profile.cooldown;
          changed = true;
        }
        continue;
      }
      // Spend the whole step's travel across waypoints; stopping at each one made fast kinds crawl.
      let budget = (step / 1000) * profile.speed;
      while (budget > 0 && zombie.path[0]) {
        const next = zombie.path[0];
        if (!walkableSegment(zombie.position, next, living)) {
          zombie.path = [];
          zombie.replanAt = 0;
          break;
        }
        const dx = next.x - zombie.position.x,
          dz = next.z - zombie.position.z,
          d = Math.hypot(dx, dz);
        if (d > 0.001) zombie.facing = Math.atan2(dx, dz);
        if (d <= budget) {
          zombie.position = { ...next };
          zombie.path.shift();
          budget -= d;
        } else {
          zombie.position.x += (dx / d) * budget;
          zombie.position.z += (dz / d) * budget;
          budget = 0;
        }
      }
    }
  }
  combat.shots = combat.shots.filter((s) => combat.time - s.at < 1200).slice(-32);
  const expired = objects.filter((o) => o.destroyedAt !== undefined && combat.time - o.destroyedAt >= 12000);
  for (const o of expired) {
    if (combat.archive.length >= ARCHIVE_CAP) {
      combat.paused = true;
      break;
    }
    combat.archive.push(structuredClone(o));
    objects = objects.filter((x) => x.id !== o.id);
    changed = true;
  }
  return { objects, changed, events };
}

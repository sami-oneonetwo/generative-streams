// The block's own small life: three birds, a stray cat, two rats. Ordinary world objects (inspect
// them, paint them, move them) with a `creature` that roams and `rules` (rules.ts) that give each
// its habits — birds perch on whatever is tagged `perch` and scatter from zombies, viewers and
// scarecrows; the cat sits by seats and keeps clear of dogs and the horde; rats hang about the
// skip and bolt from people. They are `wild`: they count against nobody's budget, are never
// repaired or archived (a downed one is simply gone and the pool refills after a minute or two),
// and the operator can send them away. Zero AI calls; every number here is the app's.
import type { PartAnimation, Primitive, Rule, SafehouseObject, Use } from '../../shared/safehouseTypes';
import { FLIGHT } from './locomotion';
import { freshCreature } from './creatures';
import { initializeObject, intact, fenceObjects } from './combat';
import { measureBlueprint, SCENERY_LIMITS } from './blueprint';
import { clampAnimations, clampRules } from './rules';
import { sceneryObjects } from './scenery';
import type { CombatState } from '../../shared/safehouseTypes';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
type V3 = [number, number, number];
const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'box',
  position: [x, y, z],
  size: [w, h, d],
  rotation,
  color: hex(color),
});
const ball = (r: number, color: number, x: number, y: number, z: number, squash = 1): Primitive => ({
  shape: 'sphere',
  position: [x, y, z],
  size: [r * 2, r * 2 * squash, r * 2],
  rotation: [0, 0, 0],
  color: hex(color),
});
const cyl = (r: number, h: number, color: number, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'cylinder',
  position: [x, y, z],
  size: [r * 2, h, r * 2],
  rotation,
  color: hex(color),
});
const cone = (r: number, h: number, color: number, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'cone',
  position: [x, y, z],
  size: [r * 2, h, r * 2],
  rotation,
  color: hex(color),
});

/** A small bird: body, head, beak, two wings that flap, a tail. Under half a metre. */
function bird(body: number, headColor: number, beak: number): { parts: Primitive[]; animations: PartAnimation[] } {
  const parts = [
    ball(0.11, body, 0, 0.14, 0, 0.8), // 0 body
    ball(0.07, headColor, 0, 0.25, 0.1), // 1 head
    cone(0.025, 0.08, beak, 0, 0.245, 0.2, [Math.PI / 2, 0, 0]), // 2 beak
    box(0.17, 0.02, 0.1, body, -0.14, 0.16, 0, [0, 0, 0.12]), // 3 left wing
    box(0.17, 0.02, 0.1, body, 0.14, 0.16, 0, [0, 0, -0.12]), // 4 right wing
    box(0.035, 0.02, 0.13, headColor, 0, 0.15, -0.15, [-0.25, 0, 0]), // 5 tail
  ];
  const animations: PartAnimation[] = [
    { part: 3, kind: 'sway', axis: 'z', speed: 2.4, amplitude: 0.5, phase: 0 },
    { part: 4, kind: 'sway', axis: 'z', speed: 2.4, amplitude: 0.5, phase: Math.PI },
  ];
  return { parts, animations };
}
function cat(): { parts: Primitive[]; animations: PartAnimation[] } {
  const fur = 0x6f6a66,
    dark = 0x4f4b48;
  const parts = [
    box(0.22, 0.2, 0.5, fur, 0, 0.27, 0), // 0 body
    box(0.18, 0.16, 0.16, fur, 0, 0.38, 0.3), // 1 head
    cone(0.035, 0.08, dark, -0.06, 0.49, 0.3), // 2 ear
    cone(0.035, 0.08, dark, 0.06, 0.49, 0.3), // 3 ear
    cyl(0.022, 0.36, dark, 0, 0.38, -0.32, [0.7, 0, 0]), // 4 tail
    box(0.06, 0.17, 0.06, dark, -0.07, 0.085, 0.17), // 5-8 legs
    box(0.06, 0.17, 0.06, dark, 0.07, 0.085, 0.17),
    box(0.06, 0.17, 0.06, dark, -0.07, 0.085, -0.17),
    box(0.06, 0.17, 0.06, dark, 0.07, 0.085, -0.17),
  ];
  const animations: PartAnimation[] = [{ part: 4, kind: 'sway', axis: 'x', speed: 0.7, amplitude: 0.3, phase: 0 }];
  return { parts, animations };
}
function rat(): { parts: Primitive[]; animations: PartAnimation[] } {
  const fur = 0x5a534f;
  const parts = [
    ball(0.07, fur, 0, 0.07, 0, 0.8), // 0 body
    ball(0.045, fur, 0, 0.08, 0.09), // 1 head
    cyl(0.01, 0.2, 0x8a7a72, 0, 0.05, -0.15, [1.35, 0, 0]), // 2 tail
    ball(0.02, 0x9a8a82, -0.035, 0.11, 0.1), // 3-4 ears
    ball(0.02, 0x9a8a82, 0.035, 0.11, 0.1),
  ];
  const animations: PartAnimation[] = [{ part: 2, kind: 'sway', axis: 'y', speed: 1.1, amplitude: 0.35, phase: 0 }];
  return { parts, animations };
}

const BIRD_RULES: Rule[] = [
  { when: 'near', target: { kind: 'zombie', within: 3 }, do: 'flee' },
  { when: 'near', target: { kind: 'viewer', within: 2.5 }, do: 'flee' },
  { when: 'near', target: { tag: 'scare', within: 4 }, do: 'flee' },
  { when: 'tick', target: { tag: 'perch', pick: 'random', within: 30 }, do: 'perch', dwell: [8, 25] },
];
const CAT_RULES: Rule[] = [
  { when: 'near', target: { kind: 'zombie', within: 4 }, do: 'flee' },
  { when: 'near', target: { kind: 'creature', within: 3 }, do: 'flee' },
  { when: 'tick', target: { tag: 'seat', pick: 'nearest', within: 25 }, do: 'visit', dwell: [15, 45] },
];
const RAT_RULES: Rule[] = [
  { when: 'near', target: { kind: 'rook', within: 3 }, do: 'flee' },
  { when: 'near', target: { kind: 'neighbour', within: 3 }, do: 'flee' },
  { when: 'near', target: { kind: 'zombie', within: 3 }, do: 'flee' },
];

interface WildSpec {
  id: string;
  name: string;
  description: string;
  body: () => { parts: Primitive[]; animations: PartAnimation[] };
  rules: Rule[];
  flying: boolean;
  /** Where it appears: a fixed spot, or beside a piece when that piece stands. */
  spawn: { x: number; z: number; near?: string };
}
/** The pool. Ids are fixed so a save carries at most one of each. */
export const WILDLIFE: readonly WildSpec[] = [
  { id: 'wild-bird-1', name: 'Sparrow', description: "One of the block's birds", body: () => bird(0x8b7355, 0x6b5537, 0x3a3025), rules: BIRD_RULES, flying: true, spawn: { x: -52, z: -14 } },
  { id: 'wild-bird-2', name: 'Magpie', description: "One of the block's birds", body: () => bird(0x2b2b2e, 0xe8e8df, 0x3a3025), rules: BIRD_RULES, flying: true, spawn: { x: 52, z: 15 } },
  { id: 'wild-bird-3', name: 'Crow', description: "One of the block's birds", body: () => bird(0x1c1c22, 0x2a2a30, 0x2a2622), rules: BIRD_RULES, flying: true, spawn: { x: 31, z: -15 } },
  { id: 'wild-cat', name: 'Stray cat', description: 'A stray that lives behind the corner shop', body: cat, rules: CAT_RULES, flying: false, spawn: { x: -46, z: -12.5, near: 'scenery-skip' } },
  { id: 'wild-rat-1', name: 'Rat', description: 'Lives in the skip', body: rat, rules: RAT_RULES, flying: false, spawn: { x: -49.5, z: -11.8, near: 'scenery-skip' } },
  { id: 'wild-rat-2', name: 'Rat', description: 'Lives in the skip', body: rat, rules: RAT_RULES, flying: false, spawn: { x: -46.5, z: -14.8, near: 'scenery-skip' } },
];
export const isWild = (o: { wild?: boolean }): boolean => !!o.wild;
/** Where scenery.ts seeds the skip; the cat's and rats' spots are offsets from it. */
const SKIP_SEED = { x: -48, z: -13.5 };
/** A downed one comes back after this long. */
export const RESPAWN_MS: [number, number] = [60_000, 120_000];
const respawnAt = new Map<string, number>();
/** Tests and restarts: forget pending respawns. */
export function resetWildlifeMemory(): void {
  respawnAt.clear();
}

interface WildWorld {
  objects: SafehouseObject[];
  combat: CombatState;
  wildlifePaused?: boolean;
}
function spawnOne(spec: WildSpec, w: WildWorld, now: number): SafehouseObject {
  const { parts, animations } = spec.body();
  const blueprint = { name: spec.name, description: spec.description, parts, animations: clampAnimations(animations, parts.length) };
  const anchor = spec.spawn.near ? w.objects.find((o) => o.id === spec.spawn.near && intact(o)) : undefined;
  // The spot is written relative to where the anchor was seeded, so it follows the anchor if chat moved it.
  const position = anchor
    ? { x: anchor.position.x + (spec.spawn.x - SKIP_SEED.x), z: anchor.position.z + (spec.spawn.z - SKIP_SEED.z) }
    : { x: spec.spawn.x, z: spec.spawn.z };
  const creature = freshCreature('roam', spec.flying);
  if (spec.flying) creature.altitude = FLIGHT.cruise; // arrives on the wing, not out of the ground
  return initializeObject({
    id: spec.id,
    revision: 1,
    blueprint,
    position,
    footprint: measureBlueprint(blueprint, SCENERY_LIMITS),
    createdBy: 'Neighborhood',
    editedBy: 'Neighborhood',
    createdAt: now,
    role: 'decoration',
    fixed: true,
    wild: true,
    creature,
    rules: clampRules(spec.rules),
  });
}
/** Any pool member not about (and not waiting to come back) appears at its spot. */
export function ensureWildlife(w: WildWorld, now: number): boolean {
  if (w.wildlifePaused) return false;
  let changed = false;
  for (const spec of WILDLIFE) {
    if (w.objects.some((o) => o.id === spec.id)) continue;
    if ((respawnAt.get(spec.id) ?? 0) > now) continue;
    w.objects.push(spawnOne(spec, w, now));
    respawnAt.delete(spec.id);
    changed = true;
  }
  return changed;
}
/**
 * One world tick for the pool: a downed one is removed outright (never rubble, never the archive)
 * and booked to come back; the operator's pause clears them all; then the pool is topped up.
 * Returns whether the object list changed (the caller bumps the world revision and saves).
 */
export function tickWildlife(w: WildWorld, now: number, rng: () => number): boolean {
  let changed = false;
  for (const o of w.objects) {
    if (!o.wild || intact(o)) continue;
    respawnAt.set(o.id, now + RESPAWN_MS[0] + rng() * (RESPAWN_MS[1] - RESPAWN_MS[0]));
    changed = true;
  }
  if (changed) w.objects = w.objects.filter((o) => !o.wild || intact(o));
  if (w.combat.archive.some(isWild)) {
    w.combat.archive = w.combat.archive.filter((o) => !o.wild);
    changed = true;
  }
  if (w.wildlifePaused) {
    if (w.objects.some(isWild)) {
      w.objects = w.objects.filter((o) => !o.wild);
      changed = true;
    }
    return changed;
  }
  return ensureWildlife(w, now) || changed;
}

/**
 * The neighbours' catalogue pieces that mean something to the animals, by their catalogue name.
 * By name rather than by id: a themed yard redoes a piece in place under the same id, so the
 * `-hoop` id may hold a rusted V8 by now, and Jake should not be shooting hoops at an engine.
 */
const OWNED_USES: [RegExp, Use[]][] = [
  [/'s bird bath$/i, ['perch']],
  [/'s scarecrow$/i, ['scare']],
  [/'s bench$/i, ['seat']],
  [/'s basketball hoop$/i, ['hoop']],
];
/**
 * Start-up fixup for saves from before uses and animations existed: the neighborhood pieces and
 * the neighbours' catalogue pieces get theirs attached in place. No revision bump — neither is
 * geometry, and the page reads animations off the view — and a piece chat has redesigned (revision
 * above one) keeps its own shape unanimated, since the part indices would no longer line up.
 */
export function adoptLife(w: { objects: SafehouseObject[]; combat: CombatState }): boolean {
  let changed = false;
  const seeds = new Map([...sceneryObjects(), ...fenceObjects()].map((o) => [o.id, o]));
  for (const o of [...w.objects, ...w.combat.archive]) {
    const seed = seeds.get(o.id);
    if (seed) {
      if (!o.uses && seed.uses) {
        o.uses = [...seed.uses];
        changed = true;
      }
      if (!o.blueprint.animations && seed.blueprint.animations && o.revision === 1 && o.blueprint.parts.length === seed.blueprint.parts.length) {
        o.blueprint = { ...o.blueprint, animations: structuredClone(seed.blueprint.animations) };
        changed = true;
      }
      // The park's own verbs (the pond to swim in): a piece chat has not redesigned takes the seed's.
      if (!o.verb && seed.verb && o.revision === 1) {
        o.verb = structuredClone(seed.verb);
        changed = true;
      }
      continue;
    }
    if (o.owner && !o.uses) {
      const hit = OWNED_USES.find(([re]) => re.test(o.blueprint.name.trim()));
      if (hit) {
        o.uses = [...hit[1]];
        changed = true;
      }
    }
  }
  return changed;
}

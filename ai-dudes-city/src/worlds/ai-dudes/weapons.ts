// Weapons in hand and on wheels. The Mayor and players (from their own pages) carry a blaster or a
// rocket launcher (G to pick, a click or Space to fire); aboard a build with a gun (a tank, a cannon
// cart) they fire its cannon instead; and anything they drive into a build rams it. Agents fire a
// tank's cannon through their `attack` (combat.ts). Hits are worked out here, at once, along the
// line of fire: the first build or person in the way takes it; a rocket or a shell goes off where it
// lands and everything round it takes some. Cartoon rules as everywhere: people are knocked out and
// get back up, builds crumble and come back (damage.ts). Zero AI: every number is the app's.
import type { Weapon } from '../../shared/dudesTypes';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { abilitiesOf } from './blueprint';
import { knockOut, knockedOut, stagger } from './combat';
import { breakable, damageBuild, ruined, type Attacker } from './damage';
import { nudge } from './state';
import { addEffect } from './sim';
import type { Dude, DudesState } from './state';

export type Gun = Weapon | 'cannon';
export const WEAPON: Record<Gun, { range: number; damage: number; cooldownMs: number; blast: number }> = {
  blaster: { range: 16, damage: 2, cooldownMs: 250, blast: 0 },
  rocket: { range: 22, damage: 16, cooldownMs: 1800, blast: 2.5 },
  cannon: { range: 26, damage: 22, cooldownMs: 1600, blast: 3 },
};
/**
 * Ramming: a knock needs a run-up (this many metres driven since the last one, so leaning on a wall
 * does nothing), and the heaviest knock is about a cannon shell, so ramming never beats the guns.
 */
export const RAM = { cooldownMs: 1200, minSpeed: 2, runUp: 2.5, maxDamage: 22, maxSpeed: 12 };
/** A blaster bolt tells the one it hit at most this often per shooter (it would wash out their memory). */
const ZAP_NUDGE_MS = 30_000;
const zapNudged = new WeakMap<Dude, Map<string, number>>();

/** A build with a gun of its own: a tank, a cannon on wheels, a battle robot. */
export const armedBuild = (o: SafehouseObject): boolean => abilitiesOf(o.blueprint).has('weapon');
/** Built to knock things down: a T-rex, a kaiju, a wrecking ball, a bulldozer. */
export const smashes = (o: SafehouseObject): boolean => abilitiesOf(o.blueprint).has('smash');

/** Who is firing: the Mayor, a player's character, or an agent's character aboard a tank. */
export interface Shooter {
  id: string;
  name: string;
  position: GroundPoint;
  facing: number;
  /** Their dude, for knockouts' credit and the scoreboard (absent for the Mayor). */
  dude?: Dude;
  /** What they are aboard, if anything: the line of fire starts there and passes over it. */
  vehicle?: SafehouseObject;
}

const nextShot = new Map<string, number>();
const nextRam = new Map<string, number>();

const at = (o: SafehouseObject) => o.driven?.at ?? o.position;
/** Where along a→b (0..1) the segment first enters the box round `o`, or undefined if it misses. */
function enters(a: GroundPoint, b: GroundPoint, o: SafehouseObject, pad = 0.1): number | undefined {
  const c = at(o),
    hw = o.footprint.width / 2 + pad,
    hd = o.footprint.depth / 2 + pad;
  let t0 = 0,
    t1 = 1;
  for (const [p, d, lo, hi] of [
    [a.x, b.x - a.x, c.x - hw, c.x + hw],
    [a.z, b.z - a.z, c.z - hd, c.z + hd],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return undefined;
      continue;
    }
    let u0 = (lo - p) / d,
      u1 = (hi - p) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return undefined;
  }
  return t0;
}
/** Where along a→b (0..1) the segment passes within `r` of `p`, or undefined. */
function passes(a: GroundPoint, b: GroundPoint, p: GroundPoint, r: number): number | undefined {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) <= r ? t : undefined;
}

type Hit = { t: number; object?: SafehouseObject; dude?: Dude };

/**
 * Fire. `aim` is where they clicked (a point on the ground), or straight ahead when absent. Returns
 * false when the gun is still cooling down or there is nothing to fire.
 */
export function fire(state: DudesState, s: Shooter, gun: Gun, aim: GroundPoint | undefined, now: number): boolean {
  if ((nextShot.get(s.id) ?? 0) > now) return false;
  const spec = WEAPON[gun];
  nextShot.set(s.id, now + spec.cooldownMs);
  const from = s.vehicle ? at(s.vehicle) : s.position;
  let dx = Math.sin(s.facing),
    dz = Math.cos(s.facing);
  if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.z) && Math.hypot(aim.x - from.x, aim.z - from.z) > 0.6) {
    const d = Math.hypot(aim.x - from.x, aim.z - from.z);
    dx = (aim.x - from.x) / d;
    dz = (aim.z - from.z) / d;
  }
  // A blaster bolt flies its full range; a rocket or a shell lands where it was aimed (if that is nearer).
  const reach = gun === 'blaster' || !aim ? spec.range : Math.min(spec.range, Math.hypot(aim.x - from.x, aim.z - from.z));
  // Out of the muzzle: past the edge of whatever they are aboard.
  const muzzle = s.vehicle ? Math.max(s.vehicle.footprint.width, s.vehicle.footprint.depth) / 2 + 0.3 : 0.4;
  const a = { x: from.x + dx * muzzle, z: from.z + dz * muzzle };
  const b = { x: from.x + dx * reach, z: from.z + dz * reach };
  const hits: Hit[] = [];
  for (const o of state.objects) {
    if (o === s.vehicle || !breakable(o) || ruined(o)) continue;
    const t = enters(a, b, o);
    if (t !== undefined) hits.push({ t, object: o });
  }
  for (const d of state.dudes) {
    if (d.id === s.id || d.hidden || knockedOut(d, now) || (s.vehicle && d.riding === s.vehicle.id)) continue;
    const t = passes(a, b, d.position, 0.6);
    if (t !== undefined) hits.push({ t, dude: d });
  }
  const first = hits.sort((x, y) => x.t - y.t)[0];
  const t = first?.t ?? 1;
  const to = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  const by: Attacker = { name: s.name, id: s.dude?.id };
  const fromHeight = s.vehicle ? 1.4 : 1.3;
  if (gun === 'blaster') {
    addEffect(state, { kind: 'shot', from: a, to, fromHeight, height: first?.object ? 1.3 : 1.2, at: now, label: 'blaster', dudeId: s.id });
    if (first?.object) damageBuild(state, first.object, spec.damage, by, now, to, 1.3);
    // A blaster bolt only knocks a person back a step; it takes a rocket to put them down.
    else if (first?.dude) {
      stagger(first.dude, from, now);
      let told = zapNudged.get(first.dude);
      if (!told) zapNudged.set(first.dude, (told = new Map()));
      if ((told.get(s.id) ?? 0) <= now) {
        told.set(s.id, now + ZAP_NUDGE_MS);
        nudge(state, first.dude, `${s.name} zapped you with a blaster`, now);
      }
    }
    return true;
  }
  // A rocket or a shell: it flies there and goes off.
  addEffect(state, { kind: 'shell', from: a, to, fromHeight, radius: spec.blast, at: now, label: gun, dudeId: s.id });
  blast(state, s, to, spec.damage, spec.blast, first?.object, now, gun === 'cannon' ? 'shelled' : 'blew up');
  return true;
}

/** Everything round a blast: the build it hit takes it all, the others less the further off; people go flat. */
export function blast(state: DudesState, s: Shooter, to: GroundPoint, damage: number, radius: number, direct: SafehouseObject | undefined, now: number, how: string): void {
  const by: Attacker = { name: s.name, id: s.dude?.id };
  for (const o of state.objects) {
    if (o === s.vehicle || !breakable(o) || ruined(o)) continue;
    const c = at(o);
    const edge = Math.max(0, Math.hypot(c.x - to.x, c.z - to.z) - Math.max(o.footprint.width, o.footprint.depth) / 2);
    if (o !== direct && edge > radius) continue;
    damageBuild(state, o, o === direct ? damage : damage * (1 - (edge / radius) * 0.6), by, now, to, 1);
  }
  for (const d of state.dudes)
    if (d.id !== s.id && !d.hidden && !(s.vehicle && d.riding === s.vehicle.id) && Math.hypot(d.position.x - to.x, d.position.z - to.z) <= radius) zap(state, s, d, how, now);
}

/** A person hit: flat on their back a few seconds, and told who did it. */
function zap(state: DudesState, s: Shooter, victim: Dude, how: string, now: number): void {
  if (knockedOut(victim, now)) return;
  if (s.dude) return knockOut(state, victim, s.dude, how, now, { ms: 5000 });
  knockOut(state, victim, undefined, `${how} by ${s.name}`, now, { ms: 5000 });
  nudge(state, victim, `${s.name} ${how} you and knocked you out. You are back up in a few seconds.`, now);
}

/**
 * Driven into a build: it takes a knock by how fast and how heavy (a T-rex or a bulldozer hits far
 * harder than a car). The page says what it ran into; the server checks it is really there. For a
 * player, `speed` is what the server saw them going and `runUp` how far they drove since the last ram.
 */
export function ram(state: DudesState, s: Shooter, targetId: string, speed: number, now: number, runUp?: number): boolean {
  const v = s.vehicle;
  const o = state.objects.find((x) => x.id === targetId);
  if (!v || !o || o === v || !breakable(o) || ruined(o) || !Number.isFinite(speed) || speed < RAM.minSpeed) return false;
  if (runUp !== undefined && runUp < RAM.runUp) return false;
  if ((nextRam.get(s.id) ?? 0) > now) return false;
  const p = at(v),
    c = at(o);
  const gap = Math.max(Math.abs(p.x - c.x) - o.footprint.width / 2, Math.abs(p.z - c.z) - o.footprint.depth / 2);
  if (gap > Math.max(v.footprint.width, v.footprint.depth) / 2 + 1.5) return false;
  nextRam.set(s.id, now + RAM.cooldownMs);
  const heft = Math.max(0.6, Math.min(3, Math.max(v.footprint.width, v.footprint.depth) / 3));
  const hard = smashes(v) ? 2 : armedBuild(v) ? 1.2 : 0.4;
  const toward = Math.hypot(c.x - p.x, c.z - p.z) || 1;
  const contact = { x: p.x + ((c.x - p.x) / toward) * Math.min(toward, Math.max(v.footprint.width, v.footprint.depth) / 2), z: p.z + ((c.z - p.z) / toward) * Math.min(toward, Math.max(v.footprint.width, v.footprint.depth) / 2) };
  addEffect(state, { kind: 'slam', from: contact, radius: 1.5 + heft, at: now });
  damageBuild(state, o, Math.min(RAM.maxDamage, Math.min(RAM.maxSpeed, speed) * hard * heft), { name: s.name, id: s.dude?.id }, now, contact, 0.8);
  return true;
}

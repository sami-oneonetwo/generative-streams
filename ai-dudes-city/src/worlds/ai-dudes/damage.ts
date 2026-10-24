// Builds fall apart. Every build has health (from how big it is); shots, rockets, a tank's shell, a
// bomb, a T-rex's stomp or a car driven into it take some off. As it goes down the build crumbles in
// steps: the top pieces come off first and lie about the foot of it, what is left leans and blackens,
// and at nothing it comes down in a heap (rubble: `destroyedAt`). Nobody's work is lost: the design
// before is kept (`state.vandalised`), `use … fix` puts it back at once, and a few minutes after it
// was first hit (or came down) it puts itself back up, however often it is hit since. Put back up, it
// only rattles for a minute. A build whose owner is away takes far less: nothing bad happens to you
// while you are gone. A community project never falls all the way.
// Zero AI: the app owns every number here.
import type { Blueprint, GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { addEffect, awake, shake } from './sim';
import { nudge, pushFeed, type DudesState } from './state';

export const DAMAGE = {
  /** Crumbling is drawn in this many steps between whole and fallen. */
  steps: 6,
  /** A damaged build puts itself back this long after it was first hit, a heap of rubble this long after it came down. */
  rebuildMs: 4 * 60_000,
  /** Just put back up (rebuilt or fixed): hits only rattle it for this long. */
  guardMs: 60_000,
  /** A build whose owner is away (their chatter quiet) takes this share of a hit. */
  awayShare: 0.35,
  /** A town project only goes down this far. */
  civicFloor: 0.35,
  soot: [0x3a, 0x34, 0x2e] as const,
};

/** How much a build can take: a shed a fair few shots, a house a proper siege, a castle a long one. */
export function maxHpOf(o: SafehouseObject): number {
  const area = o.footprint.width * o.footprint.depth;
  const hp = Math.round(Math.max(150, Math.min(1500, 150 + area * 7)));
  return o.civic ? hp * 2 : hp;
}
export const hpOf = (o: SafehouseObject): number => o.health ?? o.maxHealth ?? maxHpOf(o);
export const ruined = (o: SafehouseObject): boolean => o.destroyedAt !== undefined;
/**
 * Builds the Mayor and players can shoot at and creatures can knock about: anything standing that is
 * somebody's work. Not the head's Folly, under wraps or unveiled: the evidence stands (FK-023).
 */
export const breakable = (o: SafehouseObject): boolean => !o.wild && !o.silhouette && !o.folly && !(o.passable && !o.creature);

export interface Attacker {
  /** The one doing it, for the feed and the owner's nudge ("Sam", "The Mayor", "Sam's T-Rex"). */
  name: string;
  /** Their dude id, if a chatter: their own builds' owner is not told they did it to themselves. */
  id?: string;
}

/**
 * Take `amount` off a build. Draws the hit (chips and dust at `at`), redraws the build when it has
 * crumbled another step, and brings it down at nothing. Returns what happened.
 */
export function damageBuild(state: DudesState, o: SafehouseObject, amount: number, by: Attacker, now: number, at?: GroundPoint, height = 1.2): 'hit' | 'fell' | undefined {
  if (!breakable(o) || ruined(o) || amount <= 0) return undefined;
  const where = o.driven?.at ?? o.position;
  addEffect(state, { kind: 'hit', objectId: o.id, to: at ?? where, height, at: now });
  shake(state, o.id, now);
  if (state.ai.destruction === false) return 'hit';
  // Just put back up: it shrugs it off for a bit.
  if ((o.guardUntil ?? 0) > now) return 'hit';
  if (o.guardUntil !== undefined) o.guardUntil = undefined;
  const owner = o.owner ? state.dudes.find((d) => d.id === o.owner) : undefined;
  if (owner && owner.id !== by.id && !awake(owner, now)) amount *= DAMAGE.awayShare;
  const max = (o.maxHealth ??= maxHpOf(o));
  const floor = o.civic ? max * DAMAGE.civicFloor : 0;
  const before = hpOf(o);
  const hp = Math.max(floor, before - amount);
  o.health = Math.round(hp * 10) / 10;
  o.hitAt = now;
  o.damagedAt ??= now;
  state.vandalised ??= {};
  if (!state.vandalised[o.id]) state.vandalised[o.id] = { by: by.name.slice(0, 40), kind: 'damaged', original: structuredClone(o.blueprint) };
  else state.vandalised[o.id].by = by.name.slice(0, 40);
  const fell = hp <= 0;
  const step = fell ? DAMAGE.steps : Math.min(DAMAGE.steps - 1, Math.floor((1 - hp / max) * DAMAGE.steps));
  if (step !== (o.damageRevision ?? 0)) {
    o.damageRevision = step;
    o.blueprint = crumble(state.vandalised[o.id].original, step / DAMAGE.steps, o.id, fell);
    o.revision++;
    state.worldRevision++;
  }
  if (!fell) return 'hit';
  o.destroyedAt = now;
  state.vandalised[o.id].kind = 'wrecked';
  // Whoever was standing on it or inside it is out on the ground.
  for (const d of state.dudes)
    if (d.use?.objectId === o.id && d.use.how !== 'drive' && d.use.how !== 'ride') {
      d.use = undefined;
      d.hidden = undefined;
      d.y = undefined;
    }
  addEffect(state, { kind: 'collapse', objectId: o.id, from: { ...where }, radius: Math.max(o.footprint.width, o.footprint.depth) / 2, at: now });
  pushFeed(state, now, `${by.name} brought down ${o.blueprint.name}${owner && owner.id !== by.id ? ` (${owner.name}'s)` : ''}`);
  if (owner && owner.id !== by.id) nudge(state, owner, `${by.name} knocked down your build ${o.blueprint.name}: it is a heap of rubble. Use it with "fix" to put it back up, or it rebuilds itself in a few minutes.`, now);
  return 'fell';
}

/** Back to whole: the design before, full health (the `fix` use, the rebuild, an edit or a new age). With `now`, it only rattles for a minute after. */
export function heal(state: DudesState, o: SafehouseObject, now?: number): boolean {
  const damaged = o.health !== undefined || ruined(o);
  o.health = undefined;
  o.hitAt = undefined;
  o.damagedAt = undefined;
  o.damageRevision = undefined;
  o.destroyedAt = undefined;
  if (damaged && now !== undefined) o.guardUntil = now + DAMAGE.guardMs;
  if (damaged) state.worldRevision++;
  return damaged;
}

/** Ruins and damaged builds put themselves back up: a while after they came down, or after the first hit. */
export function tickDamage(state: DudesState, now: number): void {
  for (const o of state.objects) {
    if (o.guardUntil !== undefined && o.guardUntil <= now) o.guardUntil = undefined;
    if (o.health === undefined || now - (o.destroyedAt ?? o.damagedAt ?? o.hitAt ?? 0) < DAMAGE.rebuildMs) continue;
    const v = state.vandalised?.[o.id];
    const fell = ruined(o);
    if (v) {
      o.blueprint = v.original;
      o.revision++;
      delete state.vandalised![o.id];
    }
    heal(state, o, now);
    if (fell) pushFeed(state, now, `${o.blueprint.name} was put back up`);
  }
}

/** The text an agent reads about a build's state, or nothing when it is whole. */
export function damageNote(o: SafehouseObject): string | undefined {
  if (ruined(o)) return 'a heap of rubble (knocked down); "fix" puts it back up';
  if (o.health === undefined) return undefined;
  const pct = Math.round((hpOf(o) / (o.maxHealth ?? maxHpOf(o))) * 100);
  return pct < 100 ? `damaged, ${pct}% left; "fix" repairs it` : undefined;
}

// ---- crumbling: the design, a step further gone -------------------------------------------------
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const clamp = (v: number, n: number) => Math.max(-n, Math.min(n, v));
function sooted(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (DAMAGE.soot[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The design `gone` of the way down (0..1): the highest pieces have come off first and lie scattered
 * round the foot of it, tipped over and sooty; what still stands leans a little and darkens. Fallen,
 * every piece is down. The same build always crumbles the same way (seeded by its id).
 */
export function crumble(original: Blueprint, gone: number, seed: string, fallen: boolean): Blueprint {
  const next: Blueprint = structuredClone(original);
  const rng = seeded(seed);
  const n = next.parts.length;
  const draws = next.parts.map(() => [rng(), rng(), rng(), rng(), rng()]);
  const order = next.parts
    .map((p, i) => ({ i, k: p.position[1] + p.size[1] / 2 + draws[i][4] * 3 }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.i);
  const down = new Set(order.slice(0, fallen ? n : Math.round(n * gone * 0.75)));
  next.parts.forEach((p, i) => {
    const [a, b, c, d] = draws[i];
    if (down.has(i)) {
      const len = Math.hypot(p.position[0], p.position[2]) || 1;
      const out = 0.4 + a * (fallen ? 2.2 : 1.6);
      const lie = Math.min(p.size[0], p.size[1], p.size[2]) / 2;
      p.position = [
        clamp(p.position[0] + (p.position[0] / len) * out + (b - 0.5) * 1.2, 15),
        Math.max(0.05, lie + c * (fallen ? Math.min(2, p.position[1] * 0.25) : 0.3)),
        clamp(p.position[2] + (p.position[2] / len) * out + (d - 0.5) * 1.2, 15),
      ];
      p.rotation = [clamp(p.rotation[0] + (b - 0.5) * 2.4, 6.2), clamp(p.rotation[1] + (c - 0.5) * 2, 6.2), clamp(p.rotation[2] + (d - 0.5) * 2.4, 6.2)];
      p.color = sooted(p.color, 0.35 + a * 0.25);
    } else if (gone > 0) {
      p.rotation = [clamp(p.rotation[0] + (c - 0.5) * 0.14 * gone, 6.2), p.rotation[1], clamp(p.rotation[2] + (d - 0.5) * 0.14 * gone, 6.2)];
      p.color = sooted(p.color, gone * 0.3);
    }
  });
  // A piece that has come off stops turning or swaying.
  if (next.animations) next.animations = next.animations.filter((x) => !down.has(x.part));
  return next;
}

/** A build given a new design (an edit, a new age's restyle): whatever damage it had goes with the old one. */
export function renewed(state: DudesState, o: SafehouseObject): void {
  if (state.vandalised?.[o.id]) delete state.vandalised[o.id];
  heal(state, o);
}

/** Put a damaged or blown-up build back the way it was (the `fix` use). */
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

/** How a damaged build reads to an agent. */
export function damageOf(state: DudesState, objectId: string): string | undefined {
  const v = state.vandalised?.[objectId];
  const o = state.objects.find((x) => x.id === objectId);
  const hurt = o && damageNote(o);
  if (v && hurt) return `${hurt} (by ${v.by})`;
  if (v) return `${v.kind === 'wrecked' ? 'blown up' : v.kind} by ${v.by}; use it with "fix" to restore it`;
  return undefined;
}

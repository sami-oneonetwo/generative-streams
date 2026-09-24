// Behaviour as data: the rule interpreter and the clamps (state v9, "small life").
//
// A rule is `when / target / do` with the app's numbers (Rule in safehouseTypes.ts). A creature
// with rules runs them ahead of its preset behaviour every tick:
//
//   1. `near` rules first, every tick: a target of the given kind (a zombie, a viewer, a piece
//      tagged `scare`) inside `within` makes it `flee` — drop whatever it was doing, head six to
//      nine metres straight away, and stay skittish for a few seconds so it does not land straight
//      back where it was.
//   2. A goal in hand is continued: walk or fly the path, arrive, sit for the dwell (`perch` settles
//      onto the top of the piece; `visit` stands beside it), then let go.
//   3. With nothing in hand, the `tick` / `night` / `day` rules are tried in order; the first whose
//      target resolves and can be reached sets the goal.
//
// When a rule has the tick, the preset behaviour (roam, zoom, …) is skipped for that tick; when
// nothing resolves, the preset takes over, so a bird with no perch in range still flies about.
// Nothing here is model-authored yet, and every number a rule carries is clamped here regardless
// of who wrote it. Zero AI calls.
import type { CreatureState, GroundPoint, PartAnimation, Rule, RuleTarget, SafehouseObject } from '../../shared/safehouseTypes';
import { contains, YARD_BOUNDS } from '../../shared/safehouseLayout';
import { blueprintBounds, MAX_ANIMATIONS, MAX_RULES } from './blueprint';
import { intact } from './combat';
import { route, straighten } from './placement';
import { advance, distance, head, objectDistance, routeTo, routeToPoint, trapsIn, type World } from './locomotion';

/** The app's numbers for rules: bounds and defaults. Metres, seconds, radians. */
export const RULE_LIMITS = {
  within: { min: 1, max: 30, default: 12 },
  dwell: { min: 0, max: 120, default: [6, 20] as [number, number] },
  /** Skittish after a scare: no perching or visiting for this long. */
  scaredMs: 8000,
  /** How far a flee takes it, straight away from the threat. */
  flee: [6, 9] as [number, number],
  /** Birds keep this far from anything tagged `scare` when choosing a perch. */
  scareRadius: 4,
  /** Perched height above the top of the piece. */
  perchLift: 0.08,
};
export const ANIMATION_LIMITS = {
  speed: { min: 0.02, max: 3, default: 0.3 },
  amplitude: { sway: 0.6, drift: 0.5, bob: 0.5, default: 0.08 },
  axis: { sway: 'z', drift: 'x', spin: 'y', bob: 'y' } as Record<PartAnimation['kind'], 'x' | 'y' | 'z'>,
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Bring a rule list within the app's bounds; anything unusable is dropped rather than failing. */
export function clampRules(rules: readonly Rule[] | undefined): Rule[] {
  const out: Rule[] = [];
  for (const r of rules ?? []) {
    if (!r || typeof r !== 'object' || !r.when || !r.do) continue;
    const target: RuleTarget | undefined = r.target
      ? {
          ...(r.target.tag ? { tag: r.target.tag } : {}),
          ...(r.target.kind ? { kind: r.target.kind } : {}),
          pick: r.target.pick === 'random' ? 'random' : 'nearest',
          within: clamp(finite(r.target.within) ? r.target.within : RULE_LIMITS.within.default, RULE_LIMITS.within.min, RULE_LIMITS.within.max),
        }
      : undefined;
    const d = r.dwell;
    let dwell: [number, number] = RULE_LIMITS.dwell.default;
    if (Array.isArray(d) && finite(d[0]) && finite(d[1])) {
      const lo = clamp(d[0], RULE_LIMITS.dwell.min, RULE_LIMITS.dwell.max),
        hi = clamp(d[1], RULE_LIMITS.dwell.min, RULE_LIMITS.dwell.max);
      dwell = [Math.min(lo, hi), Math.max(lo, hi)];
    }
    out.push({ when: r.when, do: r.do, ...(target ? { target } : {}), dwell });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}
/** Bring part animations within bounds and drop any that point past the parts. */
export function clampAnimations(list: readonly PartAnimation[] | undefined, partCount: number): PartAnimation[] {
  const out: PartAnimation[] = [];
  for (const a of list ?? []) {
    if (!a || typeof a !== 'object' || !Number.isInteger(a.part) || a.part < 0 || a.part >= partCount) continue;
    if (!['sway', 'drift', 'spin', 'bob'].includes(a.kind)) continue;
    const next: PartAnimation = {
      part: a.part,
      kind: a.kind,
      axis: a.axis === 'x' || a.axis === 'y' || a.axis === 'z' ? a.axis : ANIMATION_LIMITS.axis[a.kind],
      speed: clamp(finite(a.speed) ? a.speed : ANIMATION_LIMITS.speed.default, ANIMATION_LIMITS.speed.min, ANIMATION_LIMITS.speed.max),
      phase: finite(a.phase) ? clamp(a.phase, -Math.PI * 2, Math.PI * 2) : 0,
    };
    if (a.kind !== 'spin')
      next.amplitude = clamp(finite(a.amplitude) ? a.amplitude : ANIMATION_LIMITS.amplitude.default, 0, ANIMATION_LIMITS.amplitude[a.kind]);
    out.push(next);
    if (out.length >= MAX_ANIMATIONS) break;
  }
  return out;
}

interface Candidate {
  id?: string;
  position: GroundPoint;
  object?: SafehouseObject;
}
/** Everything a rule's target could mean right now, from the creature's point of view. */
function candidates(c: SafehouseObject, target: RuleTarget | undefined, w: World): Candidate[] {
  if (!target) return [];
  const list: Candidate[] = [];
  if (target.tag) {
    const tag = target.tag;
    for (const o of w.objects) if (intact(o) && o.id !== c.id && o.uses?.includes(tag)) list.push({ id: o.id, position: o.position, object: o });
  }
  switch (target.kind) {
    case 'zombie':
      for (const z of w.combat.zombies) if (z.health > 0) list.push({ id: z.id, position: z.position });
      break;
    case 'creature':
      for (const o of w.objects) if (o.creature && !o.wild && intact(o) && o.id !== c.id) list.push({ id: o.id, position: o.position, object: o });
      break;
    case 'rook':
      list.push({ id: 'rook', position: w.survivor.position });
      break;
    case 'neighbour':
      for (const n of w.neighbours ?? []) list.push({ id: `neighbour:${n.id}`, position: n.position });
      break;
    case 'viewer':
      for (const v of w.crowd ?? []) list.push({ position: v.position });
      break;
  }
  return list;
}
const gap = (c: SafehouseObject, k: Candidate): number => (k.object ? objectDistance(c.position, k.object) : distance(c.position, k.position));
/** The top of a piece, where a bird sits. */
export const perchHeight = (o: SafehouseObject): number => Math.min(9.5, Math.max(0.2, blueprintBounds(o.blueprint).maxY + RULE_LIMITS.perchLift));

function flee(c: SafehouseObject, st: CreatureState, from: GroundPoint, rule: number, solid: SafehouseObject[], rng: () => number): boolean {
  let dx = c.position.x - from.x,
    dz = c.position.z - from.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.05) {
    const a = rng() * Math.PI * 2;
    dx = Math.sin(a);
    dz = Math.cos(a);
    d = 1;
  }
  const [lo, hi] = RULE_LIMITS.flee;
  const run = lo + rng() * (hi - lo);
  const snap = (v: number) => Math.round(v * 2) / 2;
  st.goal = undefined;
  st.path = [];
  st.scaredMs = RULE_LIMITS.scaredMs;
  st.replanMs = 0;
  // Straight away first, then off to either side, so a walker in a corner still gets out.
  for (const turn of [0, 0.7, -0.7, 1.4, -1.4]) {
    const ux = (dx / d) * Math.cos(turn) - (dz / d) * Math.sin(turn),
      uz = (dx / d) * Math.sin(turn) + (dz / d) * Math.cos(turn);
    let point = { x: c.position.x + ux * run, z: c.position.z + uz * run };
    if (st.flying) {
      point = {
        x: Math.min(YARD_BOUNDS.maxX - 1, Math.max(YARD_BOUNDS.minX + 1, point.x)),
        z: Math.min(YARD_BOUNDS.maxZ - 1, Math.max(YARD_BOUNDS.minZ + 1, point.z)),
      };
      if (distance(point, c.position) < 1.5) continue;
      st.path = [point];
    } else {
      point = { x: snap(point.x), z: snap(point.z) };
      if (!contains(YARD_BOUNDS, point)) continue;
      const path = route(c.position, point, solid);
      if (!path || path.length > 60) continue;
      st.path = straighten(path);
    }
    st.goal = { rule, point, dwellMs: 0 };
    head(c, st, point);
    return true;
  }
  return false; // scared but cornered: the preset behaviour has the tick
}

/**
 * One tick of a creature's rules. True when a rule drove the creature this tick (the preset
 * behaviour is then skipped); false hands the tick to the preset.
 */
export function stepRules(
  c: SafehouseObject,
  st: CreatureState,
  w: World,
  solid: SafehouseObject[],
  dt: number,
  rng: () => number,
): boolean {
  const rules = c.rules ?? [];
  if (!rules.length) return false;
  st.scaredMs = Math.max(0, (st.scaredMs ?? 0) - dt);
  // 1. Something to get away from, checked every tick — unless already running from the last one.
  if (st.scaredMs === 0) {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.when !== 'near' || r.do !== 'flee' || !r.target) continue;
      const within = r.target.within ?? RULE_LIMITS.within.default;
      const threat = candidates(c, r.target, w)
        .map((k) => ({ k, d: gap(c, k) }))
        .filter((x) => x.d <= within)
        .sort((a, b) => a.d - b.d)[0];
      if (!threat) continue;
      if (flee(c, st, threat.k.position, i, solid, rng)) return true;
      break; // cornered: nothing else this tick
    }
  }
  // 2. Whatever it has in hand.
  if (st.goal) {
    const g = st.goal,
      rule = rules[g.rule];
    const target = g.targetId ? w.objects.find((o) => o.id === g.targetId) : undefined;
    if (!rule || (g.targetId && (!target || !intact(target)))) {
      st.goal = undefined; // the perch fell or the rule changed: let go and think again
      st.replanMs = 0;
      return true;
    }
    if (st.path.length) {
      advance(c, st, solid, dt, trapsIn(w.objects));
      if (st.path.length || (st.heldMs ?? 0) > 0) return true;
    }
    st.moving = false;
    if (!g.arrived) {
      g.arrived = true;
      if (target && rule.do === 'perch') {
        g.perched = true;
        g.altitude = perchHeight(target);
      }
      if (target) head(c, st, target.position);
    }
    if (rule.do === 'flee' || g.dwellMs <= 0) {
      if (g.targetId) st.targetId = g.targetId; // remembered so the next pick is somewhere else
      st.goal = undefined;
      st.replanMs = 0;
      // fall through: pick the next thing straight away rather than hovering
    } else {
      g.dwellMs -= dt;
      return true;
    }
  }
  // 3. Nothing in hand: the first rule whose target resolves and can be reached.
  if (st.scaredMs > 0 || st.replanMs > 0) return false;
  const night = w.lighting === 'night';
  const scares = w.objects.filter((o) => intact(o) && o.uses?.includes('scare'));
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.when === 'near' || r.do === 'flee' || !r.target) continue;
    if ((r.when === 'night' && !night) || (r.when === 'day' && night)) continue;
    const within = r.target.within ?? RULE_LIMITS.within.default;
    let pool = candidates(c, r.target, w)
      .map((k) => ({ k, d: gap(c, k) }))
      .filter((x) => x.d <= within);
    if (r.do === 'perch')
      pool = pool.filter((x) => !x.k.object || !scares.some((s) => objectDistance(x.k.position, s) <= RULE_LIMITS.scareRadius));
    if (pool.length > 1 && st.targetId) pool = pool.filter((x) => x.k.id !== st.targetId);
    if (!pool.length) continue;
    pool.sort((a, b) => a.d - b.d);
    const tries = Math.min(5, pool.length);
    for (let t = 0; t < tries; t++) {
      const at = r.target.pick === 'random' ? Math.min(pool.length - 1, Math.floor(rng() * pool.length)) : 0;
      const [pick] = pool.splice(at, 1);
      const routed = pick.k.object ? routeTo(c, st, pick.k.object, solid) : routeToPoint(c, st, pick.k.position, solid);
      if (!routed) continue;
      const [lo, hi] = r.dwell ?? RULE_LIMITS.dwell.default;
      st.goal = { rule: i, targetId: pick.k.id, point: { ...pick.k.position }, dwellMs: (lo + rng() * (hi - lo)) * 1000 };
      st.targetId = undefined;
      // Already there (a walker beside it, a flyer over it): arrive now.
      if (!st.path.length || (st.path.length === 1 && distance(st.path[0], c.position) < 0.05)) st.path = [];
      return true;
    }
  }
  return false;
}

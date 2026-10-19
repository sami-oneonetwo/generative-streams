// Blueprints: bounded JSON geometry from the design call, made to fit before anyone sees it.
// Copied from the safehouse world (noodle-shop/src/worlds/safehouse/blueprint.ts) and cut down to
// what a field of builds needs: parts, colours and part animations. No creatures, rules or verbs yet.
import { z } from 'zod';
import { ABILITIES, type Ability, type Blueprint, type PartAnimation, type Primitive } from '../../shared/objectTypes';
const finite = z.number().finite();
const triple = (s: z.ZodNumber) => z.tuple([s, s, s]);
// Unknown keys are stripped, not rejected: every strict-schema failure here
// throws away a paid design over formatting. Geometry and text limits below are still enforced.
export const primitiveSchema = z.object({
  shape: z.enum(['box', 'cylinder', 'sphere', 'cone']),
  position: triple(finite.min(-40).max(40)),
  size: triple(finite.min(0.01).max(40)),
  rotation: triple(finite.min(-Math.PI * 2).max(Math.PI * 2)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const MAX_ANIMATIONS = 16;
export const animationSchema = z.object({
  part: z.number().int().min(0).max(99),
  kind: z.enum(['sway', 'drift', 'spin', 'bob']),
  axis: z.enum(['x', 'y', 'z']).optional(),
  speed: finite.min(0).max(4).optional(),
  amplitude: finite.min(0).max(1).optional(),
  phase: finite.min(-Math.PI * 2).max(Math.PI * 2).optional(),
});
export const blueprintSchema = z.object({
  name: z.string().trim().min(1).max(70),
  description: z.string().max(240),
  parts: z.array(primitiveSchema).min(1).max(160),
  animations: z.array(animationSchema).max(MAX_ANIMATIONS).optional(),
  abilities: z.array(z.enum(ABILITIES)).max(ABILITIES.length).optional(),
});
export const designResponseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('build'), blueprint: blueprintSchema, reply: z.string().max(240) }),
  z.object({ action: z.literal('edit'), blueprint: blueprintSchema, reply: z.string().max(240) }),
  z.object({ action: z.literal('decline'), reply: z.string().min(1).max(240) }),
]);
export type DesignResponse = z.infer<typeof designResponseSchema>;

// ---- tolerant normalisation of model output ------------------------------
export const FALLBACK_COLOR = '#8f8a82';
const NAMED_COLORS = new Map(
  (
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
    'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 ' +
    'chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff ' +
    'darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgrey:a9a9a9 darkgreen:006400 ' +
    'darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 ' +
    'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f ' +
    'darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 ' +
    'dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ' +
    'ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 grey:808080 green:008000 greenyellow:adff2f ' +
    'honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
    'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
    'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgrey:d3d3d3 lightgreen:90ee90 lightpink:ffb6c1 ' +
    'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
    'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 ' +
    'mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 ' +
    'mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 ' +
    'midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 ' +
    'oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 ' +
    'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 ' +
    'peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 ' +
    'red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 ' +
    'seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 ' +
    'slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 ' +
    'tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 ' +
    'yellowgreen:9acd32 rust:b7410e charcoal:36454f cream:fffdd0 sand:c2b280 concrete:9a9a95 wood:8b6b43 ' +
    'metal:7d848c steel:7d848c flame:ff6a13 fire:ff5a1f smoke:5b5b5b ash:b2beb5 mud:70543e'
  )
    .split(' ')
    .map((entry) => entry.split(':') as [string, string]),
);
/** Any reasonable colour spelling → `#rrggbb`; unknown spellings become a neutral, not a failure. */
export function normalizeColor(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_COLOR;
  const s = value.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(?:#|0x)?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s))) return `#${m[1]}`;
  if ((m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]?$/.exec(s))) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  if ((m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s)))
    return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  return `#${NAMED_COLORS.get(s.replace(/[\s_-]/g, '')) ?? FALLBACK_COLOR.slice(1)}`;
}
const SHAPE_SYNONYMS: Record<string, Primitive['shape']> = {
  box: 'box', cube: 'box', block: 'box', cuboid: 'box', rectangle: 'box', slab: 'box', plank: 'box', panel: 'box', plane: 'box',
  sphere: 'sphere', ball: 'sphere', ellipsoid: 'sphere', dome: 'sphere', orb: 'sphere',
  cylinder: 'cylinder', cyl: 'cylinder', tube: 'cylinder', pipe: 'cylinder', disc: 'cylinder', disk: 'cylinder', rod: 'cylinder', pole: 'cylinder', wheel: 'cylinder', barrel: 'cylinder',
  cone: 'cone', pyramid: 'cone', spike: 'cone',
};
type Triple = [number, number, number];
const num = (v: unknown): number => (typeof v === 'string' && v.trim() !== '' ? Number(v) : (v as number));
/** `[x,y,z]`, `{x,y,z}`, `{width,height,depth}` or a single number (uniform size) → a numeric triple. */
function toTriple(value: unknown, keys: [string[], string[], string[]]): unknown {
  if (Array.isArray(value)) return value.length >= 3 ? value.slice(0, 3).map(num) : value;
  if (typeof value === 'number') return [value, value, value];
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const pick = (names: string[]) => names.map((k) => o[k]).find((v) => v !== undefined);
    const t = keys.map(pick);
    if (t.every((v) => v !== undefined)) return t.map(num);
  }
  return value;
}
function normalizePart(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const p = value as Record<string, unknown>;
  const shape =
    typeof p.shape === 'string' ? SHAPE_SYNONYMS[p.shape.trim().toLowerCase()] ?? p.shape : (p.type ?? p.shape);
  const size = toTriple(p.size ?? p.dimensions ?? p.scale, [['width', 'w', 'x'], ['height', 'h', 'y'], ['depth', 'd', 'z']]);
  let rotation = toTriple(p.rotation ?? [0, 0, 0], [['x', 'pitch'], ['y', 'yaw'], ['z', 'roll']]);
  // Degrees rather than radians is the usual slip; nothing legitimate exceeds two turns.
  if (Array.isArray(rotation) && rotation.some((v) => Math.abs(Number(v)) > Math.PI * 2))
    rotation = (rotation as Triple).map((v) => (Number(v) * Math.PI) / 180);
  return {
    shape,
    position: toTriple(p.position ?? p.pos ?? p.center, [['x'], ['y'], ['z']]),
    size,
    rotation,
    color: normalizeColor(p.color ?? p.colour ?? p.fill),
  };
}
const clip = (v: unknown, n: number): unknown => (typeof v === 'string' ? v.trim().slice(0, n) : v);
const phrase = (raw: unknown): string | undefined =>
  typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[_-]+/g, ' ') : undefined;
const firstOf = <T>(table: [RegExp, T][], s: string | undefined): T | undefined =>
  s === undefined ? undefined : table.find(([re]) => re.test(s))?.[1];

export const ANIMATION_LIMITS = {
  speed: { min: 0.02, max: 3, default: 0.3 },
  amplitude: { sway: 0.6, drift: 0.5, bob: 0.5, default: 0.08 },
  axis: { sway: 'z', drift: 'x', spin: 'y', bob: 'y' } as Record<PartAnimation['kind'], 'x' | 'y' | 'z'>,
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
      speed: clamp(isFiniteNumber(a.speed) ? a.speed : ANIMATION_LIMITS.speed.default, ANIMATION_LIMITS.speed.min, ANIMATION_LIMITS.speed.max),
      phase: isFiniteNumber(a.phase) ? clamp(a.phase, -Math.PI * 2, Math.PI * 2) : 0,
    };
    if (a.kind !== 'spin')
      next.amplitude = clamp(isFiniteNumber(a.amplitude) ? a.amplitude : ANIMATION_LIMITS.amplitude.default, 0, ANIMATION_LIMITS.amplitude[a.kind]);
    out.push(next);
    if (out.length >= MAX_ANIMATIONS) break;
  }
  return out;
}

const KIND_ANIMATION: [RegExp, PartAnimation['kind']][] = [
  [/^(sway|swing|wave|flap|wag|rock|pendulum|tilt|wobble)$/, 'sway'],
  [/^(drift|slide|shift|wind|rustle|sweep)$/, 'drift'],
  [/^(spin|rotate|rotation|turn|revolve|whirl|roll)$/, 'spin'],
  [/^(bob|float|hover|bounce|up and down|rise and fall|pulse)$/, 'bob'],
];
/** `"animations":[{"partIndex":3,"kind":"rotate","axis":"Z","speed":"0.5"}]` → PartAnimation[], clamped to the part count. */
export function normalizeAnimations(value: unknown, partCount: number): PartAnimation[] | undefined {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const out: PartAnimation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as Record<string, unknown>;
    const part = num(a.part ?? a.partIndex ?? a.index ?? a.piece);
    const kind = firstOf(KIND_ANIMATION, phrase(a.kind ?? a.type ?? a.motion ?? a.animation));
    if (!Number.isInteger(part) || !kind) continue;
    const axisRaw = phrase(a.axis ?? a.around ?? a.along);
    const speed = num(a.speed ?? a.rate ?? a.hz ?? a.frequency),
      amplitude = num(a.amplitude ?? a.amount ?? a.angle ?? a.distance ?? a.range),
      phaseValue = num(a.phase ?? a.offset);
    out.push({
      part,
      kind,
      ...(axisRaw === 'x' || axisRaw === 'y' || axisRaw === 'z' ? { axis: axisRaw } : {}),
      ...(Number.isFinite(speed) ? { speed } : {}),
      ...(Number.isFinite(amplitude) ? { amplitude } : {}),
      ...(Number.isFinite(phaseValue) ? { phase: phaseValue } : {}),
    });
  }
  const clamped = clampAnimations(out, partCount);
  return clamped.length ? clamped : undefined;
}
/**
 * A design drawn bigger than the per-part bounds (an arena, a 12 m pool) is scaled down as a whole
 * before validation, and hairline parts are thickened to the minimum, rather than throwing away a
 * paid design that fitBlueprint would have scaled to the limits anyway.
 */
function preScale(parts: unknown[]): unknown[] {
  type P = { position?: unknown; size?: unknown };
  const triples = (p: P) => [p.position, p.size].filter(Array.isArray) as number[][];
  let extent = 0;
  for (const p of parts as P[])
    for (const t of p && typeof p === 'object' ? triples(p) : []) for (const v of t) if (Number.isFinite(v)) extent = Math.max(extent, Math.abs(v));
  const k = extent > 39.9 ? 39.9 / extent : 1;
  return (parts as P[]).map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p } as Record<string, unknown>;
    if (Array.isArray(p.position)) out.position = (p.position as number[]).map((v) => (Number.isFinite(v) ? v * k : v));
    if (Array.isArray(p.size)) out.size = (p.size as number[]).map((v) => (Number.isFinite(v) ? Math.max(0.01, Math.abs(v) * k) : v));
    return out;
  });
}

/** Reshape a design response into what the schema expects without changing its meaning. */
export function normalizeDesign(value: unknown, editing: boolean): unknown {
  if (!value || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  const rawBlueprint = r.blueprint ?? r.design ?? r.object ?? r.model;
  let action = typeof r.action === 'string' ? r.action.trim().toLowerCase() : undefined;
  if (action !== 'decline') action = rawBlueprint ? (editing ? 'edit' : 'build') : 'decline';
  const out: Record<string, unknown> = { action, reply: clip(r.reply ?? r.message ?? '', 240) };
  if (action === 'decline' && !out.reply) out.reply = 'Could not design that.';
  const b = rawBlueprint && typeof rawBlueprint === 'object' ? (rawBlueprint as Record<string, unknown>) : undefined;
  if (b) {
    const parts = b.parts ?? b.primitives ?? b.shapes ?? b.pieces ?? b.components;
    const partList = Array.isArray(parts) ? preScale(parts.map(normalizePart)) : parts;
    const animations = normalizeAnimations(
      b.animations ?? b.motion ?? b.animation ?? r.animations ?? r.motion,
      Array.isArray(partList) ? partList.length : 0,
    );
    const abilities = normalizeAbilities(b.abilities ?? r.abilities ?? b.can ?? b.tags);
    out.blueprint = {
      name: clip(b.name ?? b.title, 70),
      description: clip(b.description ?? b.summary ?? '', 240),
      parts: partList,
      ...(animations ? { animations } : {}),
      ...(abilities.length ? { abilities } : {}),
    };
  }
  return out;
}

// ---- abilities: what a build can do on the journey ----------------------
const ABILITY_WORDS: [RegExp, Ability][] = [
  [/^(floats?|floating|boat|swims?|water|sail|raft)$/, 'floats'],
  [/^(fl(y|ies)|flying|air|airborne|hover|hovers|aircraft)$/, 'flies'],
  [/^(vehicle|drive|drivable|driveable|ride|rideable|car|mount)$/, 'vehicle'],
  [/^(weapon|gun|shoots?|turret|cannon|fires?|ranged)$/, 'weapon'],
  [/^(trap|traps|snare|pit|spikes?)$/, 'trap'],
];
/** `["Boat","flying"]` → `['floats','flies']`; anything outside the vocabulary is dropped. */
export function normalizeAbilities(raw: unknown): Ability[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;/]+/) : [];
  const out = new Set<Ability>();
  for (const item of list) {
    const w = String(item).trim().toLowerCase();
    const hit = (ABILITIES as readonly string[]).includes(w) ? (w as Ability) : ABILITY_WORDS.find(([re]) => re.test(w))?.[1];
    if (hit) out.add(hit);
  }
  return [...out];
}
const ABILITY_GUESS: [RegExp, Ability][] = [
  [/\b(boat|raft|canoe|kayak|ship|yacht|submarine|pontoon|ferry|gondola|dinghy|surfboard|log)\b/, 'floats'],
  [/\b(jet ?pack|rocket|wings?|balloon|helicopter|plane|airplane|jet|glider|blimp|airship|ufo|drone|dragon|hoverboard|broomstick|flying)\b/, 'flies'],
  [/\b(car|truck|kart|go-kart|van|bus|tank|bike|bicycle|motorbike|motorcycle|scooter|tractor|wagon|cart|horse|vehicle|jeep|buggy)\b/, 'vehicle'],
  [/\b(gun|cannon|turret|crossbow|catapult|blaster|launcher|ballista|laser|bazooka|minigun|trebuchet|slingshot)\b/, 'weapon'],
  [/\b(trap|pit|snare|spikes|bear trap|net)\b/, 'trap'],
];
/** What a build can do: what the designer said, plus what its name and description make obvious. */
export function abilitiesOf(b: Pick<Blueprint, 'name' | 'description' | 'abilities'>): Set<Ability> {
  const out = new Set<Ability>(b.abilities ?? []);
  const text = `${b.name} ${b.description}`.toLowerCase();
  for (const [re, a] of ABILITY_GUESS) if (re.test(text)) out.add(a);
  if (out.has('floats') || out.has('flies')) out.add('vehicle');
  return out;
}

export interface Limits {
  width: number;
  depth: number;
  height: number;
}
// Room for a truck, a bus stop or a shed; anything larger is scaled down to fit
// (see fitBlueprint) rather than rejected after a paid design call.
export const CHAT_LIMITS: Limits = { width: 30, depth: 30, height: 30 };
/** Designs that would have to shrink below this fraction are declined rather than miniaturised. */
const MIN_FIT_FACTOR = 0.35;

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}
// Rotated corner bounds, matching Three.js Euler XYZ transforms. Every shape's
// size is a bounding box; the renderer scales unit geometry into those bounds.
export function blueprintBounds(blueprint: Blueprint): Bounds {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of blueprint.parts) {
    const [rx, ry, rz] = p.rotation;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          let x = (sx * p.size[0]) / 2,
            y = (sy * p.size[1]) / 2,
            z = (sz * p.size[2]) / 2;
          [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
          [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
          [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
          x += p.position[0];
          y += p.position[1];
          z += p.position[2];
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}
export function measureBlueprint(
  blueprint: Blueprint,
  limits: Limits = CHAT_LIMITS,
): { width: number; depth: number } {
  const { minX, maxX, minY, maxY, minZ, maxZ } = blueprintBounds(blueprint);
  const width = 2 * Math.max(Math.abs(minX), Math.abs(maxX)),
    depth = 2 * Math.max(Math.abs(minZ), Math.abs(maxZ));
  if (width > limits.width || depth > limits.depth || maxY > limits.height || minY < -0.15)
    throw new Error(
      `Please keep the design within ${limits.width}m × ${limits.depth}m × ${limits.height}m and above ground.`,
    );
  return { width: Math.max(0.5, width), depth: Math.max(0.5, depth) };
}
/**
 * Make a generated design fit the limits instead of throwing it away: centre a
 * new build over its origin (the footprint is measured around the origin, so
 * an off-centre design counted double), lift anything drawn below ground, and
 * scale the whole thing down uniformly when it is still too big. Only designs
 * that would have to shrink to a miniature are refused, with the real numbers.
 * Edits keep their frame: the object's position already anchors that design,
 * so recentring would make a repaint or a turn visibly jump.
 */
export function fitBlueprint(
  blueprint: Blueprint,
  limits: Limits = CHAT_LIMITS,
  recentre = true,
): { blueprint: Blueprint; notes: string[] } {
  const fitted: Blueprint = structuredClone(blueprint);
  const notes: string[] = [];
  let b = blueprintBounds(fitted);
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  if (recentre && (Math.abs(cx) > 0.01 || Math.abs(cz) > 0.01)) {
    for (const p of fitted.parts) {
      p.position[0] -= cx;
      p.position[2] -= cz;
    }
    b = blueprintBounds(fitted);
  }
  if (b.minY < -0.15) {
    for (const p of fitted.parts) p.position[1] -= b.minY;
    notes.push('lifted onto the ground');
    b = blueprintBounds(fitted);
  }
  // Same measure as measureBlueprint, so a fitted design always passes it.
  const width = 2 * Math.max(Math.abs(b.minX), Math.abs(b.maxX)),
    depth = 2 * Math.max(Math.abs(b.minZ), Math.abs(b.maxZ)),
    height = b.maxY;
  const factor = Math.min(1, limits.width / width, limits.depth / depth, limits.height / height);
  if (factor < MIN_FIT_FACTOR)
    throw new Error(
      `That design came out ${width.toFixed(1)}m × ${depth.toFixed(1)}m × ${height.toFixed(1)}m; ` +
        `the limit is ${limits.width}m × ${limits.depth}m × ${limits.height}m. Ask for something smaller.`,
    );
  if (factor < 1) {
    const scale = factor * (1 - 1e-6); // stay strictly inside the limit despite float rounding
    for (const p of fitted.parts) {
      p.position = p.position.map((v) => v * scale) as Primitive['position'];
      p.size = p.size.map((v) => Math.max(0.01, v * scale)) as Primitive['size'];
    }
    notes.push(`scaled to ${Math.round(factor * 100)}% to fit`);
  }
  return { blueprint: fitted, notes };
}
/** Parse, fit and check a design response. Edits keep their frame (no recentring). */
export function validateDesign(value: unknown, editing: boolean): DesignResponse {
  const result = designResponseSchema.parse(normalizeDesign(value, editing));
  if (result.action !== 'decline') {
    const fit = fitBlueprint(result.blueprint, CHAT_LIMITS, !editing);
    result.blueprint = fit.blueprint;
    if (fit.notes.length) result.reply = `${result.reply} (${fit.notes.join(', ')})`.slice(0, 240);
  }
  const texts = [result.reply, ...(result.action !== 'decline' ? [result.blueprint.name, result.blueprint.description] : [])];
  if (texts.some((text) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)))
    throw new Error('Invalid control characters in generated text');
  return result;
}

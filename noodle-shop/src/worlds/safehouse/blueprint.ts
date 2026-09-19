import { z } from 'zod';
import type { Blueprint, CreatureBehaviour, Primitive } from '../../shared/safehouseTypes';
const finite = z.number().finite();
const triple = (s: z.ZodNumber) => z.tuple([s, s, s]);
// Unknown keys are stripped, not rejected: every strict-schema failure here
// throws away a paid design over formatting (a `role` inside the blueprint, a
// `material` on a part). Geometry and text limits below are still enforced.
export const primitiveSchema = z.object({
  shape: z.enum(['box', 'cylinder', 'sphere', 'cone']),
  // Per-part caps only need to admit the largest neighborhood piece; chat
  // designs are still held to CHAT_LIMITS as a whole by measureBlueprint.
  position: triple(finite.min(-12).max(12)),
  size: triple(finite.min(0.01).max(12)),
  rotation: triple(finite.min(-Math.PI * 2).max(Math.PI * 2)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const blueprintSchema = z.object({
  name: z.string().trim().min(1).max(70),
  description: z.string().max(240),
  parts: z.array(primitiveSchema).min(1).max(100),
});
const roleSchema = z.enum(['decoration', 'barrier', 'turret']).optional();
// A living build: the model names one fixed behaviour (and whether it flies); the app owns every number behind it.
const creatureSchema = z
  .object({ behaviour: z.enum(['rampage', 'fight', 'zoom', 'roam']), flying: z.boolean().optional() })
  .optional();
export const responseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('build'),
    blueprint: blueprintSchema,
    role: roleSchema,
    creature: creatureSchema,
    reply: z.string().max(240),
  }),
  z.object({
    action: z.literal('edit'),
    targetId: z.string().max(100),
    blueprint: blueprintSchema,
    role: roleSchema, // ignored on edits: the existing object keeps its role
    creature: creatureSchema, // on edits: present = wake / calm / change it; absent = keep what it has
    reply: z.string().max(240),
  }),
  z.object({ action: z.enum(['reply', 'clarify', 'decline']), reply: z.string().min(1).max(240) }),
]);
export type DesignResponse = z.infer<typeof responseSchema>;

// ---- tolerant normalisation of model output ------------------------------
// The first live session lost every request to formatting: a nested `role`,
// an `orange` where `#rrggbb` was expected, the 5 m bound. Each of these is
// a well-formed design a person would accept, so normalise before validating.

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
// How a model tends to phrase the four behaviours; anything else means "not a creature".
const BEHAVIOUR_WORDS: [string, CreatureBehaviour][] = [
  ['rampage', 'rampage'], ['attack', 'rampage'], ['destroy', 'rampage'], ['smash', 'rampage'], ['wreck', 'rampage'], ['break', 'rampage'], ['hostile', 'rampage'],
  ['fight', 'fight'], ['guard', 'fight'], ['defend', 'fight'], ['protect', 'fight'], ['hunt', 'fight'], ['bite', 'fight'],
  ['zoom', 'zoom'], ['race', 'zoom'], ['drive', 'zoom'], ['speed', 'zoom'], ['fast', 'zoom'], ['dash', 'zoom'],
  ['roam', 'roam'], ['wander', 'roam'], ['walk', 'roam'], ['graze', 'roam'], ['idle', 'roam'], ['calm', 'roam'], ['tame', 'roam'], ['peaceful', 'roam'],
  ['swoop', 'rampage'], ['fly', 'roam'], ['hover', 'roam'], ['soar', 'roam'], ['glide', 'roam'], ['circle', 'roam'],
];
const FLIGHT_WORDS = /\b(fly|flies|flying|flight|hover|hovers|soar|soars|glide|glides|airborne|swoop|swoops)\b/;
const truthy = (v: unknown) => v === true || (typeof v === 'string' && /^(true|yes|y|1)$/i.test(v.trim()));
/**
 * `"creature":{"behaviour":"guard dog"}`, `"creature":"smash things"`, `"behaviour":"zoom"`,
 * `{"behaviour":"roam","flying":true}` or `"creature":"flying bird"` → a known behaviour, and whether it flies.
 */
export function normalizeCreature(value: unknown): { behaviour: CreatureBehaviour; flying?: true } | undefined {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const raw = typeof value === 'string' ? value : (o?.behaviour ?? o?.behavior ?? o?.type);
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  const hit = BEHAVIOUR_WORDS.find(([w]) => key === w) ?? BEHAVIOUR_WORDS.find(([w]) => key.includes(w));
  if (!hit) return undefined;
  const flying = truthy(o?.flying ?? o?.flies ?? o?.fly ?? o?.airborne) || FLIGHT_WORDS.test(key);
  return flying ? { behaviour: hit[1], flying: true } : { behaviour: hit[1] };
}
/**
 * Reshape a model response into what the schema expects without changing its
 * meaning: hoist a nested role, accept synonyms and alternate spellings, default
 * a missing rotation, trim over-long text. Anything still wrong fails validation.
 */
export function normalizeResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  const rawBlueprint = r.blueprint ?? r.design ?? r.object ?? r.model;
  let action = typeof r.action === 'string' ? r.action.trim().toLowerCase() : r.action;
  if (action === undefined && rawBlueprint) action = r.targetId ? 'edit' : 'build';
  const out: Record<string, unknown> = { action, reply: clip(r.reply ?? r.message ?? '', 240) };
  if (r.targetId !== undefined) out.targetId = r.targetId;
  if (r.role !== undefined) out.role = typeof r.role === 'string' ? r.role.trim().toLowerCase() : r.role;
  const creature = normalizeCreature(r.creature ?? r.behaviour ?? r.behavior);
  if (creature) out.creature = creature;
  if (rawBlueprint && typeof rawBlueprint === 'object') {
    const b = rawBlueprint as Record<string, unknown>;
    if (out.role === undefined && typeof b.role === 'string') out.role = b.role.trim().toLowerCase();
    if (out.creature === undefined) {
      const nested = normalizeCreature(b.creature ?? b.behaviour ?? b.behavior);
      if (nested) out.creature = nested;
    }
    const parts = b.parts ?? b.primitives ?? b.shapes ?? b.pieces ?? b.components;
    out.blueprint = {
      name: clip(b.name ?? b.title, 70),
      description: clip(b.description ?? b.summary ?? '', 240),
      parts: Array.isArray(parts) ? parts.map(normalizePart) : parts,
    };
  }
  return out;
}

export interface Limits {
  width: number;
  depth: number;
  height: number;
}
// Room for a truck, a bus stop or a shed; anything larger is scaled down to fit
// (see fitBlueprint) rather than rejected after a paid design call.
export const CHAT_LIMITS: Limits = { width: 8, depth: 8, height: 8 };
// Seeded neighborhood pieces (garage, neighbor houses) predate the chat bounds.
export const SCENERY_LIMITS: Limits = { width: 12, depth: 12, height: 9 };
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
export function validateResponse(
  value: unknown,
  isLarge: (targetId?: string) => boolean = () => false,
): DesignResponse {
  const result = responseSchema.parse(normalizeResponse(value));
  if ('blueprint' in result) {
    const large = result.action === 'edit' && isLarge(result.targetId);
    const fit = fitBlueprint(result.blueprint, large ? SCENERY_LIMITS : CHAT_LIMITS, result.action === 'build');
    result.blueprint = fit.blueprint;
    if (fit.notes.length) result.reply = `${result.reply} (${fit.notes.join(', ')})`.slice(0, 240);
  }
  const texts = [
    result.reply,
    ...('blueprint' in result ? [result.blueprint.name, result.blueprint.description] : []),
  ];
  if (texts.some((text) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
    throw new Error('Invalid control characters in generated text');
  }
  return result;
}

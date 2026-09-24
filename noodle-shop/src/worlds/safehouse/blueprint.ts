import { z } from 'zod';
import type {
  Blueprint,
  CreatureBehaviour,
  PartAnimation,
  PieceVerb,
  Primitive,
  Rule,
  RuleAction,
  RuleTarget,
  RuleTrigger,
  Use,
  VerbPose,
  VerbWord,
} from '../../shared/safehouseTypes';
import { VERB_WORDS, VERB_POSES } from '../../shared/safehouseTypes';
// rules.ts imports the bounds below and we import its clamps: both only at call time, so the cycle is harmless.
import { clampAnimations, clampRules } from './rules';
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
/** Part motion as data (PartAnimation). Bounds here are the outer wall; rules.ts clamps to taste. */
export const MAX_ANIMATIONS = 16;
export const animationSchema = z.object({
  part: z.number().int().min(0).max(99),
  kind: z.enum(['sway', 'drift', 'spin', 'bob']),
  axis: z.enum(['x', 'y', 'z']).optional(),
  speed: finite.min(0).max(4).optional(),
  amplitude: finite.min(0).max(1).optional(),
  phase: finite.min(-Math.PI * 2).max(Math.PI * 2).optional(),
});
/** The closed vocabulary of what a piece is for (Use). */
export const useSchema = z.enum(['perch', 'seat', 'scare', 'tree', 'vehicle', 'hoop', 'trap', 'music']);
export const MAX_USES = 6;
/** A piece's verb (PieceVerb): a word from the dictionary, a pose from the menu, the rest clamped. */
export const pieceVerbSchema = z.object({
  word: z.enum(VERB_WORDS),
  pose: z.enum(VERB_POSES),
  spot: z.enum(['on', 'beside']),
  seconds: finite.min(3).max(20),
  pop: z.string().max(12).optional(),
});
/** The rule grammar (Rule): a handful per object, every number bounded. */
export const MAX_RULES = 4;
export const ruleSchema = z.object({
  when: z.enum(['tick', 'near', 'night', 'day']),
  target: z
    .object({
      tag: useSchema.optional(),
      kind: z.enum(['zombie', 'creature', 'rook', 'neighbour', 'viewer']).optional(),
      pick: z.enum(['nearest', 'random']).optional(),
      within: finite.min(0).max(60).optional(),
    })
    .optional(),
  do: z.enum(['visit', 'perch', 'flee']),
  dwell: z.tuple([finite.min(0).max(600), finite.min(0).max(600)]).optional(),
});
export const blueprintSchema = z.object({
  name: z.string().trim().min(1).max(70),
  description: z.string().max(240),
  parts: z.array(primitiveSchema).min(1).max(100),
  animations: z.array(animationSchema).max(MAX_ANIMATIONS).optional(),
});
const roleSchema = z.enum(['decoration', 'barrier', 'turret']).optional();
// A living build: the model names one fixed behaviour (and whether it flies); the app owns every number behind it.
const creatureSchema = z
  .object({ behaviour: z.enum(['rampage', 'fight', 'zoom', 'roam']), flying: z.boolean().optional() })
  .optional();
// What a piece is for and how a living build behaves, as data (state v9 "small life"). The
// normaliser maps synonyms and drops anything outside the closed vocabulary before this runs,
// so a paid design never fails over an unknown word here; rules.ts clamps the numbers.
const usesSchema = z.array(useSchema).max(MAX_USES).optional();
const rulesSchema = z.array(ruleSchema).max(MAX_RULES).optional();
export const responseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('build'),
    blueprint: blueprintSchema,
    role: roleSchema,
    creature: creatureSchema,
    uses: usesSchema,
    rules: rulesSchema, // applied only to a living build
    verb: pieceVerbSchema.optional(), // the one thing a viewer can do at it (`!swim`)
    reply: z.string().max(240),
  }),
  z.object({
    action: z.literal('edit'),
    targetId: z.string().max(100),
    blueprint: blueprintSchema,
    role: roleSchema, // ignored on edits: the existing object keeps its role
    creature: creatureSchema, // on edits: present = wake / calm / change it; absent = keep what it has
    uses: usesSchema, // on edits: present = replace; absent = keep
    rules: rulesSchema, // on edits: present = replace; absent = keep
    verb: pieceVerbSchema.optional(), // on edits: present = replace; absent = keep
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
// ---- what a piece is for, how a living build behaves, and part motion, as the model phrases them ----
// Closed vocabularies with tolerant spellings: anything that does not map is dropped, never a
// failure, because a paid design must not be lost over a word the app does not know.
const USE_WORDS: [RegExp, Use][] = [
  [/^(perch(es|ing|able)?|roost(ing)?|landing( spot)?)$/, 'perch'],
  [/^(seat(s|ing)?|bench|chair|sit(ting|table)?|stool|hammock|swing|sofa|couch|lounger)$/, 'seat'],
  [/^(scare|scarecrow|deterrent|bird scarer|scary)$/, 'scare'],
  [/^(tree|trees)$/, 'tree'],
  [/^(vehicle|car|van|truck|bike|bicycle|motorbike|kart|go-kart|driv(e|able|eable)|ride(able)?)$/, 'vehicle'],
  [/^(hoop|basketball( hoop)?|net|basket)$/, 'hoop'],
  [/^(trap|hole|pit|pitfall|ditch|trench|pothole|sinkhole)$/, 'trap'],
  [/^(music|speakers?|boombox|jukebox|radio|stereo|sound( system)?|pa|amp(lifier)?|subwoofer|loudspeakers?)$/, 'music'],
];
const useOf = (word: string): Use | undefined => USE_WORDS.find(([re]) => re.test(word))?.[1];
function useWord(raw: unknown): Use | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return useOf(s) ?? s.split(/\s+/).map(useOf).find(Boolean);
}
/** `"uses":["seat"]`, `"uses":"perch, seat"`, `"tags":["bench"]` → the closed vocabulary, deduped and capped. */
export function normalizeUses(value: unknown): Use[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;/|]+/) : [];
  const out: Use[] = [];
  for (const entry of raw) {
    const u = useWord(entry);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= MAX_USES) break;
  }
  return out.length ? out : undefined;
}
const WHEN_WORDS: [RegExp, RuleTrigger][] = [
  [/\b(near(by)?|close( by)?|proximity|approach(es|ing)?|within|comes? (near|close)|if .* near|when .* near)\b/, 'near'],
  [/\b(night|nightfall|dark|after dark|dusk|evening|nocturnal)\b/, 'night'],
  [/\b(day(time|light)?|morning|dawn|diurnal)\b/, 'day'],
  [/\b(always|idle|tick|loop|each tick|every tick|default|constantly|otherwise|usually)\b/, 'tick'],
];
const DO_WORDS: [RegExp, RuleAction][] = [
  [/\b(perch|land(s|ing)? on|land|roost|sit(s)? on top|settle(s)? on|alight)\b/, 'perch'],
  [/\b(flee|run(s)? (from|away)|run|avoid|escape|hide|scatter|fly (away|off)|keep away|stay away|retreat|dodge|scared of|afraid of)\b/, 'flee'],
  [/\b(visit|go(es)? to|walk(s)? to|approach|follow(s)?|stand(s)? (by|near|next to)|sit(s)?( by| on| near| beside)?|rest|sleep|lie|nap|hang (around|out)|stay (near|close|by|with)|guard|watch|wait (by|near))\b/, 'visit'],
];
const KIND_WORDS: [RegExp, NonNullable<RuleTarget['kind']>][] = [
  [/^(zombies?|walkers?|runners?|brutes?|horde|undead)$/, 'zombie'],
  [/^(creatures?|animals?|pets?|monsters?|beasts?|living things?|other creatures?)$/, 'creature'],
  [/^(rook|survivor|builder|him|the builder)$/, 'rook'],
  [/^(neighbou?rs?|marge|jake|people next door|the neighbou?rs?)$/, 'neighbour'],
  [/^(viewers?|chat|crowd|audience|people|watchers?|the crowd)$/, 'viewer'],
];
const kindWord = (raw: unknown): RuleTarget['kind'] | undefined => {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  return KIND_WORDS.find(([re]) => re.test(s))?.[1];
};
const phrase = (raw: unknown): string | undefined =>
  typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[_-]+/g, ' ') : undefined;
const firstOf = <T>(table: [RegExp, T][], s: string | undefined): T | undefined =>
  s === undefined ? undefined : table.find(([re]) => re.test(s))?.[1];
function normalizeTarget(value: unknown): RuleTarget | undefined {
  if (typeof value === 'string') {
    const tag = useWord(value);
    if (tag) return { tag };
    const kind = kindWord(value);
    return kind ? { kind } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const t = value as Record<string, unknown>;
  const tag = useWord(t.tag ?? t.use ?? t.uses ?? t.piece ?? t.thing);
  const kind = kindWord(t.kind ?? t.what ?? t.who ?? t.type ?? t.mover) ?? (tag ? undefined : kindWord(t.tag ?? t.use));
  if (!tag && !kind) return undefined;
  const pickRaw = phrase(t.pick ?? t.choose ?? t.select ?? t.which);
  const within = num(t.within ?? t.radius ?? t.distance ?? t.range ?? t.metres ?? t.meters);
  return {
    ...(tag ? { tag } : {}),
    ...(kind && !tag ? { kind } : {}),
    pick: pickRaw && /random|any/.test(pickRaw) ? 'random' : 'nearest',
    ...(Number.isFinite(within) ? { within } : {}),
  };
}
function normalizeDwell(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const a = num(value[0]),
      b = num(value[1]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined;
  }
  if (Array.isArray(value) && value.length === 1) return normalizeDwell(value[0]);
  const n = num(value);
  if (Number.isFinite(n)) return [n, n];
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const lo = num(o.min ?? o.from ?? o.low ?? o.least),
      hi = num(o.max ?? o.to ?? o.high ?? o.most);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return [lo, hi];
    if (Number.isFinite(lo)) return [lo, lo];
    if (Number.isFinite(hi)) return [hi, hi];
  }
  return undefined;
}
/**
 * `"rules":[{"when":"when near","target":"zombie","do":"run from","dwell":10}]` → the grammar
 * (RuleTrigger / RuleTarget / RuleAction), then rules.ts clamps every number. A rule whose trigger,
 * action or target does not map is dropped on its own; the design stands.
 */
export function normalizeRules(value: unknown): Rule[] | undefined {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const out: Rule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const whenText = phrase(r.when ?? r.trigger ?? r.on ?? r.if ?? r.condition ?? 'tick');
    const doText = phrase(r.do ?? r.action ?? r.then ?? r.verb ?? r.behaviour ?? r.behavior);
    const when = firstOf(WHEN_WORDS, whenText);
    const act = firstOf(DO_WORDS, doText);
    const target = normalizeTarget(r.target ?? r.of ?? r.to ?? r.from ?? r.at ?? r.what);
    if (!when || !act || !target) continue;
    const dwell = normalizeDwell(r.dwell ?? r.stay ?? r.linger ?? r.for ?? r.seconds ?? r.duration);
    out.push({ when, do: act, target, ...(dwell ? { dwell } : {}) });
  }
  const clamped = clampRules(out);
  return clamped.length ? clamped : undefined;
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
 * Reshape a model response into what the schema expects without changing its
 * meaning: hoist a nested role, accept synonyms and alternate spellings, default
 * a missing rotation, trim over-long text. Anything still wrong fails validation.
 */
// ---- a piece's own verb (PieceVerb) -----------------------------------------------------------
// The model names a word and a pose; both must land in the closed lists or the verb is dropped on
// its own (never the design). Stems and a few synonyms are forgiven, as everywhere else here.
const isVerbWord = (s: string): s is VerbWord => (VERB_WORDS as readonly string[]).includes(s);
const isPose = (s: string): s is VerbPose => (VERB_POSES as readonly string[]).includes(s);
const VERB_SYNONYMS: [RegExp, VerbWord][] = [
  [/^(float|paddle|dive|bathe|swimming)$/, 'swim'],
  [/^(trampoline|boing|bouncing)$/, 'bounce'],
  [/^(leap|leaping|hopping)$/, 'jump'],
  [/^(seat|seated|sitting)$/, 'sit'],
  [/^(lay|laying|lying|lounge|recline)$/, 'lie'],
  [/^(doze|snooze|sleeping)$/, 'sleep'],
  [/^(chill|relax|relaxing|resting)$/, 'rest'],
  [/^(chime|toll|bell|ringing)$/, 'ring'],
  [/^(box|boxing|hit|strike|punching)$/, 'punch'],
  [/^(sip|beer|drinking)$/, 'drink'],
  [/^(cheers|toasting)$/, 'toast'],
  [/^(snack|dine|dining|feast|eating)$/, 'eat'],
  [/^(grill|barbecue|bbq|cooking)$/, 'cook'],
  [/^(angle|angling|fishing)$/, 'fish'],
  [/^(worship|kneel|praying)$/, 'pray'],
  [/^(zen|om|meditating)$/, 'meditate'],
  [/^(crouch|hiding)$/, 'hide'],
  [/^(study|reading)$/, 'read'],
  [/^(greet|hello|hi|waving)$/, 'wave'],
  [/^(celebrate|clap|applaud|cheering)$/, 'cheer'],
  [/^(selfie|photo|posing)$/, 'pose'],
  [/^(twirl|spinning)$/, 'spin'],
  [/^(cuddle|hugging)$/, 'hug'],
  [/^(pet|stroke|patting)$/, 'pat'],
  [/^(sprint|jog|running)$/, 'run'],
  [/^(yoga|stretching)$/, 'stretch'],
  [/^(steer|cruise|race|racing|driving|joyride)$/, 'drive'],
  [/^(mount|gallop|saddle|horseback|riding)$/, 'ride'],
  [/^(brawl|scrap|spar|wrestle|battle|attack|duel|fighting|combat)$/, 'fight'],
];
export function normalizeVerbWord(value: unknown): VerbWord | undefined {
  if (typeof value !== 'string') return undefined;
  const w = value.trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z]/g, '');
  if (!w) return undefined;
  const stems = [w, w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/(.)\1ing$/, '$1'), w.replace(/es$/, ''), w.replace(/s$/, '')];
  for (const s of stems) if (isVerbWord(s)) return s;
  return VERB_SYNONYMS.find(([re]) => re.test(w))?.[1];
}
const POSE_SYNONYMS: [RegExp, VerbPose][] = [
  [/^(float|floating|breaststroke|swimming)$/, 'swim'],
  [/^(hop|hopping|bounce|bouncing|jumping)$/, 'jump'],
  [/^(sitting|seated|crouch|kneel)$/, 'sit'],
  [/^(lying|lay|laying|flat|prone|sleep|sleeping)$/, 'lie'],
  [/^(waving|salute|greet)$/, 'wave'],
  [/^(clap|applaud|celebrate|cheering|arms up)$/, 'cheer'],
  [/^(hit|box|strike|punching|kick)$/, 'punch'],
  [/^(still|idle|standing)$/, 'stand'],
];
export function normalizePose(value: unknown): VerbPose | undefined {
  if (typeof value !== 'string') return undefined;
  const p = value.trim().toLowerCase();
  if (isPose(p)) return p;
  return POSE_SYNONYMS.find(([re]) => re.test(p))?.[1];
}
/** The pose a word implies when the model gave none. */
export const DEFAULT_POSE: Record<VerbWord, VerbPose> = {
  swim: 'swim', bounce: 'jump', jump: 'jump', hop: 'jump', run: 'jump',
  sit: 'sit', rest: 'sit', read: 'sit', eat: 'sit', drink: 'sit', fish: 'sit', meditate: 'sit', pray: 'sit', hide: 'sit', cook: 'stand',
  lie: 'lie', sleep: 'lie', nap: 'lie',
  wave: 'wave', salute: 'wave', bow: 'wave', hug: 'wave', pat: 'wave', feed: 'wave', water: 'wave', ring: 'wave', pull: 'wave',
  cheer: 'cheer', toast: 'cheer', pose: 'cheer', stretch: 'cheer', spin: 'cheer', swing: 'sit', slide: 'cheer', climb: 'cheer',
  kick: 'punch', punch: 'punch', knock: 'punch', push: 'punch', sweep: 'punch',
  drive: 'sit', ride: 'sit', fight: 'punch',
};
/** Words with a length of their own: a drive and a ride are a trip, a fight a few rounds. Everything else eight seconds. */
export const DEFAULT_SECONDS: Partial<Record<VerbWord, number>> = { drive: 12, ride: 12, fight: 5 };
/** Words whose spot does not follow from the design's height: you get in a car and square up to a gorilla. */
const DEFAULT_SPOT: Partial<Record<VerbWord, PieceVerb['spot']>> = { drive: 'on', ride: 'on', fight: 'beside' };
/**
 * `"verb":{"word":"swim","pose":"swim","spot":"on","seconds":8,"pop":"SPLASH"}`, or just `"verb":"swim"`
 * → a PieceVerb, or undefined when the word is not in the dictionary. `maxY` (the design's height)
 * decides the spot when the model gave none: low things are stood on, tall things beside.
 */
export function normalizeVerb(value: unknown, maxY = 0): PieceVerb | undefined {
  const o = typeof value === 'string' ? { word: value } : value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  if (!o) return undefined;
  const word = normalizeVerbWord(o.word ?? o.verb ?? o.command ?? o.name);
  if (!word) return undefined;
  const pose = normalizePose(o.pose ?? o.animation ?? o.stance) ?? DEFAULT_POSE[word];
  const spotRaw = typeof o.spot === 'string' ? o.spot : typeof o.where === 'string' ? o.where : typeof o.stand === 'string' ? o.stand : '';
  const spot = /^\s*(on|in|inside|onto|top|into)\b/i.test(spotRaw)
    ? 'on'
    : /^\s*(beside|next|by|near|at|front|off)\b/i.test(spotRaw)
      ? 'beside'
      : (DEFAULT_SPOT[word] ?? (maxY <= 1 ? 'on' : 'beside'));
  const secondsRaw = Number(o.seconds ?? o.duration ?? o.time ?? o.for);
  const seconds = Number.isFinite(secondsRaw) ? Math.min(20, Math.max(3, secondsRaw)) : (DEFAULT_SECONDS[word] ?? 8);
  const pop = typeof o.pop === 'string' ? o.pop.toUpperCase().replace(/[^A-Z!]/g, '').slice(0, 12) : '';
  return { word, pose, spot, seconds, ...(pop ? { pop } : {}) };
}

export function normalizeResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  const rawBlueprint = r.blueprint ?? r.design ?? r.object ?? r.model;
  let action = typeof r.action === 'string' ? r.action.trim().toLowerCase() : r.action;
  if (action === undefined && rawBlueprint) action = r.targetId ? 'edit' : 'build';
  const out: Record<string, unknown> = { action, reply: clip(r.reply ?? r.message ?? '', 240) };
  if (r.targetId !== undefined) out.targetId = r.targetId;
  if (r.role !== undefined) out.role = typeof r.role === 'string' ? r.role.trim().toLowerCase() : r.role;
  const rawCreature = r.creature ?? r.behaviour ?? r.behavior;
  const creature = normalizeCreature(rawCreature);
  if (creature) out.creature = creature;
  const b = rawBlueprint && typeof rawBlueprint === 'object' ? (rawBlueprint as Record<string, unknown>) : undefined;
  if (b) {
    if (out.role === undefined && typeof b.role === 'string') out.role = b.role.trim().toLowerCase();
    if (out.creature === undefined) {
      const nested = normalizeCreature(b.creature ?? b.behaviour ?? b.behavior);
      if (nested) out.creature = nested;
    }
    const parts = b.parts ?? b.primitives ?? b.shapes ?? b.pieces ?? b.components;
    const partList = Array.isArray(parts) ? parts.map(normalizePart) : parts;
    const animations = normalizeAnimations(
      b.animations ?? b.motion ?? b.animation ?? r.animations ?? r.motion,
      Array.isArray(partList) ? partList.length : 0,
    );
    out.blueprint = {
      name: clip(b.name ?? b.title, 70),
      description: clip(b.description ?? b.summary ?? '', 240),
      parts: partList,
      ...(animations ? { animations } : {}),
    };
  }
  // What the piece is for, and how a living build behaves: top level, inside the blueprint, or
  // (rules) tucked inside the creature — wherever the model put them.
  const uses = normalizeUses(r.uses ?? r.use ?? r.tags ?? b?.uses ?? b?.use ?? b?.tags);
  if (uses) out.uses = uses;
  const nestedRules = rawCreature && typeof rawCreature === 'object' ? (rawCreature as Record<string, unknown>).rules : undefined;
  const rules = normalizeRules(r.rules ?? r.behaviours ?? r.behaviors ?? b?.rules ?? nestedRules);
  if (rules) out.rules = rules;
  // The piece's own verb: the design's height (a rough top from the raw parts) picks on/beside when the model gave neither.
  const rawParts = b ? (b.parts ?? b.primitives ?? b.shapes ?? b.pieces ?? b.components) : undefined;
  const maxY = Array.isArray(rawParts)
    ? rawParts.reduce((top: number, p: unknown) => {
        const q = normalizePart(p) as { position?: unknown; size?: unknown } | undefined;
        const pos = Array.isArray(q?.position) ? Number(q!.position[1]) : NaN;
        const size = Array.isArray(q?.size) ? Number(q!.size[1]) : NaN;
        return Number.isFinite(pos) && Number.isFinite(size) ? Math.max(top, pos + size / 2) : top;
      }, 0)
    : 0;
  const verb = normalizeVerb(r.verb ?? r.chatVerb ?? b?.verb, maxY);
  if (verb) out.verb = verb;
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

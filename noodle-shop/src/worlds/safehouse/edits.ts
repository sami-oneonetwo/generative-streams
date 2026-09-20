import {
  shortRef,
  type Blueprint,
  type GroundPoint,
  type SafehouseObject,
} from '../../shared/safehouseTypes';
import {
  LANDMARKS,
  WANDER_AREA,
  YARD_BOUNDS,
  HOUSE_ID,
  contains,
  footprint,
  inflate,
  type Rect,
} from '../../shared/safehouseLayout';
import { CHAT_LIMITS, SCENERY_LIMITS, measureBlueprint } from './blueprint';

export interface QuickEdit {
  kind: 'recolor' | 'scale';
  color?: string;
  factor?: number;
  axis?: 'all' | 'height';
}
export type Operation = 'repair' | 'rebuild' | 'turret' | 'barrier' | 'move' | 'rotate';
export type Side = 'next to' | 'beside' | 'in front of' | 'behind' | 'left of' | 'right of';
export interface ResolvedRequest {
  targetId?: string;
  quick?: QuickEdit;
  clarification?: string;
}
/** Everything the request grammar can decide without a model call. */
export interface ParsedRequest extends ResolvedRequest {
  text: string; // what the model sees; placement suffixes removed
  operation?: Operation;
  angle?: number; // radians, rotate only
  requestedPosition?: GroundPoint;
  requestedArea?: string;
  relativeTo?: { objectId: string; side: Side };
  rejection?: string; // unsupported request, explained rather than approximated
}
/** What the resolver may use besides the words: whose "my", and what the pick is for. */
interface Asking {
  username?: string;
  prefer?: 'damaged'; // repair/rebuild of a generic name ("the fence") takes the worst one
}

const colors: Record<string, string> = {
  red: '#b65b50',
  pink: '#cb8b91',
  blue: '#6689a6',
  green: '#76875a',
  yellow: '#cfb968',
  orange: '#c68955',
  purple: '#9b80aa',
  white: '#dedbcb',
  black: '#353a37',
  brown: '#897052',
  gray: '#8c928a',
  grey: '#8c928a',
};
const SIDES = 'next to|beside|in front of|behind|left of|right of';
/** Loose placement words that mean "next to"; "by" only with an article so "made by hand" is left alone. */
const NEAR = 'near|close to|by(?= the\\b)';
export const objectReference = (o: SafehouseObject) => `#${shortRef(o.id)}`;
const normalize = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .replace(/^the\s+/, '');
/** Rook's house answers to plain "the house" as well as its full name. */
const HOUSE_ALIASES = new Set(['house', "rook's house", 'rooks house', 'his house', 'home', 'safehouse']);

// ---- Names -------------------------------------------------------------------------------
//
// Nobody in chat knows a #reference and nobody types "Road Patrol Monster Truck". They say "the
// truck", "the statue in the back", "dave's statue", "my car". A phrase fits a name when the
// whole name is given, or when every word of the phrase is a word of the name (plurals
// forgiven); the best fit wins. Several things fitting equally is a question back to chat that
// names them, where they are and who built them, rather than a demand for a hash.

const STOP = new Set(['the', 'a', 'an', 'my', 'that', 'this', 'one', 'thing', 'piece', 'of']);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !STOP.has(w));
const same = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
const fitsWords = (wanted: string[], name: string[]) =>
  wanted.length > 0 && wanted.every((w) => name.some((n) => same(w, n)));
/** 3: the whole name (or its #reference, id, or a house alias). 2: every word given is in the name. 0: no. */
function fit(phrase: string, o: SafehouseObject): number {
  const wanted = normalize(phrase);
  if (
    normalize(o.blueprint.name) === wanted ||
    objectReference(o).toLowerCase() === wanted ||
    o.id === wanted ||
    (o.id === HOUSE_ID && HOUSE_ALIASES.has(wanted))
  )
    return 3;
  return fitsWords(tokens(phrase), tokens(o.blueprint.name)) ? 2 : 0;
}
/** Everything that fits the phrase as well as anything does. */
function pick(phrase: string, objects: SafehouseObject[]): SafehouseObject[] {
  let best = 0,
    out: SafehouseObject[] = [];
  for (const o of objects) {
    const f = fit(phrase, o);
    if (!f || f < best) continue;
    if (f > best) {
      best = f;
      out = [];
    }
    out.push(o);
  }
  return out;
}
// Where things are, in chat's words. Specific areas first so "front yard" beats "the yard".
const AREA_ORDER = [
  'front yard',
  'back yard',
  'driveway',
  'garden',
  'by the garage',
  'bus stop',
  'shop',
  'playground',
  'pond',
  'park',
  'west lot',
  'east lot',
  'street',
  'across the street',
];
function where(o: SafehouseObject): string {
  const area = AREA_ORDER.find((k) => contains(LANDMARKS[k], o.position));
  if (area) return area;
  if (contains(inflate(WANDER_AREA, 1.5), o.position)) return 'the yard'; // the fence sits on the edge
  return `${o.position.x.toFixed(0)},${o.position.z.toFixed(0)}`;
}
/** "in the front yard", "by the garage", "by the house": an area name as chat would say it. */
const placeHint = (area: string) =>
  area === 'the yard' ? 'by the house' : /^(?:by|across|in front|behind|beside|outside)\b/.test(area) ? area : `in the ${area}`;
const describe = (o: SafehouseObject) =>
  `${o.blueprint.name} ${objectReference(o)} (${where(o)}${o.fixed && !o.owner ? '' : `, by ${o.createdBy}`})`;
const baseName = (o: SafehouseObject) =>
  o.blueprint.name.replace(/\s*\(.*\)\s*$/, '').replace(/\s+\d+$/, '').toLowerCase();
const hurt = (o: SafehouseObject) => o.destroyedAt !== undefined || (o.health ?? 80) < (o.maxHealth ?? 80);
const damage = (o: SafehouseObject) => (o.destroyedAt !== undefined ? -1 : (o.health ?? 80) / (o.maxHealth ?? 80));
/** How far a point is from a thing's footprint (zero when on it), so "by the house" means the wall, not the middle. */
const distanceTo = (p: GroundPoint, o: SafehouseObject) => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
};
/** "Which statue? Stone statue #a1b2 (back yard, by dave), Garden statue #c3d4 (front yard, by erin). …" */
function whichOne(phrase: string, candidates: SafehouseObject[]): string {
  const noun = normalize(phrase).replace(/^(?:my |\w+['’]s )/, '');
  const bases = new Set(candidates.map(baseName));
  if (bases.size === 1 && candidates.length > 4) {
    const base = baseName(candidates[0]);
    return `Which of the ${candidates.length} ${base}s? Say where it is, like “the ${base} by the garage” or “the ${base} at the front”, or use its #reference from Inspect.`;
  }
  const shown = candidates.slice(0, 4).map(describe).join(', ');
  const more = candidates.length > 4 ? ` and ${candidates.length - 4} more` : '';
  return `Which ${noun}? ${shown}${more}. Say which, like “the ${noun} ${placeHint(where(candidates[0]))}”, or use its #reference.`;
}
function notFound(phrase: string, objects: SafehouseObject[]): string {
  const words = tokens(phrase);
  const close = objects
    .filter((o) => words.some((w) => tokens(o.blueprint.name).some((n) => same(w, n))))
    .slice(0, 3);
  if (close.length)
    return `I can't find “${phrase.trim()}”. Did you mean ${close.map(describe).join(', ')}?`;
  return `I can't find “${phrase.trim()}”. Any part of a name works, like “the truck” or “the statue in the back”; the Inspect list has them all.`;
}

/** Named areas, plus the words chat actually uses for them. Returns a LANDMARKS key. */
const PLACE_ALIASES: Record<string, string> = {
  front: 'front yard',
  'front of the house': 'front yard',
  'front garden': 'front yard',
  porch: 'front yard',
  back: 'back yard',
  rear: 'back yard',
  'back garden': 'back yard',
  'back of the yard': 'back yard',
  garage: 'by the garage',
  'side of the garage': 'by the garage',
  store: 'shop',
  drive: 'driveway',
  'other side of the street': 'across the street',
  'other side of the road': 'across the street',
  'across the road': 'across the street',
  'over the road': 'across the street',
  west: 'west lot',
  east: 'east lot',
};
export function landmarkFor(place: string): string | undefined {
  const known = (p: string) => (LANDMARKS[p] ? p : PLACE_ALIASES[p]);
  const whole = normalize(place);
  if (known(whole)) return known(whole); // "over the road" before its words are stripped
  const bare = whole.replace(/^(?:out |round |around |over |up |down |at |in |to |on |the )+/, '');
  return known(bare) ?? known(bare.replace(/\s+(?:yard|area|bit|end|part|side)$/, ''));
}
function landmarkIn(text: string): string | undefined {
  const lower = ` ${normalize(text)} `;
  const key = Object.keys(LANDMARKS)
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.includes(` ${name} `) || lower.includes(` the ${name} `));
  if (key) return key;
  // "at the back", "out front", "to the rear": one-word places only after a place word, so a
  // "truck with a big front bumper" is not a request for the front yard.
  const led = lower.match(/ (?:in|at|to|out|around|round|from|by) (?:the )?(front|back|rear)(?: (?:yard|garden|of the house))? /);
  return led ? PLACE_ALIASES[led[1]] : undefined;
}

interface Found {
  target?: SafehouseObject;
  clarification?: string;
  /** The phrase names something here, just not one thing; the caller should not go looking elsewhere. */
  found?: boolean;
}
const QUALIFIER = /^(.+?)\s+(in|at|by|near|next to|beside|behind|in front of|on|inside|outside|around|from|under|over)\s+(.+)$/;
/**
 * One thing, from a phrase the way chat says it: "the truck", "the statue in the back", "dave's
 * statue", "my car", "the fence by the garage", "it", a #reference. Ambiguity comes back as a
 * question that lists the candidates; a miss suggests near names.
 */
export function resolveTarget(
  phrase: string,
  objects: SafehouseObject[],
  lastId?: string,
  asking: Asking = {},
): Found {
  const wanted = normalize(phrase);
  if (/^(it|that|this|that one|the same)$/.test(wanted)) {
    const target = objects.find((o) => o.id === lastId);
    return target
      ? { target, found: true }
      : { clarification: 'Which one? Name it, like “the truck”. “It” means your own last creation.' };
  }
  // "my statue", "dave's statue", "marge's veg patch": that person's own builds (a neighbour's
  // are fixed like the rest of the block but still theirs). Rook's things keep his name.
  const owned = wanted.match(/^(?:my|([\w.]+)['’]s)\s+(.+)$/);
  if (owned && !/^(rook|rooks|his)$/.test(owned[1] ?? '')) {
    const owner = (owned[1] ?? asking.username ?? '').toLowerCase();
    if (owner) {
      const theirs = objects.filter((o) => (!o.fixed || o.owner) && o.createdBy.toLowerCase() === owner);
      if (!theirs.length) return { clarification: `Nothing here was built by ${owned[1] ?? 'you'} yet.`, found: true };
      const r = resolveTarget(owned[2], theirs, lastId, { ...asking, username: undefined });
      if (r.target || r.found) return r;
      return { clarification: `I can't find a ${normalize(owned[2])} built by ${owned[1] ?? 'you'}.`, found: true };
    }
  }
  const direct = pick(wanted, objects);
  if (direct.length === 1) return { target: direct[0], found: true };
  if (direct.length > 1) return settle(wanted, direct, asking);
  // "the statue in the back", "the fence by the garage": the name, then where it is.
  const q = wanted.match(QUALIFIER);
  if (q) {
    const near = pick(q[1], objects);
    if (near.length) {
      const area = landmarkFor(q[3]);
      if (area) {
        const rect = LANDMARKS[area];
        let inside = near.filter((o) => contains(rect, o.position));
        if (!inside.length) inside = near.filter((o) => contains(inflate(rect, 4), o.position));
        if (inside.length === 1) return { target: inside[0], found: true };
        if (inside.length > 1) return settle(q[1], inside, asking);
        return { clarification: `None of these is ${q[2]} the ${area}: ${near.slice(0, 4).map(describe).join(', ')}.`, found: true };
      }
      const anchor = resolveTarget(q[3], objects.filter((o) => !near.includes(o)), lastId);
      if (anchor.target) {
        const a = anchor.target;
        const byDistance = [...near].sort((x, y) => distanceTo(x.position, a) - distanceTo(y.position, a));
        if (byDistance.length === 1 || distanceTo(byDistance[1].position, a) - distanceTo(byDistance[0].position, a) > 1.5)
          return { target: byDistance[0], found: true };
        return settle(q[1], byDistance.slice(0, 2), asking);
      }
      if (anchor.found) return anchor;
    }
  }
  return { clarification: notFound(phrase, objects) };
}
/** Several fit equally: a repair takes the worst one; anything else is a question back. */
function settle(phrase: string, candidates: SafehouseObject[], asking: Asking): Found {
  if (asking.prefer === 'damaged') {
    const broken = candidates.filter(hurt).sort((a, b) => damage(a) - damage(b));
    if (broken.length) return { target: broken[0], found: true };
  }
  return { clarification: whichOne(phrase, candidates), found: true };
}

/**
 * Things a sentence talks about without being told to: "Make the truck bigger", "Add a chimney to
 * the garage". A full name after "the", a #reference, or the house count anywhere. Part of a name
 * counts too — but in a sentence building something new ("Build a dog that fights the gorilla")
 * only when it is attached to the new thing with to/on/onto/for, so a description of the new
 * thing is never mistaken for an edit of an old one.
 */
function mentioned(input: string, objects: SafehouseObject[]): SafehouseObject[] {
  const exact = objects.filter(
    (o) =>
      input.includes(`the ${normalize(o.blueprint.name)}`) ||
      input.includes(objectReference(o).toLowerCase()) ||
      (o.id === HOUSE_ID && /\b(?:the|his|rook'?s) house\b/.test(input)),
  );
  if (exact.length) return exact;
  const building = /^(?:build|make|create|add|place|put|spawn|construct|design)\s+(?:a|an|some|another|\d+)\b/.test(input);
  const out = new Set<SafehouseObject>();
  // Up to three words after each "the", looked at without being consumed, so "the roof of the
  // truck" still reaches "the truck".
  const chunk = /(?:^|\b([\w'’-]+)\s+)the\s+(?=([\w'’-]+)(?:\s+([\w'’-]+))?(?:\s+([\w'’-]+))?)/g;
  for (const m of input.matchAll(chunk)) {
    if (building && !/^(?:to|on|onto|for)$/.test(m[1] ?? '')) continue;
    for (let k = 1; k <= 3; k++) {
      const words = [m[2], m[3], m[4]].slice(0, k);
      if (words.some((w) => w === undefined)) break;
      const wanted = tokens(words.join(' '));
      for (const o of objects) if (fitsWords(wanted, tokens(o.blueprint.name))) out.add(o);
    }
  }
  return [...out];
}

export function resolveRequest(
  text: string,
  objects: SafehouseObject[],
  lastId?: string,
  username?: string,
): ResolvedRequest {
  const input = normalize(text);
  // Full grammar only: qualifiers like "roof only" must never recolor the whole object.
  const paint = input.match(
    /^(?:paint|recolor|recolour|make)\s+(.+?)\s+(red|pink|blue|green|yellow|orange|purple|white|black|brown|gray|grey|#[0-9a-f]{6})$/,
  );
  const scale = input.match(/^make\s+(.+?)\s+(\d+(?:\.\d+)?)%\s+(taller|shorter|bigger|smaller)$/);
  const targetText = paint?.[1] ?? scale?.[1];
  let target: SafehouseObject | undefined;
  if (targetText) {
    const r = resolveTarget(targetText, objects, lastId, { username });
    if (r.target) target = r.target;
    else if (r.found) return { clarification: r.clarification };
    else if (/\b(roof|legs|windows|door|only|just|head|body|walls|wheels)\b/.test(targetText)) {
      // "Paint the roof of the truck red": a part, so a redesign of the truck, not a recolor.
      const named = mentioned(input, objects);
      if (named.length === 1) return { targetId: named[0].id };
      if (named.length > 1) return { clarification: whichOne(targetText, named) };
      if (/\b(it|that|this)\b/.test(targetText) && objects.some((o) => o.id === lastId)) return { targetId: lastId };
    }
  } else {
    const matches = mentioned(input, objects);
    if (matches.length > 1) return { clarification: whichOne(input, matches) };
    target = matches[0];
  }
  // "Build a gorilla that runs around and breaks things": here "that" opens a description
  // of the new thing, not a reference to the last one. "it" and "this" still do.
  const describing =
    /^(?:build|make|create|add|place|put|spawn|construct|design)\b.*\b(?:a|an|some|another)\s+[\w\s-]*?\bthat\s+\w+/.test(
      input,
    );
  const pronoun = targetText
    ? /^(it|that|this)$/.test(targetText)
    : (describing ? /\b(it|this)\b/ : /\b(it|that|this)\b/).test(input);
  if (!target && pronoun) target = objects.find((o) => o.id === lastId);
  if (!target && (targetText || pronoun))
    return {
      clarification:
        targetText && !pronoun
          ? notFound(targetText, objects)
          : 'Which one? Name it, like “the truck”. I keep “it” tied to your own last creation.',
    };
  if (!target) return {};
  if (paint) return { targetId: target.id, quick: { kind: 'recolor', color: colors[paint[2]] ?? paint[2] } };
  if (scale) {
    const percent = Number(scale[2]);
    if (percent <= 0 || percent > 100) return { clarification: 'Choose a size change between 1% and 100%.' };
    const factor = 1 + (percent / 100) * (/shorter|smaller/.test(scale[3]) ? -1 : 1);
    if (factor < 0.25 || factor > 2)
      return { clarification: 'Keep each size change between one quarter and twice the original size.' };
    return {
      targetId: target.id,
      quick: { kind: 'scale', factor, axis: /taller|shorter/.test(scale[3]) ? 'height' : 'all' },
    };
  }
  return { targetId: target.id };
}

const WHERE_TO = 'Where to? Say “next to <name>”, an area like “the front” or “the back yard”, or coordinates “to 3,12”.';
/**
 * "Move the statue in the back to the front", "Put the truck next to the house", "Move it to the
 * shop". The destination is read from the right: the last place word whose tail is an area or a
 * thing; what is left is the mover, qualifiers and all. `put`/`take`/`bring` with something that
 * is not here ("Put a lamp next to the house") is a build and returns nothing.
 */
function parseMove(
  input: string,
  text: string,
  objects: SafehouseObject[],
  lastId: string | undefined,
  asking: Asking,
  requestedPosition?: GroundPoint,
): ParsedRequest | undefined {
  const m = input.match(/^(move|relocate|shift|put|take|bring)\s+(.+)$/);
  if (!m) return undefined;
  const loose = /^(?:put|take|bring)$/.test(m[1]);
  const rest = m[2];
  const done = (mover: Found, placement: Partial<ParsedRequest>): ParsedRequest | undefined => {
    if (!mover.target) return loose && !mover.found ? undefined : { text, clarification: mover.clarification };
    return { text, operation: 'move', targetId: mover.target.id, ...placement };
  };
  if (requestedPosition) return done(resolveTarget(rest, objects, lastId, asking), { requestedPosition });
  // Place words only: "back to" is not one, or "the statue in the back to the front" loses its back.
  const preps = new RegExp(`\\s+(${SIDES}|${NEAR}|to|into|onto|in|inside|at|out to|round to|around to|over to|up to|down to)\\s+`, 'g');
  const splits = [...rest.matchAll(preps)].reverse();
  for (const s of splits) {
    const before = rest.slice(0, s.index),
      prep = s[1],
      after = rest.slice(s.index! + s[0].length);
    if (!before || !after) continue;
    const side = new RegExp(`^(?:${SIDES})$`).test(prep);
    const nearby = side || new RegExp(`^(?:${NEAR})$`).test(prep);
    if (!nearby) {
      const area = landmarkFor(after);
      if (area) return done(resolveTarget(before, objects, lastId, asking), { requestedArea: area });
    }
    const mover = resolveTarget(before, objects, lastId, asking);
    const anchor = resolveTarget(after, objects.filter((o) => o.id !== mover.target?.id), lastId);
    if (anchor.target) {
      if (!mover.target && !mover.found && loose) return undefined;
      return done(mover, { relativeTo: { objectId: anchor.target.id, side: side ? (prep as Side) : 'next to' } });
    }
    if (anchor.found && mover.target) return { text, clarification: anchor.clarification };
    // The tail is not a place: "to the moon". If the head is a clear thing, the place is the problem.
    if (mover.target) return { text, clarification: WHERE_TO };
  }
  const mover = resolveTarget(rest, objects, lastId, asking);
  if (!mover.target) return loose && !mover.found ? undefined : { text, clarification: mover.clarification };
  return { text, clarification: WHERE_TO };
}

/** One pass over a chat line: operation, target, placement intent, or a clarification. */
export function parseRequest(
  raw: string,
  objects: SafehouseObject[],
  lastId?: string,
  username?: string,
): ParsedRequest {
  const asking: Asking = { username };
  let text = raw.trim().replace(/\s+/g, ' ');
  if (
    /\b(rooftop|on the roof|on top of the|over the street|upstairs|second floor|second storey)\b/i.test(text)
  )
    return {
      text,
      rejection: 'Ground-level builds only for now. Choose a free ground spot in the neighborhood.',
    };
  // The house is closed up: no interior placement, and the old room names mean nothing now.
  if (/\b(?:inside|in|into|within) (?:the |rook'?s |his )?house\b|\b(?:living room|kitchen|bedroom)\b/i.test(text))
    return {
      text,
      rejection:
        "Rook's house is boarded up — nothing goes inside. Try in front of the house, behind the house, or next to the house.",
    };
  let requestedPosition: GroundPoint | undefined;
  const coordinate = text.match(
    /\b(?:at|to)\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*[.!]?$/i,
  );
  if (coordinate) {
    requestedPosition = { x: Number(coordinate[1]), z: Number(coordinate[2]) };
    if (!contains(YARD_BOUNDS, requestedPosition))
      return { text, rejection: 'That mark is outside the playable neighborhood.' };
    text = text.slice(0, coordinate.index).trim();
  }
  const input = normalize(text);

  const around = input.match(/^(?:rotate|turn|spin)\s+(.+?)\s+around$/);
  const degrees = input.match(
    /^(?:rotate|turn|spin)\s+(.+?)\s+(?:by\s+)?(-?\d+(?:\.\d+)?)\s*(?:degrees|deg|°)$/,
  );
  if (around || degrees) {
    const resolved = resolveTarget((around ?? degrees)![1], objects, lastId, asking);
    if (!resolved.target) return { text, clarification: resolved.clarification };
    let angle = around ? 180 : Number(degrees![2]);
    angle %= 360;
    if (angle > 180) angle -= 360;
    if (angle <= -180) angle += 360;
    if (Math.abs(angle) < 1)
      return { text, clarification: 'Turn it by how much? Try 90 degrees or “around”.' };
    return { text, operation: 'rotate', targetId: resolved.target.id, angle: (angle * Math.PI) / 180 };
  }

  const moved = parseMove(input, text, objects, lastId, asking, requestedPosition);
  if (moved) return moved;

  const fix =
    input.match(/^(repair|rebuild|fix|mend|patch(?: up)?)\s+(.+)$/) ??
    input.match(/^equip\s+(.+)\s+as\s+(?:a\s+)?(turret|barrier)$/);
  if (fix) {
    const isFix = !/^(turret|barrier)$/.test(fix[2]);
    const resolved = resolveTarget(isFix ? fix[2] : fix[1], objects, lastId, {
      ...asking,
      prefer: isFix ? 'damaged' : undefined,
    });
    if (!resolved.target) return { text, clarification: resolved.clarification };
    const operation: Operation = isFix ? (/^rebuild$/.test(fix[1]) ? 'rebuild' : 'repair') : (fix[2] as Operation);
    return { text, operation, targetId: resolved.target.id };
  }

  // A trailing "next to the couch" is a placement, not a request to edit the couch:
  // resolve the anchor first, then read the head of the sentence on its own.
  const area = landmarkIn(text);
  const relative = input.match(new RegExp(`^(.+?)\\s+(${SIDES}|${NEAR})\\s+(.+)$`));
  let head = text,
    relativeTo: ParsedRequest['relativeTo'];
  if (relative) {
    const anchor = resolveTarget(relative[3], objects, lastId);
    if (anchor.target) {
      const side = new RegExp(`^(?:${SIDES})$`).test(relative[2]) ? (relative[2] as Side) : 'next to';
      relativeTo = { objectId: anchor.target.id, side };
      head = text.slice(0, text.toLowerCase().lastIndexOf(relative[2])).trim();
    } else if (anchor.found || (!area && !/\b(it|that|this)\b/.test(relative[3])))
      return { text, clarification: anchor.clarification };
  }
  const base: ParsedRequest = {
    text,
    requestedPosition,
    relativeTo,
    ...resolveRequest(head, objects, lastId, username),
  };
  if (base.clarification || base.quick) return base;
  if (area && !requestedPosition && !relativeTo) base.requestedArea = area;
  return base;
}

/** Spots around an anchor for a footprint of this size, the asked-for side first. */
export function relativeCandidates(
  anchor: SafehouseObject,
  side: Side,
  size: { width: number; depth: number },
): GroundPoint[] {
  const r = footprint(anchor.position, anchor.footprint.width, anchor.footprint.depth),
    gap = 0.6,
    a = anchor.position;
  // Slide along the whole face (a house front is wide) and, failing that, one row further out.
  const spots = {
    front: (j: number, out: number) => ({ x: a.x + j, z: r.maxZ + size.depth / 2 + gap + out }),
    back: (j: number, out: number) => ({ x: a.x + j, z: r.minZ - size.depth / 2 - gap - out }),
    left: (j: number, out: number) => ({ x: r.minX - size.width / 2 - gap - out, z: a.z + j }),
    right: (j: number, out: number) => ({ x: r.maxX + size.width / 2 + gap + out, z: a.z + j }),
  };
  const along = (key: keyof typeof spots) =>
    key === 'front' || key === 'back' ? anchor.footprint.width / 2 : anchor.footprint.depth / 2;
  const offsets = (key: keyof typeof spots) => {
    const reach = Math.max(1.5, along(key) - Math.min(size.width, size.depth) / 2);
    const js = [0];
    for (let j = 0.75; j <= reach + 1e-6; j += 0.75) js.push(j, -j);
    return js;
  };
  const order: (keyof typeof spots)[] =
    side === 'in front of'
      ? ['front']
      : side === 'behind'
        ? ['back']
        : side === 'left of'
          ? ['left']
          : side === 'right of'
            ? ['right']
            : ['right', 'left', 'front', 'back'];
  return order.flatMap((key) => [0, 1.5].flatMap((out) => offsets(key).map((j) => spots[key](j, out))));
}

export function applyQuickEdit(source: Blueprint, edit: QuickEdit, large = false): Blueprint {
  const result = structuredClone(source);
  for (const part of result.parts) {
    if (edit.kind === 'recolor') part.color = edit.color!;
    else {
      const f = edit.factor!;
      // Non-uniform world-space scaling of rotated pieces requires shear; don't silently distort them.
      if (edit.axis === 'height' && part.rotation.some((n, i) => i !== 1 && Math.abs(n) > 1e-6))
        throw new Error('This design has tilted parts. Ask for a redesigned taller version instead.');
      const axes = edit.axis === 'height' ? [1] : [0, 1, 2];
      for (const i of axes) {
        part.position[i] *= f;
        part.size[i] *= f;
      }
    }
  }
  measureBlueprint(result, large ? SCENERY_LIMITS : CHAT_LIMITS);
  return result;
}

type M = number[][];
const mul = (A: M, B: M): M =>
  A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rotX = (a: number): M => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
];
const rotY = (a: number): M => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
];
const rotZ = (a: number): M => [
  [Math.cos(a), -Math.sin(a), 0],
  [Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
];
// Three.js Euler XYZ extraction (matrix = Rx·Ry·Rz), so parts keep their exact orientation.
function eulerXYZ(m: M): [number, number, number] {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}
/** Whole-object turn about its vertical axis; exact for tilted parts such as wheels and roofs. */
export function rotateBlueprint(source: Blueprint, radians: number): Blueprint {
  const result = structuredClone(source),
    R = rotY(radians);
  for (const part of result.parts) {
    const [x, y, z] = part.position;
    part.position = [R[0][0] * x + R[0][2] * z, y, R[2][0] * x + R[2][2] * z];
    const m = mul(R, mul(rotX(part.rotation[0]), mul(rotY(part.rotation[1]), rotZ(part.rotation[2]))));
    part.rotation = eulerXYZ(m);
    for (let i = 0; i < 3; i++) if (Math.abs(part.position[i]) < 1e-9) part.position[i] = 0;
  }
  return result;
}

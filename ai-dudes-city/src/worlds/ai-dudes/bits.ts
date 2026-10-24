// Bits: chat asks for something no action covers ("start a teleport cult", "petition to close the
// Mayor's lemonade stand", "give the Mayor a new hat"), and rather than quietly doing nothing the
// character acts it out. Over to whoever or whatever it is about (the Mayor too), then up to four
// poses with a line each, a caption under the name saying what is going on, maybe a prop (a
// placard with words on it, a drink, flowers, a megaphone), maybe a burst (sparkles, smoke,
// confetti, hearts). Two things really happen: a teleport (a puff, and there), and a hat put on
// someone. A shove or a punch in a bit makes whoever it is about stagger, nothing more. Closed
// grammar: the agent picks from these; the app owns every number and every motion.
import type { GroundPoint } from '../../shared/objectTypes';
import { HATS, type BitBurst, type BitProp, type Emote, type Hat } from '../../shared/dudesTypes';
import { ageOf, cityOf, homeOf, leaveVisit, lotsOf, namingAge } from './city';
import { ageStyle } from '../../shared/ages';
import { matchName } from './index';
import { MAYOR, headHidden } from './mayor'; // hook FK-020: out of sight as the stream sees it (the show's word over H)
import { clampToGround } from './placement';
import { addEffect, endUse, face, overhear, walkTo } from './sim';
import { LIMITS, pushFeed, pushLine, type Bit, type BitStep, type Dude, type DudesState } from './state';

export const BITS = {
  /** However it goes, a bit is over in this long. */
  maxMs: 60_000,
  /** A teleport, then not another for this long. */
  teleportGapMs: 20_000,
  /** A hat put on the Mayor stays on this long. */
  mayorHatMs: 10 * 60_000,
  /** Close enough to whoever it is about to start. */
  near: 1.9,
};

const HITS = new Set<Emote>(['punch', 'kick', 'push']);
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** What the agent asked for, already parsed (agent.ts). */
export interface BitRequest {
  caption: string;
  to?: string;
  steps: BitStep[];
  prop?: BitProp;
  sign?: string;
  burst?: BitBurst;
  teleport?: boolean;
  giveHat?: Hat;
}

/** Whom or what a bit is about, from what the agent wrote: the Mayor, a character, a resident, a build, home, the square, an address. */
function targetOf(state: DudesState, d: Dude, phrase: string | undefined, now: number): Bit['target'] | string | undefined {
  const p = (phrase ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!p || /^(me|here|myself)$/.test(p)) return undefined;
  // The streamer's character, by either name: "the Mayor", or what this age calls them ("the Chief").
  const head = ageStyle(namingAge(state)).head.title.toLowerCase();
  if ((/\bmayor\b/.test(p) || new RegExp(`\\b${head}\\b`).test(p)) && !/'s|’s/.test(p)) {
    const m = state.mayor;
    if (!m || headHidden(state, m) || now - m.lastInputAt > MAYOR.liveMs) return 'the Mayor is not out and about right now'; // hook FK-020
    return { kind: 'mayor', at: { ...m.position } };
  }
  if (/^(home|my home|my house|my lot|my place)$/.test(p)) {
    const home = homeOf(state, d);
    const at = home?.at ?? lotsOf(state, d)[0]?.centre;
    return at ? { kind: 'point', at: { ...at } } : 'you have no home to go to';
  }
  if (/^(the )?(square|town square|fountain|centre|center|middle)$/.test(p)) return { kind: 'point', at: { x: 0, z: -4.5 } };
  const dude = matchName(p, state.dudes.filter((x) => x.id !== d.id), (x) => x.name);
  if (dude) return { kind: 'dude', id: dude.id, at: { ...dude.position } };
  const townie = matchName(p, cityOf(state).townies, (t) => t.name);
  if (townie) return { kind: 'townie', id: townie.id, at: { ...townie.position } };
  const o = matchName(p, state.objects, (x) => x.blueprint.name);
  if (o) return { kind: 'object', id: o.id, at: { ...(o.driven?.at ?? o.position) } };
  return `there is nobody and nothing called "${phrase}" in town; you did it where you were`;
}

/** Where the target is now (people move), and how close counts as there. */
function whereNow(state: DudesState, t: NonNullable<Bit['target']>): { at: GroundPoint; reach: number } | undefined {
  if (t.kind === 'mayor') return state.mayor ? { at: state.mayor.position, reach: 0 } : undefined;
  if (t.kind === 'dude') {
    const d = state.dudes.find((x) => x.id === t.id);
    return d && !d.hidden ? { at: d.position, reach: 0 } : undefined;
  }
  if (t.kind === 'townie') {
    const tw = cityOf(state).townies.find((x) => x.id === t.id);
    return tw && !tw.hidden ? { at: tw.position, reach: 0 } : undefined;
  }
  if (t.kind === 'object') {
    const o = state.objects.find((x) => x.id === t.id);
    return o ? { at: o.driven?.at ?? o.position, reach: Math.max(o.footprint.width, o.footprint.depth) / 2 } : undefined;
  }
  return { at: t.at, reach: 0 };
}
/** Beside it, on our side. */
function besideOf(from: GroundPoint, at: GroundPoint, reach: number): GroundPoint {
  const dx = from.x - at.x,
    dz = from.z - at.z,
    d = Math.hypot(dx, dz) || 1;
  return clampToGround({ x: at.x + (dx / d) * (reach + 1.2), z: at.z + (dz / d) * (reach + 1.2) }, 1);
}

/** Start a bit. Returns a note for the agent when part of it could not happen (it still goes ahead). */
export function startBit(state: DudesState, d: Dude, req: BitRequest, now: number): string | undefined {
  const t = targetOf(state, d, req.to, now);
  const note = typeof t === 'string' ? t : undefined;
  const target = typeof t === 'string' ? undefined : t;
  const teleport = !!req.teleport && !!target && now >= (d.teleportAt ?? 0);
  endUse(state, d, now);
  leaveVisit(d);
  d.labour = undefined;
  d.emote = undefined;
  d.bit = {
    caption: req.caption,
    steps: req.steps.length ? req.steps : [{ pose: 'point', seconds: 3 }],
    ...(target ? { target } : {}),
    ...(req.prop ? { prop: req.prop } : {}),
    ...(req.sign ? { sign: req.sign } : {}),
    ...(req.burst ? { burst: req.burst } : {}),
    ...(teleport ? { teleport: true } : {}),
    ...(req.giveHat && target && (target.kind === 'mayor' || target.kind === 'dude') ? { giveHat: req.giveHat } : {}),
    phase: target ? 'going' : 'doing',
    step: 0,
    until: now + BITS.maxMs,
  };
  if (req.teleport && !teleport && target) return `${note ? `${note}; ` : ''}you teleported only a moment ago, so you walked`;
  return note;
}

function endBit(d: Dude): void {
  d.bit = undefined;
  if (d.say?.placard) d.say = undefined;
  if (d.walkingFor === 'move') {
    d.path = [];
    d.walkingFor = undefined;
  }
}

/** One tick of a bit. Returns false when there is none. */
export function runBit(state: DudesState, d: Dude, now: number): boolean {
  const b = d.bit;
  if (!b) return false;
  if (now > b.until) {
    endBit(d);
    return true;
  }
  const where = b.target ? whereNow(state, b.target) : undefined;
  if (b.phase === 'going') {
    if (!where) {
      b.phase = 'doing'; // gone (went inside, left town): do it here
    } else {
      const spot = besideOf(d.position, where.at, where.reach);
      if (b.teleport) {
        // A puff here, and there.
        addEffect(state, { kind: 'burst', at: now, to: { ...d.position }, label: 'smoke' });
        d.position = spot;
        d.path = [];
        d.teleportAt = now + BITS.teleportGapMs;
        addEffect(state, { kind: 'burst', at: now, to: { ...spot }, label: 'smoke' });
        b.phase = 'doing';
      } else if (dist(d.position, where.at) <= where.reach + BITS.near) {
        d.path = [];
        d.walkingFor = undefined;
        b.phase = 'doing';
      } else {
        // On the way; people move, so the way is checked again when they have gone a little.
        const end = d.path.at(-1);
        if (!end || dist(end, spot) > 2) {
          if (!walkTo(state, d, spot, 'move')) b.phase = 'doing';
        }
        return true;
      }
    }
  }
  // Doing it: the next pose when this one is up.
  if (b.stepUntil !== undefined && now < b.stepUntil) {
    if (where) face(d, where.at);
    return true;
  }
  if (b.step >= b.steps.length) {
    finishBit(state, d, b, now);
    return true;
  }
  if (b.step === 0) {
    pushFeed(state, now, `${d.name} ${b.caption}`);
    if (b.burst) addEffect(state, { kind: 'burst', at: now, to: { ...d.position }, label: b.burst });
  }
  const s = b.steps[b.step];
  b.stepUntil = now + s.seconds * 1000;
  b.step++;
  if (where) face(d, where.at);
  d.emote = { pose: s.pose, until: b.stepUntil };
  if (s.say) {
    d.say = { text: s.say, until: b.stepUntil + 1500 };
    pushLine(d.history, { from: 'dude', text: s.say, at: now }, LIMITS.history);
    overhear(state, d, s.say, now);
  } else if (b.sign) d.say = { text: b.sign, until: b.stepUntil + 400, placard: true };
  if (HITS.has(s.pose) && b.target) hit(state, d, b.target, now);
  return true;
}

/** A shove or a swing in a bit: whoever it is about staggers, and the Mayor's figure too. Cartoon, no knockout. */
function hit(state: DudesState, d: Dude, t: NonNullable<Bit['target']>, now: number): void {
  const reach = whereNow(state, t);
  if (!reach || dist(d.position, reach.at) > reach.reach + 2.5) return;
  const stagger = { pose: 'stagger' as Emote, until: now + 1300 };
  if (t.kind === 'mayor' && state.mayor) {
    state.mayor.emote = stagger;
    pushFeed(state, now, `${d.name} got the Mayor`);
  } else if (t.kind === 'dude') {
    const o = state.dudes.find((x) => x.id === t.id);
    if (o && !o.riding) {
      o.emote = stagger;
      pushLine(o.history, { from: 'world', text: `${d.name} ${d.bit?.caption ?? 'got you'}`, at: now }, LIMITS.history);
    }
  } else if (t.kind === 'townie') {
    const tw = cityOf(state).townies.find((x) => x.id === t.id);
    if (tw) {
      tw.emote = stagger;
      tw.say = { text: ['Oi!', 'Steady on!', 'How rude.', 'Well I never.'][Math.floor(Math.random() * 4)], until: now + 3000 };
    }
  }
}

/** The end: the hat goes on, and the bit is over. */
function finishBit(state: DudesState, d: Dude, b: Bit, now: number): void {
  if (b.giveHat && b.target) {
    const where = whereNow(state, b.target);
    const close = where && dist(d.position, where.at) <= where.reach + 3;
    if (close && b.target.kind === 'mayor' && state.mayor) {
      state.mayor.hatGift = { hat: b.giveHat, color: d.look.hatColor, by: d.name, until: now + BITS.mayorHatMs };
      pushFeed(state, now, `${d.name} put a ${b.giveHat === 'none' ? 'bare head' : b.giveHat} on the Mayor`);
      addEffect(state, { kind: 'burst', at: now, to: { ...state.mayor.position }, label: 'sparkles' });
    } else if (close && b.target.kind === 'dude') {
      const o = state.dudes.find((x) => x.id === b.target!.id);
      if (o) {
        o.look = { ...o.look, hat: b.giveHat };
        pushLine(o.history, { from: 'world', text: `${d.name} put a ${b.giveHat} on your head; change your look if you do not want it`, at: now }, LIMITS.history);
        o.nudges = [...(o.nudges ?? []), `${d.name} just put a ${b.giveHat} on your head`].slice(-4);
        addEffect(state, { kind: 'burst', at: now, to: { ...o.position }, label: 'sparkles' });
      }
    }
  }
  if (d.emote && d.emote.until > now) d.emote = undefined;
  endBit(d);
}

/** A hat name from what the agent wrote ("a cowboy hat", "top hat" …). */
export function hatOf(raw: unknown): Hat | undefined {
  const s = String(raw ?? '').toLowerCase().replace(/hat/g, '').replace(/[\s_-]+/g, '');
  if (!s) return undefined;
  return (HATS as readonly string[]).includes(s) ? (s as Hat) : s === 'top' ? 'tophat' : s === 'party' ? 'party' : s.includes('heli') || s.includes('propel') ? 'propeller' : s.includes('crown') ? 'crown' : s.includes('cowboy') ? 'cowboy' : s.includes('wizard') ? 'wizard' : undefined;
}

/** The Mayor's spot, if he is out and about (for "move to the Mayor"). */
export function mayorSpot(state: DudesState, now: number): GroundPoint | undefined {
  const m = state.mayor;
  return m && !headHidden(state, m) && now - m.lastInputAt < MAYOR.liveMs ? { ...m.position } : undefined; // hook FK-020
}

// Challenges on the journey: every few hundred metres the walk stops at something the group has to
// get through together, and everyone who helped earns a collectable for their name tag.
//
// The river: ten metres of fast water across the whole glade. Anything that floats or flies can be
// ridden or driven across; anyone can try to swim it (it often goes wrong); and the group can build a
// bridge or freeze the river, which takes several people working together and can be hindered.
// The challenge ends when everyone awake is across, or after ten minutes, when the stragglers are
// ferried over with no collectable. Zero AI: the agents pick help / hinder / swim / ride, the app
// owns the water, the work, the odds and the rewards.
import type { GroundPoint } from '../../shared/objectTypes';
import type { HappeningView } from '../../shared/dudesTypes';
import { trailX } from '../../shared/trail';
import { abilitiesOf } from './blueprint';
import { campOf, journeyOf } from './journey';
import { clampToGround, inWater } from './placement';
import { addEffect, awake, endUse, face, sendDude, walkTo } from './sim';
import { nudge } from './events';
import { LIMITS, nextId, pushFeed, pushLine, type Challenge, type ChallengeKind, type Dude, type DudesState, type Project, type ProjectKind, type RiverFeature } from './state';

export const CHALLENGE = {
  /** Metres of walking between one challenge and the next. */
  gap: [300, 450] as const,
  /** The camp stops this far short of the feature. */
  stopShort: 12,
  riverHalf: 5,
  riverMs: 10 * 60_000,
  rewardMs: 8000,
  swimOdds: 0.4,
  swimSpeed: 1.1,
  helpRate: 1, // work per second per helper
  hinderRate: 0.7,
  hinderCap: 1.5, // all hinderers together never undo faster than this
  /** Seconds of help that count as having contributed. */
  minHelp: 5,
  /** The work a project needs, by how many are awake. */
  need: (awake: number) => Math.max(60, Math.min(400, 40 + 15 * awake)),
  /** Distinct helpers it takes: a bridge is never one person's work. */
  hands: (awake: number) => Math.max(1, Math.min(3, awake)),
};

export const BADGES: Record<string, { name: string }> = {
  river: { name: 'the water droplet' },
};

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const isAwake = (state: DudesState, now: number) => state.dudes.filter((d) => awake(d, now) && !d.muted);

export function challengeOf(state: DudesState): Challenge | undefined {
  return journeyOf(state).challenge;
}
export function riverOf(state: DudesState): RiverFeature | undefined {
  const j = journeyOf(state);
  const c = j.challenge;
  return c?.kind === 'river' ? j.features?.find((f) => f.id === c.featureId) : undefined;
}
/** The river is open to walk across (a finished bridge, or ice right over it). */
export const crossingOpen = (f: RiverFeature) => f.bridge >= 1 || f.ice >= 1;
export const isAcross = (f: RiverFeature, p: GroundPoint) => p.z < f.z - f.half;

/** A spot on the far bank for this character, near the path. */
export function farBank(state: DudesState, f: RiverFeature, rng: () => number): GroundPoint {
  const z = f.z - f.half - 2.5 - rng() * 4;
  return clampToGround({ x: trailX(journeyOf(state).seed, z) + (rng() * 2 - 1) * 8, z }, 1.5);
}
function nearBank(state: DudesState, f: RiverFeature, x: number, side: 'near' | 'far'): GroundPoint {
  const z = side === 'near' ? f.z + f.half + 1.2 : f.z - f.half - 1.2;
  return clampToGround({ x, z }, 1);
}

// ---- before and after ---------------------------------------------------------------------------
/** Which challenge comes next: the boss only once there is one to meet (`kinds`). */
let KINDS: ChallengeKind[] = ['river'];
export function allowChallengeKinds(kinds: ChallengeKind[]): void {
  KINDS = kinds;
}

/** Put the next challenge on the trail ahead, so it can be seen coming. */
function placeNext(state: DudesState, rng: () => number, kind?: ChallengeKind, at?: number): void {
  const j = journeyOf(state);
  const pick = kind ?? KINDS[(j.met ?? 0) % KINDS.length] ?? 'river';
  const z = at ?? j.campZ - CHALLENGE.gap[0] - rng() * (CHALLENGE.gap[1] - CHALLENGE.gap[0]);
  j.next = { kind: pick, z };
  if (pick === 'river') {
    j.features ??= [];
    j.features.push({ id: nextId(state, 'r'), kind: 'river', z, half: CHALLENGE.riverHalf, bridge: 0, ice: 0 });
    while (j.features.length > 6) j.features.shift();
  }
}

/** Operator: the next challenge, right here (the river just ahead, the boss now). */
export function challengeNow(state: DudesState, now: number, rng: () => number, kind: ChallengeKind): string | undefined {
  const j = journeyOf(state);
  if (j.challenge) return 'the group is already at a challenge';
  if (j.phase === 'arrived') return 'the group has arrived; set off again first';
  // Drop the one that was coming and put this one just in front of the camp.
  if (j.next?.kind === 'river') j.features = (j.features ?? []).filter((f) => f.z !== j.next!.z);
  placeNext(state, rng, kind, j.campZ - CHALLENGE.stopShort);
  startChallenge(state, now);
  return undefined;
}

function startChallenge(state: DudesState, now: number): void {
  const j = journeyOf(state);
  const next = j.next!;
  j.next = undefined;
  j.campZ = Math.max(j.campZ, next.z + CHALLENGE.stopShort);
  j.phase = 'challenge';
  const n = isAwake(state, now).length;
  const project = (): Project => ({ work: 0, need: CHALLENGE.need(n), helpers: {}, hinderers: {} });
  if (next.kind === 'river') {
    const f = j.features?.find((x) => x.z === next.z);
    j.challenge = { kind: 'river', featureId: f?.id, startedAt: now, until: now + CHALLENGE.riverMs, projects: { bridge: project(), freeze: project() }, crossed: [] };
    pushFeed(state, now, 'The group has reached a river');
    for (const d of isAwake(state, now))
      nudge(
        state,
        d,
        'The group has stopped at a wide, fast river across the path. Everyone has to get to the other side: ride or drive something that floats or flies across, swim for it (risky), or get together and build a bridge or freeze the river (both take several people working together). Whoever gets across, or helps, earns the water droplet.',
        now,
      );
  } else {
    j.challenge = { kind: next.kind, startedAt: now, until: now + CHALLENGE.riverMs, crossed: [] };
    startOther(state, next.kind, now);
  }
}

/** Hooks for challenge kinds that live in their own module (the boss), set at load. */
const OTHER: Partial<Record<ChallengeKind, { start(state: DudesState, now: number): void; tick(state: DudesState, dt: number, now: number, rng: () => number): void; view(state: DudesState, now: number): HappeningView | undefined; line(state: DudesState, dude: Dude): string; end(state: DudesState, now: number): void }>> = {};
export function registerChallenge(kind: ChallengeKind, hooks: NonNullable<(typeof OTHER)[ChallengeKind]>): void {
  OTHER[kind] = hooks;
}
function startOther(state: DudesState, kind: ChallengeKind, now: number): void {
  OTHER[kind]?.start(state, now);
}

/** Give someone a collectable, and tell their agent. */
export function award(state: DudesState, dude: Dude, kind: string, name: string, now: number): void {
  dude.badges ??= [];
  dude.badges.push({ kind, at: now });
  while (dude.badges.length > 500) dude.badges.shift();
  pushLine(dude.history, { from: 'world', text: `you earned ${name} for your name tag`, at: now }, LIMITS.history);
}

/**
 * It is over: collectables for everyone who earned one, everyone else brought along, and a few
 * seconds of cheering before the walk goes on.
 */
export function finishChallenge(state: DudesState, now: number, outcome: 'won' | 'timeout', earned: string[], badge: { kind: string; name: string }, rng: () => number): void {
  const c = challengeOf(state);
  if (!c || c.outcome) return;
  c.outcome = outcome;
  c.rewardUntil = now + CHALLENGE.rewardMs;
  c.awarded = [...new Set(earned)];
  const j = journeyOf(state);
  j.phase = 'reward';
  j.met = (j.met ?? 0) + 1;
  for (const d of state.dudes) {
    d.project = undefined;
    d.swim = undefined;
    if (c.awarded.includes(d.id)) {
      award(state, d, badge.kind, badge.name, now);
      if (!d.riding && !d.use) d.emote = { pose: 'cheer', until: now + CHALLENGE.rewardMs };
    }
  }
  pushFeed(state, now, c.awarded.length ? `${c.awarded.length} earned ${badge.name}` : 'Nobody earned anything this time');
}

/** After the cheering: stragglers are brought over, the camp moves past the obstacle, the walk goes on. */
function resume(state: DudesState, now: number, rng: () => number): void {
  const j = journeyOf(state);
  const f = riverOf(state);
  if (f) {
    j.campZ = Math.min(j.campZ, f.z - f.half - 22);
    for (const d of state.dudes)
      if (!isAcross(f, d.position)) {
        // Ferried over by the app: no collectable for this one.
        endUse(state, d, now);
        d.position = farBank(state, f, rng);
        d.path = [];
        d.walkingFor = undefined;
      }
  }
  OTHER[j.challenge!.kind]?.end(state, now);
  j.challenge = undefined;
  j.phase = 'travel';
  pushFeed(state, now, 'The group walks on');
}

// ---- every tick -------------------------------------------------------------------------------
export function tickChallenges(state: DudesState, dt: number, now: number, rng: () => number): void {
  const j = journeyOf(state);
  if (j.phase === 'travel' && !j.paused) {
    if (!j.next) placeNext(state, rng);
    else if (j.campZ <= j.next.z + CHALLENGE.stopShort) startChallenge(state, now);
    return;
  }
  const c = j.challenge;
  if (!c) return;
  if (j.phase === 'reward') {
    if (now >= (c.rewardUntil ?? now)) resume(state, now, rng);
    return;
  }
  if (j.phase !== 'challenge') return;
  if (c.kind === 'river') tickRiver(state, c, dt, now, rng);
  else OTHER[c.kind]?.tick(state, dt, now, rng);
}

function tickRiver(state: DudesState, c: Challenge, dt: number, now: number, rng: () => number): void {
  const f = riverOf(state);
  if (!f) {
    // Lost its river (an old save): nothing to cross.
    finishChallenge(state, now, 'timeout', [], { kind: 'river', name: BADGES.river.name }, rng);
    return;
  }
  const group = isAwake(state, now);
  // Whoever is on the far side made it, however they did it.
  for (const d of group)
    if (isAcross(f, d.position) && !c.crossed.includes(d.id)) {
      c.crossed.push(d.id);
      if (c.crossed.length <= 6) pushFeed(state, now, `${d.name} made it across`);
    }
  // The projects: helpers build, hinderers undo, never faster than the cap.
  for (const kind of ['bridge', 'freeze'] as ProjectKind[]) {
    const p = c.projects?.[kind];
    if (!p || p.done) continue;
    const working = state.dudes.filter((d) => d.project?.kind === kind && d.project.phase === 'working');
    const helpers = working.filter((d) => d.project!.role === 'help'),
      hinderers = working.filter((d) => d.project!.role === 'hinder');
    const s = dt / 1000;
    for (const d of helpers) p.helpers[d.id] = (p.helpers[d.id] ?? 0) + s;
    for (const d of hinderers) p.hinderers[d.id] = (p.hinderers[d.id] ?? 0) + s;
    const undo = Math.min(CHALLENGE.hinderCap, hinderers.length * CHALLENGE.hinderRate) * s;
    if (hinderers.length && (now / 1000) % 3 < s) addEffect(state, { kind: 'splash', from: { x: trailX(journeyOf(state).seed, f.z), z: f.z + f.half * 0.6 }, at: now });
    p.work = Math.max(0, p.work + helpers.length * CHALLENGE.helpRate * s - undo);
    const hands = Object.values(p.helpers).filter((t) => t >= CHALLENGE.minHelp).length;
    // Nobody finishes a bridge alone: the last bit waits for enough people to have pitched in.
    if (hands < CHALLENGE.hands(group.length)) p.work = Math.min(p.work, p.need * 0.95);
    const progress = Math.min(1, p.work / p.need);
    if (kind === 'bridge') f.bridge = progress;
    else f.ice = progress;
    if (p.work >= p.need) {
      p.done = true;
      if (kind === 'bridge') f.bridge = 1;
      else f.ice = 1;
      for (const d of state.dudes) if (d.project?.kind === kind) d.project = undefined;
      pushFeed(state, now, kind === 'bridge' ? 'The bridge is finished' : 'The river is frozen solid');
      for (const d of group) if (!isAcross(f, d.position)) nudge(state, d, kind === 'bridge' ? 'The bridge across the river is finished: walk over it.' : 'The river has frozen solid: walk across the ice.', now);
    }
  }
  // Once the river is open, everyone with nothing else on walks over.
  if (crossingOpen(f))
    for (const d of group)
      if (!isAcross(f, d.position) && !d.path.length && !d.use && !d.attack && !d.chop && !d.project && !d.swim && !d.riding && !d.hidden)
        sendDude(state, d, farBank(state, f, rng));
  if (group.length && group.every((d) => c.crossed.includes(d.id)))
    return finishChallenge(state, now, 'won', earnedAtRiver(c), { kind: 'river', name: BADGES.river.name }, rng);
  if (now >= c.until) finishChallenge(state, now, 'timeout', earnedAtRiver(c), { kind: 'river', name: BADGES.river.name }, rng);
}

function earnedAtRiver(c: Challenge): string[] {
  const helped = Object.values(c.projects ?? {}).flatMap((p) => Object.entries(p?.helpers ?? {}).filter(([, t]) => t >= CHALLENGE.minHelp).map(([id]) => id));
  return [...c.crossed, ...helped];
}

// ---- what a character can do about it ----------------------------------------------------------
const PROJECT_WORDS: [RegExp, ProjectKind][] = [
  [/(bridge|plank|span|crossing)/, 'bridge'],
  [/(freez|frost|ice|icy|cold)/, 'freeze'],
];
export function projectOf(phrase: string): ProjectKind | undefined {
  const p = phrase.toLowerCase();
  return PROJECT_WORDS.find(([re]) => re.test(p))?.[1];
}

/** Go and work on (or against) the bridge or the freezing. Returns a reason when it cannot start. */
export function startProject(state: DudesState, dude: Dude, phrase: string, role: 'help' | 'hinder', now: number, rng: () => number): string | undefined {
  const c = challengeOf(state);
  const f = riverOf(state);
  if (!c || c.outcome || !f) return 'there is nothing to work on together right now';
  // Unnamed: whichever is further along (the bridge when neither has started).
  const kind = projectOf(phrase) ?? ((c.projects?.freeze?.work ?? 0) > (c.projects?.bridge?.work ?? 0) ? 'freeze' : 'bridge');
  const p = c.projects?.[kind];
  if (!p) return 'there is nothing like that to work on';
  if (p.done) return kind === 'bridge' ? 'the bridge is already finished' : 'the river is already frozen';
  endUse(state, dude, now);
  dude.follow = undefined;
  dude.explore = undefined;
  const mid = trailX(journeyOf(state).seed, f.z);
  const x = mid + (rng() * 2 - 1) * (kind === 'bridge' ? 3 : 16);
  const at = nearBank(state, f, x, isAcross(f, dude.position) ? 'far' : 'near');
  if (!walkTo(state, dude, at, 'job') && dist(dude.position, at) > 2) return 'you could not get to the riverbank';
  dude.project = { kind, role, at, phase: 'going' };
  return undefined;
}

/** On the way to the bank, then at it: hammering planks, freezing the water, or kicking it all apart. */
export function runProject(state: DudesState, dude: Dude, now: number): void {
  const pr = dude.project!;
  const p = challengeOf(state)?.projects?.[pr.kind];
  if (!p || p.done || challengeOf(state)?.outcome) {
    dude.project = undefined;
    dude.emote = undefined;
    return;
  }
  if (pr.phase === 'going') {
    if (dude.path.length) return;
    dude.walkingFor = undefined;
    if (dist(dude.position, pr.at) > 2.5) {
      dude.project = undefined;
      pushLine(dude.history, { from: 'world', text: 'you could not get to the riverbank', at: now }, LIMITS.history);
      return;
    }
    pr.phase = 'working';
    const f = riverOf(state);
    if (f) face(dude, { x: dude.position.x, z: f.z });
  }
  const pose = pr.role === 'hinder' ? 'kick' : pr.kind === 'bridge' ? 'hammer' : 'cast';
  if (!dude.emote || dude.emote.pose !== pose || dude.emote.until < now + 1000) dude.emote = { pose, until: now + 5000 };
}

/** Try to swim it: walk to the bank, then in. Most of the time the current wins. */
export function startSwim(state: DudesState, dude: Dude, now: number, rng: () => number): string | undefined {
  const f = riverOf(state);
  if (!f) return 'there is no water to swim here';
  if (isAcross(f, dude.position)) return 'you are already across';
  endUse(state, dude, now);
  const at = nearBank(state, f, dude.position.x, 'near');
  if (!walkTo(state, dude, at, 'job') && dist(dude.position, at) > 2) return 'you could not get down to the water';
  dude.swim = { phase: 'going', ok: rng() < CHALLENGE.swimOdds, to: { x: at.x, z: f.z - f.half - 1.2 } };
  return undefined;
}

export function runSwim(state: DudesState, dude: Dude, now: number): void {
  const s = dude.swim!;
  const f = riverOf(state);
  if (!f || challengeOf(state)?.outcome) {
    dude.swim = undefined;
    return;
  }
  if (s.phase === 'going') {
    if (dude.path.length) return;
    s.phase = 'swimming';
    dude.path = [s.to];
    dude.walkingFor = 'swim';
    pushFeed(state, now, `${dude.name} jumped in the river`);
    return;
  }
  if (!s.ok && dude.position.z <= f.z) {
    // Halfway over, the current takes them back to where they started.
    addEffect(state, { kind: 'splash', from: { ...dude.position }, at: now });
    dude.position = nearBank(state, f, dude.position.x + 3, 'near');
    dude.path = [];
    dude.walkingFor = undefined;
    dude.swim = undefined;
    dude.emote = { pose: 'shrug', until: now + 2500 };
    pushLine(dude.history, { from: 'world', text: 'you swam halfway, then the current dragged you back to the bank', at: now }, LIMITS.history);
    pushFeed(state, now, `The current dragged ${dude.name} back`);
    return;
  }
  if (!dude.path.length) {
    dude.swim = undefined;
    dude.walkingFor = undefined;
    addEffect(state, { kind: 'splash', from: { ...dude.position }, at: now });
    pushLine(dude.history, { from: 'world', text: 'you swam across the river', at: now }, LIMITS.history);
  }
}

/** Is this character in the water right now (swimming, or on its way in)? */
export const swimming = (dude: Dude) => dude.swim?.phase === 'swimming' && inWater(dude.position);

/** Driving or riding this build over water is fine: it floats or flies. */
export function crossesWater(state: DudesState, objectId: string): boolean {
  const o = state.objects.find((x) => x.id === objectId);
  if (!o) return false;
  const a = abilitiesOf(o.blueprint);
  return a.has('floats') || a.has('flies');
}

/** Where a cruise goes while a river is in the way: stay on the side you are on. */
export function sameSide(state: DudesState, from: GroundPoint, to: GroundPoint): GroundPoint {
  const f = riverOf(state);
  if (!f) return to;
  const fromAcross = isAcross(f, from);
  if (fromAcross && to.z >= f.z - f.half - 1) return { x: to.x, z: f.z - f.half - 3 - Math.abs(to.z - f.z) % 20 };
  if (!fromAcross && to.z <= f.z + f.half + 1) return { x: to.x, z: f.z + f.half + 3 + Math.abs(to.z - f.z) % 20 };
  return to;
}

// ---- what the page and the agents are told ------------------------------------------------------
export function challengeView(state: DudesState, now: number): HappeningView | undefined {
  const j = journeyOf(state);
  const c = j.challenge;
  if (!c) return undefined;
  if (c.kind !== 'river') return OTHER[c.kind]?.view(state, now);
  const group = isAwake(state, now);
  if (c.outcome)
    return {
      kind: 'river',
      title: c.outcome === 'won' ? 'EVERYONE IS ACROSS' : 'TIME TO MOVE ON',
      text: c.awarded?.length ? `${c.awarded.length} earned the water droplet. The walk goes on.` : 'The rest were ferried over. The walk goes on.',
    };
  const p = c.projects ?? {};
  const bar = (kind: ProjectKind, label: string) => {
    const x = p[kind];
    if (!x || (!x.work && !Object.keys(x.helpers).length)) return [];
    const working = state.dudes.filter((d) => d.project?.kind === kind && d.project.phase === 'working' && d.project.role === 'help').length;
    const hands = Object.values(x.helpers).filter((t) => t >= CHALLENGE.minHelp).length;
    const short = CHALLENGE.hands(group.length) - hands;
    return [{ label, value: x.done ? 1 : Math.min(1, x.work / x.need), note: x.done ? 'done' : short > 0 ? `needs ${short} more` : `${working} working` }];
  };
  return {
    kind: 'river',
    title: 'THE RIVER',
    text: 'Everyone has to get across: boats, flying, swimming, or build a bridge or freeze it together.',
    until: c.until,
    bars: [{ label: 'across', value: group.length ? c.crossed.filter((id) => group.some((d) => d.id === id)).length / group.length : 0, note: `${c.crossed.length}/${group.length}` }, ...bar('bridge', 'bridge'), ...bar('freeze', 'ice')],
  };
}

/** One line for an agent about the challenge in front of the group, from where it stands. */
export function challengeLine(state: DudesState, dude: Dude, now: number): string | undefined {
  const j = journeyOf(state);
  const c = j.challenge;
  if (!c) return j.next ? `Somewhere ahead on the path there is ${j.next.kind === 'river' ? 'a river' : 'something big'}; you will reach it in ${Math.round(j.campZ - j.next.z)} m.` : undefined;
  if (c.outcome) return 'The group just got through a challenge and is about to walk on.';
  if (c.kind !== 'river') return OTHER[c.kind]?.line(state, dude);
  const f = riverOf(state);
  if (!f) return undefined;
  const group = isAwake(state, now);
  const side = isAcross(f, dude.position) ? 'You are already across.' : 'You are on the near bank and still have to get across.';
  const p = c.projects ?? {};
  const state_ = (k: ProjectKind, label: string) => {
    const x = p[k];
    return x?.done ? `${label} done` : `${label} ${Math.round(Math.min(1, (x?.work ?? 0) / (x?.need ?? 1)) * 100)}% (${state.dudes.filter((d) => d.project?.kind === k && d.project.role === 'help').length} helping, ${state.dudes.filter((d) => d.project?.kind === k && d.project.role === 'hinder').length} hindering)`;
  };
  return `THE RIVER: the group is stopped at a wide fast river. ${side} ${c.crossed.length} of ${group.length} are across. Ways over: use something that floats or flies with "drive"/"ride" to "across"; swim (move to "across", the current often drags you back); or "help" the bridge or the freeze, which need at least ${CHALLENGE.hands(group.length)} people working; "hinder" undoes it. Bridge: ${state_('bridge', 'bridge')}. Ice: ${state_('freeze', 'ice')}. Getting across or helping earns the water droplet.`;
}

/** Spot names the agent can use for the river. */
export function riverPlace(state: DudesState, phrase: string, dude: Dude, rng: () => number): GroundPoint | undefined {
  const f = riverOf(state) ?? journeyOf(state).features?.find((x) => Math.abs(x.z - campOf(state).z) < 60);
  if (!f) return undefined;
  if (/^(across|the other side|other side|far side|far bank|over the river|over)/.test(phrase)) return farBank(state, f, rng);
  if (/^(river|the river|bank|riverbank|the bank|water|the water)/.test(phrase)) return nearBank(state, f, dude.position.x, isAcross(f, dude.position) ? 'far' : 'near');
  return undefined;
}

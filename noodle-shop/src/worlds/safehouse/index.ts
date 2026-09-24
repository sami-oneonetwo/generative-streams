import crypto from 'node:crypto';
import type { WorldModule, WorldCtx, ChatMessage } from '../../engine/world';
import {
  viewOf,
  type SafehouseJobView,
  type SafehouseScene,
  type SafehouseObject,
  type GroundPoint,
  type SurvivorActivity,
  type VerbWord,
  type PieceVerb,
  isCreatureVerb,
} from '../../shared/safehouseTypes';
import { config } from '../../config';
import { generateBlueprint, fixtureGenerator, type DesignGenerator } from '../../llm/blueprint';
import {
  CHAT_LIMITS,
  SCENERY_LIMITS,
  MAX_USES,
  measureBlueprint,
  validateResponse,
  type DesignResponse,
} from './blueprint';
import { clampAnimations, clampRules } from './rules';
import {
  createInitialState,
  stateSchema,
  active,
  STATE_VERSION,
  BUDGETS,
  type SafehouseState,
  type Job,
} from './state';
import { choosePlacement, route, straighten, walkableSegment } from './placement';
import {
  SURVIVOR_START,
  LANDMARKS,
  HOUSE_ID,
  WANDER_AREA,
  YARD_BOUNDS,
  areaCandidates,
  contains,
  footprint,
} from '../../shared/safehouseLayout';
import {
  tickCombat,
  spawnGroup,
  initializeObject,
  intact,
  isHostile,
  fenceObjects,
  waveRoster,
  describeRoster,
  MAX_CREATURES,
  TACTICS,
} from './combat';
import { tickCreatures, freshCreature } from './creatures';
import { parseRequest, resolveTarget, applyQuickEdit, rotateBlueprint, relativeCandidates } from './edits';
import { sceneryObjects } from './scenery';
import { tickWildlife, adoptLife, resetWildlifeMemory } from './wildlife';
import { migrateState, defaultAllowance, defaultSurveyAllowance } from './state';
import { pickRepairTarget, repairMs } from './repair';
import {
  pickLine,
  ttlFor,
  speakName,
  addressesRook,
  looksLikeRequest,
  idleMoment,
  type Moment,
  type LineVars,
} from './voice';
import { persona as rookPersona, replyInstruction } from './persona';
import { noteChatter, tickCrowd, crowdViews, resetCrowdMemory, type CrowdEvent } from './crowd';
import { parseVerb, runVerb, verbViews, hoopsBoard, resetVerbMemory, standingVerbs, type VerbResult } from './verbs';
import { noteVerb } from './neighbours';
import { GRUDGE, bump, chatterKey, decayTable, sulking } from './grudges';
import {
  tickNeighbours,
  noteChatEdit,
  forgive,
  NEIGHBOURS,
  type ChatEditKind,
  neighbourGhosts,
  neighbourViews,
  ownedByNeighbours,
  resetNeighbourMemory,
  takeWish,
  fulfilWish,
  takeSurvey,
  adoptTheme,
  specOf,
  DEFAULT_PACE,
  FIXTURE_PACE,
  NEIGHBOUR_HOUSE_IDS,
  adoptNames,
  type NeighbourEvent,
  type Pace,
  type ReadyDesign,
} from './neighbours';
import { fixtureSurveyor, surveyBlock, type Surveyor, type ThemeSurvey } from './survey';
class CheckpointError extends Error {}
/** userId of the jobs Rook gives himself; never a chat user. */
const ROOK = 'rook';
/** A chatter the operator has trusted (admin: "Trust a chatter"): no design time limit, and `!delete <name>`. */
const isPrivileged = (state: SafehouseState, username: string) =>
  (state.privileged ?? []).includes(username.trim().toLowerCase());
/** The houses stay whoever asks: Rook's is what the waves are about, the neighbours' are where they live. */
const PROTECTED_IDS = new Set([HOUSE_ID, ...NEIGHBOUR_HOUSE_IDS]);
/** Names on `createdBy` that are nobody in chat: Rook's grudges (grudges.ts) are only ever with chatters. */
const NOT_CHATTERS = ['Rook', 'Neighborhood', ...NEIGHBOURS.map((n) => n.name)];
/** What a chat job did to the piece it landed on, for the neighbour whose piece it was (neighbours.ts `noteChatEdit`). */
export function chatEditKindOf(job: Pick<Job, 'quick' | 'operation'>): ChatEditKind {
  if (job.quick) return job.quick.kind === 'recolor' ? 'paint' : 'resize';
  switch (job.operation) {
    case 'move':
      return 'move';
    case 'rotate':
      return 'turn';
    case 'repair':
      return 'repair';
    case 'rebuild':
      return 'rebuild';
    default:
      return 'redesign';
  }
}
/**
 * Rook's pace in m/s: brisk on a job, easier when pacing or heading home. Routes are
 * straightened into runs (placement.ts), so a run is covered in one go and only a
 * corner costs the rest of a snapshot.
 */
const WALK_SPEED = 3.2,
  STROLL_SPEED = 2.4;

type Ctx = WorldCtx<SafehouseState>;
export interface SafehouseOptions {
  generator?: DesignGenerator;
  fixture?: boolean;
  workMs?: number;
  seedScenery?: boolean; // tests opt out to keep worlds tiny; the app always seeds
  converse?: boolean; // answer viewers who speak to Rook by name with a dialogue call; default: not in fixture mode
  neighbours?: boolean; // the people next door go about their business; tests about chat's own creatures turn them off
  neighbourPace?: Partial<Pace>; // how often they start something (tests shorten it)
  neighbourAi?: boolean; // may their ideas go to the design model; default: yes outside fixture mode when a model is configured
  surveyor?: Surveyor; // reads the block and names a theme; tests inject a stub
  survey?: boolean; // may they read the block at all; default: yes outside fixture mode when a model is configured
  wildlife?: boolean; // the block's birds, cat and rats (wildlife.ts); default: whenever the neighborhood is seeded — tests about chat's own creatures turn them off
}
export function createSafehouseWorld(options: SafehouseOptions = {}): WorldModule<SafehouseState> {
  const fixture = options.fixture ?? process.env.SAFEHOUSE_FIXTURES === '1';
  const generator = options.generator ?? (fixture ? fixtureGenerator : generateBlueprint);
  const available = fixture || !!options.generator || !!config.OPENROUTER_API_KEY;
  let pending:
    { id: string; controller: AbortController; deadline: number; catalog: Map<string, number> } | undefined;
  let inbox:
    { id: string; result?: DesignResponse; error?: string; catalog: Map<string, number> } | undefined;
  let stopped = false;
  let nextRepairAt = 0; // idle grace before Rook picks the hammer up on his own
  const repairSkips = new Map<string, number>(); // pieces a repair just failed on → retry time
  const converse = options.converse ?? !fixture;
  // The neighbours (neighbours.ts) run on their own clock: jobs take `workMs` when a test sets one, and
  // fixture mode keeps the gaps between their projects short so a smoke sees them at work.
  const neighboursOn = options.neighbours ?? true;
  // The block's own small life needs the block: no trees or skip, no birds or rats.
  const wildlifeOn = options.wildlife ?? options.seedScenery ?? true;
  // Their ideas may go to the design model outside fixture mode, at most one design per neighbour
  // every SAFEHOUSE_NEIGHBOUR_AI_MINUTES (default 10), under the same pause and allowance as chat.
  const neighbourAi = options.neighbourAi ?? (!fixture && available);
  const aiMinutes = Number(process.env.SAFEHOUSE_NEIGHBOUR_AI_MINUTES ?? 10);
  // Reading the block is a separate, much cheaper call with its own switch and its own budget.
  // Off in plain fixture mode so the existing suites keep their old behaviour; on when a test
  // injects a surveyor, and in the demo world when SAFEHOUSE_NEIGHBOUR_THEMES=1 asks for it.
  const surveyor = options.surveyor ?? (fixture ? fixtureSurveyor : surveyBlock);
  const surveyOn =
    options.survey ??
    (!!options.surveyor || (fixture ? process.env.SAFEHOUSE_NEIGHBOUR_THEMES === '1' : available));
  const surveyMinutes = Number(process.env.SAFEHOUSE_SURVEY_MINUTES ?? 8);
  const pace: Pace = {
    ...(fixture ? FIXTURE_PACE : DEFAULT_PACE),
    ai: neighbourAi,
    aiGapMs: (Number.isFinite(aiMinutes) && aiMinutes >= 0 ? aiMinutes : 10) * 60_000,
    survey: surveyOn,
    surveyGapMs: (Number.isFinite(surveyMinutes) && surveyMinutes >= 0 ? surveyMinutes : 8) * 60_000,
    ...(options.workMs !== undefined ? { workMs: options.workMs } : {}),
    ...options.neighbourPace,
  };
  let nextNeighbourLineAt = 0; // Rook remarks on the neighbours now and then, not on every hammer blow
  let nextGrudgeRemarkAt = 0; // a neighbour sniffing at a chatter they have not forgiven: at most one remark in three minutes
  // One neighbour design in flight at a time, never alongside a chat design; asked wishes are remembered
  // so a wish that somehow survives its answer is not paid for twice.
  let neighbourDesign: { id: string; controller: AbortController; deadline: number } | undefined;
  let neighbourInbox: { id: string; result?: DesignResponse; error?: string } | undefined;
  const askedWishes = new Set<string>();
  // The block reading sits third in line, behind a chat design and a neighbour design, so a
  // viewer's request is never waiting on one. Same one-at-a-time, same double-charge guard.
  let blockSurvey: { id: string; controller: AbortController; deadline: number } | undefined;
  let surveyInbox: { id: string; result?: ThemeSurvey; error?: string } | undefined;
  const askedSurveys = new Set<string>();
  /** What the model drew up, as the neighbours take it: decoration or a wall, a roaming pet at most, never a turret. */
  function neighbourDesignOf(result: DesignResponse): ReadyDesign | undefined {
    if (!('blueprint' in result)) return undefined;
    const creature = result.creature;
    return {
      blueprint: result.blueprint,
      name: result.blueprint.name,
      role: result.action === 'build' && result.role === 'barrier' ? 'barrier' : 'decoration',
      pet: !!creature,
      flying: !!creature?.flying,
      reply: result.reply,
    };
  }
  /** Whether a model call may start: fixture mode is free, the operator may ignore the allowance, else it must have calls left. */
  const allowanceOpen = (state: SafehouseState) =>
    fixture || state.allowanceEnforced === false || state.callsRemaining > 0;
  /** Book a model call: always counted, taken off the allowance only while it is enforced. */
  function bookCall(state: SafehouseState) {
    if (fixture) return;
    state.callsUsed = (state.callsUsed ?? 0) + 1;
    if (state.allowanceEnforced !== false) state.callsRemaining = Math.max(0, state.callsRemaining - 1);
  }
  /** Whether a block reading may start: its own allowance, so it never draws on chat's. */
  const surveyAllowanceOpen = (state: SafehouseState) =>
    fixture || state.allowanceEnforced === false || (state.surveyCallsRemaining ?? defaultSurveyAllowance()) > 0;
  /**
   * Book a block reading. It comes off the survey allowance rather than chat's — the neighbours
   * can never eat calls a viewer wanted — but it still adds to `callsUsed`, because that total is
   * what the operator reads to know what the world has spent altogether.
   */
  function bookSurveyCall(state: SafehouseState) {
    if (fixture) return;
    state.callsUsed = (state.callsUsed ?? 0) + 1;
    state.surveyCallsUsed = (state.surveyCallsUsed ?? 0) + 1;
    if (state.allowanceEnforced !== false)
      state.surveyCallsRemaining = Math.max(0, (state.surveyCallsRemaining ?? defaultSurveyAllowance()) - 1);
  }
  // Rook's voice (voice.ts): what is showing, what he said lately, and when he next mutters.
  // Status lines go through speak(); muttering goes through mutter() and waits its turn.
  let speechUntil = 0,
    nextIdleLineAt = 0,
    nextWorkLineAt = 0,
    preempted = false,
    talking = false;
  // Voiced follow-ups wait their turn behind whatever is showing. A short queue, not a slot:
  // a wave clearing, a creature going down and a flyer taking off can land within seconds.
  let reactions: { moment: Moment; vars: LineVars; at: number; since: number }[] = [];
  let houseHitWave = 0,
    houseHalfWave = 0,
    lastHouseHealth: number | undefined;
  let nextLegAt = 0; // pacing: when the next wander leg may start (0 = walking one now)
  let nextCreatureLineAt = 0; // a rampaging creature gets a comment now and then, not every hit
  // Nothing on: he heads for a seat near the porch if chat has built one, else the steps, and
  // after a while sits down (SurvivorActivity 'sitting'). Anything to do stands him up.
  let idleSince = 0;
  let restSpot: { at: GroundPoint; facing: number; seat?: string; dance?: boolean } | undefined;
  const SIT_AFTER_MS = 20_000,
    SEAT_REACH = 8,
    MUSIC_REACH = 12; // speakers this close to the porch beat a seat: nothing on and a beat going, he dances
  // Chat's tactics on the block (`trap` holes and `music` speakers): a word when one appears, when a
  // hole first catches something, when the horde starts dancing. Primed on the first tick so a
  // restart with holes already dug says nothing.
  let tacticsPrimed = false;
  const seenTraps = new Set<string>(),
    seenMusic = new Set<string>();
  let nextHeldLineAt = 0,
    nextDanceLineAt = 0;
  // Pieces' own verbs (`!swim` while a pool stands): a word when a new one comes on, and the first time
  // anyone does each. Primed on the first tick so a restart with the park's pond says nothing.
  let verbsPrimed = false;
  const seenVerbWords = new Set<VerbWord>(),
    firstVerbDone = new Set<VerbWord>();
  let nextFightLineAt = 0, // a scrap decided
    nextDriveLineAt = 0; // someone took a car out
  /** The verb a piece may keep: a living build only `ride` or `fight`; the block's own animals none. */
  const pieceVerbFor = (verb: PieceVerb | undefined, creature: boolean, wild: boolean): PieceVerb | undefined =>
    !verb || wild ? undefined : creature && !isCreatureVerb(verb.word) ? undefined : verb;
  let nextVerbLineAt = 0, // a new word coming on
    nextFirstVerbLineAt = 0; // the first go at a word
  function verbWatch(ctx: Ctx) {
    const words = new Set(standingVerbs(ctx.state).map((v) => v.word));
    for (const word of words)
      if (!seenVerbWords.has(word)) {
        seenVerbWords.add(word);
        if (verbsPrimed && ctx.now >= nextVerbLineAt) {
          nextVerbLineAt = ctx.now + 90_000;
          react(ctx, 'verb:new', { word });
        }
      }
    // A word whose last piece fell is news again when one stands.
    for (const word of [...seenVerbWords]) if (!words.has(word)) seenVerbWords.delete(word);
    verbsPrimed = true;
  }
  /**
   * Where Rook works on a living build without moving it: the nearest clear, reachable spot within
   * a few metres of the creature (a ring of candidates, nearest first). A flyer over the middle of
   * a roof may leave nothing reachable; then he works from where he stands, as he does for flyers.
   */
  function creatureWorkSpot(state: SafehouseState, target: SafehouseObject, from: GroundPoint): { position: GroundPoint; path: GroundPoint[] } {
    const snap = (v: number) => Math.round(v * 2) / 2;
    const ring: GroundPoint[] = [];
    for (const r of [1.5, 2.5, 3.5])
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ring.push({ x: snap(target.position.x + Math.sin(a) * r), z: snap(target.position.z + Math.cos(a) * r) });
      }
    const spots = ring
      .filter((p) => contains(YARD_BOUNDS, p) && walkableSegment(p, p, state.objects))
      .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    for (const p of spots) {
      if (Math.hypot(p.x - from.x, p.z - from.z) < 0.3) return { position: { ...target.position }, path: [] };
      const path = route(from, p, state.objects);
      if (path) return { position: { ...target.position }, path: straighten(path) };
    }
    return { position: { ...target.position }, path: [] };
  }
  /** A clear, reachable spot `off` metres off one side of a piece, nearest the porch first. */
  function besideSpot(state: SafehouseState, o: SafehouseObject, off: number): GroundPoint | undefined {
    const r = footprint(o.position, o.footprint.width, o.footprint.depth);
    return [
      { x: o.position.x, z: r.maxZ + off },
      { x: o.position.x, z: r.minZ - off },
      { x: r.minX - off, z: o.position.z },
      { x: r.maxX + off, z: o.position.z },
    ]
      .filter((p) => contains(YARD_BOUNDS, p) && walkableSegment(p, p, state.objects))
      .sort((a, b) => Math.hypot(a.x - SURVIVOR_START.x, a.z - SURVIVOR_START.z) - Math.hypot(b.x - SURVIVOR_START.x, b.z - SURVIVOR_START.z))[0];
  }
  /**
   * Where he rests with nothing on: speakers within earshot of the porch first (he dances, two metres
   * off them, facing them), else the nearest standing seat within reach (stood beside, facing the
   * street), else the steps.
   */
  function pickRestSpot(state: SafehouseState): { at: GroundPoint; facing: number; seat?: string; dance?: boolean } {
    const near = (use: 'music' | 'seat', reach: number) =>
      state.objects
        .filter((o) => intact(o) && !o.passable && !o.creature && o.uses?.includes(use))
        .map((o) => ({ o, d: Math.hypot(o.position.x - SURVIVOR_START.x, o.position.z - SURVIVOR_START.z) }))
        .filter((x) => x.d <= reach)
        .sort((a, b) => a.d - b.d)
        .map((x) => x.o);
    for (const o of near('music', MUSIC_REACH)) {
      const at = besideSpot(state, o, 2);
      if (at) return { at, facing: Math.atan2(o.position.x - at.x, o.position.z - at.z), seat: o.id, dance: true };
    }
    for (const o of near('seat', SEAT_REACH)) {
      const at = besideSpot(state, o, 0.75);
      if (at) return { at, facing: 0, seat: o.id };
    }
    return { at: { ...SURVIVOR_START }, facing: 0 };
  }
  /**
   * Chat's tactics, noticed: a new hole or a new set of speakers standing (once per piece), the
   * first zombie stuck in a hole and the first one dancing (with a breather between remarks).
   */
  function tacticsWatch(ctx: Ctx) {
    const traps = ctx.state.objects.filter((o) => intact(o) && !o.owner && !!o.passable && !!o.uses?.includes('trap'));
    const stacks = ctx.state.objects.filter((o) => intact(o) && !o.owner && !o.passable && !!o.uses?.includes('music'));
    for (const o of traps)
      if (!seenTraps.has(o.id)) {
        seenTraps.add(o.id);
        if (tacticsPrimed) react(ctx, 'hole:dug');
      }
    for (const o of stacks)
      if (!seenMusic.has(o.id)) {
        seenMusic.add(o.id);
        if (tacticsPrimed) react(ctx, 'music:on');
      }
    // A hole filled in or speakers unplugged stop being one; dug or plugged in again, they are news again.
    for (const id of [...seenTraps]) if (!traps.some((o) => o.id === id)) seenTraps.delete(id);
    for (const id of [...seenMusic]) if (!stacks.some((o) => o.id === id)) seenMusic.delete(id);
    tacticsPrimed = true;
    const c = ctx.state.combat;
    if (ctx.now >= nextHeldLineAt && c.zombies.some((z) => (z.heldUntil ?? 0) > c.time)) {
      react(ctx, 'hole:held');
      nextHeldLineAt = ctx.now + 90_000;
    }
    if (ctx.now >= nextDanceLineAt && c.zombies.some((z) => (z.dancingUntil ?? 0) > c.time)) {
      react(ctx, 'music:dance');
      nextDanceLineAt = ctx.now + 90_000;
    }
  }
  let lastBigCrowdAt = 0; // he remarks on a full pavement at most every ten minutes
  // Chat verbs (verbs.ts): his remarks on horns, dancing and bricked shots are gated so a busy chat cannot keep him narrating.
  let nextHonkLineAt = 0,
    nextDanceCrowdLineAt = 0,
    nextBrickLineAt = 0;
  const recent: string[] = [];
  /** One tick along idlePath at walking pace; true while there is somewhere to go. One straight segment per snapshot. */
  function stroll(ctx: Ctx, dt: number): boolean {
    const pos = ctx.state.survivor.position,
      next = ctx.state.idlePath[0];
    if (!next) return false;
    if (!walkableSegment(pos, next, ctx.state.objects)) {
      ctx.state.idlePath = [];
      return false;
    }
    const dx = next.x - pos.x,
      dz = next.z - pos.z,
      length = Math.hypot(dx, dz),
      step = Math.min(length, (dt / 1000) * STROLL_SPEED);
    ctx.state.survivor.activity = 'walking';
    if (length > 0.001) {
      pos.x += (dx / length) * step;
      pos.z += (dz / length) * step;
      ctx.state.survivor.facing = Math.atan2(dx, dz);
    }
    if (step >= length) ctx.state.idlePath.shift();
    return true;
  }
  /**
   * Waiting on a design (or a queued request the AI cannot take yet): pace the yard
   * inside the fence rather than stand frozen. A leg is a random reachable spot a
   * few metres off; a short breather between legs. The walk to the work spot is
   * planned from wherever he has got to.
   */
  function wander(ctx: Ctx, dt: number) {
    if (stroll(ctx, dt)) return;
    ctx.state.survivor.activity = 'idle';
    if (!nextLegAt) {
      nextLegAt = ctx.now + 2000 + ctx.rng() * 4000;
      return;
    }
    if (ctx.now < nextLegAt) return;
    const pos = ctx.state.survivor.position,
      snap = (v: number) => Math.round(v * 2) / 2;
    for (let i = 0; i < 8; i++) {
      const target = {
        x: snap(WANDER_AREA.minX + ctx.rng() * (WANDER_AREA.maxX - WANDER_AREA.minX)),
        z: snap(WANDER_AREA.minZ + ctx.rng() * (WANDER_AREA.maxZ - WANDER_AREA.minZ)),
      };
      if (Math.hypot(target.x - pos.x, target.z - pos.z) < 2.5) continue;
      const path = route(pos, target, ctx.state.objects);
      if (path && path.length <= 40) {
        ctx.state.idlePath = straighten(path);
        nextLegAt = 0;
        return;
      }
    }
    nextLegAt = ctx.now + 3000; // nowhere reachable just now; try again shortly
  }
  let lastVoiced: { moment: Moment; vars: LineVars; at: number; queued: boolean } | undefined;
  /** A queued follow-up spoken within the last snapshot interval: no viewer has seen it yet. (`ctx.now` is the wall clock, so "same tick" is a window, not an equality.) */
  const unseenFollowUp = (ctx: Ctx) => !!lastVoiced?.queued && ctx.now - lastVoiced.at < 450;
  function speak(ctx: Ctx, text: string, voiced?: { moment: Moment; vars: LineVars; queued: boolean }) {
    // A status line landing on a follow-up before a single snapshot carried it would erase it for
    // everyone. Put the follow-up back to be said afterwards.
    if (!voiced && unseenFollowUp(ctx))
      reactions.unshift({ moment: lastVoiced!.moment, vars: lastVoiced!.vars, at: ctx.now + ttlFor(text) + 700, since: ctx.now });
    ctx.say(text);
    speechUntil = ctx.now + ttlFor(text);
    lastSpokenAt = ctx.now;
    lastVoiced = voiced ? { ...voiced, at: ctx.now } : undefined;
  }
  let lastSpokenAt = 0;
  function line(moment: Moment, vars: LineVars, rng: () => number): string {
    const text = pickLine(moment, vars, rng, recent);
    recent.push(text);
    if (recent.length > 14) recent.shift();
    return text;
  }
  /**
   * A voiced line. Waits for whatever is showing unless forced; returns whether he spoke.
   * Ordinary muttering also yields to a follow-up whose turn has come, so a busy yard
   * (a gorilla on the fence, repairs every few seconds) cannot starve the queue.
   */
  function mutter(ctx: Ctx, moment: Moment, vars: LineVars = {}, force = false, queued = false): boolean {
    if (!force && ctx.now < speechUntil + 600) return false;
    if (!force && !queued && reactions[0] && ctx.now >= reactions[0].at) return false;
    speak(ctx, line(moment, vars, ctx.rng), { moment, vars, queued });
    return true;
  }
  /** A voiced follow-up once the plain status line has had its moment. At most four wait; the oldest goes first. */
  function react(ctx: Ctx, moment: Moment, vars: LineVars = {}) {
    reactions.push({ moment, vars, at: Math.max(ctx.now, speechUntil) + 700, since: ctx.now });
    if (reactions.length > 4) reactions.shift();
  }
  /**
   * Speak the reaction at the head of the queue when its turn comes. It waits for the current
   * line to clear, but not forever: once that line has had 3.5 s on screen the follow-up may cut
   * in, so constant status chatter cannot bury it. One that waited half a minute is stale.
   */
  function reactionsDue(ctx: Ctx) {
    reactions = reactions.filter((r) => ctx.now - r.since <= 30000);
    const r = reactions[0];
    if (!r || ctx.now < r.at) return;
    const mayCutIn = ctx.now >= lastSpokenAt + 3500;
    if (mutter(ctx, r.moment, r.vars, mayCutIn, true)) reactions.shift();
    else r.at = Math.min(speechUntil + 600, lastSpokenAt + 3500);
  }
  /** Nothing on and at the porch: a nudge to chat every minute or so, about whatever is most pressing. */
  function idleLine(ctx: Ctx) {
    if (!nextIdleLineAt) {
      nextIdleLineAt = ctx.now + 12000 + ctx.rng() * 8000;
      return;
    }
    if (ctx.now < nextIdleLineAt) return;
    const c = ctx.state.combat;
    const moment = idleMoment({
      canDesign: available && !ctx.state.generationPaused && allowanceOpen(ctx.state),
      creations: ctx.state.objects.filter((o) => !o.fixed).length,
      combatPaused: c.paused,
      phase: c.wave.phase,
      prepLeftMs: c.wave.phaseEndsAt - c.time,
      zombies: c.zombies.length,
      hour: new Date(ctx.now).getHours(),
      rng: ctx.rng,
    });
    if (mutter(ctx, moment)) nextIdleLineAt = ctx.now + 45000 + ctx.rng() * 30000;
  }
  /** The house taking hits is the one thing he reacts to unprompted mid-wave: once when it starts, once under half. */
  function houseWatch(ctx: Ctx) {
    const house = ctx.state.objects.find((o) => o.id === HOUSE_ID);
    if (!house) return;
    const hp = intact(house) ? (house.health ?? 4000) : 0,
      max = house.maxHealth ?? 4000,
      wave = ctx.state.combat.wave.number;
    if (lastHouseHealth !== undefined && hp > 0 && hp < lastHouseHealth && !ctx.state.combat.paused) {
      if (hp < max * 0.5 && houseHalfWave !== wave) {
        houseHalfWave = wave;
        react(ctx, 'house:half');
      } else if (hp >= max * 0.5 && houseHitWave !== wave) {
        houseHitWave = wave;
        react(ctx, 'house:hit');
      }
    }
    lastHouseHealth = hp;
  }
  /** Something happened next door. Logged always; Rook remarks on the alarming bits and, now and then, on the rest. */
  function neighbourEvent(ctx: Ctx, e: NeighbourEvent) {
    ctx.log(`neighbours: ${e.who} — ${e.kind}${e.reason ? ` (${e.reason})` : ''}${e.name ? ` — ${e.name}` : ''}${e.threat ? ` (${e.threat})` : ''}`);
    const who = e.who.toLowerCase();
    // "Marge's vegetable patch" → "vegetable patch": his lines put their own article in front.
    const name = e.name?.replace(/^[\w.]+['’]s\s+/, '').toLowerCase();
    const threat = e.threat ? `the ${e.threat}` : undefined; // "love that for the yard gorilla"
    if (e.kind === 'alarm' && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'neighbour:alarm', { who, threat });
      nextNeighbourLineAt = ctx.now + 45_000;
    } else if (e.kind === 'defense' || e.kind === 'hunter') {
      react(ctx, e.kind === 'hunter' ? 'neighbour:hunter' : 'neighbour:defense', { who, name, threat });
      nextNeighbourLineAt = ctx.now + 45_000;
    } else if (e.kind === 'care') {
      react(ctx, 'neighbour:care', { who });
      nextNeighbourLineAt = ctx.now + 45_000;
    } else if (e.kind === 'visit' && e.reason === 'visit' && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'neighbour:visit', { who, name });
      nextNeighbourLineAt = ctx.now + 90_000;
    } else if (e.kind === 'project' && ctx.now >= nextNeighbourLineAt && ctx.rng() < 0.5) {
      react(ctx, 'neighbour:project', { who, name });
      nextNeighbourLineAt = ctx.now + 150_000;
    } else if (e.kind === 'use' && ctx.now >= nextNeighbourLineAt) {
      // A game at the hoop, a dance, a sit-down: a remark now and then, never every time.
      react(ctx, e.reason === 'hoop' ? 'neighbour:play' : e.reason === 'music' ? 'neighbour:dance' : 'neighbour:rest', { who, name });
      nextNeighbourLineAt = ctx.now + 180_000;
    } else if (e.kind === 'fill' && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'hole:filled', { who });
      nextNeighbourLineAt = ctx.now + 90_000;
    } else if (e.kind === 'unplug' && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'music:unplugged', { who });
      nextNeighbourLineAt = ctx.now + 90_000;
    } else if (e.kind === 'crowd' && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'neighbour:crowd', { who });
      nextNeighbourLineAt = ctx.now + 180_000;
    } else if (e.kind === 'grudge' && e.user) {
      // A grudge acted on: the sniff now and then, the kerb, the beige and the vendetta every time.
      const user = e.user.toLowerCase();
      if (e.act === 'remark') {
        if (ctx.now >= nextGrudgeRemarkAt && ctx.now >= nextNeighbourLineAt) {
          react(ctx, 'neighbour:remark', { who, user });
          nextGrudgeRemarkAt = ctx.now + 180_000;
          nextNeighbourLineAt = ctx.now + 90_000;
        }
      } else if (e.act && ctx.now >= nextNeighbourLineAt) {
        react(ctx, e.act === 'kerb' ? 'neighbour:kerb' : e.act === 'beige' ? 'neighbour:beige' : 'neighbour:vendetta', { who, user, name });
        nextNeighbourLineAt = ctx.now + 90_000;
      }
    } else if (e.kind === 'favourite' && e.user && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'neighbour:favourite', { who, user: e.user.toLowerCase() });
      nextNeighbourLineAt = ctx.now + 90_000;
    } else if (e.kind === 'gift' && e.user && ctx.now >= nextNeighbourLineAt) {
      react(ctx, 'neighbour:gift', { who, user: e.user.toLowerCase(), name });
      nextNeighbourLineAt = ctx.now + 90_000;
    }
  }
  /** The neighbours' ideas and the model: bring an answer back, time a slow one out, ask the next one. */
  function neighbourDesigns(ctx: Ctx) {
    if (neighbourInbox) {
      const r = neighbourInbox;
      neighbourInbox = undefined;
      try {
        fulfilWish(ctx.state, r.id, r.result ? neighbourDesignOf(r.result) : undefined, ctx.now);
      } catch (error) {
        ctx.log(`could not take a neighbour design: ${(error as Error).message}`, 'warn');
      }
    }
    if (neighbourDesign && ctx.now > neighbourDesign.deadline) {
      const d = neighbourDesign;
      neighbourDesign = undefined;
      d.controller.abort();
      neighbourInbox = { id: d.id, error: 'timed out' };
    }
    if (neighbourDesign || pending || !neighbourAi || !available || ctx.state.generationPaused || !allowanceOpen(ctx.state)) return;
    const ask = takeWish(ctx.state, ctx.now);
    if (!ask || askedWishes.has(`${ask.id}:${ask.wish.at}`)) return;
    askedWishes.add(`${ask.id}:${ask.wish.at}`);
    const name = specOf(ask.id)?.name ?? ask.id;
    try {
      transaction(ctx, () => bookCall(ctx.state));
    } catch (error) {
      ctx.log(`could not book a neighbour design call: ${(error as Error).message}`, 'warn');
      return;
    }
    ctx.log(`neighbours: ${name} asks the model for ${ask.wish.idea}`);
    const controller = new AbortController();
    neighbourDesign = { id: ask.id, controller, deadline: ctx.now + 95_000 };
    void generator({ text: ask.prompt, username: name, objects: [] }, controller.signal).then(
      (result) => {
        if (!stopped && neighbourDesign?.id === ask.id) {
          neighbourInbox = { id: ask.id, result };
          neighbourDesign = undefined;
        }
      },
      (error) => {
        if (!stopped && neighbourDesign?.id === ask.id) {
          ctx.log(`neighbour design failed (${name}): ${(error as Error).message}`, 'warn');
          neighbourInbox = { id: ask.id, error: (error as Error).message };
          neighbourDesign = undefined;
        }
      },
    );
  }
  /**
   * The neighbours reading the block: bring a theme back, time a slow one out, ask for the next.
   * Third in line behind a chat design and a neighbour design, on its own allowance, so a viewer
   * request is never queued behind one and the neighbours can never spend chat's calls.
   */
  function neighbourSurveys(ctx: Ctx) {
    if (surveyInbox) {
      const r = surveyInbox;
      surveyInbox = undefined;
      try {
        if (adoptTheme(ctx.state, r.id, r.result, ctx.now)) {
          const n = ctx.state.neighbours.find((x) => x.id === r.id);
          ctx.log(`neighbours: ${specOf(r.id)?.name ?? r.id} is redoing the yard — ${n?.theme?.name}`);
          ctx.state.worldRevision++;
        }
      } catch (error) {
        ctx.log(`could not take a block reading: ${(error as Error).message}`, 'warn');
      }
    }
    if (blockSurvey && ctx.now > blockSurvey.deadline) {
      const s = blockSurvey;
      blockSurvey = undefined;
      s.controller.abort();
      surveyInbox = { id: s.id, error: 'timed out' };
    }
    // Chat first, always: anything a viewer is waiting on holds the survey back a tick.
    if (blockSurvey || pending || neighbourDesign) return;
    if (!surveyOn || !available || ctx.state.generationPaused || ctx.state.surveyPaused || !surveyAllowanceOpen(ctx.state)) return;
    const ask = takeSurvey(ctx.state, ctx.now);
    if (!ask || askedSurveys.has(`${ask.id}:${ask.at}`)) return;
    askedSurveys.add(`${ask.id}:${ask.at}`);
    const name = specOf(ask.id)?.name ?? ask.id;
    try {
      transaction(ctx, () => bookSurveyCall(ctx.state));
    } catch (error) {
      ctx.log(`could not book a block reading: ${(error as Error).message}`, 'warn');
      return;
    }
    ctx.log(`neighbours: ${name} is having a look at what the street has built`);
    const controller = new AbortController();
    blockSurvey = { id: ask.id, controller, deadline: ctx.now + 45_000 };
    void surveyor(ask.input, controller.signal).then(
      (result) => {
        if (!stopped && blockSurvey?.id === ask.id) {
          surveyInbox = { id: ask.id, result };
          blockSurvey = undefined;
        }
      },
      (error) => {
        if (!stopped && blockSurvey?.id === ask.id) {
          ctx.log(`block reading failed (${name}): ${(error as Error).message}`, 'warn');
          surveyInbox = { id: ask.id, error: (error as Error).message };
          blockSurvey = undefined;
        }
      },
    );
  }
  /** A viewer spoke to Rook by name and did not ask for work: one dialogue call, under the allowance. */
  async function talk(ctx: Ctx, msg: ChatMessage) {
    const user = msg.username;
    try {
      transaction(ctx, () => {
        ctx.state.seen.push(msg.id);
        trim(ctx.state);
      });
    } catch (error) {
      ctx.log(`could not record a chat message: ${(error as Error).message}`, 'warn');
    }
    if (talking) {
      mutter(ctx, 'busy', { user }, true);
      return;
    }
    if (!available || ctx.state.generationPaused || !allowanceOpen(ctx.state)) {
      mutter(ctx, 'offline', { user }, true);
      return;
    }
    talking = true;
    try {
      if (!fixture) transaction(ctx, () => bookCall(ctx.state));
      const reply = await ctx.llm.dialogue({
        instruction: replyInstruction(ctx.state, user),
        userLine: msg.text,
        username: user,
      });
      if (stopped) return;
      if (reply) {
        speak(ctx, reply);
        recent.push(reply);
      } else mutter(ctx, 'missed', { user }, true);
    } catch (error) {
      ctx.log(`reply to ${user} failed: ${(error as Error).message}`, 'warn');
    } finally {
      talking = false;
    }
  }
  function transaction(ctx: Ctx, change: () => void) {
    const before = structuredClone(ctx.state);
    try {
      change();
      ctx.checkpoint?.();
    } catch (error) {
      Object.assign(ctx.state, before);
      throw new CheckpointError((error as Error).message);
    }
  }
  function notice(ctx: Ctx, text: string) {
    ctx.state.notice = text;
    speak(ctx, text);
  }
  function fail(ctx: Ctx, job: Job, error: string, skipTarget = true) {
    const own = job.userId === ROOK;
    transaction(ctx, () => {
      job.status = 'failed';
      job.error = error.slice(0, 240);
      delete job.preview;
      job.path = [];
      ctx.state.survivor.activity = 'idle';
      if (!own) ctx.state.notice = job.error;
    });
    nextRepairAt = ctx.now + 5000;
    if (own) {
      // Rook's own rounds fail quietly, and a piece he could not fix waits a while before he retries.
      if (skipTarget && job.resolvedTarget) repairSkips.set(job.resolvedTarget, ctx.now + 300000);
      ctx.log(`repair set aside (${job.label}): ${error}`);
      return;
    }
    speak(ctx, error.slice(0, 240));
  }
  function trim(state: SafehouseState) {
    const live = state.jobs.filter(active),
      finished = state.jobs.filter((j) => !active(j)),
      // Repair rounds are frequent; keep only the last few so chat's history stays visible.
      done = [
        ...finished.filter((j) => j.userId !== ROOK).slice(-24),
        ...finished.filter((j) => j.userId === ROOK).slice(-6),
      ].sort((a, b) => a.createdAt - b.createdAt);
    state.jobs = [...done, ...live];
    state.seen = state.seen.slice(-1000);
    state.edits = state.edits.slice(-20);
  }
  /**
   * `!delete <name>` from a trusted chatter: the piece goes, standing or rubble, and the operator's
   * undo puts it back whole. Anything in flight on it is set aside. The houses are never deleted.
   */
  function deleteObject(ctx: Ctx, msg: ChatMessage, phrase: string) {
    if (!isPrivileged(ctx.state, msg.username)) {
      notice(ctx, `${msg.username}, !delete is for chatters the operator has trusted. The operator can undo a change.`);
      return;
    }
    if (!phrase) {
      notice(ctx, 'Say “!delete <name>”, like “!delete the duck watchtower”.');
      return;
    }
    const catalog = [...ctx.state.objects, ...ctx.state.combat.archive];
    const found = resolveTarget(
      phrase,
      catalog,
      ctx.state.targets.find((t) => t.userId === msg.userId)?.objectId,
      { username: msg.username },
    );
    const target = found.target;
    if (!target) {
      notice(ctx, found.clarification ?? `I can't find ${phrase} here.`);
      return;
    }
    if (PROTECTED_IDS.has(target.id)) {
      notice(ctx, `${target.blueprint.name} stays. Houses are not for deleting.`);
      return;
    }
    for (const job of ctx.state.jobs.filter(
      (j) => active(j) && (j.resolvedTarget === target.id || j.targetId === target.id),
    )) {
      if (pending?.id === job.id) {
        pending.controller.abort();
        pending = undefined;
      }
      fail(ctx, job, `${target.blueprint.name} was deleted before this could finish.`, false);
    }
    transaction(ctx, () => {
      ctx.state.seen.push(msg.id);
      // A neighbour's piece deleted from chat: they take note (neighbours.ts keeps the score).
      if (target.owner) noteChatEdit(ctx.state, target, msg.username, 'delete', ctx.now);
      ctx.state.objects = ctx.state.objects.filter((o) => o.id !== target.id);
      ctx.state.combat.archive = ctx.state.combat.archive.filter((o) => o.id !== target.id);
      ctx.state.targets = ctx.state.targets.filter((t) => t.objectId !== target.id);
      ctx.state.edits = [
        ...ctx.state.edits,
        { objectId: target.id, previous: structuredClone(target), revision: target.revision, removed: true },
      ].slice(-20);
      ctx.state.worldRevision++;
      ctx.state.notice = `Removed ${target.blueprint.name} for ${msg.username}.`;
      trim(ctx.state);
    });
    speak(ctx, ctx.state.notice);
  }
  /**
   * A chat verb (`!shoot`, `!honk`, `!dance`, `!verbs`): the chatter's own figure does the thing; no
   * job, no model call. Refusals and the acceptance are plain lines; his remarks are voiced follow-ups.
   */
  function runChatVerb(ctx: Ctx, msg: ChatMessage) {
    let result: VerbResult = {};
    try {
      transaction(ctx, () => {
        ctx.state.seen.push(msg.id);
        result = runVerb(ctx.state, msg, ctx.now, ctx.rng);
        trim(ctx.state);
      });
    } catch (error) {
      ctx.log(`chat verb failed (${msg.text.slice(0, 20)}): ${(error as Error).message}`, 'warn');
      return;
    }
    if (result.reply) notice(ctx, result.reply);
    const user = msg.username;
    if (result.event === 'first-shot') react(ctx, 'hoops:first', { user });
    else if (result.event === 'honk' && ctx.now >= nextHonkLineAt) {
      nextHonkLineAt = ctx.now + 120_000;
      react(ctx, 'honk', { user });
    } else if (result.event === 'dance' && ctx.now >= nextDanceCrowdLineAt) {
      nextDanceCrowdLineAt = ctx.now + 180_000;
      react(ctx, 'dance:crowd', { user });
    }
  }
  /**
   * A shot landed on the pavement's errand: the neighbours hear about it, and Rook has a word on a
   * streak or a drought. A figure doing a piece's own verb (`!swim` at the pool): the neighbours
   * hear about that too, and Rook remarks the first time anyone tries each word.
   */
  function crowdEvent(ctx: Ctx, e: CrowdEvent) {
    if (e.kind === 'verb') {
      try {
        noteVerb(ctx.state, e.word, e.user, e.targetId, e.result ? { result: e.result } : {}, ctx.now);
      } catch (error) {
        ctx.log(`neighbours could not take !${e.word}: ${(error as Error).message}`, 'warn');
      }
      const piece = ctx.state.objects.find((o) => o.id === e.targetId);
      if (e.result) {
        // A scrap decided: a word on the result, gated so a busy street does not have him commentating.
        ctx.log(`fight: ${e.name} ${e.result} against ${piece?.blueprint.name ?? e.targetId}`);
        if (ctx.now >= nextFightLineAt) {
          nextFightLineAt = ctx.now + 120_000;
          react(ctx, e.result === 'won' ? 'fight:won' : 'fight:lost', { user: e.name, name: speakName(piece) });
        }
        return;
      }
      if (e.word === 'drive' && ctx.now >= nextDriveLineAt) {
        nextDriveLineAt = ctx.now + 180_000;
        react(ctx, 'drive:go', { user: e.name, name: speakName(piece) });
      }
      if (!firstVerbDone.has(e.word)) {
        firstVerbDone.add(e.word);
        if (ctx.now >= nextFirstVerbLineAt) {
          nextFirstVerbLineAt = ctx.now + 90_000;
          react(ctx, 'verb:first', { user: e.name, word: e.word });
        }
      }
      return;
    }
    if (e.kind !== 'shot') return;
    ctx.log(`hoops: ${e.name} ${e.hit ? 'hit' : 'missed'} — ${e.streak} in a row`);
    try {
      noteVerb(ctx.state, 'shoot', e.user, e.targetId, { hit: e.hit }, ctx.now);
    } catch (error) {
      ctx.log(`neighbours could not take the shot: ${(error as Error).message}`, 'warn');
    }
    if (e.hit && e.streak === 3) react(ctx, 'hoops:streak', { user: e.name });
    else if (!e.hit && e.misses === 4 && ctx.now >= nextBrickLineAt) {
      nextBrickLineAt = ctx.now + 300_000;
      react(ctx, 'hoops:brick', { user: e.name });
    }
  }
  function admit(ctx: Ctx, msg: ChatMessage) {
    if (ctx.state.seen.includes(msg.id)) return;
    if (msg.text.length > 1000 || msg.username.length > 40) {
      notice(ctx, 'Keep requests under 1,000 characters and names under 40.');
      return;
    }
    // A chat verb: the figure on the pavement does it (verbs.ts). Only these words and !delete are commands.
    if (parseVerb(msg.text)) return runChatVerb(ctx, msg);
    // A trusted chatter's command: neither a request nor a conversation.
    const command = msg.text.match(/^!delete\b\s*(.*)$/is);
    if (command) return deleteObject(ctx, msg, command[1].trim());
    // Someone talking to him rather than asking for work: answer, don't design.
    if (converse && addressesRook(msg.text) && !looksLikeRequest(msg.text)) return talk(ctx, msg);
    const catalog = [...ctx.state.objects, ...ctx.state.combat.archive];
    const resolved = parseRequest(
      msg.text,
      catalog,
      ctx.state.targets.find((t) => t.userId === msg.userId)?.objectId,
      msg.username, // "my statue"
    );
    const { operation, text, requestedPosition } = resolved;
    if (resolved.rejection) {
      notice(ctx, resolved.rejection);
      return;
    }
    if (resolved.clarification) {
      notice(ctx, resolved.clarification);
      return;
    }
    if (
      !resolved.quick &&
      !operation &&
      (!available || ctx.state.generationPaused || !allowanceOpen(ctx.state))
    ) {
      notice(
        ctx,
        !available
          ? 'AI is offline. Simple named color/size edits still work.'
          : 'AI generation is paused or its call allowance is empty. Simple named edits still work.',
      );
      return;
    }
    const live = ctx.state.jobs.filter(active);
    if (live.length >= 8) {
      notice(ctx, 'The build queue is full. Let me finish a few jobs first.');
      return;
    }
    if (live.some((j) => j.userId === msg.userId)) {
      notice(ctx, `${msg.username}, your request is already in the queue. Let me finish it first.`);
      return;
    }
    const previous = ctx.state.jobs.filter((j) => j.userId === msg.userId).at(-1);
    if (previous && ctx.now - previous.createdAt < 3000) {
      notice(ctx, 'Give me a moment before the next request.');
      return;
    }
    if (/\b(delete|demolish|destroy|remove|erase|burn down)\b/i.test(msg.text)) {
      notice(ctx, 'I will not delete community creations from chat. The operator can undo a change.');
      return;
    }
    try {
      transaction(ctx, () => {
        ctx.state.seen.push(msg.id);
        ctx.state.jobs.push({
          id: msg.id,
          text,
          username: msg.username,
          userId: msg.userId,
          status: 'queued',
          createdAt: ctx.now,
          attempts: 0,
          label: `Idea from ${msg.username}`,
          path: [],
          workedMs: 0,
          workMs:
            options.workMs ??
            (resolved.quick ? 2500 : operation === 'move' || operation === 'rotate' ? 4000 : 12000),
          resolvedTarget: resolved.targetId,
          quick: resolved.quick,
          operation,
          requestedPosition,
          requestedArea: resolved.requestedArea,
          relativeTo: resolved.relativeTo,
          angle: resolved.angle,
          giftTo: resolved.giftTo,
        });
        trim(ctx.state);
        ctx.state.notice = `Queued ${msg.username}'s request.`;
      });
      speak(ctx, `Got your idea, ${msg.username}. It's in the queue.`);
      // The plain acknowledgement stays plain; the sulk is a voiced follow-up once it has cleared.
      if (sulking(ctx.state.grudges, msg.username)) react(ctx, 'grudge:ack', { user: msg.username });
    } catch (error) {
      ctx.log(`admission save failed: ${(error as Error).message}`, 'alert');
      speak(ctx, 'I could not save that request. Please try again once storage is available.');
    }
  }
  function consume(ctx: Ctx) {
    if (!inbox) return;
    const response = inbox;
    inbox = undefined;
    const job = ctx.state.jobs.find((j) => j.id === response.id);
    if (!job || job.status !== 'designing') return;
    try {
      if (response.error) throw new Error(response.error);
      const catalog = [...ctx.state.objects, ...ctx.state.combat.archive];
      const result = validateResponse(response.result, (id) => !!catalog.find((o) => o.id === id)?.fixed);
      if (!('blueprint' in result)) {
        transaction(ctx, () => {
          job.status = result.action === 'decline' ? 'failed' : 'complete';
          job.error = result.action === 'decline' ? result.reply : undefined;
          job.label = result.reply;
          ctx.state.notice = result.reply;
        });
        speak(ctx, result.reply);
        return;
      }
      const target = result.action === 'edit' ? catalog.find((o) => o.id === result.targetId) : undefined;
      if (result.action === 'edit' && (!target || response.catalog.get(target.id) !== target.revision))
        throw new Error('That changed while I was designing. Please ask again.');
      // Rook adapts on the spot: a piece knocked down since he picked it gets rebuilt instead.
      if (job.userId === ROOK && target && !intact(target)) job.operation = 'rebuild';
      if (target && !intact(target) && job.operation !== 'rebuild')
        throw new Error('That was destroyed. Ask to rebuild it.');
      if (job.operation === 'rebuild' && target && intact(target))
        throw new Error('That is still standing. Use repair instead.');
      if (target?.passable && (job.operation === 'move' || job.operation === 'rotate'))
        throw new Error('The floor stays where it is. Move the things on it instead.');
      if (target?.id === HOUSE_ID && (job.operation === 'move' || job.operation === 'rotate'))
        throw new Error("Rook's house stays where it is. Build around it instead.");
      if (!target && ctx.state.objects.filter((o) => !o.fixed).length >= BUDGETS.creations)
        throw new Error(
          `The block has reached its creation budget (${BUDGETS.creations}). You can still edit existing things.`,
        );
      // A living build: the model named a behaviour; the app runs it. Edits keep what a piece has
      // unless the design says otherwise (calm the gorilla, wake the statue).
      const living = 'creature' in result ? result.creature : undefined;
      // The block's own birds and cat (wild) are nobody's and count against nobody.
      if (living && !target?.creature && ctx.state.objects.filter((o) => o.creature && intact(o) && !o.wild).length >= MAX_CREATURES)
        throw new Error(
          `The yard has ${MAX_CREATURES} living things already. Ask to change one instead of adding another.`,
        );
      const reborn =
        !!living &&
        (living.behaviour !== target?.creature?.behaviour || !!living.flying !== !!target?.creature?.flying);
      // Seeded neighborhood pieces keep their own detail; only community additions spend the budget.
      const parts =
        ctx.state.objects
          .filter((o) => o.id !== target?.id && !o.fixed)
          .reduce((n, o) => n + o.blueprint.parts.length, 0) + result.blueprint.parts.length;
      if (!target?.fixed && parts > BUDGETS.parts)
        throw new Error('The block is at its detail budget. Try a simpler design.');
      const size = measureBlueprint(result.blueprint, target?.fixed ? SCENERY_LIMITS : CHAT_LIMITS);
      let requested: GroundPoint | GroundPoint[] | undefined = job.requestedPosition;
      if (job.requestedArea) requested = areaCandidates(LANDMARKS[job.requestedArea]);
      if (job.relativeTo) {
        const anchor = ctx.state.objects.find((o) => o.id === job.relativeTo!.objectId && intact(o));
        if (!anchor) throw new Error('The thing to place it beside is gone. Pick another spot.');
        requested = relativeCandidates(anchor, job.relativeTo.side, size);
      }
      // A neighbour walking to a build site has claimed that ground; nothing goes there meanwhile.
      // A living build redesigned where it stands is not placed on the ground at all: Rook walks
      // to wherever near it he can get (a perched bird has the fence under it).
      const placement =
        target?.creature && intact(target) && job.operation !== 'move'
          ? creatureWorkSpot(ctx.state, target, ctx.state.survivor.position)
          : choosePlacement(
              size,
              [...ctx.state.objects, ...neighbourGhosts(ctx.state)],
              ctx.state.survivor.position,
              target,
              requested,
            );
      // What the piece is for, how it behaves and how it moves — from the design when it says, else
      // kept from the piece being edited. Rules only ever ride on a living build; every number is
      // the app's (rules.ts clamps), and a repaint or a move keeps all three.
      const nextCreature = living
        ? freshCreature(living.behaviour, !!living.flying)
        : target?.creature
          ? structuredClone(target.creature)
          : undefined;
      const usesChosen = result.uses ?? (result.action === 'edit' ? target?.uses : undefined) ?? [];
      const uses = [...new Set(usesChosen)].slice(0, MAX_USES);
      // The wave loop's tactics (TACTICS in combat.ts): chat may have three holes and three sets of
      // speakers standing at once; a hole is ground, never a wall, whatever the model called it.
      const addsUse = (use: 'trap' | 'music') => uses.includes(use) && !target?.uses?.includes(use);
      const standingWith = (use: 'trap' | 'music') =>
        ctx.state.objects.filter((o) => o.id !== target?.id && !o.fixed && intact(o) && o.uses?.includes(use)).length;
      if (addsUse('trap') && standingWith('trap') >= TACTICS.trap.max) throw new Error('Three holes is plenty. Fill one in first.');
      if (addsUse('music') && standingWith('music') >= TACTICS.music.max)
        throw new Error('Three sets of speakers is plenty for one street.');
      const hole = uses.includes('trap');
      const rules = nextCreature ? clampRules(result.rules ?? (result.action === 'edit' ? target?.rules : undefined)) : [];
      const animations = clampAnimations(result.blueprint.animations, result.blueprint.parts.length);
      const { animations: _drawn, ...bare } = result.blueprint;
      const blueprint = animations.length ? { ...bare, animations } : bare;
      transaction(ctx, () => {
        job.preview = {
          id: target?.id ?? crypto.randomUUID(),
          revision: (target?.revision ?? 0) + 1,
          blueprint,
          position: placement.position,
          footprint: size,
          createdBy: target?.createdBy ?? job.username,
          editedBy: job.username,
          createdAt: target?.createdAt ?? ctx.now,
          role: hole
            ? 'decoration'
            : job.operation === 'turret' || job.operation === 'barrier'
              ? job.operation
              : (target?.role ?? (result.action === 'build' ? result.role : undefined) ?? 'decoration'),
          fixed: target?.fixed,
          passable: hole || target?.passable ? true : undefined,
          owner: target?.owner,
          uses: uses.length ? uses : undefined,
          rules: rules.length ? rules : undefined,
          // The piece's own verb (`!swim` at a pool): a build names one or none; an edit replaces or keeps. Never on a creature.
          // A living build may carry only `ride` or `fight`; the block's own animals carry none.
          verb: pieceVerbFor(result.verb ?? (result.action === 'edit' ? target?.verb : undefined), !!nextCreature, !!target?.wild),
          wild: target?.wild,
          // A gift is a new build for a neighbour; an edit keeps what the piece was and never makes it one.
          giftTo: target ? target.giftTo : job.giftTo,
          creature: nextCreature,
          maxHealth:
            job.operation === 'turret' || job.operation === 'barrier' || reborn ? undefined : target?.maxHealth,
        };
        if (job.preview.creature) {
          // Whatever it was doing, it starts over from where the work leaves it.
          job.preview.creature.path = [];
          job.preview.creature.targetId = undefined;
          job.preview.creature.moving = false;
          job.preview.creature.replanMs = 0;
        }
        job.preview = initializeObject(job.preview);
        job.preview.lifecycle =
          job.operation === 'rebuild' ? (target?.lifecycle ?? 1) + 1 : (target?.lifecycle ?? 1);
        job.baseLifecycle = target?.lifecycle;

        job.targetId = target?.id;
        job.baseRevision = target?.revision;
        job.path = placement.path;
        job.status = 'walking';
        job.label = result.blueprint.name;
        ctx.state.idlePath = []; // any pacing ends here; the work route starts from where he stands
        ctx.state.survivor.activity = 'walking';
        ctx.state.notice = result.reply;
      });
      nextLegAt = 0;
      // His own repair-round line steps aside while a follow-up is waiting, or was just said and not yet seen.
      if (!(job.userId === ROOK && (reactions.length || unseenFollowUp(ctx)))) speak(ctx, result.reply);
      // His own round already got its voiced line as the reply; a viewer's job gets one a few steps
      // into the walk, sooner if he just dropped a repair for it.
      nextWorkLineAt = ctx.now + (preempted ? 600 : job.userId === ROOK ? 9000 : 3500) + ctx.rng() * 2000;
    } catch (error) {
      if (error instanceof CheckpointError) throw error;
      const currentJob = ctx.state.jobs.find((j) => j.id === job.id);
      if (currentJob) fail(ctx, currentJob, (error as Error).message || 'Could not prepare that design.');
    }
  }
  function startDesign(ctx: Ctx, job: Job) {
    if (job.quick || job.operation) {
      const target = [...ctx.state.objects, ...ctx.state.combat.archive].find(
        (o) => o.id === job.resolvedTarget,
      );
      let result: DesignResponse;
      try {
        if (!target) throw new Error('That no longer exists. Choose another target.');
        const verb =
          job.operation === 'move'
            ? 'Moving it'
            : job.operation === 'rotate'
              ? 'Turning it'
              : job.operation === 'repair'
                ? 'Patching it up'
                : job.operation === 'rebuild'
                  ? 'Rebuilding it from the saved plan'
                  : 'A quick edit';
        result = {
          action: 'edit',
          targetId: target.id,
          blueprint: job.quick
            ? applyQuickEdit(target.blueprint, job.quick, !!target.fixed)
            : job.operation === 'rotate'
              ? rotateBlueprint(target.blueprint, job.angle ?? Math.PI)
              : structuredClone(target.blueprint),
          // His own rounds are nobody's request, so the line is his, not a status report.
          reply:
            job.userId === ROOK
              ? line(intact(target) ? 'walk:repair' : 'walk:rebuild', { name: speakName(target) }, ctx.rng)
              : `${verb}—no AI call needed.`,
        };
      } catch (error) {
        fail(ctx, job, (error as Error).message);
        return;
      }
      transaction(ctx, () => {
        job.status = 'designing';
        ctx.state.idlePath = [];
      });
      inbox = { id: job.id, result, catalog: new Map([[target!.id, target!.revision]]) };
      return;
    }
    if (ctx.state.generationPaused || !allowanceOpen(ctx.state)) return;
    if (job.attempts >= 2) {
      fail(ctx, job, 'This request was interrupted twice. Please submit it again.');
      return;
    }
    // A trusted chatter's design is never cut off: no deadline here, no timer on the call.
    const trusted = isPrivileged(ctx.state, job.username);
    transaction(ctx, () => {
      job.status = 'designing';
      job.attempts++;
      bookCall(ctx.state);
      ctx.state.idlePath = [];
      ctx.state.survivor.activity = 'idle';
      ctx.state.notice = `Designing ${job.username}'s idea${trusted ? ' (no time limit)' : ''}…`;
    });
    nextLegAt = 0;
    nextWorkLineAt = ctx.now + 6000 + ctx.rng() * 4000; // a line or two while he paces
    const controller = new AbortController(),
      catalog = new Map(ctx.state.objects.map((o) => [o.id, o.revision]));
    pending = { id: job.id, controller, deadline: trusted ? Infinity : ctx.now + 95000, catalog };
    const input = {
      text: job.text,
      username: job.username,
      objects: structuredClone(ctx.state.objects),
      targetId: job.resolvedTarget,
      ...(trusted ? { noTimeout: true } : {}),
    };
    void generator(input, controller.signal).then(
      (result) => {
        if (!stopped && pending?.id === job.id) {
          inbox = { id: job.id, result, catalog };
          pending = undefined;
        }
      },
      (error) => {
        if (!stopped && pending?.id === job.id) {
          const message = (error as Error).message;
          ctx.log(`safehouse generation failed: ${message}`, 'warn');
          // Our own validation messages are written for chat and say what to
          // change; transport and JSON-shape failures get a generic line.
          const spoken =
            error instanceof Error &&
            error.constructor === Error &&
            !/JSON|Unexpected token|response size/i.test(message)
              ? message
              : 'I could not generate a valid design. Try rephrasing or simplifying the request.';
          inbox = {
            id: job.id,
            error: /abort|timeout|timed out/i.test(message)
              ? 'That design took too long. Try a simpler version; existing creations are safe.'
              : spoken,
            catalog,
          };
          pending = undefined;
        }
      },
    );
  }
  /** Rook's own initiative: with nothing asked of him, fix the worst zombie damage. Zero AI calls. */
  function autoRepair(ctx: Ctx): boolean {
    if (ctx.state.repairsPaused || ctx.now < nextRepairAt || ctx.state.jobs.some(active)) return false;
    // The neighbours' houses and whatever they built are theirs to fix — unless the operator has stood them down.
    const theirs = new Set(
      neighboursOn && !ctx.state.neighboursPaused
        ? [...ctx.state.objects, ...ctx.state.combat.archive].filter(ownedByNeighbours).map((o) => o.id)
        : [],
    );
    const pick = pickRepairTarget(
      ctx.state.objects,
      ctx.state.combat.archive,
      ctx.state.survivor.position,
      (id) => (repairSkips.get(id) ?? 0) > ctx.now || theirs.has(id),
      // The sulk: a chatter whose creatures keep knocking his yard down gets their things fixed last in the tier.
      (o) => !o.fixed && sulking(ctx.state.grudges, o.createdBy),
    );
    if (!pick) return false;
    const name = pick.object.blueprint.name;
    try {
      transaction(ctx, () => {
        ctx.state.jobs.push({
          id: `repair:${crypto.randomUUID()}`,
          text: `${pick.operation === 'rebuild' ? 'Rebuild' : 'Repair'} ${name}`,
          username: 'Rook',
          userId: ROOK,
          status: 'queued',
          createdAt: ctx.now,
          attempts: 0,
          label: `Fixing ${name}`,
          path: [],
          workedMs: 0,
          workMs: options.workMs ?? repairMs(pick.missing),
          resolvedTarget: pick.object.id,
          operation: pick.operation,
        });
        trim(ctx.state);
      });
      return true;
    } catch (error) {
      ctx.log(`repair round could not be saved: ${(error as Error).message}`, 'warn');
      nextRepairAt = ctx.now + 30000;
      return false;
    }
  }
  function tick(ctx: Ctx, dt: number) {
    if (stopped) return;
    const beforeCombat = ctx.state.combat.paused ? undefined : structuredClone(ctx.state);
    const combatResult = tickCombat(ctx.state.combat, ctx.state.objects, dt);
    ctx.state.objects = combatResult.objects;
    if (combatResult.changed) {
      ctx.state.worldRevision++;
      try {
        ctx.checkpoint?.();
      } catch (error) {
        if (beforeCombat) Object.assign(ctx.state, beforeCombat);
        ctx.state.combat.paused = true;
        ctx.state.notice = 'Combat paused because saving failed.';
        throw error;
      }
    }
    // Wave beats. Calls viewers must parse (the incoming roster, cleared with the count, the house
    // falling) stay plain in the bubble and on the panel; the warnings keep their plain text on the
    // panel but he says them his own way; the big moments get a voiced follow-up once the plain line
    // has had its moment. Bubble and log only, never Kick.
    for (const event of combatResult.events) {
      ctx.log(`wave: ${event}`);
      const wave = Number(/wave (\d+)/i.exec(event)?.[1] ?? ctx.state.combat.wave.number);
      if (/^One minute until/.test(event)) {
        ctx.state.notice = event;
        mutter(ctx, 'wave:minute', { wave }, true);
      } else if (/in ten seconds/.test(event)) {
        ctx.state.notice = event;
        mutter(ctx, 'wave:ten', { wave }, true);
      } else {
        notice(ctx, event);
        const follow: Moment | undefined = /cleared —/.test(event)
          ? 'wave:cleared'
          : /stragglers/.test(event)
            ? 'wave:over'
            : /house fell/.test(event)
              ? 'wave:fell'
              : undefined;
        if (follow)
          react(ctx, follow, { wave, down: Number(/(\d+) down/.exec(event)?.[1] ?? ctx.state.combat.wave.killed) });
      }
    }
    houseWatch(ctx);
    tacticsWatch(ctx);
    verbWatch(ctx);
    // Living builds run on their own clock, zombies paused or not. Damage is durable, so it saves;
    // a fallen piece changes the inspect list, so that bumps the world revision.
    const life = tickCreatures(ctx.state, dt, ctx.rng);
    if (life.changed) {
      if (life.events.some((e) => e.kind === 'down')) ctx.state.worldRevision++;
      try {
        ctx.checkpoint?.();
      } catch (error) {
        ctx.log(`could not save creature damage: ${(error as Error).message}`, 'warn');
      }
    }
    // Time heals: his grudges (grudges.ts) lose a point a quarter hour and are forgotten at zero.
    decayTable(ctx.state.grudges, ctx.now);
    for (const e of life.events) {
      const by = ctx.state.objects.find((o) => o.id === e.id);
      if (e.kind === 'hit' && by && isHostile(by) && ctx.now >= nextCreatureLineAt) {
        if (mutter(ctx, 'creature:rampage', { name: speakName(by) })) nextCreatureLineAt = ctx.now + 40000;
      }
      if (e.kind === 'down') {
        const fallen = [...ctx.state.objects, ...ctx.state.combat.archive].find((o) => o.id === e.targetId);
        if (fallen?.creature) react(ctx, 'creature:down', { name: speakName(fallen) });
        // A chatter's creature knocking something of his down (the fence, the house, the yard's own
        // clutter, or someone else's creation): he remembers whose creature it was. A neighbour's
        // hunter is nobody in chat, and a chatter wrecking their own thing is their business.
        const culprit = by ? chatterKey(by.createdBy, NOT_CHATTERS) : undefined;
        if (
          culprit &&
          fallen &&
          (fallen.id.startsWith('fence-') ||
            fallen.id === HOUSE_ID ||
            (fallen.fixed && !fallen.owner && !fallen.wild) ||
            (!fallen.fixed && fallen.createdBy.toLowerCase() !== culprit))
        ) {
          ctx.state.grudges ??= {};
          bump(ctx.state.grudges, culprit, GRUDGE.knockedDown, ctx.now, `${speakName(by)} knocked ${speakName(fallen)} down`);
        }
      }
    }
    // The block's own small life (wildlife.ts): a downed bird goes, the pool refills, the operator's
    // switch clears them. Only a change to the object list is worth a save.
    if (wildlifeOn && tickWildlife(ctx.state, ctx.now, ctx.rng)) {
      ctx.state.worldRevision++;
      try {
        ctx.checkpoint?.();
      } catch (error) {
        ctx.log(`could not save the wildlife: ${(error as Error).message}`, 'warn');
      }
    }
    // The neighbours go about their business on their own clock. A fault in their code must never
    // stop Rook's tick, so it is fenced off; their builds and repairs save like any other change.
    if (neighboursOn) {
      try {
        const revisionBefore = ctx.state.worldRevision;
        const next = tickNeighbours(ctx.state, dt, ctx.now, ctx.rng, pace, !!ctx.state.neighboursPaused);
        if (next.changed || ctx.state.worldRevision !== revisionBefore) {
          try {
            ctx.checkpoint?.();
          } catch (error) {
            ctx.log(`could not save the neighbours' work: ${(error as Error).message}`, 'warn');
          }
        }
        for (const e of next.events) neighbourEvent(ctx, e);
        neighbourDesigns(ctx);
        neighbourSurveys(ctx);
      } catch (error) {
        ctx.log(`neighbours tick failed: ${(error as Error).message}`, 'warn');
      }
    }
    for (const e of tickCrowd(ctx.state, ctx.now, dt, ctx.rng)) crowdEvent(ctx, e);
    reactionsDue(ctx);
    if (ctx.state.combat.archive.length >= 100)
      ctx.state.notice = 'Combat paused: blueprint archive is full.';
    if (pending && ctx.now > pending.deadline) {
      const p = pending;
      pending = undefined;
      p.controller.abort();
      inbox = { id: p.id, error: 'Design timed out. Please try a smaller request.', catalog: p.catalog };
    }
    const awaiting = inbox;
    try {
      consume(ctx);
    } catch (error) {
      inbox = awaiting;
      throw error;
    }
    let job = ctx.state.jobs.find(active);
    if (!job && autoRepair(ctx)) job = ctx.state.jobs.find(active);
    if (!job) {
      preempted = false;
      nextWorkLineAt = 0;
      nextLegAt = 0;
      const pos = ctx.state.survivor.position;
      // Just became idle: pick where to rest — a seat chat built near the porch, else the steps.
      if (!idleSince) {
        idleSince = ctx.now;
        restSpot = pickRestSpot(ctx.state);
      }
      const rest = restSpot ?? { at: SURVIVOR_START, facing: 0 };
      if (!ctx.state.idlePath.length && Math.hypot(pos.x - rest.at.x, pos.z - rest.at.z) > 0.2) {
        const path = route(pos, rest.at, ctx.state.objects);
        // A seat he cannot get to (something went up in the way) is dropped for the steps.
        if (!path && rest.seat) restSpot = { at: { ...SURVIVOR_START }, facing: 0 };
        ctx.state.idlePath = straighten(path ?? []);
      }
      if (!stroll(ctx, dt)) {
        const there = Math.hypot(pos.x - rest.at.x, pos.z - rest.at.z) <= 0.2;
        if (there && ctx.now - idleSince >= SIT_AFTER_MS) {
          // Speakers in earshot and he dances; otherwise he sits — on the seat, or the steps.
          const resting: SurvivorActivity = rest.dance ? 'dancing' : 'sitting';
          if (ctx.state.survivor.activity !== resting) {
            ctx.state.survivor.activity = resting;
            ctx.state.survivor.facing = rest.facing;
          }
        } else ctx.state.survivor.activity = 'idle';
        idleLine(ctx);
      }
      return;
    }
    idleSince = 0;
    restSpot = undefined;
    nextIdleLineAt = 0;
    if (job.userId === ROOK && ctx.state.jobs.filter(active).length > 1) {
      // A viewer's request always comes first; Rook picks the repair up again when he is free.
      fail(ctx, job, 'Set aside for a viewer request.', false);
      preempted = true;
      return;
    }
    if (job.status === 'queued') {
      if (!pending) startDesign(ctx, job);
      // Still queued: the AI is paused, the allowance is spent or another design is in flight.
      // Nothing for him to do but not a reason to stand still.
      if (job.status === 'queued') wander(ctx, dt);
      return;
    }
    if (job.status === 'designing') {
      wander(ctx, dt);
      if (nextWorkLineAt && ctx.now >= nextWorkLineAt && mutter(ctx, 'wait', { user: job.username }))
        nextWorkLineAt = ctx.now + 12000 + ctx.rng() * 8000;
      return;
    }
    if (job.status === 'walking') {
      // The route was planned without the piece being edited (a moved piece is
      // carried along), so the walk check must ignore it too.
      const around = ctx.state.objects.filter((o) => o.id !== job!.targetId);
      if (job.path[0] && !walkableSegment(ctx.state.survivor.position, job.path[0], around)) {
        fail(ctx, job, 'The work route is now blocked. Please retry from a clear approach.');
        return;
      }
      if (nextWorkLineAt && ctx.now >= nextWorkLineAt && job.path.length) {
        const moment: Moment = preempted
          ? 'walk:preempt'
          : job.userId === ROOK
            ? job.operation === 'rebuild'
              ? 'walk:rebuild'
              : 'walk:repair'
            : job.operation === 'move' || job.operation === 'rotate'
              ? 'walk:move'
              : sulking(ctx.state.grudges, job.username)
                ? 'walk:grudge' // building it anyway, and saying so
                : job.targetId
                  ? 'walk:edit'
                  : 'walk:build';
        if (mutter(ctx, moment, { name: speakName(job.preview), user: job.username })) {
          preempted = false;
          nextWorkLineAt = ctx.now + 9000 + ctx.rng() * 6000;
        }
      }
      let distance = (Math.min(dt, 10000) / 1000) * WALK_SPEED;
      while (job.path.length && distance > 0) {
        const pos = ctx.state.survivor.position,
          next = job.path[0],
          dx = next.x - pos.x,
          dz = next.z - pos.z,
          length = Math.hypot(dx, dz);
        if (length > 0.001) ctx.state.survivor.facing = Math.atan2(dx, dz);
        if (length <= distance) {
          ctx.state.survivor.position = { ...next };
          job.path.shift();
          distance -= length;
          if (length > 0.001) break; // one straight segment per snapshot; never interpolate across corners
        } else {
          pos.x += (dx / length) * distance;
          pos.z += (dz / length) * distance;
          distance = 0;
        }
      }
      if (!job.path.length) {
        transaction(ctx, () => {
          job!.status = 'building';
          ctx.state.survivor.activity =
            job!.operation === 'repair' || job!.operation === 'rebuild' ? 'repairing' : 'building';
          const p = job!.preview?.position,
            s = ctx.state.survivor.position;
          if (p) ctx.state.survivor.facing = Math.atan2(p.x - s.x, p.z - s.z);
        });
        nextWorkLineAt = ctx.now + 4000 + ctx.rng() * 3000;
      }
      return;
    }
    if (job.status === 'building') {
      job.workedMs = Math.min(job.workMs, job.workedMs + Math.min(dt, 10000));
      if (job.workedMs < job.workMs) {
        // Hammer talk every ten seconds or so, on anything longer than a quick tap.
        if (nextWorkLineAt && ctx.now >= nextWorkLineAt && job.workMs - job.workedMs > 3000) {
          const repairing = job.operation === 'repair' || job.operation === 'rebuild';
          if (
            mutter(ctx, repairing ? 'work:repair' : 'work:build', {
              name: speakName(job.preview),
              user: job.username,
            })
          )
            nextWorkLineAt = ctx.now + 9000 + ctx.rng() * 7000;
        }
        return;
      }
      const preview = job.preview;
      if (!preview) {
        fail(ctx, job, 'The saved blueprint is missing.');
        return;
      }
      const target = job.targetId
        ? [...ctx.state.objects, ...ctx.state.combat.archive].find((o) => o.id === job!.targetId)
        : undefined;
      if (
        job.targetId &&
        (!target || target.revision !== job.baseRevision || target.lifecycle !== job.baseLifecycle)
      ) {
        fail(ctx, job, 'That creation changed before this edit could finish. Please try again.');
        return;
      }
      // A living build being redesigned in place (not moved) is met where it is: it may be perched
      // over the fence or standing in a doorway, so ground placement does not apply, and its live
      // state carries on — the same body in a new coat keeps its goal; a new behaviour starts fresh.
      const inFlight = !!target?.creature && intact(target) && job.operation !== 'move' && !!preview.creature;
      if (inFlight) {
        const live = structuredClone(target!.creature!);
        const reborn = preview.creature!.behaviour !== live.behaviour || !!preview.creature!.flying !== !!live.flying;
        const sameRules = JSON.stringify(preview.rules ?? null) === JSON.stringify(target!.rules ?? null);
        preview.position = { ...target!.position };
        preview.creature = reborn
          ? { ...preview.creature!, facing: live.facing, ...(preview.creature!.flying && live.flying ? { altitude: live.altitude } : {}) }
          : sameRules
            ? live
            : { ...live, goal: undefined, path: [], targetId: undefined, moving: false, replanMs: 0 };
      } else {
        try {
          choosePlacement(
            preview.footprint,
            ctx.state.objects,
            ctx.state.survivor.position,
            target,
            preview.position,
          );
        } catch (error) {
          fail(ctx, job, (error as Error).message);
          return;
        }
      }
      transaction(ctx, () => {
        if (target && (job.operation === 'repair' || job.operation === 'rebuild')) {
          // A repair is a full repair. (initializeObject's role default left 600-hp walls at 240.)
          preview.health = preview.maxHealth;
        } else if (target) {
          // Same maximum → carry the exact number; only a role change rescales the damage.
          preview.health =
            (preview.maxHealth ?? 80) === (target.maxHealth ?? 80)
              ? target.health
              : ((target.health ?? 80) / (target.maxHealth ?? 80)) * (preview.maxHealth ?? 80);
        }
        preview.damageRevision = target?.damageRevision ?? 0;
        preview.nextShotAt = ctx.state.combat.time + 1000;
        ctx.state.combat.archive = ctx.state.combat.archive.filter((o) => o.id !== preview.id);
        ctx.state.edits.push({
          objectId: preview.id,
          previous: target ? structuredClone(target) : undefined,
          revision: preview.revision,
        });
        ctx.state.objects = ctx.state.objects.filter((o) => o.id !== preview.id);
        ctx.state.objects.push(preview);
        ctx.state.worldRevision++;
        ctx.state.targets = [
          ...ctx.state.targets.filter((t) => t.userId !== job!.userId),
          { userId: job!.userId, objectId: preview.id },
        ].slice(-200);
        if (job!.userId !== ROOK) {
          // A chat job on a neighbour's piece: they take note of who did what (neighbours.ts).
          if (target?.owner) noteChatEdit(ctx.state, target, job!.username, chatEditKindOf(job!), ctx.now);
          // Amends with Rook: a repair they asked for, a defense, a gift to a neighbour.
          const key = chatterKey(job!.username, NOT_CHATTERS);
          if (key && ctx.state.grudges?.[key]) {
            if (job!.operation === 'repair' || job!.operation === 'rebuild') bump(ctx.state.grudges, key, GRUDGE.repaired, ctx.now);
            else if (!target && (preview.role === 'turret' || preview.role === 'barrier')) bump(ctx.state.grudges, key, GRUDGE.defended, ctx.now);
            if (preview.giftTo && !target) bump(ctx.state.grudges, key, GRUDGE.gifted, ctx.now);
          }
        }
        job!.status = 'complete';
        delete job!.preview;
        job!.path = [];
        ctx.state.survivor.activity = 'idle';
        const recipient = !target && preview.giftTo ? specOf(preview.giftTo)?.name : undefined;
        ctx.state.notice =
          job!.userId === ROOK
            ? `${job!.operation === 'rebuild' ? 'Rebuilt' : 'Patched up'} ${preview.blueprint.name}.`
            : recipient
              ? `Finished ${preview.blueprint.name}, from ${job!.username} for ${recipient}.`
              : `Finished ${preview.blueprint.name}, suggested by ${job!.username}.`;
        trim(ctx.state);
      });
      nextRepairAt = ctx.now + 5000;
      nextWorkLineAt = 0;
      speak(ctx, ctx.state.notice);
      if (preview.creature && !target?.creature)
        react(ctx, preview.creature.flying ? 'creature:airborne' : 'creature:loose', { name: speakName(preview) });
    }
  }
  /** Undo of a `!delete`: the piece comes back exactly as it was, unless something now stands under its id. */
  function restoreDeleted(ctx: Ctx, edit: SafehouseState['edits'][number]) {
    const previous = edit.previous;
    if (!previous || [...ctx.state.objects, ...ctx.state.combat.archive].some((o) => o.id === edit.objectId)) {
      notice(ctx, 'That deletion cannot be undone safely.');
      return;
    }
    if (ctx.state.jobs.some((j) => active(j) && j.userId !== ROOK)) {
      notice(ctx, 'Wait for current requests to finish before undoing.');
      return;
    }
    const round = ctx.state.jobs.find((j) => active(j) && j.userId === ROOK);
    if (round) fail(ctx, round, 'Set aside for the operator.', false);
    transaction(ctx, () => {
      ctx.state.edits.pop();
      ctx.state.objects.push({ ...structuredClone(previous), revision: previous.revision + 1 });
      ctx.state.worldRevision++;
      ctx.state.notice = `Put ${previous.blueprint.name} back.`;
    });
    speak(ctx, ctx.state.notice);
  }
  function undo(ctx: Ctx) {
    const edit = ctx.state.edits.at(-1);
    if (!edit) {
      notice(ctx, 'Nothing to undo yet.');
      return;
    }
    if (edit.removed) {
      restoreDeleted(ctx, edit);
      return;
    }
    const current = ctx.state.objects.find((o) => o.id === edit.objectId);
    if (!current || current.revision !== edit.revision || !intact(current)) {
      notice(ctx, 'The most recent edit is stale or that thing was destroyed; it cannot be undone safely.');
      return;
    }
    if (ctx.state.jobs.some((j) => active(j) && j.userId !== ROOK)) {
      notice(ctx, 'Wait for current requests to finish before undoing.');
      return;
    }
    const round = ctx.state.jobs.find((j) => active(j) && j.userId === ROOK);
    if (round) fail(ctx, round, 'Set aside for the operator.', false);
    transaction(ctx, () => {
      ctx.state.edits.pop();
      ctx.state.objects = ctx.state.objects.filter((o) => o.id !== edit.objectId);
      if (edit.previous) {
        // Undo restores the design, never the health: combat damage stays earned.
        const previous = {
          ...edit.previous,
          revision: current.revision + 1,
          health: ((current.health ?? 80) / (current.maxHealth ?? 80)) * (edit.previous.maxHealth ?? 80),
          damageRevision: current.damageRevision,
          lifecycle: current.lifecycle,
        };
        ctx.state.objects.push(previous);
        const older = [...ctx.state.edits].reverse().find((e) => e.objectId === previous.id);
        if (older) older.revision = previous.revision;
      }
      ctx.state.worldRevision++;
      ctx.state.notice = `Undid the last change to ${current.blueprint.name}.`;
    });
    speak(ctx, ctx.state.notice);
  }
  const view = (j: Job): SafehouseJobView => ({
    id: j.id,
    label: j.label,
    requestedBy: j.username,
    status: j.status,
    progress: j.status === 'complete' ? 1 : j.workedMs / j.workMs,
    error: j.error,
    preview: j.preview,
  });
  return {
    meta: { id: 'safehouse', name: 'Corner House', stateVersion: STATE_VERSION },
    stateSchema,
    createInitialState: () => {
      const state = createInitialState();
      if (options.seedScenery ?? true) state.objects = [...sceneryObjects(), ...fenceObjects()];
      return state;
    },
    migrate: migrateState,
    reset(previous) {
      // Cost controls are the operator's, not the world's: a reset keeps them.
      const fresh = createInitialState();
      if (options.seedScenery ?? true) fresh.objects = [...sceneryObjects(), ...fenceObjects()];
      fresh.callsRemaining = previous.callsRemaining;
      fresh.allowanceEnforced = previous.allowanceEnforced;
      fresh.callsUsed = previous.callsUsed;
      fresh.generationPaused = previous.generationPaused;
      fresh.repairsPaused = previous.repairsPaused;
      fresh.neighboursPaused = previous.neighboursPaused;
      fresh.surveyPaused = previous.surveyPaused;
      fresh.surveyCallsRemaining = previous.surveyCallsRemaining;
      fresh.surveyCallsUsed = previous.surveyCallsUsed;
      fresh.privileged = previous.privileged;
      fresh.crowdHidden = previous.crowdHidden;
      fresh.wildlifePaused = previous.wildlifePaused;
      fresh.lighting = previous.lighting;
      fresh.notice = 'Fresh start. The neighborhood is back the way it was — build something.';
      return fresh;
    },
    start(ctx) {
      stopped = false;
      pending = undefined;
      inbox = undefined;
      nextRepairAt = 0;
      repairSkips.clear();
      tacticsPrimed = false;
      seenTraps.clear();
      seenMusic.clear();
      nextHeldLineAt = nextDanceLineAt = 0;
      verbsPrimed = false;
      seenVerbWords.clear();
      firstVerbDone.clear();
      nextVerbLineAt = nextFirstVerbLineAt = nextFightLineAt = nextDriveLineAt = 0;
      speechUntil = 0;
      nextIdleLineAt = 0;
      nextWorkLineAt = 0;
      preempted = false;
      talking = false;
      reactions = [];
      lastVoiced = undefined;
      lastSpokenAt = 0;
      houseHitWave = houseHalfWave = 0;
      lastHouseHealth = undefined;
      nextLegAt = 0;
      nextCreatureLineAt = 0;
      idleSince = 0;
      restSpot = undefined;
      nextNeighbourLineAt = 0;
      lastBigCrowdAt = 0;
      resetNeighbourMemory();
      neighbourDesign = undefined;
      neighbourInbox = undefined;
      askedWishes.clear();
      blockSurvey = undefined;
      surveyInbox = undefined;
      askedSurveys.clear();
      recent.length = 0;
      resetWildlifeMemory();
      resetCrowdMemory();
      resetVerbMemory();
      nextHonkLineAt = nextDanceCrowdLineAt = nextBrickLineAt = 0;
      transaction(ctx, () => {
        // Pieces an older save built under a neighbour's former name take the current one.
        if (adoptNames(ctx.state)) ctx.state.worldRevision++;
        // Saves from before uses and animations: the trees learn to sway, the fence becomes a perch.
        if (adoptLife(ctx.state)) ctx.state.worldRevision++;
        // A run or a scrap does not survive a restart: the car is drawn where it is parked, the creature gets on with it.
        for (const o of ctx.state.objects) {
          if (o.driven) delete o.driven;
          if (o.creature?.busyMs) o.creature.busyMs = 0;
        }
        for (const job of ctx.state.jobs) {
          if (job.status === 'designing') job.status = 'queued';
        }
        const current = ctx.state.jobs.find(active);
        ctx.state.survivor.activity =
          current?.status === 'building'
            ? current.operation === 'repair' || current.operation === 'rebuild'
              ? 'repairing'
              : 'building'
            : current?.status === 'walking'
              ? 'walking'
              : 'idle';
      });
      return () => {
        stopped = true;
        pending?.controller.abort();
        pending = undefined;
        inbox = undefined;
        neighbourDesign?.controller.abort();
        neighbourDesign = undefined;
        neighbourInbox = undefined;
        blockSurvey?.controller.abort();
        blockSurvey = undefined;
        surveyInbox = undefined;
      };
    },
    /**
     * Every arriving message, before classification: whoever speaks gets (or keeps) a figure on the
     * pavement across the street (crowd.ts). Nothing is held; this is the audience, not admission.
     */
    receiveMessage(ctx, msg) {
      if (msg.username.length > 40) return;
      const { first, count } = noteChatter(ctx.state, msg, ctx.now);
      if (first) react(ctx, 'crowd:first', { user: msg.username });
      else if (count >= 10 && (!lastBigCrowdAt || ctx.now - lastBigCrowdAt >= 600_000)) {
        lastBigCrowdAt = ctx.now;
        react(ctx, 'crowd:many');
      }
    },
    chatThrottleMs: 0,
    quickClassify: () => ({ intent: 'request' }),
    fallbackIntent: 'request',
    intents: [
      {
        name: 'request',
        description: 'Request a creation, edit or conversation',
        examples: ['Build a greenhouse'],
        handle: admit,
      },
    ],
    events: [],
    tickMs: 500,
    tick,
    persona: rookPersona,
    /** Parts for an id+revision the page has seen in a snapshot: standing, archived, or the ghost in flight. */
    objectParts(state, id, revision) {
      const standing = [...state.objects, ...state.combat.archive].find((o) => o.id === id && o.revision === revision);
      if (standing) return standing.blueprint.parts;
      const ghost = state.jobs.find((j) => active(j) && j.preview?.id === id && j.preview.revision === revision);
      return ghost?.preview?.blueprint.parts;
    },
    adminActions: [
      {
        id: 'safehouse-combat-start',
        label: 'Start zombie simulation',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.combat.paused = false;
            const w = ctx.state.combat.wave;
            ctx.state.notice =
              w.phase === 'prep'
                ? `Zombies are active. Wave ${w.number} in ${Math.max(0, Math.round((w.phaseEndsAt - ctx.state.combat.time) / 1000))} s — get your defenses up.`
                : `Zombies are active. Wave ${w.number} is on.`;
          });
        },
      },
      {
        id: 'safehouse-combat-pause',
        label: 'Pause zombie simulation',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.combat.paused = true;
            ctx.state.notice = 'Zombie simulation paused.';
          });
        },
      },
      {
        id: 'safehouse-zombies',
        label: 'Send three zombies',
        run(ctx) {
          transaction(ctx, () => {
            spawnGroup(ctx.state.combat, 3);
            ctx.state.notice =
              'Three zombies at the neighborhood edge. Start simulation to let them approach.';
          });
        },
      },
      {
        id: 'safehouse-wave-next',
        label: 'Start the next wave now',
        run(ctx) {
          transaction(ctx, () => {
            const w = ctx.state.combat.wave;
            if (w.phase !== 'prep') {
              ctx.state.notice = `Wave ${w.number} is already on.`;
              return;
            }
            w.phaseEndsAt = ctx.state.combat.time;
            ctx.state.combat.paused = false;
            ctx.state.notice = `Wave ${w.number} called in early.`;
          });
        },
      },
      {
        id: 'safehouse-day',
        label: 'Daylight',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.lighting = 'day';
          });
        },
      },
      {
        id: 'safehouse-night',
        label: 'After dark',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.lighting = 'night';
          });
        },
      },
      { id: 'safehouse-undo', label: 'Undo last creation/edit', run: undo },
      {
        id: 'safehouse-pause',
        label: 'Pause AI generation',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.generationPaused = true;
            ctx.state.notice = 'AI generation paused. Existing work will finish.';
          });
        },
      },
      {
        id: 'safehouse-resume',
        label: 'Resume AI generation',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.generationPaused = false;
            ctx.state.notice = 'AI generation resumed.';
          });
        },
      },
      {
        id: 'safehouse-repairs-pause',
        label: "Pause Rook's repairs",
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.repairsPaused = true;
            ctx.state.notice = 'Rook is off repair duty. Damage stays until someone asks.';
          });
        },
      },
      {
        id: 'safehouse-repairs-resume',
        label: "Resume Rook's repairs",
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.repairsPaused = false;
            ctx.state.notice = 'Rook is back on repairs.';
          });
        },
      },
      {
        id: 'safehouse-neighbours-pause',
        label: 'Stand the neighbours down',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.neighboursPaused = true;
            ctx.state.notice = 'The neighbours are staying indoors. Rook covers their repairs meanwhile.';
          });
        },
      },
      {
        id: 'safehouse-neighbours-resume',
        label: 'Let the neighbours out',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.neighboursPaused = false;
            ctx.state.notice = 'The neighbours are back out and about.';
          });
        },
      },
      {
        id: 'safehouse-survey-pause',
        label: 'Stop the neighbours reading the block',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.surveyPaused = true;
            ctx.state.notice = 'The neighbours will keep the theme they have and stop reading the block.';
          });
        },
      },
      {
        id: 'safehouse-survey-resume',
        label: 'Let the neighbours read the block',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.surveyPaused = false;
            ctx.state.notice = 'The neighbours are watching what the street builds again.';
          });
        },
      },
      {
        id: 'safehouse-survey-allowance',
        label: 'Set block-reading allowance',
        input: { label: 'calls', min: 0, max: 1_000_000, step: 1, placeholder: '40' },
        run(ctx, value) {
          transaction(ctx, () => {
            const next = Math.round(typeof value === 'number' ? value : (ctx.state.surveyCallsRemaining ?? defaultSurveyAllowance()));
            ctx.state.surveyCallsRemaining = Math.max(0, next);
            ctx.state.notice = `Block readings: ${ctx.state.surveyCallsRemaining} calls left.`;
          });
        },
      },
      {
        id: 'safehouse-wildlife-pause',
        label: 'Send the wildlife away',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.wildlifePaused = true;
            ctx.state.notice = 'The birds, the cat and the rats have made themselves scarce.';
          });
        },
      },
      {
        id: 'safehouse-wildlife-resume',
        label: 'Let the wildlife back',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.wildlifePaused = false;
            ctx.state.notice = 'The block has its birds back.';
          });
        },
      },
      {
        id: 'safehouse-crowd-hide',
        label: 'Hide the crowd',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.crowdHidden = true;
            ctx.state.notice = 'The pavement is clear: viewers are not drawn on the stream.';
          });
        },
      },
      {
        id: 'safehouse-crowd-show',
        label: 'Show the crowd',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.crowdHidden = false;
            ctx.state.notice = 'Viewers who speak in chat stand on the pavement across the street again.';
          });
        },
      },
      {
        id: 'safehouse-allowance',
        label: 'Reset AI call allowance',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.callsRemaining = defaultAllowance();
            ctx.state.notice = `AI allowance reset to ${ctx.state.callsRemaining} calls.`;
          });
        },
      },
      {
        id: 'safehouse-allowance-set',
        label: 'Set AI call allowance',
        input: { label: 'calls', min: 0, max: 1_000_000, step: 1, placeholder: '200' },
        run(ctx, value) {
          transaction(ctx, () => {
            ctx.state.callsRemaining = Math.round(typeof value === 'number' ? value : ctx.state.callsRemaining);
            ctx.state.notice = `AI allowance set to ${ctx.state.callsRemaining} calls${ctx.state.allowanceEnforced === false ? ' (not enforced right now)' : ''}.`;
          });
        },
      },
      {
        id: 'safehouse-allowance-off',
        label: 'Ignore the AI call limit',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.allowanceEnforced = false;
            ctx.state.notice = 'AI call limit ignored: every request may spend a model call. Calls are still counted.';
          });
        },
      },
      {
        id: 'safehouse-allowance-on',
        label: 'Enforce the AI call limit',
        run(ctx) {
          transaction(ctx, () => {
            ctx.state.allowanceEnforced = true;
            ctx.state.notice = `AI call limit enforced: ${ctx.state.callsRemaining} calls left.`;
          });
        },
      },
      {
        id: 'safehouse-trust',
        label: 'Trust a chatter',
        input: { kind: 'text', label: 'username', placeholder: 'kick username', maxLength: 40 },
        run(ctx, value) {
          const name = String(value ?? '').trim().toLowerCase();
          if (!name) return;
          transaction(ctx, () => {
            const list = ctx.state.privileged ?? [];
            ctx.state.privileged = list.includes(name) ? list : [...list, name].slice(-100);
            ctx.state.notice = `${name} is trusted: no time limit on their designs, and !delete <name> works for them.`;
          });
        },
      },
      {
        id: 'safehouse-untrust',
        label: 'Untrust a chatter',
        input: { kind: 'text', label: 'username', placeholder: 'kick username', maxLength: 40 },
        run(ctx, value) {
          const name = String(value ?? '').trim().toLowerCase();
          if (!name) return;
          transaction(ctx, () => {
            ctx.state.privileged = (ctx.state.privileged ?? []).filter((n) => n !== name);
            ctx.state.notice = `${name} is back on the usual rules.`;
          });
        },
      },
      {
        id: 'safehouse-forgive',
        label: 'Forgive a chatter',
        input: { kind: 'text', label: 'username', placeholder: 'kick username', maxLength: 40 },
        run(ctx, value) {
          const name = String(value ?? '').trim().toLowerCase();
          if (!name) return;
          transaction(ctx, () => {
            // Everyone lets it go at once: the neighbours' tables (neighbours.ts) and Rook's own.
            forgive(ctx.state, name);
            if (ctx.state.grudges) delete ctx.state.grudges[name];
            ctx.state.notice = `${name} is forgiven, by everyone.`;
          });
        },
      },
      {
        id: 'safehouse-forgive-all',
        label: 'Forgive everyone',
        run(ctx) {
          transaction(ctx, () => {
            forgive(ctx.state);
            ctx.state.grudges = undefined;
            ctx.state.notice = 'Clean slate. Nobody on the block holds anything against anyone.';
          });
        },
      },
      {
        id: 'safehouse-retry',
        label: 'Retry last failed request',
        run(ctx) {
          const job = [...ctx.state.jobs].reverse().find((j) => j.status === 'failed');
          if (!job) {
            notice(ctx, 'No failed request to retry.');
            return;
          }
          admit(ctx, {
            id: `retry:${crypto.randomUUID()}`,
            userId: job.userId,
            username: job.username,
            text: job.text,
            ts: ctx.now,
            source: 'dev',
          });
        },
      },
    ],
    tuning: {},
    layout: { width: 1920, height: 1080, worldWidth: 1920, protagonistHomeX: 0, walkSpeedPxPerSec: 1 },
    buildScene(state, engine) {
      const live = state.jobs.filter(active);
      const payload: SafehouseScene = {
        schema: 1,
        fixture,
        lighting: state.lighting,
        // Geometry travels separately (objectParts below); the snapshot carries the rest.
        objects: state.objects.map(viewOf),
        combat: { ...state.combat, archive: state.combat.archive.map(viewOf) },
        survivor: state.survivor,
        current: live[0] ? view(live[0]) : undefined,
        pending: live.slice(1).map(view),
        recent: state.jobs
          .filter((j) => !active(j))
          .slice(-6)
          .map(view),
        notice: state.notice,
        generationAvailable: available,
        generationPaused: state.generationPaused,
        callsRemaining: state.callsRemaining,
        allowanceEnforced: state.allowanceEnforced !== false,
        callsUsed: state.callsUsed ?? 0,
        worldRevision: state.worldRevision,
        repairsPaused: state.repairsPaused ?? false,
        upcomingWave: describeRoster(waveRoster(state.combat.wave.number)),
        crowd: crowdViews(state, engine.now),
        crowdHidden: state.crowdHidden ?? false,
        verbs: verbViews(state),
        hoops: hoopsBoard(state, engine.now),
        ...(state.effects?.length ? { effects: state.effects } : {}),
        neighbours: neighboursOn ? neighbourViews(state) : [],
        neighboursPaused: state.neighboursPaused ?? false,
        wildlifePaused: state.wildlifePaused ?? false,
      };
      return {
        width: 1920,
        height: 1080,
        worldWidth: 1920,
        bg: '#28332c',
        entities: [],
        protagonist: { name: 'Rook', x: 0, y: 0, state: 'idle' },
        speech: engine.speech,
        safehouse: payload,
        hud: {
          title: 'Corner House',
          meters: [],
          counters: [],
          board: [],
          queue: { pending: [] },
          logLines: [],
          pinned: 'Tell me what to build.',
        },
      };
    },
  };
}
export const safehouseWorld = createSafehouseWorld();

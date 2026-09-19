import crypto from 'node:crypto';
import type { WorldModule, WorldCtx, ChatMessage } from '../../engine/world';
import {
  viewOf,
  type SafehouseJobView,
  type SafehouseScene,
  type SafehouseObject,
  type GroundPoint,
} from '../../shared/safehouseTypes';
import { config } from '../../config';
import { generateBlueprint, fixtureGenerator, type DesignGenerator } from '../../llm/blueprint';
import {
  CHAT_LIMITS,
  SCENERY_LIMITS,
  measureBlueprint,
  validateResponse,
  type DesignResponse,
} from './blueprint';
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
  areaCandidates,
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
} from './combat';
import { tickCreatures, freshCreature } from './creatures';
import { parseRequest, applyQuickEdit, rotateBlueprint, relativeCandidates } from './edits';
import { sceneryObjects } from './scenery';
import { migrateState, defaultAllowance } from './state';
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
class CheckpointError extends Error {}
/** userId of the jobs Rook gives himself; never a chat user. */
const ROOK = 'rook';
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
  /** Whether a model call may start: fixture mode is free, the operator may ignore the allowance, else it must have calls left. */
  const allowanceOpen = (state: SafehouseState) =>
    fixture || state.allowanceEnforced === false || state.callsRemaining > 0;
  /** Book a model call: always counted, taken off the allowance only while it is enforced. */
  function bookCall(state: SafehouseState) {
    if (fixture) return;
    state.callsUsed = (state.callsUsed ?? 0) + 1;
    if (state.allowanceEnforced !== false) state.callsRemaining = Math.max(0, state.callsRemaining - 1);
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
  function admit(ctx: Ctx, msg: ChatMessage) {
    if (ctx.state.seen.includes(msg.id)) return;
    if (msg.text.length > 1000 || msg.username.length > 40) {
      notice(ctx, 'Keep requests under 1,000 characters and names under 40.');
      return;
    }
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
        });
        trim(ctx.state);
        ctx.state.notice = `Queued ${msg.username}'s request.`;
      });
      speak(ctx, `Got your idea, ${msg.username}. It's in the queue.`);
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
      if (living && !target?.creature && ctx.state.objects.filter((o) => o.creature && intact(o)).length >= MAX_CREATURES)
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
      const placement = choosePlacement(
        size,
        ctx.state.objects,
        ctx.state.survivor.position,
        target,
        requested,
      );
      transaction(ctx, () => {
        job.preview = {
          id: target?.id ?? crypto.randomUUID(),
          revision: (target?.revision ?? 0) + 1,
          blueprint: result.blueprint,
          position: placement.position,
          footprint: size,
          createdBy: target?.createdBy ?? job.username,
          editedBy: job.username,
          createdAt: target?.createdAt ?? ctx.now,
          role:
            job.operation === 'turret' || job.operation === 'barrier'
              ? job.operation
              : (target?.role ?? (result.action === 'build' ? result.role : undefined) ?? 'decoration'),
          fixed: target?.fixed,
          passable: target?.passable,
          creature: living
            ? freshCreature(living.behaviour, !!living.flying)
            : target?.creature
              ? structuredClone(target.creature)
              : undefined,
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
    transaction(ctx, () => {
      job.status = 'designing';
      job.attempts++;
      bookCall(ctx.state);
      ctx.state.idlePath = [];
      ctx.state.survivor.activity = 'idle';
      ctx.state.notice = `Designing ${job.username}'s idea…`;
    });
    nextLegAt = 0;
    nextWorkLineAt = ctx.now + 6000 + ctx.rng() * 4000; // a line or two while he paces
    const controller = new AbortController(),
      catalog = new Map(ctx.state.objects.map((o) => [o.id, o.revision]));
    pending = { id: job.id, controller, deadline: ctx.now + 95000, catalog };
    const input = {
      text: job.text,
      username: job.username,
      objects: structuredClone(ctx.state.objects),
      targetId: job.resolvedTarget,
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
    const pick = pickRepairTarget(
      ctx.state.objects,
      ctx.state.combat.archive,
      ctx.state.survivor.position,
      (id) => (repairSkips.get(id) ?? 0) > ctx.now,
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
    for (const e of life.events) {
      const by = ctx.state.objects.find((o) => o.id === e.id);
      if (e.kind === 'hit' && by && isHostile(by) && ctx.now >= nextCreatureLineAt) {
        if (mutter(ctx, 'creature:rampage', { name: speakName(by) })) nextCreatureLineAt = ctx.now + 40000;
      }
      if (e.kind === 'down') {
        const fallen = [...ctx.state.objects, ...ctx.state.combat.archive].find((o) => o.id === e.targetId);
        if (fallen?.creature) react(ctx, 'creature:down', { name: speakName(fallen) });
      }
    }
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
      if (
        !ctx.state.idlePath.length &&
        Math.hypot(pos.x - SURVIVOR_START.x, pos.z - SURVIVOR_START.z) > 0.2
      ) {
        ctx.state.idlePath = straighten(route(pos, SURVIVOR_START, ctx.state.objects) ?? []);
      }
      if (!stroll(ctx, dt)) {
        ctx.state.survivor.activity = 'idle';
        idleLine(ctx);
      }
      return;
    }
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
        job!.status = 'complete';
        delete job!.preview;
        job!.path = [];
        ctx.state.survivor.activity = 'idle';
        ctx.state.notice =
          job!.userId === ROOK
            ? `${job!.operation === 'rebuild' ? 'Rebuilt' : 'Patched up'} ${preview.blueprint.name}.`
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
  function undo(ctx: Ctx) {
    const edit = ctx.state.edits.at(-1);
    if (!edit) {
      notice(ctx, 'Nothing to undo yet.');
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
      recent.length = 0;
      transaction(ctx, () => {
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
      };
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
            ctx.state.callsRemaining = Math.round(value ?? ctx.state.callsRemaining);
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

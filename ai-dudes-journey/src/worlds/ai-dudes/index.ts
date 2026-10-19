// AI DUDES: an empty field where every chatter gets a dude, and every dude is run by that
// chatter's own agent. Chat is not classified or queued behind a single protagonist: each message
// goes straight into its chatter's inbox, and agents take turns in parallel (a pool of
// DUDES_AGENT_CONCURRENCY), each turn answering everything its chatter said since the last one.
// Builds are designed in a second pool (DUDES_DESIGN_CONCURRENCY) and then every dude walks over
// and puts its own up at the same time as everyone else's. The agents answer in a closed grammar
// (agent.ts); this file turns that into world changes, and sim.ts runs the clockwork.
import { config } from '../../config';
import type { AdminAction, WorldCtx, WorldModule } from '../../engine/world';
import { chatCompletion } from '../../llm/openrouter';
import { shortRef, viewOf, type GroundPoint, type SafehouseObject } from '../../shared/objectTypes';
import type { DudeView, DudesAdminStatus, DudesScene, Emote } from '../../shared/dudesTypes';
import { agentInput, defaultLook, parseAgentText, type AgentAction, type AgentFn, type AgentReply } from './agent';
import { DESIGN_SYSTEM, designMessage, parseDesign, type DesignFn } from './design';
import { fixtureAgent, fixtureDesign } from './fixtures';
import { sendDude, overhear, placeJob, tickDudes, awake, isActive, startUse, endUse, inUse, startChop, AWAKE_MS, HOLD_MS } from './sim';
import { GROUND, clampToGround, spawnPoint } from './placement';
import { campOf, journeyOf, journeyView, sceneryNear, syncGround, tickJourney, travelling } from './journey';
import { bossKind, bossOf } from './boss';
import { gettingClose, landmarkDesigned, landmarkView, madeIt, setOffAgain, tickLandmark, LANDMARK } from './landmark';
import { challengeNow, challengeOf, challengeView, crossingOpen, isAcross, riverOf, riverPlace, startProject, startSwim, swimming, tickChallenges } from './challenge';
import { damageOf, happeningView, startHappening, tickEvents } from './events';
import { knockedOut, startAttack } from './combat';
import { applyReading, backfill, chatFromLog, due, fixtureListener, listen, listenerInput, listenerOf, REFUSAL, wishesMarkdown, wishViews, type ListenerFn } from './listener';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIMITS,
  STATE_VERSION,
  freshState,
  nextId,
  pushFeed,
  pushLine,
  resetState,
  stateSchema,
  type Dude,
  type DudesState,
  type Job,
} from './state';

export interface DudesOptions {
  agent: AgentFn;
  design: DesignFn;
  fixture: boolean;
  /** A key is configured (or fixtures are on): model calls can happen at all. */
  available: boolean;
  agentLimit: number;
  designLimit: number;
  allowance: number;
  agentModel: string;
  designModel: string;
  /** Minimum gap between one dude's turns; messages that arrive inside it wait and go together. */
  turnGapMs?: number;
  /** The Listener's model call, and where its backlog document goes (none in tests). */
  listener?: ListenerFn;
  listenerModel?: string;
  writeWishes?: (markdown: string) => void;
  /** The Builder's attempts (data/builder/attempts.json), for the admin page. */
  readProposals?: () => NonNullable<DudesAdminStatus['listener']>['proposals'];
  /** Earlier chat for the Listener's first reading (the engine's terminal log). */
  readChatLog?: () => ReturnType<typeof chatFromLog>;
}

/** Live model calls. A turn is small and fast; a design is big and slow, like the safehouse's. */
export function liveAgent(model: string): AgentFn {
  return async (turn, signal) =>
    parseAgentText(
      await chatCompletion({
        model,
        system: turn.system,
        messages: [{ role: 'user', content: turn.content }],
        json: true,
        temperature: 0.85,
        maxTokens: 900,
        timeoutMs: 45_000,
        attempts: 1,
        signal,
      }),
    );
}
export function liveListener(model: string): ListenerFn {
  return async (input, signal) => {
    const raw = await chatCompletion({
      model,
      system: input.system,
      messages: [{ role: 'user', content: input.content }],
      json: true,
      temperature: 0.3,
      maxTokens: 12_000,
      reasoning: { max_tokens: 3000, exclude: true },
      timeoutMs: 150_000,
      attempts: 1,
      signal,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('listener answered without JSON');
    return JSON.parse(match[0]) as unknown;
  };
}
export function liveDesign(model: string): DesignFn {
  return async (input, signal) =>
    parseDesign(
      await chatCompletion({
        model,
        system: DESIGN_SYSTEM,
        messages: [{ role: 'user', content: designMessage(input) }],
        json: true,
        temperature: 0.7,
        maxTokens: 14_000,
        reasoning: { max_tokens: 2500, exclude: true }, // thinking must not eat the geometry
        timeoutMs: 150_000,
        attempts: 1,
        signal,
      }),
      !!input.target,
    );
}

const lower = (s: string) => s.trim().toLowerCase();
/** A chat line as it goes in a speech bubble: one line, no links, not too long. */
const sayable = (text: string) =>
  text
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.say);
const sayMs = (text: string) => Math.max(4000, Math.min(12_000, 2500 + text.length * 70));

/** Best match for a name the agent wrote among some named things: exact, then contains, then shared words. */
export function matchName<T>(phrase: string, items: T[], nameOf: (t: T) => string): T | undefined {
  const p = lower(phrase).replace(/^(the|my|a|an)\s+/, '').replace(/^@/, '');
  if (!p) return undefined;
  const ref = p.replace(/^#/, '');
  const exact = items.find((t) => lower(nameOf(t)) === p);
  if (exact) return exact;
  const contains = items.filter((t) => lower(nameOf(t)).includes(p) || p.includes(lower(nameOf(t))));
  if (contains.length) return contains.sort((a, b) => nameOf(a).length - nameOf(b).length)[0];
  const words = new Set(p.split(/\W+/).filter((w) => w.length > 2));
  let best: T | undefined,
    score = 0;
  for (const t of items) {
    const s = lower(nameOf(t))
      .split(/\W+/)
      .filter((w) => words.has(w) || words.has(w.replace(/s$/, ''))).length;
    if (s > score) [best, score] = [t, s];
  }
  return best ?? items.find((t) => (t as { id?: string }).id && shortRef((t as unknown as { id: string }).id) === ref);
}

export function createAiDudesWorld(opts: DudesOptions): WorldModule<DudesState> {
  const turnGapMs = opts.turnGapMs ?? 2500;
  /** A character reacting to something on its own waits this long after its last turn. */
  const NUDGE_GAP_MS = 15_000;
  /** Idle life: one quiet character gets a turn of its own about this often. */
  const IDLE_TURN_MS = 40_000;
  let nextIdleAt = 0;
  // In flight right now (never saved): which dudes' agents are mid-turn, which designs are out.
  const agentCalls = new Map<string, AbortController>();
  const designCalls = new Map<string, AbortController>();
  let live: WorldCtx<DudesState> | undefined;
  const ctxOf = (ctx: WorldCtx<DudesState>) => live ?? ctx;

  /** One model call against the allowance; false when the operator's limit is reached. */
  function reserveCall(state: DudesState): boolean {
    if (state.ai.enforced && state.ai.callsRemaining <= 0) return false;
    if (state.ai.enforced) state.ai.callsRemaining--;
    state.ai.callsUsed++;
    return true;
  }

  const canCall = (state: DudesState) => opts.available && !state.ai.paused && !(state.ai.enforced && state.ai.callsRemaining <= 0);

  function pump(ctx: WorldCtx<DudesState>): void {
    pumpAgents(ctx);
    pumpDesigns(ctx);
  }

  // ---- agent turns ----------------------------------------------------------------------------
  function pumpAgents(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state;
    while (agentCalls.size < opts.agentLimit && canCall(state)) {
      const now = ctx.now;
      // Chat first, oldest waiting first; then characters reacting on their own to what happened to them.
      const free = state.dudes.filter((d) => !d.muted && !agentCalls.has(d.id));
      const next =
        free.filter((d) => d.inbox.length && now - d.lastTurnAt >= turnGapMs).sort((a, b) => a.inbox[0].at - b.inbox[0].at)[0] ??
        free.filter((d) => d.nudges?.length && awake(d, now) && now - d.lastTurnAt >= NUDGE_GAP_MS).sort((a, b) => a.lastTurnAt - b.lastTurnAt)[0];
      if (!next || !reserveCall(state)) return;
      startTurn(ctx, state, next, now);
    }
  }

  function startTurn(ctx: WorldCtx<DudesState>, state: DudesState, dude: Dude, now: number): void {
    const turn = agentInput(state, dude, now, AWAKE_MS);
    // What it is answering joins the conversation now, so a failed call still leaves it on record.
    for (const line of dude.inbox.splice(0)) pushLine(dude.history, line, LIMITS.history);
    dude.overheard = [];
    dude.nudges = undefined;
    dude.lastTurnAt = now;
    const ac = new AbortController();
    agentCalls.set(dude.id, ac);
    const id = dude.id;
    opts
      .agent(turn, ac.signal)
      .then((reply) => {
        if (ctx.state !== state) return; // the world was reset under this call
        const d = state.dudes.find((x) => x.id === id);
        if (d) applyReply(ctx, state, d, reply, ctx.now, turn.messages.length > 0);
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        const d = state.dudes.find((x) => x.id === id);
        if (d) {
          d.lastError = `agent: ${e.message}`.slice(0, 300);
          d.emote = { pose: 'think', until: ctx.now + 4000 };
        }
        ctx.log(`agent turn for ${turn.name} failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (agentCalls.get(id) === ac) agentCalls.delete(id);
        if (ctx.state === state) pump(ctx);
      });
  }

  function applyReply(ctx: WorldCtx<DudesState>, state: DudesState, dude: Dude, reply: AgentReply, now: number, prompted = true): void {
    dude.turns++;
    dude.lastTurnAt = now;
    dude.lastError = undefined;
    if (reply.persona) dude.persona = reply.persona;
    if (reply.title) dude.title = reply.title;
    if (reply.look) dude.look = { ...dude.look, ...reply.look };
    for (const fact of reply.remember ?? []) pushLine(dude.memory, fact, LIMITS.memory);
    // The chatter's own words are the character's speech (see `hear`); the agent speaks for itself
    // only on a turn of its own, reacting to something that happened to it.
    // A refusal is still worth hearing about, even when nobody sees it said.
    if (reply.say && REFUSAL.test(reply.say)) listen(state, 'refused', dude.name, reply.say, now);
    if (reply.say && !prompted) {
      dude.say = { text: reply.say, until: now + sayMs(reply.say) };
      pushLine(dude.history, { from: 'dude', text: reply.say, at: now }, LIMITS.history);
      overhear(state, dude, reply.say, now);
      // Mirrors to Kick only while the operator's replies toggle is on; always lands in the log.
      ctx.say(`@${dude.name} ${reply.say}`, { toKick: true });
    }
    for (const action of reply.actions) {
      // A turn of the agent's own (nobody in chat asked) may talk, move, use and fix, but not start
      // builds or fights: those cost designs or start feuds that would run on without anyone asking.
      if (!prompted && (action.do === 'build' || action.do === 'attack')) continue;
      const note = act(state, dude, action, now, ctx.rng);
      if (note) {
        pushLine(dude.history, { from: 'world', text: note, at: now }, LIMITS.history);
        listen(state, 'failed', dude.name, note, now);
      }
    }
    pump(ctx);
  }

  /** Where "near X" / "to X" points: a dude, a build, the middle, the edge, or right here. */
  function placeOf(state: DudesState, dude: Dude, phrase: string | undefined, rng: () => number): GroundPoint | undefined {
    const p = lower(phrase ?? 'me');
    if (!p || p === 'me' || p === 'here' || p === 'myself') return dude.position;
    if (/^(centre|center|middle|the group|group|everyone|camp)/.test(p)) return campOf(state);
    const river = riverPlace(state, p, dude, rng);
    if (river) return river;
    // The boss: straight at it (a vehicle driven "to" the boss rams it).
    const boss = bossOf(state);
    if (boss && boss.hp > 0 && (matchName(p, [boss], (b) => bossKind(b.kindId).name) || /^(the )?(boss|monster|creature|giant|beast)$/.test(p))) return { ...boss.position };
    if (/^(ahead|front|forward|the front|lead|onward)/.test(p)) {
      const c = campOf(state);
      return clampToGround({ x: c.x + (rng() * 2 - 1) * 4, z: c.z - 10 - rng() * 6 }, 2);
    }
    if (/^(back|behind|the back|rear)/.test(p)) {
      const c = campOf(state);
      return clampToGround({ x: c.x + (rng() * 2 - 1) * 4, z: c.z + 14 + rng() * 6 }, 2);
    }
    if (p === 'wander' || p === 'around' || p === 'anywhere') {
      const a = rng() * Math.PI * 2,
        r = 4 + rng() * 8;
      return { x: dude.position.x + Math.cos(a) * r, z: dude.position.z + Math.sin(a) * r };
    }
    if (p === 'edge') {
      // The edge of the glade, on the nearer side.
      const x = dude.position.x,
        z = dude.position.z;
      const options = [clampToGround({ x: GROUND.bounds.minX, z }, 2), clampToGround({ x: GROUND.bounds.maxX, z }, 2)];
      return options.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    }
    const other = matchName(p, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name);
    if (other) {
      // Stand beside them, on the side we are coming from.
      const dx = dude.position.x - other.position.x,
        dz = dude.position.z - other.position.z,
        d = Math.hypot(dx, dz) || 1;
      return { x: other.position.x + (dx / d) * 1.4, z: other.position.z + (dz / d) * 1.4 };
    }
    const tree = /\b(tree|pine|oak|birch|boulder|rock)\b/.test(p) ? sceneryNear(state, dude.position, 12).find((s) => p.includes(s.name.split(' ')[0]) || /\btree\b/.test(p) && s.item.kind !== 'boulder' || /\b(boulder|rock)\b/.test(p) && s.item.kind === 'boulder') : undefined;
    if (tree) {
      const dx = dude.position.x - tree.item.x,
        dz = dude.position.z - tree.item.z,
        d = Math.hypot(dx, dz) || 1;
      return { x: tree.item.x + (dx / d) * 1.6, z: tree.item.z + (dz / d) * 1.6 };
    }
    const build = matchName(p, state.objects.filter((o) => !o.silhouette), (o) => o.blueprint.name);
    if (build) {
      const dx = dude.position.x - build.position.x,
        dz = dude.position.z - build.position.z,
        d = Math.hypot(dx, dz) || 1,
        reach = Math.max(build.footprint.width, build.footprint.depth) / 2 + 1;
      return { x: build.position.x + (dx / d) * reach, z: build.position.z + (dz / d) * reach };
    }
    return undefined;
  }

  /** Run one action; returns a line for the agent's next turn when something did not go as asked. */
  function act(state: DudesState, dude: Dude, action: AgentAction, now: number, rng: () => number): string | undefined {
    const mine = state.objects.filter((o) => o.owner === dude.id);
    // A shape in the mist far down the path is not something anyone can walk up to and use yet.
    const visible = state.objects.filter((o) => !o.silhouette);
    const active = state.jobs.filter((j) => j.dudeId === dude.id && isActive(j));
    const busy = active.some((j) => j.status === 'walking' || j.status === 'building');
    if (knockedOut(dude, now)) return `you were knocked out, so you could not ${action.do}`;
    // Anything new the body is asked to do replaces the little errands it was on.
    if (action.do !== 'emote' && action.do !== 'show') {
      dude.explore = undefined;
      dude.meet = undefined;
      if (action.do !== 'follow') dude.follow = undefined;
      if (action.do !== 'chop') dude.chop = undefined;
    }
    const others = () => state.dudes.filter((d) => d.id !== dude.id);
    switch (action.do) {
      case 'explore': {
        if (busy) return 'you were busy building, so you did not wander off';
        endUse(state, dude, now);
        dude.explore = { until: now + 25_000 };
        dude.idleUntil = now + 25_000;
        return undefined;
      }
      case 'greet': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        if (busy) return `you were busy building, so you did not go over to ${other.name}`;
        endUse(state, dude, now);
        dude.meet = { dudeId: other.id, how: action.how, giveUpAt: now + 30_000 };
        return undefined;
      }
      case 'follow': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" to follow`;
        endUse(state, dude, now);
        dude.follow = { dudeId: other.id, until: now + 60_000 };
        return undefined;
      }
      case 'stop': {
        const was = dude.use?.phase === 'doing' && (dude.use.how === 'drive' || dude.use.how === 'ride') ? state.objects.find((o) => o.id === dude.use!.objectId) : undefined;
        endUse(state, dude, now);
        if (was) {
          pushLine(dude.history, { from: 'world', text: `you parked ${was.blueprint.name} and got out`, at: now }, LIMITS.history);
          pushFeed(state, now, `${dude.name} parked ${was.blueprint.name}`);
        }
        dude.follow = undefined;
        dude.attack = undefined;
        dude.emote = undefined;
        dude.idleUntil = undefined;
        if (dude.walkingFor === 'move') {
          dude.path = [];
          dude.walkingFor = undefined;
        }
        return undefined;
      }
      case 'chop': {
        if (busy) return 'you were busy building, so you did not go and chop a tree';
        const near = sceneryNear(state, dude.position, 12).filter((s) => s.item.kind !== 'boulder');
        const phrase = lower(action.target ?? '');
        const tree = near.find((s) => phrase && phrase.includes(s.item.kind)) ?? near[0];
        if (!tree) return 'there are no trees close enough to chop';
        return startChop(state, dude, tree.item.id, now);
      }
      case 'help':
      case 'hinder': {
        if (busy) return `you were busy building, so you did not ${action.do} the ${action.project || 'work'}`;
        return startProject(state, dude, action.project, action.do, now, rng);
      }
      case 'show': {
        dude.badgesOpenUntil = now + 15_000;
        return dude.badges?.length ? undefined : 'you have not earned any collectables yet; they come from getting through challenges on the journey';
      }
      case 'attack': {
        if (busy) return `you were busy building, so you did not attack ${action.target}`;
        const other = matchName(action.target, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name);
        if (other) {
          startAttack(state, dude, 'dude', other.id, action.with, now);
          return undefined;
        }
        // The boss, by its name or just as "the boss", "the monster", "it".
        const boss = bossOf(state);
        if (boss && boss.hp > 0 && (matchName(action.target, [boss], (b) => bossKind(b.kindId).name) || /\b(boss|monster|creature|giant|beast|troll|boar|gnarl|it|him)\b/i.test(action.target))) {
          startAttack(state, dude, 'boss', boss.id, action.with, now);
          return undefined;
        }
        const npc = matchName(action.target, state.npcs ?? [], (n) => n.name);
        if (npc) {
          startAttack(state, dude, 'npc', npc.id, action.with, now);
          return undefined;
        }
        const build = matchName(action.target, visible, (o) => o.blueprint.name);
        if (build && action.with === 'shove') return startUse(state, dude, build, 'push', undefined, now);
        if (build) {
          startAttack(state, dude, 'object', build.id, action.with, now);
          return undefined;
        }
        if (/^(me|myself|self)$/i.test(action.target.trim()) && action.with === 'bomb') {
          startAttack(state, dude, 'dude', dude.id, 'bomb', now);
          return undefined;
        }
        return `there is nobody and nothing called "${action.target}" here`;
      }
      case 'emote': {
        const hold = action.pose === 'sit' || action.pose === 'lie' || action.pose === 'think';
        dude.emote = { pose: action.pose as Emote, until: now + (hold ? HOLD_MS : action.pose === 'dance' ? 10_000 : 5000) };
        dude.idleUntil = Math.max(dude.idleUntil ?? 0, now + 20_000);
        return undefined;
      }
      case 'move': {
        if (busy) return `you were busy building, so you did not go to ${action.to}`;
        const to = placeOf(state, dude, action.to, rng);
        if (!to) return `there is nothing called "${action.to}" in the field`;
        // The far side of a river nobody has bridged or frozen: the only way on foot is to swim.
        const river = riverOf(state);
        if (river && !crossingOpen(river) && !dude.riding && !isAcross(river, dude.position) && isAcross(river, to)) return startSwim(state, dude, now, rng);
        endUse(state, dude, now);
        dude.emote = undefined;
        // Stay where you were sent a while before wandering again (on the walk, before catching up).
        dude.idleUntil = now + (travelling(state) ? 12_000 : 45_000);
        return sendDude(state, dude, to) ? undefined : `you could not find a way to ${action.to}`;
      }
      case 'build': {
        // At the river, a bridge is everyone's job: asking to build one means joining in.
        if (riverOf(state) && !challengeOf(state)?.outcome && /\bbridge\b/i.test(action.what)) return startProject(state, dude, 'bridge', 'help', now, rng);
        if (active.length >= LIMITS.jobsPerDude) return `you already have ${active.length} things on the go; they will finish soon`;
        if (state.objects.length + state.jobs.filter((j) => j.kind === 'build' && isActive(j)).length >= LIMITS.objects)
          return 'the field is full; nothing new can go up until someone removes something';
        const anchor = placeOf(state, dude, action.near, rng) ?? dude.position;
        const job: Job = { id: nextId(state, 'j'), dudeId: dude.id, kind: 'build', request: action.what.slice(0, 300), anchor, status: 'queued', createdAt: now };
        state.jobs.push(job);
        pushFeed(state, now, `${dude.name} is designing ${action.what.slice(0, 60)}`);
        return undefined;
      }
      case 'use': {
        if (busy) return `you were busy building, so you did not ${action.how} ${action.target}`;
        const target = matchName(action.target, visible, (o) => o.blueprint.name);
        if (!target) return `there is no build called "${action.target}" in the field`;
        if (target.id.startsWith('landmark') && (action.how === 'drive' || action.how === 'ride' || action.how === 'push')) return `${target.blueprint.name} does not move`;
        // Driving "to" a person means at them, not politely beside them: that is how people get run over.
        const victim = action.to && (action.how === 'drive' || action.how === 'ride') ? matchName(action.to, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name) : undefined;
        const to = victim ? { ...victim.position } : action.to ? placeOf(state, dude, action.to, rng) : undefined;
        if (action.to && !to) return `there is nothing called "${action.to}" to ${action.how} to`;
        return startUse(state, dude, target, action.how, to, now);
      }
      case 'edit':
      case 'remove': {
        const target = matchName(action.target, mine, (o) => o.blueprint.name);
        if (!target) {
          const theirs = matchName(action.target, state.objects, (o) => o.blueprint.name);
          return theirs ? `${theirs.blueprint.name} is ${theirs.createdBy}'s, not yours; you can only change your own builds` : `you have no build called "${action.target}"`;
        }
        if (active.some((j) => j.targetId === target.id)) return `you are already working on ${target.blueprint.name}`;
        const user = inUse(state, target.id);
        if (user) return `${user.name} is using ${target.blueprint.name} right now; try again when they are done`;
        if (active.length >= LIMITS.jobsPerDude) return `you already have ${active.length} things on; finish those first`;
        const job: Job =
          action.do === 'edit'
            ? { id: nextId(state, 'j'), dudeId: dude.id, kind: 'edit', request: action.change.slice(0, 300), targetId: target.id, anchor: target.position, status: 'queued', createdAt: now }
            : { id: nextId(state, 'j'), dudeId: dude.id, kind: 'remove', request: `take down ${target.blueprint.name}`.slice(0, 300), targetId: target.id, anchor: target.position, status: 'ready', createdAt: now };
        state.jobs.push(job);
        return undefined;
      }
    }
  }

  // ---- design calls ---------------------------------------------------------------------------
  function pumpDesigns(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state;
    while (designCalls.size < opts.designLimit && canCall(state)) {
      const designing = new Set(state.jobs.filter((j) => j.status === 'designing').map((j) => j.dudeId));
      // One design per dude at a time, oldest request first: a dude asking for five things does not starve the field.
      const job = state.jobs.filter((j) => j.status === 'queued' && !designing.has(j.dudeId)).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!job || !reserveCall(state)) return;
      startDesign(ctx, state, job);
    }
  }

  function startDesign(ctx: WorldCtx<DudesState>, state: DudesState, job: Job): void {
    const dude = state.dudes.find((d) => d.id === job.dudeId);
    const target = job.targetId ? state.objects.find((o) => o.id === job.targetId) : undefined;
    if (!dude || (job.kind === 'edit' && !target)) {
      job.status = 'failed';
      return;
    }
    job.status = 'designing';
    const ac = new AbortController();
    designCalls.set(job.id, ac);
    opts
      .design({ dudeName: dude.name, persona: dude.persona, request: job.request, ...(target ? { target: target.blueprint } : {}) }, ac.signal)
      .then((result) => {
        if (ctx.state !== state || job.status !== 'designing') return;
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (result.action === 'decline') {
          job.status = 'failed';
          listen(state, 'refused', d?.name ?? '?', `design declined "${job.request.slice(0, 80)}": ${result.reply}`, ctx.now);
          if (d) pushLine(d.history, { from: 'world', text: `the designer declined "${job.request.slice(0, 60)}": ${result.reply}`, at: ctx.now }, LIMITS.history);
          return;
        }
        job.blueprint = result.blueprint;
        job.reply = result.reply;
        try {
          placeJob(state, job);
          job.status = 'ready';
        } catch (e) {
          job.status = 'failed';
          if (d) {
            d.lastError = (e as Error).message;
            pushLine(d.history, { from: 'world', text: `${result.blueprint.name} could not go up: ${(e as Error).message}`, at: ctx.now }, LIMITS.history);
          }
        }
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        job.status = 'failed';
        job.error = e.message.slice(0, 300);
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (d) {
          d.lastError = `design: ${e.message}`.slice(0, 300);
          pushLine(d.history, { from: 'world', text: `designing "${job.request.slice(0, 60)}" failed; you can ask again`, at: ctx.now }, LIMITS.history);
        }
        ctx.log(`design for ${dude.name} failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get(job.id) === ac) designCalls.delete(job.id);
        if (ctx.state === state) pump(ctx);
      });
  }

  /** The streamer's landmark, designed once like any build; the stand-in tower holds its place meanwhile. */
  function designLandmark(ctx: WorldCtx<DudesState>, description: string): void {
    const state = ctx.state;
    if (!canCall(state) || !reserveCall(state)) return landmarkDesigned(state, undefined, ctx.now);
    const ac = new AbortController();
    designCalls.set('landmark', ac);
    opts
      .design(
        {
          dudeName: 'the forest',
          persona: 'Ancient, mysterious, a little magical. Something a whole crowd has walked a long way to see.',
          request: `${description}. A huge landmark at the end of a long forest path: as big as the limits allow (about 30 m), awe-inspiring, readable from far away.`,
        },
        ac.signal,
      )
      .then((result) => {
        if (ctx.state !== state) return;
        landmarkDesigned(state, result.action === 'decline' ? undefined : result.blueprint, ctx.now);
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        landmarkDesigned(state, undefined, ctx.now);
        ctx.log(`landmark design failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get('landmark') === ac) designCalls.delete('landmark');
      });
  }

  // ---- the Listener ----------------------------------------------------------------------------
  let listening: AbortController | undefined;
  const listenerFn = opts.listener ?? fixtureListener;
  function runListener(ctx: WorldCtx<DudesState>, force = false): string | undefined {
    const state = ctx.state,
      now = ctx.now,
      l = listenerOf(state);
    if (listening) return 'already reading';
    if (!force && !due(l, now)) return 'nothing new to read yet';
    if (!l.buffer.length) return 'nothing new to read yet';
    if (!canCall(state) || !reserveCall(state)) return 'AI is paused or out of calls';
    const ac = new AbortController();
    listening = ac;
    const reading = l.buffer.length;
    // Lines that arrive while it reads stay for the next reading.
    const input = listenerInput(l);
    const taken = l.buffer;
    l.buffer = [];
    listenerFn(input, ac.signal)
      .then((raw) => {
        if (ctx.state !== state) return;
        applyReading(l, raw, ctx.now);
        ctx.log(`listener read ${reading} lines: ${l.wishes.length} wishes, ${l.tips.length} tips`);
        try {
          opts.writeWishes?.(wishesMarkdown(l, ctx.now));
        } catch (e) {
          ctx.log(`could not write wishes.md: ${(e as Error).message}`, 'warn');
        }
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        l.lastError = e.message.slice(0, 300);
        l.lastRunAt = ctx.now; // back off as if it had run
        l.buffer = [...taken, ...l.buffer].slice(-150); // and keep what it was given for the next try
        ctx.log(`listener failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (listening === ac) listening = undefined;
      });
    return undefined;
  }

  /** When chat is quiet, one character at a time takes a turn of its own, so the field is never silent for long. */
  function idleLife(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state,
      now = ctx.now;
    if (state.ai.idleLife === false || !canCall(state) || now < nextIdleAt) return;
    nextIdleAt = now + IDLE_TURN_MS * (0.75 + ctx.rng() * 0.5);
    const quiet = state.dudes.filter(
      (d) =>
        awake(d, now) && !d.muted && !d.hidden && !d.inbox.length && !d.nudges?.length && !agentCalls.has(d.id) &&
        now - d.lastHeardAt > 60_000 && now - d.lastTurnAt > 3 * 60_000 && d.turns > 0,
    );
    if (!quiet.length) return;
    const d = quiet[Math.floor(ctx.rng() * quiet.length)];
    d.nudges = ['It has been quiet for a bit.'];
    pump(ctx);
  }

  // ---- arriving chat --------------------------------------------------------------------------
  function dudeFor(ctx: WorldCtx<DudesState>, userId: string, username: string, now: number): Dude | undefined {
    const state = ctx.state;
    let dude = state.dudes.find((d) => d.id === userId);
    if (dude) return dude;
    if (state.dudes.length >= LIMITS.dudes) {
      // Make room with the longest-quiet dude that has nothing standing and nothing in flight.
      const spare = state.dudes
        .filter((d) => !state.objects.some((o) => o.owner === d.id) && !state.jobs.some((j) => j.dudeId === d.id) && !agentCalls.has(d.id))
        .sort((a, b) => a.lastHeardAt - b.lastHeardAt)[0];
      if (!spare) return undefined;
      state.dudes.splice(state.dudes.indexOf(spare), 1);
    }
    const name = username.slice(0, 40);
    dude = {
      id: userId,
      name,
      createdAt: now,
      lastHeardAt: now,
      lastTurnAt: 0,
      turns: 0,
      persona: '',
      look: defaultLook(name),
      memory: [],
      history: [],
      inbox: [],
      overheard: [],
      position: spawnPoint(state.objects, state.dudes.map((d) => d.position), ctx.rng, campOf(state)),
      facing: Math.PI,
      path: [],
    };
    state.dudes.push(dude);
    pushFeed(state, now, `${name} showed up`);
    return dude;
  }

  function hear(ctx: WorldCtx<DudesState>, userId: string, username: string, text: string): void {
    const c = ctxOf(ctx);
    const now = c.now;
    const dude = dudeFor(c, userId, username, now);
    if (!dude) return c.log(`no room for ${username}'s dude (the field holds ${LIMITS.dudes})`, 'warn');
    dude.name = username.slice(0, 40);
    dude.lastHeardAt = now;
    if (dude.muted) return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return;
    pushLine(dude.inbox, { from: 'chatter', text: clean, at: now }, LIMITS.inbox);
    // The character says it: the chatter's own words, in the bubble straight away, while its agent
    // works out what the body does about them.
    const said = sayable(clean);
    if (said) {
      dude.say = { text: said, until: now + sayMs(said) };
      overhear(c.state, dude, said, now);
    }
    listen(c.state, 'chat', dude.name, clean, now);
    pump(c);
  }

  // ---- the scene ------------------------------------------------------------------------------
  function previewOf(state: DudesState, job: Job, dude: Dude): SafehouseObject | undefined {
    if (!job.blueprint || !job.position || !job.footprint) return undefined;
    return {
      id: `preview-${job.id}`,
      revision: 1,
      blueprint: job.blueprint,
      position: job.position,
      footprint: job.footprint,
      createdBy: dude.name,
      editedBy: dude.name,
      createdAt: job.createdAt,
      owner: dude.id,
    };
  }

  function dudeView(state: DudesState, d: Dude, now: number): DudeView {
    const jobs = state.jobs.filter((j) => j.dudeId === d.id && isActive(j));
    const job = jobs.find((j) => j.status === 'walking' || j.status === 'building') ?? jobs.find((j) => j.status === 'designing') ?? jobs[0];
    const target = job?.targetId ? state.objects.find((o) => o.id === job.targetId) : undefined;
    const busy = job && (job.status === 'walking' || job.status === 'building');
    const preview = job && job.kind !== 'remove' && (job.status === 'ready' || busy) ? previewOf(state, job, d) : undefined;
    return {
      id: d.id,
      name: d.name,
      ...(d.title ? { title: d.title } : {}),
      position: d.position,
      facing: d.facing,
      activity:
        d.use?.phase === 'doing' ? 'using' : job?.status === 'building' ? 'building' : d.path.length ? 'walking' : !awake(d, now) ? 'sleeping' : d.emote ? 'emote' : 'idle',
      look: d.look,
      ...(d.emote ? { emote: d.emote } : {}),
      ...(d.say ? { say: d.say } : {}),
      ...(knockedOut(d, now) ? { ko: d.ko!.until } : {}),
      ...(d.attack ? { attacking: { with: d.attack.with, targetId: d.attack.targetId } } : {}),
      ...(d.y ? { y: d.y } : {}),
      ...(d.hidden ? { hidden: true } : {}),
      ...(d.riding ? { riding: d.riding } : {}),
      ...(d.use ? { use: { how: d.use.how, targetId: d.use.objectId, phase: d.use.phase } } : {}),
      ...(agentCalls.has(d.id) ? { thinking: true } : {}),
      heardAt: d.lastHeardAt,
      ...(!awake(d, now) ? { away: true } : {}),
      ...(swimming(d) ? { swimming: true } : {}),
      ...(d.badges?.length ? { badges: badgeGroups(d.badges) } : {}),
      ...(d.badgesOpenUntil && d.badgesOpenUntil > now ? { badgesOpen: true } : {}),
      ...(job
        ? {
            job: {
              id: job.id,
              kind: job.kind,
              label: job.kind === 'build' ? (job.blueprint?.name ?? job.request.slice(0, 50)) : `${job.kind === 'edit' ? 'changing' : 'taking down'} ${target?.blueprint.name ?? 'a build'}`,
              status: job.status,
              progress: job.status === 'building' ? Math.min(1, (job.workedMs ?? 0) / (job.workMs ?? 1)) : 0,
              ...(preview ? { preview } : {}),
              ...(job.position || target ? { at: job.position ?? target!.position } : {}),
            },
          }
        : {}),
    };
  }

  /** The boss, drawn as a huge figure; flat on its back once it is down. */
  function bossViews(state: DudesState, now: number): DudeView[] {
    const b = bossOf(state);
    if (!b) return [];
    const kind = bossKind(b.kindId);
    const down = b.hp <= 0;
    return [
      {
        id: b.id,
        name: kind.name,
        npc: true,
        scale: kind.scale,
        position: b.position,
        facing: b.facing,
        activity: down ? 'idle' : 'walking',
        look: kind.look,
        ...(down ? { ko: now + 60_000 } : {}),
        ...(b.slamAt && now - b.slamAt < 1200 ? { emote: { pose: 'jump' as Emote, until: b.slamAt + 1200 } } : b.stunUntil && b.stunUntil > now ? { emote: { pose: 'stagger' as Emote, until: b.stunUntil } } : {}),
        ...(b.say ? { say: b.say } : {}),
      },
    ];
  }

  /** Badges grouped by kind, in the order first earned: [kind, count]. */
  function badgeGroups(badges: { kind: string }[]): [string, number][] {
    const counts = new Map<string, number>();
    for (const b of badges) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    return [...counts];
  }

  /** The knockout table: most knockouts first, five rows. */
  function scoreRows(state: DudesState) {
    return Object.entries(state.scores ?? {})
      .map(([id, sc]) => ({ name: state.dudes.find((d) => d.id === id)?.name ?? id, ...sc }))
      .filter((r) => r.kos > 0)
      .sort((a, b) => b.kos - a.kos || a.downs - b.downs)
      .slice(0, 5);
  }

  function buildScene(state: DudesState, now: number): DudesScene {
    const shown = [...state.dudes].sort((a, b) => b.lastHeardAt - a.lastHeardAt).slice(0, LIMITS.dudesOnScreen);
    return {
      schema: 1,
      journey: journeyView(state),
      fixture: opts.fixture,
      objects: state.objects.map(viewOf),
      dudes: [
        ...shown.map((d) => dudeView(state, d, now)),
        ...(state.npcs ?? []).map(
          (n): DudeView => ({
            id: n.id,
            name: n.name,
            npc: true,
            position: n.position,
            facing: n.facing,
            activity: n.path.length || n.towing ? 'walking' : n.emote ? 'emote' : 'idle',
            look: n.look,
            ...(n.emote ? { emote: n.emote } : {}),
            ...(n.say ? { say: n.say } : {}),
            ...(n.ko && n.ko > now ? { ko: n.ko } : {}),
          }),
        ),
        ...bossViews(state, now),
      ],
      ...((challengeView(state, now) ?? landmarkView(state) ?? happeningView(state)) ? { happening: challengeView(state, now) ?? landmarkView(state) ?? happeningView(state) } : {}),
      ...(scoreRows(state).length ? { scores: scoreRows(state) } : {}),
      ...(wishViews(state.listener, 3).length ? { wishes: wishViews(state.listener, 3) } : {}),
      feed: state.feed.slice(-8),
      ...(state.effects?.length ? { effects: state.effects.filter((e) => now - e.at < 4000) } : {}),
      ai: {
        available: opts.available,
        paused: state.ai.paused,
        enforced: state.ai.enforced,
        callsRemaining: state.ai.callsRemaining,
        callsUsed: state.ai.callsUsed,
        thinking: agentCalls.size,
        designing: designCalls.size,
        idleLife: state.ai.idleLife !== false,
        events: state.ai.events !== false,
      },
      counts: { dudes: state.dudes.length, awake: state.dudes.filter((d) => awake(d, now)).length, builds: state.objects.length },
      worldRevision: state.worldRevision,
    };
  }

  // ---- operator controls ----------------------------------------------------------------------
  const findDude = (state: DudesState, name: string) => state.dudes.find((d) => lower(d.name) === lower(name.replace(/^@/, '')));
  const adminActions: AdminAction<DudesState>[] = [
    { id: 'ai-pause', label: 'Pause AI (agents and designs)', run: (ctx) => { ctx.state.ai.paused = true; ctx.log('AI paused (admin)', 'alert'); } },
    { id: 'ai-resume', label: 'Resume AI', run: (ctx) => { ctx.state.ai.paused = false; ctx.log('AI resumed (admin)'); pump(ctx); } },
    {
      id: 'allowance-set',
      label: 'Set AI call allowance',
      input: { label: 'calls', min: 0, max: 1_000_000, step: 1 },
      run: (ctx, value) => { ctx.state.ai.callsRemaining = Math.floor(Number(value)); ctx.log(`AI call allowance set to ${ctx.state.ai.callsRemaining} (admin)`); pump(ctx); },
    },
    { id: 'allowance-ignore', label: 'Ignore the AI call limit', run: (ctx) => { ctx.state.ai.enforced = false; ctx.log('AI call limit ignored (admin)', 'alert'); pump(ctx); } },
    { id: 'allowance-enforce', label: 'Enforce the AI call limit', run: (ctx) => { ctx.state.ai.enforced = true; ctx.log('AI call limit enforced (admin)'); } },
    {
      id: 'event-now',
      label: 'Send a troublemaker now',
      input: { kind: 'text', label: 'painter | squasher | tow | thief | mayor | random', maxLength: 10 },
      run: (ctx, value) => {
        const v = String(value).trim().toLowerCase();
        const kind = (['painter', 'squasher', 'tow', 'thief', 'mayor'] as const).find((k) => k === v);
        const why = startHappening(ctx.state, ctx.now, ctx.rng, kind);
        ctx.log(why ? `no troublemaker: ${why}` : `troublemaker sent in: ${ctx.state.happening?.title} (admin)`, why ? 'warn' : 'info');
      },
    },
    {
      id: 'listener-now',
      label: 'Listener: read chat now',
      run: (ctx) => {
        const why = runListener(ctx, true);
        ctx.log(why ? `listener not run: ${why}` : 'listener reading chat (admin)', why ? 'warn' : 'info');
      },
    },
    { id: 'listener-off', label: 'Listener: stop', run: (ctx) => { listenerOf(ctx.state).enabled = false; ctx.log('listener stopped (admin)'); } },
    { id: 'listener-on', label: 'Listener: start', run: (ctx) => { listenerOf(ctx.state).enabled = true; ctx.log('listener on (admin)'); } },
    {
      id: 'listener-clear',
      label: 'Listener: clear wishes and tips',
      run: (ctx) => {
        const l = listenerOf(ctx.state);
        l.wishes = [];
        l.tips = [];
        ctx.log('listener wishes and tips cleared (admin)', 'alert');
      },
    },
    {
      id: 'challenge-now',
      label: 'Journey: next challenge right now',
      input: { kind: 'text', label: 'river | boss', maxLength: 10 },
      run: (ctx, value) => {
        const kind = String(value).trim().toLowerCase() === 'boss' ? 'boss' : 'river';
        const why = challengeNow(ctx.state, ctx.now, ctx.rng, kind);
        ctx.log(why ? `no challenge: ${why}` : `challenge: ${kind} (admin)`, why ? 'warn' : 'alert');
      },
    },
    {
      id: 'challenge-finish',
      label: 'Journey: end this challenge now (stragglers ferried, no badge for them)',
      run: (ctx) => {
        const c = challengeOf(ctx.state);
        if (!c || c.outcome) return ctx.log('no challenge to end', 'warn');
        c.until = ctx.now;
        ctx.log('challenge ending (admin)', 'alert');
      },
    },
    {
      id: 'landmark-close',
      label: 'Journey: Getting close (describe what is at the end, or "default")',
      input: { kind: 'text', label: 'what it is', maxLength: 300 },
      run: (ctx, value) => {
        const text = String(value).trim();
        const description = /^default$/i.test(text) ? LANDMARK.defaultDescription : text;
        const why = gettingClose(ctx.state, ctx.now, description);
        if (why) return ctx.log(`not yet: ${why}`, 'warn');
        ctx.log(`getting close: ${description.slice(0, 80)} (admin)`, 'alert');
        designLandmark(ctx, description);
      },
    },
    {
      id: 'landmark-arrive',
      label: "Journey: You've made it (reveal the landmark)",
      run: (ctx) => {
        const why = madeIt(ctx.state, ctx.now);
        ctx.log(why ? `not yet: ${why}` : "you've made it (admin)", why ? 'warn' : 'alert');
      },
    },
    {
      id: 'journey-set-off',
      label: 'Journey: set off again (next leg)',
      run: (ctx) => {
        const why = setOffAgain(ctx.state, ctx.now);
        ctx.log(why ? `not yet: ${why}` : 'setting off again (admin)', why ? 'warn' : 'alert');
      },
    },
    { id: 'journey-pause', label: 'Journey: stop the group where it is', run: (ctx) => { journeyOf(ctx.state).paused = true; ctx.log('journey paused (admin)', 'alert'); } },
    { id: 'journey-resume', label: 'Journey: walk on', run: (ctx) => { journeyOf(ctx.state).paused = false; ctx.log('journey resumed (admin)'); } },
    { id: 'events-off', label: 'Stop troublemakers', run: (ctx) => { ctx.state.ai.events = false; ctx.log('troublemakers stopped (admin)'); } },
    { id: 'events-on', label: 'Let troublemakers come', run: (ctx) => { ctx.state.ai.events = true; ctx.log('troublemakers on (admin)'); } },
    { id: 'idle-off', label: 'Stop idle turns (quiet characters stay quiet)', run: (ctx) => { ctx.state.ai.idleLife = false; ctx.log('idle turns off (admin)'); } },
    { id: 'idle-on', label: 'Idle turns on (one quiet character every ~40 s)', run: (ctx) => { ctx.state.ai.idleLife = true; ctx.log('idle turns on (admin)'); } },
    {
      id: 'mute',
      label: "Mute a chatter's agent",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return ctx.log(`no dude called ${value}`, 'warn');
        d.muted = true;
        d.inbox = [];
        agentCalls.get(d.id)?.abort();
        ctx.log(`${d.name}'s agent muted (admin)`, 'alert');
      },
    },
    {
      id: 'unmute',
      label: "Unmute a chatter's agent",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return ctx.log(`no dude called ${value}`, 'warn');
        d.muted = false;
        ctx.log(`${d.name}'s agent unmuted (admin)`);
      },
    },
    {
      id: 'forget',
      label: "Reset a dude's agent (keeps builds)",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return ctx.log(`no dude called ${value}`, 'warn');
        agentCalls.get(d.id)?.abort();
        endUse(ctx.state, d, ctx.now);
        Object.assign(d, { persona: '', title: undefined, memory: [], history: [], inbox: [], overheard: [], look: defaultLook(d.name), lastError: undefined });
        ctx.log(`${d.name}'s agent reset (admin)`, 'alert');
      },
    },
    {
      id: 'remove-dude',
      label: 'Remove a dude and its builds',
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const s = ctx.state;
        const d = findDude(s, String(value));
        if (!d) return ctx.log(`no dude called ${value}`, 'warn');
        agentCalls.get(d.id)?.abort();
        for (const j of s.jobs) if (j.dudeId === d.id) designCalls.get(j.id)?.abort();
        s.dudes = s.dudes.filter((x) => x !== d);
        s.objects = s.objects.filter((o) => o.owner !== d.id);
        s.jobs = s.jobs.filter((j) => j.dudeId !== d.id);
        s.worldRevision++;
        ctx.log(`${d.name} and their builds removed (admin)`, 'alert');
      },
    },
    {
      id: 'remove-build',
      label: 'Remove a build (#ref or name)',
      input: { kind: 'text', label: 'build', maxLength: 70 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim().replace(/^#/, '');
        const o = s.objects.find((x) => shortRef(x.id) === v || x.id === v) ?? matchName(v, s.objects, (x) => x.blueprint.name);
        if (!o) return ctx.log(`no build matching ${value}`, 'warn');
        s.objects = s.objects.filter((x) => x !== o);
        s.jobs = s.jobs.filter((j) => j.targetId !== o.id);
        s.worldRevision++;
        ctx.log(`${o.blueprint.name} (by ${o.createdBy}) removed (admin)`, 'alert');
      },
    },
  ];

  const world: WorldModule<DudesState> = {
    meta: { id: 'ai-dudes', name: 'AI Dudes', stateVersion: STATE_VERSION },
    stateSchema,
    createInitialState: (now) => freshState(now, opts.allowance),
    reset: (previous, now) => {
      for (const ac of [...agentCalls.values(), ...designCalls.values()]) ac.abort();
      listening?.abort();
      listening = undefined;
      agentCalls.clear();
      designCalls.clear();
      return resetState(previous, now, opts.allowance);
    },
    migrate: (raw) => raw as DudesState,
    start(ctx) {
      live = ctx;
      journeyOf(ctx.state);
      syncGround(ctx.state);
      // Designs that were out when the process stopped are asked again; everything else resumes as saved.
      for (const job of ctx.state.jobs) if (job.status === 'designing') job.status = 'queued';
      const heard = backfill(ctx.state, opts.readChatLog?.() ?? []);
      if (heard) ctx.log(`listener: read back ${heard} lines from earlier chat`);
      ctx.log(
        `ai-dudes: ${ctx.state.dudes.length} dudes, ${ctx.state.objects.length} builds; ` +
          (opts.fixture ? 'FIXTURE agents (no AI)' : `agents ${opts.agentModel} ×${opts.agentLimit}, designs ${opts.designModel} ×${opts.designLimit}`),
      );
      setTimeout(() => pump(ctx), 0);
      return () => {
        for (const ac of [...agentCalls.values(), ...designCalls.values()]) ac.abort();
        agentCalls.clear();
        designCalls.clear();
        live = undefined;
      };
    },
    // Every message goes straight to its chatter's agent: no classifier call, no throttle drop.
    intents: [
      {
        name: 'agent',
        description: "Anything a chatter says: it goes to that chatter's own agent.",
        examples: [],
        handle: (ctx, msg) => hear(ctx, msg.userId, msg.username, msg.text),
      },
    ],
    fallbackIntent: 'agent',
    chatThrottleMs: 0,
    quickClassify: () => ({ intent: 'agent' }),
    events: [],
    tickMs: 500,
    tick(ctx, dt) {
      const now = ctx.now;
      tickJourney(ctx.state, dt, now, (d) => awake(d, now));
      tickLandmark(ctx.state);
      tickChallenges(ctx.state, dt, now, ctx.rng);
      tickDudes(ctx.state, dt, ctx.now, ctx.rng);
      tickEvents(ctx.state, dt, ctx.now, ctx.rng);
      idleLife(ctx);
      runListener(ctx);
      pump(ctx); // turn gaps elapse and calls free up between messages
    },
    buildScene: (state, view) => buildScene(state, view.now),
    objectParts: (state, id, revision) => {
      const o = state.objects.find((x) => x.id === id);
      return o && o.revision === revision ? o.blueprint.parts : undefined;
    },
    persona: {
      name: 'AI Dudes',
      systemPrompt: '',
      idleMutterMs: 0,
      summarizeState: (state, now = Date.now()) =>
        `${state.dudes.length} dudes (${state.dudes.filter((d) => awake(d, now)).length} awake), ${state.objects.length} builds, ` +
        `${state.jobs.length} jobs in flight, ${agentCalls.size} agents thinking, ${designCalls.size} designs out; ` +
        `AI ${state.ai.paused ? 'paused' : 'on'}, ${state.ai.enforced ? `${state.ai.callsRemaining} calls left` : 'no call limit'} (${state.ai.callsUsed} used).`,
    },
    adminActions,
    adminStatus: (state, now): DudesAdminStatus => ({
      fixture: opts.fixture,
      models: { agent: opts.agentModel, design: opts.designModel, listener: opts.listenerModel ?? 'fixture' },
      ai: {
        ...buildScene(state, now).ai,
        agentLimit: opts.agentLimit,
        designLimit: opts.designLimit,
        waiting: state.dudes.filter((d) => d.inbox.length && !d.muted).length,
      },
      dudes: [...state.dudes]
        .sort((a, b) => b.lastHeardAt - a.lastHeardAt)
        .map((d) => ({
          id: d.id,
          name: d.name,
          ...(d.title ? { title: d.title } : {}),
          persona: d.persona,
          memory: d.memory,
          turns: d.turns,
          builds: state.objects.filter((o) => o.owner === d.id).length,
          inbox: d.inbox.length,
          lastHeardAt: d.lastHeardAt,
          muted: !!d.muted,
          ...(d.lastError ? { lastError: d.lastError } : {}),
        })),
      objects: state.objects.map((o) => ({ id: o.id, name: o.blueprint.name, createdBy: o.createdBy, ...(damageOf(state, o.id) ? { damage: damageOf(state, o.id) } : {}) })),
      journey: journeyView(state),
      journeyNext: (() => {
        const j = journeyOf(state);
        if (j.challenge) return `${j.challenge.kind}${j.challenge.outcome ? ` (${j.challenge.outcome})` : ''} now, ${Math.max(0, Math.round((j.challenge.until - now) / 1000))} s left`;
        if (j.landmark) return `landmark (${j.landmark.status})`;
        return j.next ? `${j.next.kind} in ${Math.round(j.campZ - j.next.z)} m` : undefined;
      })(),
      ...(happeningView(state) ? { happening: happeningView(state) } : {}),
      listener: {
        enabled: state.listener?.enabled !== false,
        runs: state.listener?.runs ?? 0,
        buffered: state.listener?.buffer.length ?? 0,
        lastRunAt: state.listener?.lastRunAt ?? 0,
        ...(state.listener?.lastError ? { lastError: state.listener.lastError } : {}),
        tips: state.listener?.tips ?? [],
        wishes: (state.listener?.wishes ?? []).map((w) => ({ id: w.id, wish: w.wish, count: w.count, status: w.status, askers: w.askers, examples: w.examples, how: w.how })),
        proposals: opts.readProposals?.() ?? [],
      },
      ...(state.nextHappeningAt && !state.happening ? { nextHappeningInS: Math.max(0, Math.round((state.nextHappeningAt - now) / 1000)) } : {}),
      jobs: state.jobs.map((j) => ({
        id: j.id,
        dude: state.dudes.find((d) => d.id === j.dudeId)?.name ?? j.dudeId,
        kind: j.kind,
        label: j.blueprint?.name ?? j.request.slice(0, 60),
        status: j.status,
        ...(j.error ? { error: j.error } : {}),
      })),
    }),
    tuning: {},
    layout: { width: 1920, height: 1080, worldWidth: 1920, protagonistHomeX: 0, walkSpeedPxPerSec: 1 },
  };
  return world;
}

const fixture = config.DUDES_FIXTURES === '1' || config.DUDES_FIXTURES === 'true';
const agentModel = config.DUDES_AGENT_MODEL ?? config.FAST_MODEL;
const designModel = config.DUDES_DESIGN_MODEL ?? config.AGENT_MODEL;
const listenerModel = config.DUDES_LISTENER_MODEL ?? config.AGENT_MODEL;
export const aiDudesWorld = createAiDudesWorld({
  agent: fixture ? fixtureAgent : liveAgent(agentModel),
  design: fixture ? fixtureDesign : liveDesign(designModel),
  fixture,
  available: fixture || !!config.OPENROUTER_API_KEY,
  agentLimit: config.DUDES_AGENT_CONCURRENCY,
  designLimit: config.DUDES_DESIGN_CONCURRENCY,
  allowance: config.DUDES_CALL_ALLOWANCE,
  agentModel: fixture ? 'fixture' : agentModel,
  designModel: fixture ? 'fixture' : designModel,
  listener: fixture ? fixtureListener : liveListener(listenerModel),
  listenerModel: fixture ? 'fixture' : listenerModel,
  readChatLog: () => {
    const file = path.join(config.DATA_DIR, 'log', 'terminal.jsonl');
    return fs.existsSync(file) ? chatFromLog(fs.readFileSync(file, 'utf8')) : [];
  },
  readProposals: () => {
    const file = path.join(config.DATA_DIR, 'builder', 'attempts.json');
    try {
      const attempts = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { wish: string; status: string; tests?: string; at: string }>;
      return Object.entries(attempts)
        .map(([id, a]) => ({ id, wish: a.wish, status: a.status, ...(a.tests ? { tests: a.tests } : {}), at: a.at }))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20);
    } catch {
      return [];
    }
  },
  writeWishes: (markdown) => {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(config.DATA_DIR, 'wishes.md'), markdown);
  },
});

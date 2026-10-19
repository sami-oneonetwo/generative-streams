// AI DUDES, the town: every chatter moves in, gets a lot of their own, and is run by their own
// agent. They build homes and places other people use (city.ts), go out when they need to, and
// put up the big things together. Chat is not classified or queued behind a single protagonist: each message
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
import { sendDude, overhear, placeJob, tickDudes, awake, isActive, startUse, endUse, inUse, draftingSpot, AWAKE_MS, HOLD_MS } from './sim';
import { clampToGround, spawnPoint } from './placement';
import {
  TOWN,
  cityOf,
  claimLot,
  coinsOf,
  contribute,
  findFlat,
  freeSpaceOn,
  freeSpotOn,
  onLot,
  freshNeeds,
  homeOf,
  leaveVisit,
  lotForBuild,
  lotsOf,
  needsOf,
  placeById,
  placesOf,
  projectDesigned,
  projectOf,
  projectPreview,
  proposeProject,
  releaseLot,
  shareLot,
  startLabour,
  startVisit,
  tell,
  throwParty,
  tickCity,
  townBanner,
  townieViews,
  townView,
  welcomeBack,
  type Place,
} from './city';
import { MAYOR_BUILDER, mayorBuildViews, mayorDudeView, mayorView, tickMayor, tickMayorBuilds } from './mayor';
import { mayorSpot, startBit } from './bits';
import { tickMovers } from './movers';
import { BUS_STOP, NEEDS, VENUES, allPlots, moodOf, plotById, venueKindOf, type Need } from '../../shared/city';
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
const sayMs = (text: string) => Math.max(4000, Math.min(16_000, 2500 + text.length * 65));

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
        if (d) applyReply(ctx, state, d, reply, ctx.now, turn.messages.length > 0, turn.messages);
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

  function applyReply(ctx: WorldCtx<DudesState>, state: DudesState, dude: Dude, reply: AgentReply, now: number, prompted = true, said: string[] = []): void {
    // What the chatter actually typed this turn: it goes to the designer with whatever they asked built.
    const asked = said.join(' / ').slice(0, 300) || undefined;
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
    // Knocking something down in the same breath as building means making room, which the chatter
    // did not ask for: the removal waits until they say so.
    const building = reply.actions.some((a) => a.do === 'build' || a.do === 'edit');
    for (const action of reply.actions) {
      if (building && action.do === 'remove') {
        pushLine(dude.history, { from: 'world', text: `you did not take down ${action.target}: only remove things when your chatter asks you to`, at: now }, LIMITS.history);
        continue;
      }
      // A turn of the agent's own (nobody in chat asked) may talk, move, use and fix, but not start
      // builds or fights: those cost designs or start feuds that would run on without anyone asking.
      // Nor propose a town project or hand money about: those were the chatter's to decide.
      if (!prompted && ['build', 'attack', 'propose', 'contribute', 'give'].includes(action.do)) continue;
      const note = act(state, dude, action, now, ctx.rng, asked);
      if (note) {
        pushLine(dude.history, { from: 'world', text: note, at: now }, LIMITS.history);
        listen(state, 'failed', dude.name, note, now);
      }
    }
    pump(ctx);
  }

  /** Where "near X" / "to X" points: a dude, a build, home, the square, an address, or right here. */
  function placeOf(state: DudesState, dude: Dude, phrase: string | undefined, rng: () => number): GroundPoint | undefined {
    const p = lower(phrase ?? 'me');
    if (!p || p === 'me' || p === 'here' || p === 'myself') return dude.position;
    if (/^(home|my home|my house|my lot|my place|my plot)$/.test(p)) {
      const home = homeOf(state, dude);
      if (home) return standBeside(dude, home.at, home.footprint);
      const lot = lotsOf(state, dude)[0];
      return lot ? lot.centre : undefined;
    }
    if (/^(the )?mayor$/.test(p)) return mayorSpot(state, Date.now());
    if (/^(the )?(square|town square|centre|center|middle|town|fountain|everyone)/.test(p)) {
      const a = rng() * Math.PI * 2;
      return { x: Math.cos(a) * 4, z: Math.sin(a) * 4 };
    }
    if (p === 'wander' || p === 'around' || p === 'anywhere') {
      const a = rng() * Math.PI * 2,
        r = 4 + rng() * 8;
      return clampToGround({ x: dude.position.x + Math.cos(a) * r, z: dude.position.z + Math.sin(a) * r }, 2);
    }
    const lot = allPlots().find((l) => p.includes(l.address.toLowerCase()));
    if (lot) return lot.centre;
    const other = matchName(p.replace(/'s (lot|house|home|place)$/, ''), [...state.dudes.filter((d) => d.id !== dude.id), ...cityOf(state).townies], (d) => d.name);
    if (other) {
      if (/'s (lot|house|home|place)$/.test(p) && 'inbox' in other) {
        const theirs = lotsOf(state, other)[0];
        if (theirs) return theirs.centre;
      }
      // Stand beside them, on the side we are coming from.
      const dx = dude.position.x - other.position.x,
        dz = dude.position.z - other.position.z,
        d = Math.hypot(dx, dz) || 1;
      return { x: other.position.x + (dx / d) * 1.4, z: other.position.z + (dz / d) * 1.4 };
    }
    const build = matchName(p, state.objects, (o) => o.blueprint.name);
    if (build) return standBeside(dude, build.driven?.at ?? build.position, build.footprint);
    return undefined;
  }
  function standBeside(dude: Dude, at: GroundPoint, size: { width: number; depth: number }): GroundPoint {
    const dx = dude.position.x - at.x,
      dz = dude.position.z - at.z,
      d = Math.hypot(dx, dz) || 1,
      reach = Math.max(size.width, size.depth) / 2 + 1;
    return { x: at.x + (dx / d) * reach, z: at.z + (dz / d) * reach };
  }

  /** A place from what the agent wrote: a name, or a need ("food", "somewhere fun", "rest"). */
  function placeFromPhrase(state: DudesState, dude: Dude, phrase: string, rng: () => number): Place | string {
    const p = lower(phrase);
    const places = placesOf(state);
    const named = matchName(p, places, (x) => x.name);
    if (named && (lower(named.name).includes(p.replace(/^(the|my|a|an)\s+/, '')) || p.includes(lower(named.name)))) return named;
    const needWord: [RegExp, Need][] = [
      [/\b(food|eat|hungry|lunch|dinner|breakfast|snack|coffee|drink)\b/, 'hunger'],
      [/\b(rest|sleep|bed|nap|home|tired)\b/, 'energy'],
      [/\b(fun|bored|party|dance|entertain|play)\b/, 'fun'],
      [/\b(company|people|friends|social|chat|lonely)\b/, 'social'],
    ];
    const need = needWord.find(([re]) => re.test(p))?.[1];
    if (need === 'energy') {
      const home = homeOf(state, dude);
      if (home) return home;
    }
    if (need) {
      const best = placesOf(state)
        .filter((x) => (x.spec.gives[need] ?? 0) > 0 && (x.kind !== 'home' || x.owner === dude.id))
        .sort((a, b) => (b.spec.gives[need] ?? 0) - (a.spec.gives[need] ?? 0) + (Math.hypot(a.at.x - dude.position.x, a.at.z - dude.position.z) - Math.hypot(b.at.x - dude.position.x, b.at.z - dude.position.z)) * 0.3)[0];
      if (best) return best;
      return `nothing in town does that yet${need === 'energy' ? '; build yourself a home' : ''}`;
    }
    return named ?? `there is no place called "${phrase}" in town`;
  }

  /** Run one action; returns a line for the agent's next turn when something did not go as asked. */
  function act(state: DudesState, dude: Dude, action: AgentAction, now: number, rng: () => number, asked?: string): string | undefined {
    const mine = state.objects.filter((o) => o.owner === dude.id);
    // A shape in the mist far down the path is not something anyone can walk up to and use yet.
    const visible = state.objects.filter((o) => !o.silhouette);
    const active = state.jobs.filter((j) => j.dudeId === dude.id && isActive(j));
    const busy = active.some((j) => j.status === 'walking' || j.status === 'building');
    if (knockedOut(dude, now)) return `you were knocked out, so you could not ${action.do}`;
    // Anything new the body is asked to do replaces the little errands it was on.
    const errands = ['emote', 'show', 'invite', 'share', 'give', 'contribute', 'propose', 'build', 'edit', 'remove', 'rent'];
    if (!errands.includes(action.do)) {
      dude.explore = undefined;
      dude.meet = undefined;
      dude.bit = undefined;
      if (action.do !== 'follow') dude.follow = undefined;
      leaveVisit(dude);
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
        // The Mayor is not a character in the town's lists: greeting him is a little bit of its own.
        if (/\bmayor\b/i.test(action.target))
          return startBit(state, dude, { caption: `greets the Mayor`, to: 'the Mayor', steps: [{ pose: action.how === 'hug' ? 'hug' : action.how === 'bow' ? 'bow' : action.how === 'handshake' ? 'handshake' : action.how === 'highfive' ? 'highfive' : 'wave', seconds: 2.5 }] }, now);
        // Anyone about: another chatter, or one of the town's residents.
        const other = matchName(action.target, [...others(), ...cityOf(state).townies], (d) => d.name);
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
      case 'visit': {
        if (busy) return `you were busy building, so you did not go to ${action.target}`;
        const place = placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return place;
        return startVisit(state, dude, place, 'asked', now);
      }
      case 'bit': {
        if (busy) return `you were busy building, so you did not ${action.caption}`;
        const { do: _verb, ...req } = action;
        return startBit(state, dude, req, now);
      }
      case 'play': {
        if (busy) return `you were busy building, so you did not go and ${action.target}`;
        // "the basketball court", or just "hoops" / "swim": the nearest place where that is what you do.
        const words = lower(action.target).split(/\W+/).filter((w) => w.length > 2);
        const playable = placesOf(state)
          .filter((p) => p.spec.visit === 'play')
          .map((p) => ({ p, score: words.filter((w) => lower(`${p.name} ${p.spec.verb} ${p.spec.pose}`).includes(w.replace(/s$/, ''))).length, far: Math.hypot(p.at.x - dude.position.x, p.at.z - dude.position.z) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.far - b.far);
        const place = playable[0]?.p ?? placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return `there is nowhere in town to ${action.target} yet; someone could build one`;
        if (place.spec.visit !== 'play') return `there is nothing to do at ${place.name} but visit it`;
        return startVisit(state, dude, place, 'asked', now);
      }
      case 'work': {
        if (busy) return `you were busy building, so you did not go to work`;
        const place = placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return place;
        if (place.kind === 'home' || place.kind === 'decor' || place.kind === 'park') return `there is no work at ${place.name}`;
        return startVisit(state, dude, place, 'work', now);
      }
      case 'invite': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        const place = action.to ? placeFromPhrase(state, dude, action.to, rng) : undefined;
        const where = place && typeof place !== 'string' ? place.name : 'hang out';
        tell(state, other, `${dude.name} invited you to ${place && typeof place !== 'string' ? `come to ${where}` : 'hang out'}`, now, true);
        if (place && typeof place !== 'string') {
          const why = startVisit(state, dude, place, 'asked', now);
          if (why) return why;
          if (dude.visit) dude.visit.with = other.name;
        } else dude.meet = { dudeId: other.id, how: 'wave', giveUpAt: now + 30_000 };
        pushFeed(state, now, `${dude.name} invited ${other.name}${place && typeof place !== 'string' ? ` to ${where}` : ''}`);
        return undefined;
      }
      case 'share': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        return shareLot(state, dude, other, now);
      }
      case 'rent': {
        if (lotsOf(state, dude).length) return 'you have a lot already; you do not need a flat';
        const named = action.target ? matchName(action.target, state.objects.filter((o) => o.venue === 'apartments'), (o) => o.blueprint.name) : undefined;
        const flat = named ?? findFlat(state, dude);
        if (!flat) return 'there are no flats free in town; someone needs to build apartments';
        dude.rentsAt = flat.id;
        pushFeed(state, now, `${dude.name} rented a flat in ${flat.blueprint.name}`);
        const owner = state.dudes.find((d) => d.id === flat.owner);
        if (owner) tell(state, owner, `${dude.name} rented a flat in your ${flat.blueprint.name}`, now);
        return undefined;
      }
      case 'give': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        const amount = Math.min(Math.max(1, Math.floor(action.coins)), coinsOf(dude));
        if (amount <= 0) return 'you have no coins to give';
        dude.coins = coinsOf(dude) - amount;
        other.coins = coinsOf(other) + amount;
        tell(state, other, `${dude.name} gave you §${amount}`, now, true);
        pushFeed(state, now, `${dude.name} gave ${other.name} §${amount}`);
        return undefined;
      }
      case 'propose':
        return proposeProject(state, dude, action.what, now);
      case 'contribute':
        return contribute(state, dude, action.coins, now);
      case 'help': {
        if (busy) return 'you were busy building your own thing, so you did not help';
        return startLabour(state, dude, now);
      }
      case 'show': {
        dude.badgesOpenUntil = now + 15_000;
        return dude.badges?.length ? undefined : 'you have not earned any badges yet; they come from helping with the town\'s community projects';
      }
      case 'attack': {
        if (busy) return `you were busy building, so you did not attack ${action.target}`;
        // The Mayor can be got, cartoon-style: a stumble, never a knockout.
        if (/\bmayor\b/i.test(action.target) && !/'s|’s/.test(action.target))
          return startBit(state, dude, { caption: `takes a swing at the Mayor`, to: 'the Mayor', steps: [{ pose: action.with === 'kick' ? 'kick' : action.with === 'shove' ? 'push' : 'punch', seconds: 1.5 }, { pose: 'laugh', seconds: 2 }] }, now);
        const other = matchName(action.target, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name);
        if (other) {
          startAttack(state, dude, 'dude', other.id, action.with, now);
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
        if (!to) return `there is nothing called "${action.to}" in town`;
        endUse(state, dude, now);
        dude.emote = undefined;
        // Stay where you were sent a while before wandering off again.
        dude.idleUntil = now + 45_000;
        return sendDude(state, dude, to) ? undefined : `you could not find a way to ${action.to}`;
      }
      case 'build': {
        if (active.length >= LIMITS.jobsPerDude) return `you already have ${active.length} things on the go; they will finish soon`;
        if (state.objects.length + state.jobs.filter((j) => j.kind === 'build' && isActive(j)).length >= LIMITS.objects)
          return 'the town is full; nothing new can go up until someone removes something';
        const lot = lotForBuild(state, dude, action.near);
        if (!lot) return dude.rentsAt ? 'you rent a flat, so you have no lot to build on; ask a friend to share theirs' : 'you have no lot to build on: the town is full; ask a friend to share their lot';
        const venue = action.kind ?? venueKindOf(action.what);
        // Where on the lot: the middle of the biggest space left (toward the back, the block's middle,
        // leaving the front to the street), marked out as the site while it is designed.
        const space = freeSpotOn(state, lot);
        const site = Math.max(3, Math.min(8, space.side));
        const job: Job = { id: nextId(state, 'j'), dudeId: dude.id, kind: 'build', request: action.what.slice(0, 300), anchor: space.at, status: 'queued', createdAt: now, plot: lot.id, venue, site, ...(asked ? { asked } : {}) };
        state.jobs.push(job);
        pushFeed(state, now, `${dude.name} is designing ${venue === 'decor' ? '' : `a ${VENUES[venue].label}: `}${action.what.slice(0, 60)}`);
        return undefined;
      }
      case 'use': {
        if (busy) return `you were busy building, so you did not ${action.how} ${action.target}`;
        const target = matchName(action.target, visible, (o) => o.blueprint.name);
        if (!target) return `there is no build called "${action.target}" in town`;
        if (target.civic && (action.how === 'drive' || action.how === 'ride' || action.how === 'push')) return `${target.blueprint.name} belongs to the town and stays put`;
        // Going inside a place is a visit: it costs what it costs and does what it does.
        const asPlace = target.venue && (action.how === 'enter' || action.how === 'sit') && target.venue !== 'decor' ? placeById(state, target.id) : undefined;
        if (asPlace) return startVisit(state, dude, asPlace, 'asked', now);
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
            ? { id: nextId(state, 'j'), dudeId: dude.id, kind: 'edit', request: action.change.slice(0, 300), targetId: target.id, anchor: target.position, status: 'queued', createdAt: now, ...(asked ? { asked } : {}) }
            : { id: nextId(state, 'j'), dudeId: dude.id, kind: 'remove', request: `take down ${target.blueprint.name}`.slice(0, 300), targetId: target.id, anchor: target.position, status: 'ready', createdAt: now };
        state.jobs.push(job);
        return undefined;
      }
    }
  }

  // ---- design calls ---------------------------------------------------------------------------
  function pumpDesigns(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state;
    // The town's project first: everyone is waiting to see it.
    const project = projectOf(state);
    if (project?.status === 'designing' && !designCalls.has(`project:${project.id}`) && designCalls.size < opts.designLimit && canCall(state) && reserveCall(state)) designProject(ctx, project.id);
    while (designCalls.size < opts.designLimit && canCall(state)) {
      const designing = new Set(state.jobs.filter((j) => j.status === 'designing').map((j) => j.dudeId));
      // One design per dude at a time, oldest request first: a dude asking for five things does not starve the field.
      const job = state.jobs.filter((j) => j.status === 'queued' && !designing.has(j.dudeId)).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!job || !reserveCall(state)) return;
      startDesign(ctx, state, job);
    }
  }

  function startDesign(ctx: WorldCtx<DudesState>, state: DudesState, job: Job): void {
    // The Mayor's builds have no character behind them: the town's own designer, in his name.
    const dude = state.dudes.find((d) => d.id === job.dudeId) ?? (job.dudeId === 'mayor' ? MAYOR_BUILDER : undefined);
    const target = job.targetId ? state.objects.find((o) => o.id === job.targetId) : undefined;
    if (!dude || (job.kind === 'edit' && !target)) {
      job.status = 'failed';
      return;
    }
    job.status = 'designing';
    const ac = new AbortController();
    designCalls.set(job.id, ac);
    opts
      .design(
        {
          dudeName: dude.name,
          persona: dude.persona,
          request: job.request,
          ...(job.asked ? { asked: job.asked } : {}),
          ...(target ? { target: target.blueprint } : {}),
          // The room actually left on the lot, and what is there already.
          ...(job.plot && plotById(job.plot) && job.kind === 'build' ? { lot: Math.max(3, Math.floor(freeSpaceOn(state, plotById(job.plot)!, job.id))), lotHas: onLot(state, plotById(job.plot)!) } : job.plot ? { lot: plotById(job.plot)?.civic ? 13 : 16 } : {}),
          ...((job.venue ?? target?.venue) ? { kind: VENUES[(job.venue ?? target?.venue)!].label } : {}),
        },
        ac.signal,
      )
      .then((result) => {
        if (ctx.state !== state || job.status !== 'designing') return;
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (result.action === 'decline') {
          job.status = 'failed';
          listen(state, 'refused', d?.name ?? '?', `design declined "${job.request.slice(0, 80)}": ${result.reply}`, ctx.now);
          if (d) failedBuild(state, d, `the designer turned down "${job.request.slice(0, 60)}": ${result.reply}`, `${d.name}'s ${job.request.slice(0, 40)} was turned down`, ctx.now);
          else pushFeed(state, ctx.now, `the Mayor's ${job.request.slice(0, 40)} was turned down: ${result.reply.slice(0, 80)}`);
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
            failedBuild(state, d, `${result.blueprint.name} could not go up: ${(e as Error).message}`, `${d.name}'s ${result.blueprint.name} didn't fit on their lot`, ctx.now);
          } else pushFeed(state, ctx.now, `the Mayor's ${result.blueprint.name} didn't fit there`);
        }
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        job.status = 'failed';
        job.error = e.message.slice(0, 300);
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (d) {
          d.lastError = `design: ${e.message}`.slice(0, 300);
          failedBuild(state, d, `designing "${job.request.slice(0, 60)}" failed; your chatter can ask again`, `${d.name}'s ${job.request.slice(0, 40)} couldn't be designed`, ctx.now);
        } else if (job.dudeId === 'mayor') pushFeed(state, ctx.now, `the Mayor's ${job.request.slice(0, 40)} couldn't be designed`);
        ctx.log(`design for ${dude.name} failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get(job.id) === ac) designCalls.delete(job.id);
        if (ctx.state === state) pump(ctx);
      });
  }

  /**
   * A build that will not happen: in the feed, so the stream sees it, and told to the character's
   * agent as something that happened to it, so it says so in its own words.
   */
  function failedBuild(state: DudesState, d: Dude, why: string, feed: string, now: number): void {
    pushFeed(state, now, feed);
    tell(state, d, why, now, true);
  }

  /** The town's community project, designed once from the proposal, as big as its lot on the square allows. */
  function designProject(ctx: WorldCtx<DudesState>, id: string): void {
    const state = ctx.state;
    const project = projectOf(state)!;
    const proposer = state.dudes.find((d) => d.id === project.by);
    const key = `project:${id}`;
    const ac = new AbortController();
    designCalls.set(key, ac);
    opts
      .design(
        {
          dudeName: proposer?.name ?? 'the town',
          persona: `A public building for the whole town, proposed by ${proposer?.name ?? 'a resident'}: ${(proposer?.persona ?? '').slice(0, 160)}`,
          request: `${project.what}. A community project for the town square: a proud public landmark everyone can use, filling a 13 m × 13 m lot.`,
          lot: 13,
          kind: 'community project',
        },
        ac.signal,
      )
      .then((result) => {
        if (ctx.state !== state) return;
        projectDesigned(state, result.action === 'decline' ? undefined : result.blueprint, ctx.now, result.action === 'decline' ? result.reply : undefined);
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        projectDesigned(state, undefined, ctx.now, 'the designer could not draw it up');
        ctx.log(`project design failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get(key) === ac) designCalls.delete(key);
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
      position: spawnPoint(state.objects, state.dudes.map((d) => d.position), ctx.rng, BUS_STOP),
      facing: Math.PI,
      path: [],
      coins: TOWN.startCoins,
      needs: freshNeeds(ctx.rng),
    };
    state.dudes.push(dude);
    // Off the bus and over to their new lot, or into a flat when the town is full.
    const lot = claimLot(state, dude, now);
    if (lot) {
      pushFeed(state, now, `${name} moved into ${lot.address}`);
      pushLine(dude.history, { from: 'world', text: `you just arrived in ${cityOf(state).name} and got a lot of your own at ${lot.address}; it is empty`, at: now }, LIMITS.history);
      sendDude(state, dude, lot.centre);
      dude.idleUntil = now + 30_000;
    } else {
      const flat = findFlat(state, dude);
      if (flat) dude.rentsAt = flat.id;
      pushFeed(state, now, flat ? `${name} arrived and took a flat in ${flat.blueprint.name}` : `${name} arrived, but every lot in town is taken`);
      pushLine(dude.history, { from: 'world', text: flat ? `you arrived in ${cityOf(state).name}; every lot was taken, so you rent a flat in ${flat.blueprint.name}` : `you arrived in ${cityOf(state).name}, but every lot is taken: ask someone to share theirs, or wait for apartments`, at: now }, LIMITS.history);
    }
    return dude;
  }

  function hear(ctx: WorldCtx<DudesState>, userId: string, username: string, text: string): void {
    const c = ctxOf(ctx);
    const now = c.now;
    const dude = dudeFor(c, userId, username, now);
    if (!dude) return c.log(`no room for ${username}'s dude (the field holds ${LIMITS.dudes})`, 'warn');
    dude.name = username.slice(0, 40);
    const returning = !awake(dude, now) && dude.turns > 0;
    dude.lastHeardAt = now;
    // Back after a while: what happened to their places goes to their agent to react to.
    if (returning) {
      const news = welcomeBack(c.state, dude, now);
      if (news) {
        dude.nudges ??= [];
        dude.nudges.push(news.slice(0, 240));
        pushLine(dude.history, { from: 'world', text: news, at: now }, LIMITS.history);
      }
    }
    if (dude.muted) return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return;
    pushLine(dude.inbox, { from: 'chatter', text: clean, at: now }, LIMITS.inbox);
    // Out on an errand of their own (inside the café, napping at home): their chatter speaking
    // brings them straight out, so the bubble is seen and the body is free for whatever comes next.
    if (dude.visit && (dude.visit.why === 'need' || dude.visit.why === 'party')) leaveVisit(dude);
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
        d.use?.phase === 'doing'
          ? 'using'
          : job?.status === 'building'
            ? 'building'
            : d.path.length
              ? 'walking'
              : !awake(d, now)
                ? 'sleeping'
                : (job?.status === 'designing' || job?.status === 'queued') && job.kind === 'build' && atDraftingSpot(d, job)
                  ? 'designing'
                  : d.emote
                    ? 'emote'
                    : 'idle',
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
      mood: moodOf(needsOf(d)),
      coins: coinsOf(d),
      needs: Object.fromEntries(NEEDS.map((n) => [n, Math.round(needsOf(d)[n])])) as DudeView['needs'],
      ...(d.bit ? { bit: { caption: d.bit.caption, ...(d.bit.prop ? { prop: d.bit.prop } : {}) } } : {}),
      ...(lotsOf(state, d)[0] ? { address: lotsOf(state, d)[0].address } : d.rentsAt ? { address: `a flat in ${state.objects.find((o) => o.id === d.rentsAt)?.blueprint.name ?? 'an apartment block'}` } : {}),
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
              ...(job.position || target ? { at: job.position ?? target!.position } : job.plot && job.kind === 'build' ? { at: job.anchor, site: job.site ?? 7 } : {}),
            },
          }
        : {}),
    };
  }

  function atDraftingSpot(d: Dude, job: Job): boolean {
    const spot = draftingSpot(job);
    return !!spot && Math.hypot(d.position.x - spot.x, d.position.z - spot.z) < 1.3;
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
      town: townView(state, now),
      ...(state.mayor ? { mayor: mayorView(state, now) } : {}),
      ...(mayorBuildViews(state).length ? { mayorBuilds: mayorBuildViews(state) } : {}),
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
        ...townieViews(state),
        ...mayorDudeView(state, now),
      ],
      ...((townBanner(state, now) ?? happeningView(state)) ? { happening: townBanner(state, now) ?? happeningView(state) } : {}),
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
      id: 'party',
      label: 'Town: throw a street party (at a build, an address, or "square")',
      input: { kind: 'text', label: 'where', maxLength: 70 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim();
        const build = v && !/^square$/i.test(v) ? matchName(v, s.objects, (o) => o.blueprint.name) : undefined;
        const lot = !build && v ? allPlots().find((l) => lower(l.address).includes(lower(v))) : undefined;
        const at = build ? (build.driven?.at ?? build.position) : lot ? lot.centre : { x: 0, z: 0 };
        throwParty(s, at, `STREET PARTY${build ? ` AT ${build.blueprint.name.toUpperCase()}` : lot ? ` ON ${lot.address.toUpperCase()}` : ' ON THE SQUARE'}`, ctx.now, build?.id);
        ctx.log(`street party thrown (admin)`, 'alert');
      },
    },
    {
      id: 'project-shelve',
      label: 'Town: shelve the community project (coins go back)',
      run: (ctx) => {
        const p = projectOf(ctx.state);
        if (!p) return ctx.log('no community project to shelve', 'warn');
        designCalls.get(`project:${p.id}`)?.abort();
        p.until = ctx.now - 1;
        if (p.status === 'designing') {
          p.status = 'failed';
        }
        ctx.log(`community project shelved (admin)`, 'alert');
      },
    },
    {
      id: 'project-finish',
      label: 'Town: finish the community project now (fills coins and labour)',
      run: (ctx) => {
        const p = projectOf(ctx.state);
        if (!p || p.status !== 'gathering') return ctx.log('no community project ready to finish', 'warn');
        p.coins = p.coinsNeed;
        p.work = p.workNeed;
        ctx.log(`community project finished (admin)`, 'alert');
      },
    },
    {
      id: 'coins',
      label: 'Town: give a chatter coins ("name 100")',
      input: { kind: 'text', label: 'name amount', maxLength: 60 },
      run: (ctx, value) => {
        const m = /^@?(.+?)\s+(-?\d+)$/.exec(String(value).trim());
        const d = m ? findDude(ctx.state, m[1]) : undefined;
        if (!m || !d) return ctx.log(`give coins as "name amount"`, 'warn');
        d.coins = Math.max(0, coinsOf(d) + Number(m[2]));
        ctx.log(`${d.name} now has §${d.coins} (admin)`);
      },
    },
    {
      id: 'release-lot',
      label: "Town: take a chatter's lot back (their builds go too)",
      input: { kind: 'text', label: 'username or address', maxLength: 60 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim();
        const d = findDude(s, v);
        const lot = d ? lotsOf(s, d).find((l) => cityOf(s).plots[l.id]?.owner === d.id) : allPlots().find((l) => lower(l.address) === lower(v));
        if (!lot || !cityOf(s).plots[lot.id]) return ctx.log(`no claimed lot for ${v}`, 'warn');
        s.objects = s.objects.filter((o) => o.plot !== lot.id);
        releaseLot(s, lot.id);
        s.worldRevision++;
        ctx.log(`${lot.address} released (admin)`, 'alert');
      },
    },
    {
      id: 'rename-town',
      label: 'Town: rename it',
      input: { kind: 'text', label: 'name', maxLength: 40 },
      run: (ctx, value) => {
        const v = String(value).trim();
        if (!v) return;
        cityOf(ctx.state).name = v.slice(0, 40);
        ctx.log(`town renamed to ${v} (admin)`);
      },
    },
    { id: 'town-off', label: 'Town life off (no residents, nobody goes out on their own)', run: (ctx) => { ctx.state.ai.townLife = false; ctx.log('town life off (admin)'); } },
    { id: 'town-on', label: 'Town life on', run: (ctx) => { ctx.state.ai.townLife = true; ctx.log('town life on (admin)'); } },
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
        for (const l of lotsOf(s, d)) if (cityOf(s).plots[l.id]?.owner === d.id) releaseLot(s, l.id);
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
    meta: { id: 'ai-dudes', name: 'AI Dudes: the town', stateVersion: STATE_VERSION },
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
      cityOf(ctx.state);
      // Tips from before the town (the forest walk, the Mayor as a troublemaker) mislead every agent: gone.
      const l = ctx.state.listener;
      if (l) l.tips = l.tips.filter((t) => !/\b(river|boss|forest|trail|journey|glade)\b|troublemaker npcs?\b|like the mayor|mayor is a troublemaker|only appears? every/i.test(t));
      // Anyone who arrived before the town had lots (or lost theirs) gets one now.
      for (const d of ctx.state.dudes) if (!lotsOf(ctx.state, d).length && !d.rentsAt) claimLot(ctx.state, d, ctx.now);
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
      tickCity(ctx.state, dt, now, ctx.rng);
      tickMayor(ctx.state, now);
      tickMayorBuilds(ctx.state, dt, now);
      tickMovers(ctx.state, dt, now, ctx.rng);
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
        `${cityOf(state).name}: ${state.dudes.length} residents (${state.dudes.filter((d) => awake(d, now)).length} awake), ${Object.keys(cityOf(state).plots).length} lots taken, ${state.objects.length} builds, ` +
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
      town: townView(state, now),
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

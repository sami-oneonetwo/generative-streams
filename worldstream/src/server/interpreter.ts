import { randomUUID } from 'node:crypto';
import { textSpriteWidth } from '../shared/atlas.js';
import { ambientPrefix, fill, makeAmbientEntity, pick } from './drift.js';
import { findSprite, normaliseName, type Catalogue, type SpriteDef } from '../shared/catalogue.js';
import { HELP_TEXT, parseCommand, type Command, type Position } from '../shared/commands.js';
import type { Config } from '../shared/config.js';
import { PARALLAX, TRANSITION_MS, VIEW, type Entity, type Layer, type Weather, type World, type WorldState } from '../shared/state.js';
import { isPrivileged, type IncomingChat } from './ingest.js';
import type { Policy } from './policy.js';
import type { Store } from './store.js';
import { applyWear, resolveWear, type ItemSlot, type Outfit, type Wardrobe, type WearAction } from '../shared/wardrobe.js';

export interface InterpreterContext {
  store: Store;
  policy: Policy;
  catalogue: Catalogue;
  cfg: Config;
  /** When set, commands change the world but the character stays quiet (the caller speaks). */
  silent?: boolean;
  /** Who has voted in the open travel vote (server memory, not state). */
  votes?: Set<string>;
  /** What chat can dress him in; absent until assets are packed. */
  wardrobe?: Wardrobe;
  /** Draws things the world does not have yet. */
  generator?: { request(req: { query: string; description?: string; user: IncomingChat['user']; world: import('../shared/state.js').World; msg: IncomingChat }): { ok: true; queued: number } | { ok: false; reason: string } };
  /** The character's own hands, for commissions. */
  builder?: { find(query: string): import('../shared/catalogue.js').BuildDef | undefined; request(plan: { def: import('../shared/catalogue.js').BuildDef; forUser?: IncomingChat['user']; announce?: (plan: { def: import('../shared/catalogue.js').BuildDef; forUser?: IncomingChat['user'] }) => string | undefined }): { ok: true; etaMs: number } | { ok: false; reason: string } };
}

export interface Outcome {
  applied: boolean;
  /** What the character says on screen in response. */
  reply?: string;
  /** Handed to the language model rather than answered directly. */
  queued?: boolean;
}

/** Entry point for every chat message. Commands are handled here; the
 *  natural-language path (milestone 4) picks up whatever returns null. */
export function handleChat(msg: IncomingChat, ctx: InterpreterContext): Outcome {
  const cmd = parseCommand(msg.content);
  if (!cmd) return { applied: false };
  return runCommand(cmd, msg, ctx);
}

const TIME_PRESETS = { night: 23, dusk: 19, dawn: 6, day: 13 } as const;

const WEATHER_LINES: Record<Weather, string> = {
  rain: 'here comes the rain again',
  storm: 'hold onto something',
  fog: 'can barely see the signs',
  clear: 'skies clearing. strange.',
  snow: 'snow? in this city?',
};

export function runCommand(cmd: Command, msg: IncomingChat, ctx: InterpreterContext): Outcome {
  const { store, policy, catalogue, cfg } = ctx;
  const now = msg.at;
  const s = store.state;
  const who = msg.user.name;

  switch (cmd.kind) {
    case 'help':
      return say(ctx, now, HELP_TEXT, false);

    case 'sign':
      return runCommand({ kind: 'add', sprite: 'neon_sign', text: cmd.text }, msg, ctx);

    case 'add': {
      const def = findSprite(catalogue, cmd.sprite);
      if (!def) return runCommand({ kind: 'generate', query: cmd.sprite }, msg, ctx);
      const layer = def.layers[0];
      const v = policy.canAdd(s, msg.user, layer, now);
      if (!v.ok) return say(ctx, now, v.reason, false);

      let text: string | undefined;
      if (def.acceptsText) {
        const f = policy.filterText(cmd.text ?? who.toUpperCase());
        if (!f.ok) return say(ctx, now, f.reason, false);
        text = f.text;
      }

      const width = textSpriteWidth(def, text);
      const x = placeX(s, layer, cmd.position, width);
      const y = placeY(layer, def.h);
      const entity: Entity = {
        id: randomUUID().slice(0, 8),
        sprite: def.name,
        layer,
        x,
        y,
        text,
        addedBy: msg.user.id,
        addedByName: who,
        addedAt: now,
        touchedAt: now,
        expiresAt: now + cfg.limits.entityTtlMs,
      };
      store.dispatch({ type: 'add_entity', entity }, who);
      policy.noteAdd(msg.user, now);
      walkTowards(ctx, entity, width);
      return say(ctx, now, addLine(ctx, def, who, text), true);
    }

    case 'remove': {
      const target = pickRemoval(s, cmd.target, msg, catalogue);
      if (!target) return say(ctx, now, `nothing like that here to remove`, false);
      const v = policy.canRemove(msg.user, target);
      if (!v.ok) return say(ctx, now, v.reason, false);
      store.dispatch({ type: 'remove_entity', id: target.id }, who);
      const removedLine = pick(catalogue.lines?.removed);
      return say(ctx, now, removedLine ? fill(removedLine, { thing: pretty(target.sprite), user: who }) : `${pretty(target.sprite)}, gone`, true);
    }

    case 'move': {
      const target = pickRemoval(s, cmd.target, msg, catalogue);
      if (!target) return say(ctx, now, `nothing like that here to move`, false);
      const v = policy.canRemove(msg.user, target);
      if (!v.ok) return say(ctx, now, v.reason, false);
      const def = catalogue.sprites.find((d) => d.name === target.sprite);
      const width = def ? textSpriteWidth(def, target.text) : 16;
      const x = placeX(s, target.layer, cmd.position, width);
      store.dispatch({ type: 'move_entity', id: target.id, x }, who);
      if (target.layer === 'stage' || target.layer === 'near') walkTowards(ctx, { ...target, x }, width);
      return say(ctx, now, `${pretty(target.sprite)} moved ${cmd.position}`, true);
    }

    case 'generate': {
      if (!ctx.generator) return say(ctx, now, `I do not have a ${cmd.query} here, ${who}. sorry.`, false);
      const v = ctx.generator.request({ query: cmd.query, description: cmd.description, user: msg.user, world: s.world, msg });
      if (!v.ok) return say(ctx, now, v.reason, false);
      return say(ctx, now, `a ${cmd.query}? I do not have one. give me a minute, ${who}, I will draw one.`, true);
    }

    case 'build': {
      if (!ctx.builder) return say(ctx, now, `I am not building today`, false);
      const def = ctx.builder.find(cmd.name);
      if (!def) {
        const names = (catalogue.builds ?? []).filter((b) => !b.welcome).map((b) => pretty(b.name)).join(', ');
        return say(ctx, now, `I do not know how to build a ${cmd.name}. I can do: ${names}`, false);
      }
      const v = ctx.builder.request({
        def,
        forUser: msg.user,
        announce: (plan) => `${plan.forUser?.name ?? 'chat'}, your ${pretty(def.name)} is done. hope you like it.`,
      });
      if (!v.ok) return say(ctx, now, v.reason, false);
      return say(ctx, now, `on it. a ${pretty(def.name)} for ${who}. give me a minute.`, true);
    }

    case 'wear': {
      const ward = ctx.wardrobe;
      if (!ward) return say(ctx, now, `no wardrobe today, ${who}. just what I have on.`, false);
      const action = resolveWear(ward, cmd.text, cmd.off);
      if (action.kind === 'unknown') {
        const sample = [...ward.items].sort(() => Math.random() - 0.5).slice(0, 6).map((i) => i.name.replace(/_/g, ' ')).join(', ');
        const what = cmd.text.replace(/_/g, ' ');
        return say(ctx, now, `I do not have ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what} to wear. try a colour for my coat, or: ${sample}`, false);
      }
      if (action.kind === 'remove' && action.slot === 'hood') return say(ctx, now, `the hood stays on, ${who}. house rule.`, false);
      const v = policy.canDress(msg.user, now);
      if (!v.ok) return say(ctx, now, v.reason, false);
      const next = applyWear(s.character.outfit, action);
      if (next === s.character.outfit) return say(ctx, now, action.kind === 'remove' ? `nothing to take off there, ${who}` : `I am already wearing that, ${who}`, false);
      store.dispatch({ type: 'dress', outfit: next }, who);
      policy.noteDress(msg.user, now);
      return say(ctx, now, wearLine(action, who, next), true);
    }

    case 'name': {
      const target = pickRemoval(s, cmd.target, msg, catalogue);
      if (!target) return say(ctx, now, `nothing like that here to name`, false);
      const v = policy.canRemove(msg.user, target);
      if (!v.ok) return say(ctx, now, v.reason, false);
      const f = policy.filterText(cmd.name);
      if (!f.ok) return say(ctx, now, f.reason, false);
      const label = f.text.slice(0, 12);
      store.dispatch({ type: 'label_entity', id: target.id, label }, who);
      walkTowards(ctx, target, catalogue.sprites.find((d) => d.name === target.sprite)?.w ?? 8);
      return say(ctx, now, `${label}. good name, ${who}.`, true);
    }

    case 'weather': {
      if (s.weather === cmd.weather) return say(ctx, now, `it is already ${cmd.weather}`, false);
      store.dispatch({ type: 'set_weather', weather: cmd.weather }, who);
      return say(ctx, now, pick(catalogue.lines?.weather?.[cmd.weather]) ?? WEATHER_LINES[cmd.weather], true);
    }

    case 'time': {
      const hour = TIME_PRESETS[cmd.preset];
      if (s.time === hour) return say(ctx, now, `it is already ${cmd.preset}`, false);
      store.dispatch({ type: 'set_time', time: hour }, who);
      return say(ctx, now, `turning towards ${cmd.preset}`, true);
    }

    case 'world': {
      if (cmd.world === s.world) return say(ctx, now, `we are already in the ${cmd.world}, ${who}`, false);
      if (s.transition) return say(ctx, now, `already on the move`, false);
      if (isPrivileged(msg.user)) {
        beginTravel(ctx, cmd.world, now);
        return say(ctx, now, `packing up. next stop: the ${cmd.world}`, true);
      }
      if (s.vote && s.vote.to !== cmd.world) return say(ctx, now, `there is already a vote to leave for the ${s.vote.to}. !vote if you are in`, false);
      if (s.vote) return castVote(ctx, msg, now);
      ctx.votes = new Set([msg.user.id]);
      const needed = cfg.votes.worldChangeVoters;
      store.dispatch({ type: 'set_vote', vote: { to: cmd.world, count: 1, needed, until: now + cfg.votes.windowMs } }, who);
      return say(ctx, now, `${who} wants the ${cmd.world}. !vote if you are in (1/${needed})`, true);
    }

    case 'vote':
      if (!s.vote) return say(ctx, now, `nothing to vote on right now`, false);
      return castVote(ctx, msg, now);

    case 'event': {
      if (!isPrivileged(msg.user)) return say(ctx, now, `only the crew can call events, ${who}`, false);
      const def = (catalogue.ambient ?? []).find((a) => a.name === cmd.name || a.sprite === cmd.name);
      if (!def) return say(ctx, now, `no event called ${cmd.name}. try: ${(catalogue.ambient ?? []).map((a) => a.name).join(', ')}`, false);
      if (s.entities.some((e) => e.id.startsWith(ambientPrefix(def.name)))) return say(ctx, now, `${def.name} is already happening`, false);
      store.dispatch({ type: 'add_entity', entity: makeAmbientEntity(def, now) }, who);
      return say(ctx, now, pick(def.lines) ?? `here comes the ${def.name.replace(/_/g, ' ')}`, true);
    }

    case 'unknown':
      return say(ctx, now, `not sure what that means, ${who}. !help lists everything`, false);
  }
}

function castVote(ctx: InterpreterContext, msg: IncomingChat, now: number): Outcome {
  const s = ctx.store.state;
  const vote = s.vote!;
  ctx.votes ??= new Set();
  if (ctx.votes.has(msg.user.id)) return say(ctx, now, `you already voted, `, false);
  ctx.votes.add(msg.user.id);
  const count = ctx.votes.size;
  if (count >= vote.needed) {
    beginTravel(ctx, vote.to, now);
    return say(ctx, now, `that settles it. the .`, true);
  }
  ctx.store.dispatch({ type: 'set_vote', vote: { ...vote, count } }, msg.user.name);
  return say(ctx, now, `/ for the `, true);
}

/** Leave for another world: spawn the departure ride if this world has one, walk off, and let the tick finish the trip. */
export function beginTravel(ctx: InterpreterContext, to: World, now: number): void {
  const s = ctx.store.state;
  ctx.store.dispatch({ type: 'begin_transition', to, at: now, durationMs: TRANSITION_MS }, 'travel');
  ctx.votes = undefined;
  const ride = (ctx.catalogue.ambient ?? []).find((a) => a.departure);
  if (ride && !s.entities.some((e) => e.id.startsWith(ambientPrefix(ride.name)))) {
    ctx.store.dispatch({ type: 'add_entity', entity: makeAmbientEntity(ride, now) }, 'travel');
  }
  const targetX = Math.round(Math.min(VIEW.worldW - 1, s.camera.x + VIEW.w + 24));
  ctx.store.dispatch({ type: 'set_character', patch: { targetX, facing: 'r', mode: 'travel' } }, 'travel');
}

/** Put words in the character's mouth. */
/** What he says when dressed; the item lines invite chat to react. */
function wearLine(a: WearAction, who: string, _outfit: Outfit | undefined): string {
  if (a.kind === 'colour') return pick([`${a.colour} ${a.slot}. I like it, ${who}. thank you.`, `a ${a.colour} ${a.slot}. bold. thanks, ${who}.`, `${a.colour}. good eye, ${who}.`]) ?? '';
  if (a.kind === 'item') {
    const n = a.item.name.replace(/_/g, ' ');
    const c = a.colour ? `${a.colour} ` : '';
    const an = /^[aeiou]/.test(c || n) ? 'an' : 'a';
    const lines: Record<ItemSlot, string[]> = {
      head: [`${an} ${c}${n}. how do I look, chat?`, `${c}${n} on. thank you, ${who}. very me.`, `${an} ${c}${n}. I feel taller. thanks, ${who}.`],
      face: [`${c}${n}. can barely see, but I look good. thanks, ${who}.`, `${c}${n} on. mysterious. thank you, ${who}.`],
      back: [`${an} ${c}${n}. I feel faster already. thanks, ${who}.`, `${c}${n}. careful, chat, I may take off.`],
      hand: [`${an} ${c}${n}. handy. thank you, ${who}.`, `holding the ${c}${n}. what now, chat?`],
    };
    return pick(lines[a.item.slot]) ?? '';
  }
  if (a.kind === 'remove') return a.slot === 'all' ? `back to my usual clothes. thanks, ${who}.` : `off it comes. thank you, ${who}.`;
  return '';
}

export function characterSay(ctx: InterpreterContext, now: number, text: string): void {
  const c = ctx.store.state.character;
  const mode = c.mode === 'travel' ? 'travel' : c.targetX !== undefined ? 'walk' : 'talk';
  ctx.store.dispatch({ type: 'set_character', patch: { bubble: { text, until: now + ctx.cfg.drift.bubbleMs }, mode } }, 'character');
}

function say(ctx: InterpreterContext, now: number, text: string, applied: boolean): Outcome {
  if (!ctx.silent) characterSay(ctx, now, text);
  return { applied, reply: text };
}

function addLine(ctx: InterpreterContext, def: SpriteDef, who: string, text?: string): string {
  const lines = ctx.catalogue.lines;
  const vars = { user: who, thing: pretty(def.name), text: text ?? '' };
  if (def.acceptsText && text) return fill(pick(lines?.addedText) ?? '{user} lit up "{text}"', vars);
  return fill(pick(lines?.added) ?? '{user} brought a {thing}', vars);
}

const pretty = (name: string) => name.replace(/_/g, ' ');

/** Pick a world x so the entity lands in the requested screen band, accounting for parallax. */
function placeX(s: WorldState, layer: Layer, pos: Position | undefined, w: number): number {
  const bands: Record<Position, [number, number]> = { left: [24, 150], centre: [180, 300], right: [330, 456] };
  const [a, b] = pos ? bands[pos] : [24, 456];
  const screenX = a + Math.random() * (b - a) - w / 2;
  const worldX = screenX + s.camera.x * PARALLAX[layer];
  return Math.round(Math.max(0, Math.min(VIEW.worldW - w, worldX)));
}

const LAYER_Y: Record<Layer, [number, number]> = {
  sky: [16, 50],
  far: [60, 100],
  mid: [84, 150],
  near: [130, 178],
  stage: [VIEW.groundY, VIEW.groundY],
  fg: [0, 0],
  weather: [0, 0],
  ui: [0, 0],
};

export function placeY(layer: Layer, h: number): number {
  if (layer === 'stage') return VIEW.groundY - h;
  const [a, b] = LAYER_Y[layer];
  return Math.round(a + Math.random() * (b - a));
}

function walkTowards(ctx: InterpreterContext, e: Entity, width: number): void {
  if (e.layer !== 'stage' && e.layer !== 'near') return;
  const c = ctx.store.state.character;
  const centre = e.x + width / 2;
  const standAt = centre + (centre < c.x ? 14 : -14);
  const targetX = Math.round(Math.max(8, Math.min(VIEW.worldW - 8, standAt)));
  ctx.store.dispatch({ type: 'set_character', patch: { targetX, facing: targetX < c.x ? 'l' : 'r', mode: 'walk' } }, 'character');
}

function pickRemoval(s: WorldState, target: string, msg: IncomingChat, catalogue: Catalogue): Entity | undefined {
  const newestFirst = s.entities.slice().reverse();
  const byId = newestFirst.find((e) => e.id === target);
  if (byId) return byId;
  const byLabel = newestFirst.find((e) => e.label && e.label.toLowerCase() === target.toLowerCase());
  if (byLabel) return byLabel;
  if (target === 'mine') return newestFirst.find((e) => e.addedBy === msg.user.id);
  if (target === 'last') return newestFirst[0];
  const name = findSprite(catalogue, target)?.name ?? normaliseName(target);
  const ownFirst = newestFirst.find((e) => e.sprite === name && e.addedBy === msg.user.id);
  if (ownFirst) return ownFirst;
  return isPrivileged(msg.user) ? newestFirst.find((e) => e.sprite === name) : newestFirst.find((e) => e.sprite === name);
}

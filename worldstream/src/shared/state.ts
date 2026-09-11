// World state: the single source of truth, owned by the server, broadcast
// whole to renderers. Everything here is plain data and the reducer is pure.
import type { Outfit } from './wardrobe.js';

export const WORLDS = ['cyberpunk', 'countryside', 'castle', 'desert'] as const;
export type World = (typeof WORLDS)[number];

export const LAYERS = ['sky', 'far', 'mid', 'near', 'stage', 'fg', 'weather', 'ui'] as const;
export type Layer = (typeof LAYERS)[number];

export const WEATHERS = ['clear', 'rain', 'storm', 'fog', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];

/** How long a trip between worlds takes, from departure to arrival. */
export const TRANSITION_MS = 5000;

/** Internal pixel canvas. All coordinates are integers in this space. */
export const VIEW = { w: 480, h: 270, groundY: 220, worldW: 960 } as const;

/** Horizontal parallax factor per layer (screenX = x - camera.x * factor). */
export const PARALLAX: Record<Layer, number> = {
  sky: 0,
  far: 0.1,
  mid: 0.3,
  near: 0.6,
  stage: 1,
  fg: 1.2,
  weather: 0,
  ui: 0,
};

export interface Motion {
  fromX: number;
  toX: number;
  startAt: number;
  endAt: number;
}

export interface Entity {
  id: string;
  sprite: string;
  layer: Layer;
  /** Top-left in world pixels. */
  x: number;
  y: number;
  /** Signs and screens render this in the pixel font. */
  text?: string;
  /** Server-scripted motion; the renderer interpolates. */
  motion?: Motion;
  /** A name viewers gave this thing, shown above it. */
  label?: string;
  /** Follows the character around. */
  follow?: boolean;
  /** A short line this thing is saying right now. */
  say?: { text: string; until: number };
  addedBy: string;
  addedByName: string;
  addedAt: number;
  touchedAt: number;
  expiresAt: number;
}

export type CharacterMode = 'idle' | 'walk' | 'talk' | 'travel';

export const NEEDS = ['food', 'comfort', 'rest', 'spirit'] as const;
export type Need = (typeof NEEDS)[number];

/** The character's body. Needs run 0..100; comfort is warmth in the city and water in the desert. */
export interface Vitals {
  food: number;
  comfort: number;
  rest: number;
  spirit: number;
  deaths: number;
  /** In-world days survived since the last death. */
  days: number;
  dayProgress: number;
  collapsed?: { need: Need; since: number; until: number };
  blackout?: { since: number; until: number };
  lastSavedBy?: string;
}

export function initialVitals(): Vitals {
  return { food: 70, comfort: 70, rest: 80, spirit: 60, deaths: 0, days: 0, dayProgress: 0 };
}

export type ErrandStage = 'travelling' | 'searching' | 'found' | 'returning';

/** A trip to fetch something from another world. */
export interface Errand {
  item: string;
  target: World;
  home: World;
  stage: ErrandStage;
  since: number;
  /** The world turned the item up itself after chat did not. */
  spawned?: boolean;
}

export interface CharacterState {
  /** Feet position in world pixels. */
  x: number;
  y: number;
  mode: CharacterMode;
  facing: 'l' | 'r';
  targetX?: number;
  bubble?: { text: string; until: number };
  vitals: Vitals;
  sleeping?: { until: number };
  inventory?: string[];
  errand?: Errand;
  /** What chat has dressed him in; absent means the base drawing. Travels with him. */
  outfit?: Outfit;
}

/** An open vote to travel somewhere else; the renderer shows the tally. */
export interface WorldVote {
  to: World;
  count: number;
  needed: number;
  until: number;
}

/** An open question from the character to chat; the renderer shows it with a countdown. */
export interface HostAsk {
  id: string;
  text: string;
  hint?: string;
  until: number;
  totalMs: number;
}

export interface HostState {
  ask?: HostAsk;
  /** Rotating one-line suggestion for viewers. */
  hint?: string;
}

export interface WorldState {
  version: number;
  world: World;
  /** In-world hour, 0..24. */
  time: number;
  weather: Weather;
  camera: { x: number };
  character: CharacterState;
  entities: Entity[];
  vote?: WorldVote;
  transition?: { to: World; startedAt: number; durationMs: number };
  host?: HostState;
  music?: { enabled: boolean; volume: number };
}

export type Mutation =
  | { type: 'add_entity'; entity: Entity }
  | { type: 'remove_entity'; id: string }
  | { type: 'move_entity'; id: string; x: number; y?: number }
  | { type: 'touch_entity'; id: string; at: number; ttlMs: number }
  | { type: 'set_motion'; id: string; motion: Motion | undefined; x?: number }
  | { type: 'label_entity'; id: string; label: string | undefined }
  | { type: 'set_follow'; id: string; follow: boolean }
  | { type: 'entity_say'; id: string; say: Entity['say'] | undefined }
  | { type: 'set_weather'; weather: Weather }
  | { type: 'set_time'; time: number }
  | { type: 'set_camera'; x: number }
  | { type: 'set_character'; patch: Partial<CharacterState> }
  | { type: 'dress'; outfit: Outfit | undefined }
  | { type: 'begin_transition'; to: World; at: number; durationMs: number }
  | { type: 'end_transition' }
  | { type: 'set_vote'; vote: WorldVote | undefined }
  | { type: 'set_ask'; ask: HostAsk | undefined }
  | { type: 'set_hint'; hint: string | undefined }
  | { type: 'set_vitals'; patch: Partial<Vitals> }
  | { type: 'collapse'; need: Need; at: number; windowMs: number }
  | { type: 'revive'; at: number; by?: string }
  | { type: 'death'; at: number; blackoutMs: number; respawnX: number }
  | { type: 'sleep'; until: number }
  | { type: 'wake' }
  | { type: 'set_music'; enabled?: boolean; volume?: number }
  | { type: 'expire'; now: number }
  | { type: 'clear_entities' };

const DEFAULT_WEATHER: Record<World, Weather> = {
  cyberpunk: 'rain',
  countryside: 'clear',
  castle: 'fog',
  desert: 'clear',
};

export function initialState(world: World): WorldState {
  return {
    version: 0,
    world,
    time: 22,
    weather: DEFAULT_WEATHER[world],
    camera: { x: 0 },
    character: { x: 240, y: VIEW.groundY, mode: 'idle', facing: 'r', vitals: initialVitals() },
    entities: [],
  };
}

const clampX = (x: number) => Math.round(Math.max(0, Math.min(VIEW.worldW - 1, x)));
const clampY = (y: number) => Math.round(Math.max(0, Math.min(VIEW.h - 1, y)));
const wrapHour = (t: number) => ((t % 24) + 24) % 24;

/** Pure reducer. Returns the same reference when nothing changed. */
export function apply(state: WorldState, m: Mutation): WorldState {
  const next = reduce(state, m);
  if (next === state) return state;
  return { ...next, version: state.version + 1 };
}

function updateEntity(s: WorldState, id: string, fn: (e: Entity) => Entity): WorldState {
  const i = s.entities.findIndex((e) => e.id === id);
  if (i < 0) return s;
  const next = fn(s.entities[i]);
  if (next === s.entities[i]) return s;
  const entities = s.entities.slice();
  entities[i] = next;
  return { ...s, entities };
}

function reduce(s: WorldState, m: Mutation): WorldState {
  switch (m.type) {
    case 'add_entity': {
      if (s.entities.some((e) => e.id === m.entity.id)) return s;
      const e: Entity = { ...m.entity, x: clampX(m.entity.x), y: clampY(m.entity.y) };
      return { ...s, entities: [...s.entities, e] };
    }
    case 'remove_entity': {
      if (!s.entities.some((e) => e.id === m.id)) return s;
      return { ...s, entities: s.entities.filter((e) => e.id !== m.id) };
    }
    case 'move_entity':
      return updateEntity(s, m.id, (cur) => {
        const moved: Entity = { ...cur, x: clampX(m.x), y: m.y === undefined ? cur.y : clampY(m.y) };
        return moved.x === cur.x && moved.y === cur.y ? cur : moved;
      });
    case 'touch_entity':
      return updateEntity(s, m.id, (cur) => ({ ...cur, touchedAt: m.at, expiresAt: m.at + m.ttlMs }));
    case 'set_motion':
      return updateEntity(s, m.id, (cur) => {
        const next: Entity = { ...cur, motion: m.motion };
        if (m.x !== undefined) next.x = clampX(m.x);
        if (!m.motion) delete next.motion;
        return next;
      });
    case 'label_entity':
      return updateEntity(s, m.id, (cur) => (cur.label === m.label ? cur : { ...cur, label: m.label }));
    case 'set_follow':
      return updateEntity(s, m.id, (cur) => (Boolean(cur.follow) === m.follow ? cur : { ...cur, follow: m.follow }));
    case 'entity_say':
      return updateEntity(s, m.id, (cur) => {
        if (!m.say && !cur.say) return cur;
        const next = { ...cur, say: m.say };
        if (!m.say) delete next.say;
        return next;
      });
    case 'set_weather':
      return s.weather === m.weather ? s : { ...s, weather: m.weather };
    case 'set_time': {
      const t = wrapHour(m.time);
      return t === s.time ? s : { ...s, time: t };
    }
    case 'set_camera': {
      const x = Math.round(Math.max(0, Math.min(VIEW.worldW - VIEW.w, m.x)));
      return x === s.camera.x ? s : { ...s, camera: { x } };
    }
    case 'set_character':
      return { ...s, character: { ...s.character, ...m.patch } };
    case 'dress':
      if (JSON.stringify(s.character.outfit ?? null) === JSON.stringify(m.outfit ?? null)) return s;
      return { ...s, character: { ...s.character, outfit: m.outfit } };
    case 'begin_transition':
      if (s.transition || m.to === s.world) return s;
      return { ...s, vote: undefined, transition: { to: m.to, startedAt: m.at, durationMs: m.durationMs } };
    case 'end_transition':
      return s.transition ? { ...s, transition: undefined } : s;
    case 'set_vote':
      if (!m.vote && !s.vote) return s;
      return { ...s, vote: m.vote };
    case 'set_ask':
      if (!m.ask && !s.host?.ask) return s;
      return { ...s, host: { ...(s.host ?? {}), ask: m.ask } };
    case 'set_hint':
      if ((s.host?.hint ?? undefined) === m.hint) return s;
      return { ...s, host: { ...(s.host ?? {}), hint: m.hint } };
    case 'set_vitals': {
      const v = { ...s.character.vitals, ...m.patch };
      for (const n of NEEDS) v[n] = Math.max(0, Math.min(100, v[n]));
      return { ...s, character: { ...s.character, vitals: v } };
    }
    case 'collapse': {
      if (s.character.vitals.collapsed || s.character.vitals.blackout) return s;
      const vitals: Vitals = { ...s.character.vitals, collapsed: { need: m.need, since: m.at, until: m.at + m.windowMs } };
      return { ...s, character: { ...s.character, vitals, targetX: undefined, sleeping: undefined, mode: 'idle' } };
    }
    case 'revive': {
      const cur = s.character.vitals;
      if (!cur.collapsed) return s;
      const vitals: Vitals = { ...cur, collapsed: undefined, lastSavedBy: m.by ?? cur.lastSavedBy };
      vitals[cur.collapsed.need] = Math.max(vitals[cur.collapsed.need], 40);
      return { ...s, character: { ...s.character, vitals, mode: 'talk' } };
    }
    case 'death': {
      const cur = s.character.vitals;
      const vitals: Vitals = {
        ...cur,
        food: 60,
        comfort: 60,
        rest: 70,
        spirit: 30,
        deaths: cur.deaths + 1,
        days: 0,
        dayProgress: 0,
        collapsed: undefined,
        blackout: { since: m.at, until: m.at + m.blackoutMs },
      };
      const x = clampX(m.respawnX);
      return {
        ...s,
        entities: s.entities.map((e) => (e.follow ? { ...e, follow: false } : e)),
        character: { ...s.character, vitals, x, targetX: clampX(x + 180), mode: 'walk', facing: 'r', bubble: undefined, sleeping: undefined },
      };
    }
    case 'sleep':
      return { ...s, character: { ...s.character, sleeping: { until: m.until }, targetX: undefined, mode: 'idle' } };
    case 'wake':
      return s.character.sleeping ? { ...s, character: { ...s.character, sleeping: undefined, mode: 'idle' } } : s;
    case 'set_music': {
      const cur = s.music ?? { enabled: true, volume: 0.6 };
      const next = { enabled: m.enabled ?? cur.enabled, volume: Math.max(0, Math.min(1, m.volume ?? cur.volume)) };
      return next.enabled === cur.enabled && next.volume === cur.volume && s.music ? s : { ...s, music: next };
    }
    case 'expire': {
      const kept = s.entities.filter((e) => e.expiresAt > m.now);
      return kept.length === s.entities.length ? s : { ...s, entities: kept };
    }
    case 'clear_entities':
      return s.entities.length === 0 ? s : { ...s, entities: [] };
  }
}

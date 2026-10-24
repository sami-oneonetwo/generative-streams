// The Mayor: the streamer, in the town. Walked with WASD from the operator page (/mayor), which
// also steers the camera; the stream view follows that camera, so the stream is the Mayor's
// walk round town while the streamer talks over it. The operator page moves the figure itself
// (it is never held back by the snapshot clock) and sends where it is; the server checks it,
// keeps it, and passes it straight on to every page between snapshots. What the Mayor types is
// said aloud in a bubble: characters nearby overhear it, anyone it names is told, and the
// town's residents turn and answer. Zero AI here; the agents answer on turns of their own.
import { clampToGround, workSpots } from './placement';
import { addEffect, awake, clearFootprint, inUse, isActive, overhear, parkObject, seatHeight } from './sim';
import { altitudeOf, flies, rideable, setAltitude, startMoving } from './movers';
import { abilitiesOf } from './blueprint';
import { ageOf, cityOf, freeSpotOn, stampAge, themed, gossip, headName, lotsOf, placeById, placeOfObject, startPlaying, tell } from './city';
import { MODERN, ageStyle } from '../../shared/ages';
import { outfitFor } from '../../shared/outfits';
import { interactionOf } from './blueprint';
import { plotAt, venueKindOf } from '../../shared/city';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { matchName } from './index';
import { EMOTES, WEAPONS, type DudeLook, type DudeView, type Emote, type MayorView, type Weapon } from '../../shared/dudesTypes';
import { armedBuild, fire, ram } from './weapons';
import { LIMITS, nextId, pushFeed, pushLine, storyOn, type DudesState, type Job, type Mayor } from './state';
import { nudge } from './events';
import { renewed } from './damage';
import { onShowInput, type ShowInput } from './story/beats'; // FK-001
import { storyMayorView } from './story/view'; // FK-001

export const MAYOR = {
  name: 'The Mayor',
  /** The operator page counts as there while it has sent anything this recently. */
  liveMs: 15_000,
  /** Characters this close hear what the Mayor says; residents this close answer. */
  hearing: 12,
  answering: 9,
  /** How close he has to be to something to get on it (metres from its edge). */
  reach: 4,
  /** Camera zoom (orthographic half-height, metres) the operator may ask for. */
  half: [5, 45] as const,
  /**
   * The longest the show may keep him on a mark (FK-020): past the longest scene's lock (the Rising's
   * 4 min) and its 25 s Call, so only a release that never came hits it, and Sami's WASD comes back.
   */
  lockMs: 5 * 60_000,
};
export const MAYOR_LOOK: DudeLook = {
  skin: '#e0ac85',
  shirt: '#2b2f3a',
  pants: '#22252c',
  hair: '#2b2018',
  hat: 'propeller',
  hatColor: '#c4402f',
  accessory: 'scarf',
  accessoryColor: '#d9a23a',
  height: 1.12,
  build: 1.1,
};

/** What the streamer's character wears in this age: robes, a crown, a top hat; the Modern age is MAYOR_LOOK. */
const headLook = (state: DudesState): DudeLook => {
  // The theme-free sandbox: the Mayor as he is, no period costume.
  const age = themed(state) ? ageOf(state) : MODERN;
  const outfit = themed(state) ? outfitFor(age, 'mayor', 'head') : undefined;
  // What the aide changed goes over the age's look; with the costume off, the colours underneath show.
  const { costume, ...mine } = state.mayor?.look ?? {};
  return { ...ageStyle(age).head.look, ...mine, ...(outfit && costume !== false ? { outfit } : {}) };
};

/** What the operator page sends, many times a second while it moves. */
export type MayorInput =
  | { t: 'move'; x: number; z: number; facing: number; moving: boolean; running?: boolean; yaw?: number; half?: number; cx?: number; cz?: number; alt?: number; at?: number }
  | { t: 'say'; text: string }
  | { t: 'emote'; pose: string }
  | { t: 'follow'; on: boolean }
  /** The stream camera's mode: on the Mayor, framing everyone, or on one person. */
  | { t: 'camera'; mode: 'mayor' | 'everyone' | 'person'; target?: string }
  | { t: 'visible'; on: boolean }
  | { t: 'ride' }
  | { t: 'audio'; music: number; sfx: number }
  | { t: 'play' }
  | { t: 'build'; what: string; at?: { x: number; z: number }; for?: string }
  /** Rework a build he clicked: "give the castle a trebuchet". Anyone's build; it stays theirs. */
  | { t: 'edit'; target: string; change: string }
  /** Take a build down (he clicked it and pressed Delete). Anyone's. */
  | { t: 'remove'; target: string }
  /** A wish for the aide (aide.ts): "put me in a purple cape". Answered on a model call of its own. */
  | { t: 'ask'; text: string }
  /** Pick up a weapon (or put it away: none), fire it (at a point he clicked, or straight ahead), or drive into a build. */
  | { t: 'arm'; weapon: string }
  | { t: 'fire'; aim?: { x: number; z: number } }
  | { t: 'ram'; target: string; speed: number }
  /** Finders Keepers' show keys (Tab, the cue lines, GO …): handed to story/beats.ts, whose kinds they are. */
  | ShowInput;

export function mayorOf(state: DudesState, now: number): Mayor {
  return (state.mayor ??= { position: { x: 0, z: 9 }, facing: Math.PI, moving: false, follow: true, cam: { yaw: 0.65, half: 14 }, lastInputAt: now - MAYOR.liveMs - 1 });
}
const live = (m: Mayor, now: number) => now - m.lastInputAt < MAYOR.liveMs;

/**
 * When a step was taken, in server time: the operator page stamps each one with its own clock, and
 * that is turned into server time at the quickest delivery seen (drifting back slowly, like the
 * page's own snapshot clock). Messages that arrive bunched up by the network keep the spacing they
 * were sent with, so the stream slides the Mayor at the pace he walked, instead of reading two
 * steps a few milliseconds apart as a teleport.
 */
const clock = { offset: NaN, last: 0, lastNow: 0 };
function stampOf(at: unknown, now: number): number {
  if (typeof at !== 'number' || !Number.isFinite(at)) return now;
  const sample = now - at;
  clock.offset = Number.isNaN(clock.offset) ? sample : Math.min(sample, clock.offset + (now - clock.lastNow) * 0.002);
  clock.lastNow = now;
  // Never ahead of now, never before the last one, and never far behind (a sleeping tab).
  const t = Math.max(clock.last + 1, Math.min(now, Math.max(now - 1000, at + clock.offset)));
  clock.last = t;
  return t;
}

/** Apply one message from the operator page; returns what every page should hear right away, and when it happened. */
export function mayorInput(state: DudesState, raw: unknown, now: number): { view: MayorView; at: number } | undefined {
  const msg = raw as MayorInput;
  if (!msg || typeof msg !== 'object') return undefined;
  const m = mayorOf(state, now);
  m.lastInputAt = now;
  let at = now;
  switch (msg.t) {
    case 'move': {
      if (![msg.x, msg.z, msg.facing].every(Number.isFinite)) return undefined;
      at = stampOf(msg.at, now);
      // On his mark for a scene, he stays on it whatever the page sends (a step sent before it heard
      // of the lock, a heartbeat); the camera still turns and zooms round him.
      const lock = headLock(state);
      m.position = lock ? { ...lock.at } : clampToGround({ x: msg.x, z: msg.z }, 0.5);
      m.facing = lock ? lock.facing : msg.facing;
      m.moving = !lock && !!msg.moving;
      m.running = !lock && !!msg.running;
      if (Number.isFinite(msg.yaw)) m.cam.yaw = msg.yaw!;
      if (Number.isFinite(msg.half)) m.cam.half = Math.max(MAYOR.half[0], Math.min(MAYOR.half[1], msg.half!));
      // Where the camera looks: on the Mayor, or wherever the operator has flown it (a little past the edge at most).
      if (Number.isFinite(msg.cx) && Number.isFinite(msg.cz) && !lock) {
        const c = clampToGround({ x: msg.cx!, z: msg.cz! }, -20);
        m.cam.x = c.x;
        m.cam.z = c.z;
      } else {
        m.cam.x = m.position.x;
        m.cam.z = m.position.z;
      }
      // Walking off ends a pose (and whatever he was playing at).
      if (m.moving && m.emote) m.emote = undefined;
      if (m.moving && m.playing) stopPlaying(m);
      if (m.riding) ridden(state, m, msg.alt);
      break;
    }
    case 'say': {
      if (headHidden(state, m)) return undefined; // nobody to say it
      const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.say);
      if (!text) return undefined;
      speak(state, m, text, now);
      break;
    }
    case 'emote': {
      if (headHidden(state, m)) return undefined;
      const pose = (EMOTES as readonly string[]).includes(msg.pose) ? (msg.pose as Emote) : undefined;
      if (!pose) return undefined;
      m.emote = { pose, until: now + (pose === 'dance' ? 10_000 : pose === 'sit' || pose === 'think' ? 60_000 : 3500) };
      waveBack(state, m, now, pose);
      break;
    }
    case 'follow':
      m.follow = !!msg.on;
      m.focus = undefined;
      break;
    case 'camera': {
      const target = String(msg.target ?? '');
      const known = state.dudes.some((d) => d.id === target) || cityOf(state).townies.some((t) => t.id === target) || (state.npcs ?? []).some((n) => n.id === target);
      if (msg.mode === 'person' && known) {
        m.focus = target;
        m.follow = false;
      } else {
        m.focus = undefined;
        m.follow = msg.mode === 'mayor';
      }
      break;
    }
    case 'ride':
      if (headLock(state)) return undefined; // on his mark: nothing to get on or off until the release
      if (m.riding) getOff(state, m);
      else if (!getOn(state, m)) return undefined;
      break;
    case 'build':
      mayorBuild(state, m, msg, now);
      break;
    case 'edit':
      mayorEdit(state, msg, now);
      break;
    case 'remove': {
      const o = state.objects.find((x) => x.id === String(msg.target ?? ''));
      if (!o) break;
      state.objects = state.objects.filter((x) => x !== o);
      state.jobs = state.jobs.filter((j) => j.targetId !== o.id);
      state.worldRevision++;
      pushFeed(state, now, `${headName(state)} took down ${o.blueprint.name}`);
      const owner = o.owner ? state.dudes.find((d) => d.id === o.owner) : undefined;
      if (owner) tell(state, owner, `${headName(state)} took down your ${o.blueprint.name}`, now, true);
      break;
    }
    case 'play':
      if (headLock(state)) return undefined;
      if (m.playing) stopPlaying(m);
      else if (!play(state, m, now)) return undefined;
      break;
    case 'audio': {
      const level = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));
      m.audio = { music: level(msg.music), sfx: level(msg.sfx) };
      break;
    }
    case 'ask': {
      const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!text) return undefined;
      if (m.ask) return undefined; // one wish at a time
      m.ask = { text, at: now };
      m.aide = { asked: text, reply: '', ok: true, at: now };
      break;
    }
    case 'arm':
      if (headLock(state)) return undefined; // the show put it away: it stays away until the release
      m.armed = (WEAPONS as readonly string[]).includes(msg.weapon) ? (msg.weapon as Weapon) : undefined;
      break;
    case 'fire': {
      if (headHidden(state, m) || headLock(state)) return undefined;
      const vehicle = m.riding ? state.objects.find((o) => o.id === m.riding) : undefined;
      const gun = vehicle && armedBuild(vehicle) ? 'cannon' : m.armed;
      if (!gun) return undefined;
      const aim = msg.aim && Number.isFinite(msg.aim.x) && Number.isFinite(msg.aim.z) ? { x: msg.aim.x, z: msg.aim.z } : undefined;
      if (!fire(state, { id: 'mayor', name: headName(state), position: m.position, facing: m.facing, vehicle }, gun, aim, now)) return undefined;
      if (!vehicle) {
        m.emote = { pose: 'point', until: now + 500 };
        if (m.playing) stopPlaying(m);
      }
      break;
    }
    case 'ram': {
      if (headLock(state)) return undefined;
      const vehicle = m.riding ? state.objects.find((o) => o.id === m.riding) : undefined;
      if (!vehicle || !ram(state, { id: 'mayor', name: headName(state), position: m.position, facing: m.facing, vehicle }, String(msg.target ?? ''), Number(msg.speed), now)) return undefined;
      break;
    }
    case 'visible':
      // The page's own wish: kept even while the show overrides it (headHidden), so it holds again after.
      m.hidden = !msg.on || undefined;
      if (headHidden(state, m)) {
        m.say = undefined;
        m.emote = undefined;
      }
      break;
    case 'show':
      if (typeof msg.k !== 'string' || !onShowInput(state, msg, now)) return undefined;
      break;
    default:
      return undefined;
  }
  return { view: mayorView(state, now), at };
}

/** The Mayor says something: the bubble, the characters in earshot, whoever is named, and the residents nearby. */
function speak(state: DudesState, m: Mayor, text: string, now: number): void {
  m.say = { text, until: now + Math.max(4000, Math.min(16_000, 2500 + text.length * 65)) };
  pushFeed(state, now, `${headName(state)}: ${text}`);
  // Overheard like anyone talking nearby (sim.ts `overhear` wants a speaker with an id).
  overhear(state, { id: 'mayor', name: headName(state), position: m.position }, text, now);
  // Anyone named, wherever they are in town, is told directly: their agent answers on a turn of its own.
  const named = new Set<string>();
  for (const word of text.split(/[\s,.!?]+/).filter((w) => w.length > 1)) {
    const d = matchName(word.replace(/^@/, ''), state.dudes, (x) => x.name);
    if (d && d.name.toLowerCase().startsWith(word.replace(/^@/, '').toLowerCase()) && awake(d, now)) named.add(d.id);
  }
  for (const d of state.dudes) {
    const near = Math.hypot(d.position.x - m.position.x, d.position.z - m.position.z) < MAYOR.hearing;
    if (named.has(d.id)) nudge(state, d, `The Mayor (the streamer, walking round town) said to you: "${text}"`, now);
    else if (near && awake(d, now)) pushLine(d.history, { from: 'world', text: `The Mayor, passing by, said: "${text}"`, at: now }, LIMITS.history);
  }
  // The town's residents nearby turn to look, and one of them answers.
  const near = cityOf(state).townies.filter((t) => !t.hidden && Math.hypot(t.position.x - m.position.x, t.position.z - m.position.z) < MAYOR.answering);
  near.forEach((t, i) => {
    t.facing = Math.atan2(m.position.x - t.position.x, m.position.z - t.position.z);
    t.path = [];
    t.doing = 'chat';
    t.until = Math.max(t.until, now + 6000);
    if (i === 0) t.say = { text: replyTo(state, text, now), until: now + 6500 };
    else t.emote = { pose: Math.random() < 0.5 ? 'wave' : 'laugh', until: now + 2500 };
  });
}

/** A resident's answer to the Mayor: a greeting, a complaint, or whatever the town is talking about. */
function replyTo(state: DudesState, text: string, now: number): string {
  const t = text.toLowerCase();
  const rng = Math.random;
  if (/\b(hi|hello|hey|morning|evening|afternoon)\b/.test(t)) return ['Afternoon, Mayor.', 'Hello, Mayor! Lovely day for it.', 'Mayor! Fancy seeing you out here.'][Math.floor(rng() * 3)];
  if (/\?$/.test(t)) return ['Couldn\'t tell you, Mayor.', 'Ask me again after lunch.', gossip(state, now, rng)][Math.floor(rng() * 3)];
  return rng() < 0.5 ? gossip(state, now, rng) : ['Hear, hear!', 'Vote Mayor!', 'You said it, Mayor.', 'Is that a new hat, Mayor?'][Math.floor(rng() * 4)];
}

/** A wave or a cheer from the Mayor gets one back from whoever is close. */
function waveBack(state: DudesState, m: Mayor, now: number, pose: Emote): void {
  if (pose !== 'wave' && pose !== 'cheer' && pose !== 'bow') return;
  for (const t of cityOf(state).townies)
    if (!t.hidden && Math.hypot(t.position.x - m.position.x, t.position.z - m.position.z) < MAYOR.answering) {
      t.facing = Math.atan2(m.position.x - t.position.x, m.position.z - t.position.z);
      t.emote = { pose: pose === 'bow' ? 'bow' : 'wave', until: now + 2500 };
    }
  for (const d of state.dudes)
    if (awake(d, now) && !d.hidden && !d.path.length && !d.use && !d.visit && Math.hypot(d.position.x - m.position.x, d.position.z - m.position.z) < MAYOR.answering) {
      d.facing = Math.atan2(m.position.x - d.position.x, m.position.z - d.position.z);
      d.emote = { pose: 'wave', until: now + 2500 };
    }
}

export function tickMayor(state: DudesState, now: number): void {
  const m = state.mayor;
  if (!m) return;
  if (m.say && m.say.until <= now) m.say = undefined;
  if (m.emote && m.emote.until <= now) m.emote = undefined;
  if (m.hatGift && m.hatGift.until <= now) m.hatGift = undefined;
  // A lock the show never let go of (a scene cut off without its release): his WASD comes back.
  if (m.lock && now - m.lock.since > MAYOR.lockMs) m.lock = undefined;
  // The operator page went away mid-stride: the Mayor stops (and gets off whatever he was on).
  if (!live(m, now)) {
    m.moving = false;
    if (m.riding) getOff(state, m);
  }
  if (m.riding && !state.objects.some((o) => o.id === m.riding)) m.riding = undefined;
  if (m.playing) {
    if (now >= m.playing.until) stopPlaying(m);
    else if (now >= m.playing.popAt) {
      const p = placeById(state, m.playing.placeId);
      if (p?.spec.pop) addEffect(state, { kind: 'pop', at: now, to: { ...m.position }, label: p.spec.pop, pose: p.spec.pose });
      m.playing.popAt = now + 2600 + Math.random() * 1800;
    }
  }
}

// ---- playing: shooting hoops, a swim, a tune on the stage ----------------------------------------
/** The nearest build with something to do at it, within reach: on it (or beside it), in the pose. */
function play(state: DudesState, m: Mayor, now: number): boolean {
  if (m.riding || headHidden(state, m)) return false;
  const p = state.objects
    .filter((o) => interactionOf(o.blueprint))
    .map((o) => ({ o, d: Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z) - Math.max(o.footprint.width, o.footprint.depth) / 2 }))
    .filter((c) => c.d < MAYOR.reach)
    .sort((a, b) => a.d - b.d)
    .map((c) => placeOfObject(state, c.o))
    .find(Boolean);
  if (!p) return false;
  const until = now + Math.max(8, (interactionOf(state.objects.find((o) => o.id === p.id)!.blueprint)?.seconds ?? 10) * 1.5) * 1000;
  startPlaying(state, m, p, undefined, now, until);
  m.playing = { placeId: p.id, until, popAt: now + 2600 };
  m.moved = (m.moved ?? 0) + 1;
  pushFeed(state, now, `${headName(state)} is having a go at ${p.name}`);
  return true;
}
function stopPlaying(m: Mayor): void {
  m.playing = undefined;
  m.y = undefined;
  m.emote = undefined;
}

// ---- building -----------------------------------------------------------------------------------
/** Who designs for the Mayor: the town's own designer, in his name. */
export const MAYOR_BUILDER = {
  name: 'The Mayor',
  persona: 'The Mayor of the town: generous, a bit grand, fond of a ribbon-cutting. Gifts from the Mayor should look like gifts: handsome, cheerful, well made.',
};

/**
 * The Mayor builds something: on a chatter's lot (it is theirs once it is up, a gift), on whatever
 * lot or bit of street he clicked, or where he stands. No figure walks over to put it up: it is
 * designed, the site is marked out, and it rises on its own (`tickMayorBuilds`).
 */
function mayorBuild(state: DudesState, m: Mayor, msg: Extract<MayorInput, { t: 'build' }>, now: number): void {
  const what = String(msg.what ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (!what) return;
  if (state.jobs.filter((j) => j.dudeId === 'mayor' && isActive(j)).length >= 3) return void pushFeed(state, now, `${headName(state)} already has three things on the go`);
  const forName = String(msg.for ?? '').replace(/^@/, '').trim();
  const forDude = forName ? matchName(forName, state.dudes, (d) => d.name) : undefined;
  const clicked = msg.at && Number.isFinite(msg.at.x) && Number.isFinite(msg.at.z) ? clampToGround(msg.at, 1) : undefined;
  // Where: their lot, the lot he clicked, or a spot on the street (where he clicked, or stands).
  const lot = forDude ? lotsOf(state, forDude)[0] : plotAt(clicked ?? m.position);
  const owner = forDude && lot ? forDude : lot ? state.dudes.find((d) => d.id === cityOf(state).plots[lot.id]?.owner) : undefined;
  const inside = clicked && lot && clicked.x > lot.rect.minX && clicked.x < lot.rect.maxX && clicked.z > lot.rect.minZ && clicked.z < lot.rect.maxZ;
  const space = lot ? freeSpotOn(state, lot) : undefined;
  const anchor = inside ? clicked! : space ? space.at : (clicked ?? { ...m.position });
  const job: Job = {
    id: nextId(state, 'j'),
    dudeId: 'mayor',
    kind: 'build',
    request: what,
    anchor,
    status: 'queued',
    createdAt: now,
    venue: venueKindOf(what),
    site: space ? Math.max(3, Math.min(8, space.side)) : 6,
    ...(lot ? { plot: lot.id } : {}),
    ...(owner ? { gift: owner.id } : {}),
  };
  state.jobs.push(job);
  pushFeed(state, now, `${headName(state)} is designing ${what.slice(0, 50)}${owner ? ` for ${owner.name}` : lot ? ` at ${lot.address}` : ''}`);
  if (forName && !forDude) pushFeed(state, now, `(there is nobody called ${forName} in town; it goes where the Mayor is)`);
}

/**
 * The Mayor reworks a build he clicked on the operator page: it is redesigned with his change and
 * keeps everything else (the design call gets the current blueprint), then swaps in where it stands.
 * Anyone's build; it stays its owner's, and the owner hears about it.
 */
function mayorEdit(state: DudesState, msg: Extract<MayorInput, { t: 'edit' }>, now: number): void {
  const change = String(msg.change ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  const target = state.objects.find((o) => o.id === String(msg.target ?? ''));
  if (!change || !target) return;
  if (state.jobs.some((j) => j.targetId === target.id && isActive(j))) return void pushFeed(state, now, `${target.blueprint.name} is already being worked on`);
  if (state.jobs.filter((j) => j.dudeId === 'mayor' && isActive(j)).length >= 3) return void pushFeed(state, now, `${headName(state)} already has three things on the go`);
  state.jobs.push({ id: nextId(state, 'j'), dudeId: 'mayor', kind: 'edit', request: `${target.blueprint.name}: ${change}`.slice(0, 300), targetId: target.id, anchor: { ...target.position }, status: 'queued', createdAt: now, ...(target.plot ? { plot: target.plot } : {}) });
  pushFeed(state, now, `${headName(state)} is reworking ${target.blueprint.name}: ${change.slice(0, 60)}`);
}

/** The Mayor's designed builds rise on their own, a few seconds each, then stand. */
export function tickMayorBuilds(state: DudesState, dt: number, now: number): void {
  for (const job of state.jobs) {
    if (job.dudeId !== 'mayor' && job.dudeId !== 'town') continue;
    // The town's remakes for a new age swap straight in, quietly (or are dropped if the age moved on again).
    if (job.dudeId === 'town' && job.status === 'ready') {
      const target = state.objects.find((o) => o.id === job.targetId);
      job.status = target && job.blueprint && job.footprint && job.restyle === ageOf(state) && themed(state) ? 'done' : 'failed';
      if (job.status === 'failed' || !target) continue;
      target.revision++;
      target.blueprint = job.blueprint!;
      target.footprint = job.footprint!;
      renewed(state, target);
      if (job.position && (job.position.x !== job.anchor.x || job.position.z !== job.anchor.z)) target.position = job.position;
      target.age = job.restyle;
      delete target.free;
      clearFootprint(state, target);
      // A remake is not a build being done up: the caravan's "build or do up" asks don't count it.
      const revs = cityOf(state).caravan?.revs;
      if (revs && target.id in revs) revs[target.id] = target.revision;
      // A puff of dust and a sparkle as the old one gives way to the new.
      addEffect(state, { kind: 'burst', at: now, to: { ...target.position }, label: 'smoke' });
      addEffect(state, { kind: 'burst', at: now, to: { ...target.position } });
      state.worldRevision++;
      continue;
    }
    if (job.dudeId === 'town') continue;
    if (job.status === 'ready') {
      job.status = 'building';
      job.workMs = 6000;
      job.workedMs = 0;
    }
    if (job.status !== 'building') continue;
    job.workedMs = (job.workedMs ?? 0) + dt;
    if (job.workedMs < (job.workMs ?? 6000)) continue;
    if (!job.blueprint || !job.position || !job.footprint) {
      job.status = 'failed';
      continue;
    }
    if (job.kind === 'edit') {
      // The rework swaps in where the build stands (moved only if the new shape no longer fits there).
      const target = state.objects.find((o) => o.id === job.targetId);
      job.status = target ? 'done' : 'failed';
      if (!target) continue;
      target.revision++;
      target.blueprint = job.blueprint;
      target.footprint = job.footprint;
      renewed(state, target);
      if (job.position.x !== job.anchor.x || job.position.z !== job.anchor.z) target.position = job.position;
      target.editedBy = MAYOR.name;
      stampAge(state, target);
      clearFootprint(state, target);
      state.worldRevision++;
      pushFeed(state, now, `${headName(state)} reworked ${target.blueprint.name}`);
      const owner = target.owner ? state.dudes.find((d) => d.id === target.owner) : undefined;
      if (owner) tell(state, owner, `${headName(state)} reworked your ${target.blueprint.name}: ${job.request.slice(0, 120)}`, now, true);
      continue;
    }
    const owner = job.gift ? state.dudes.find((d) => d.id === job.gift) : undefined;
    const object: SafehouseObject = {
      id: nextId(state, 'b'),
      revision: 1,
      blueprint: job.blueprint,
      position: job.position,
      footprint: job.footprint,
      createdBy: MAYOR.name,
      editedBy: MAYOR.name,
      createdAt: now,
      ...(owner ? { owner: owner.id } : {}),
      ...(job.plot ? { plot: job.plot } : {}),
      ...(job.venue ? { venue: job.venue } : {}),
    };
    stampAge(state, object);
    startMoving(object, `${job.request} ${job.asked ?? ''}`);
    state.objects.push(object);
    clearFootprint(state, object);
    state.worldRevision++;
    job.status = 'done';
    pushFeed(state, now, `${headName(state)} built ${object.blueprint.name}${owner ? ` for ${owner.name}` : ''}`);
    if (owner) tell(state, owner, `${headName(state)} built you ${object.blueprint.name} on your lot, as a gift. It is yours now.`, now, true);
  }
}

/** The Mayor's builds in flight, for the page: the site while designing, the ghost while going up. */
export function mayorBuildViews(state: DudesState): NonNullable<import('../../shared/dudesTypes').DudesScene['mayorBuilds']> {
  return state.jobs
    .filter((j) => j.dudeId === 'mayor' && isActive(j))
    .map((j) => ({
      id: j.id,
      label: j.blueprint?.name ?? j.request.slice(0, 50),
      status: j.status,
      at: j.position ?? j.anchor,
      ...(j.site ? { site: j.site } : {}),
      progress: j.status === 'building' ? Math.min(1, (j.workedMs ?? 0) / (j.workMs ?? 6000)) : 0,
      ...(j.blueprint && j.position && j.footprint
        ? { preview: { id: `preview-${j.id}`, revision: 1, blueprint: j.blueprint, position: j.position, footprint: j.footprint, createdBy: MAYOR.name, editedBy: MAYOR.name, createdAt: j.createdAt, age: ageOf(state) } }
        : {}),
    }));
}

// ---- riding -------------------------------------------------------------------------------------
/** The nearest thing the Mayor can ride or drive, within a few steps, that nobody else is aboard. */
function getOn(state: DudesState, m: Mayor): boolean {
  const o = state.objects
    .filter((x) => rideable(x) && !x.civic && !inUse(state, x.id))
    .map((x) => ({ x, d: Math.hypot((x.driven?.at ?? x.position).x - m.position.x, (x.driven?.at ?? x.position).z - m.position.z) - Math.max(x.footprint.width, x.footprint.depth) / 2 }))
    .filter((c) => c.d < MAYOR.reach)
    .sort((a, b) => a.d - b.d)[0]?.x;
  if (!o) return false;
  const at = { ...(o.driven?.at ?? o.position) };
  m.riding = o.id;
  m.position = at;
  m.facing = o.driven?.turn ?? o.creature?.facing ?? m.facing;
  m.emote = undefined;
  o.driven = { at, turn: m.facing, by: MAYOR.name, until: Number.MAX_SAFE_INTEGER };
  if (o.creature) o.creature.path = [];
  pushFeed(state, Date.now(), `${headName(state)} ${o.blueprint.moves === 'drive' || (!o.blueprint.moves && o.blueprint.abilities?.includes('vehicle')) ? 'took' : 'hopped on'} ${o.blueprint.name}${o.createdBy !== MAYOR.name ? ` (${o.createdBy}'s)` : ''}`);
  return true;
}
/** Off again, beside it; it stays where he left it (and a mover carries on from there, movers.ts). */
function getOff(state: DudesState, m: Mayor): void {
  const o = state.objects.find((x) => x.id === m.riding);
  m.riding = undefined;
  if (!o) return;
  // Down it comes: a flown build lands where he left it (a flyer of its own carries on, movers.ts).
  if (!o.creature) setAltitude(o, 0);
  parkObject(state, o, MAYOR.name);
  const at = o.driven?.at ?? o.position;
  const side = workSpots(at, o.footprint, m.position)[0];
  if (side) m.position = side;
}
/** Steering what he is aboard: it goes where the operator page says the Mayor is. */
function ridden(state: DudesState, m: Mayor, alt?: number): void {
  const o = m.riding ? state.objects.find((x) => x.id === m.riding) : undefined;
  if (!o) return void (m.riding = undefined);
  o.driven = { at: { ...m.position }, turn: m.facing, by: MAYOR.name, until: Number.MAX_SAFE_INTEGER };
  // In something that flies, the operator page says how high.
  if (flies(o) && Number.isFinite(alt)) setAltitude(o, alt!);
}

// ---- the show: his mark (Finders Keepers, FK-020) -----------------------------------------------
// At a Call the server puts the head where the scene needs him, so Sami never has to find a mark.
// All of it is Story-only: with Story off a lock or a forced hiding left in a save does nothing.

/** Where the show has him pinned, while Story is on. */
export function headLock(state: DudesState): Mayor['lock'] {
  return storyOn(state) ? state.mayor?.lock : undefined;
}

/**
 * Whether he is out of sight. The show has the last word (hidden for the Intro's flashback, shown on
 * his mark); otherwise the operator page's H. The page's own wish is kept apart (`hidden`), so it
 * holds again once the show lets go.
 */
export function headHidden(state: DudesState, m: Mayor): boolean {
  if (storyOn(state) && m.forcedHidden) return true;
  if (storyOn(state) && m.lock) return false;
  return !!m.hidden;
}

/**
 * The Call: he is shown (whatever H says), off whatever he was riding (left parked where it stood),
 * the weapon put away, out of a game or a pose, and snapped onto `mark` facing `face`; the operator
 * page jumps there too (`moved`), its free camera goes off, and its WASD waits for `releaseHead`.
 * FK-061 walks him there instead of the snap. False, and nothing touched, while Story is off or the
 * mark isn't a place; a `face` that isn't a number keeps the way he faces (a NaN would spoil the save).
 */
export function prepareHead(state: DudesState, mark: GroundPoint, face: number, now: number): boolean {
  if (!storyOn(state) || !Number.isFinite(mark.x) || !Number.isFinite(mark.z)) return false;
  const m = mayorOf(state, now);
  if (!Number.isFinite(face)) face = m.facing;
  if (m.riding) getOff(state, m);
  if (m.playing) stopPlaying(m);
  m.armed = undefined;
  m.emote = undefined;
  m.forcedHidden = undefined;
  const at = clampToGround(mark, 0.5);
  m.position = { ...at };
  m.facing = face;
  m.moving = false;
  m.running = false;
  m.cam.x = at.x;
  m.cam.z = at.z;
  m.moved = (m.moved ?? 0) + 1;
  m.lock = { at: { ...at }, facing: face, since: now };
  return true;
}

/** The release: his WASD back, from the mark; H's say holds again. False if he wasn't on one. */
export function releaseHead(state: DudesState): boolean {
  const m = state.mayor;
  if (!m?.lock) return false;
  m.lock = undefined;
  return true;
}

/** Out of sight whatever the operator page asks (the Intro's flashback, FK-043), or back as he was. */
export function forceHeadHidden(state: DudesState, on: boolean, now: number): void {
  const m = mayorOf(state, now);
  m.forcedHidden = on || undefined;
  if (on) {
    m.say = undefined;
    m.emote = undefined;
  }
}

export function mayorView(state: DudesState, now: number): MayorView {
  const m = mayorOf(state, now);
  return {
    position: m.position,
    facing: m.facing,
    moving: m.moving,
    ...(m.running ? { running: true } : {}),
    ...(m.say ? { say: m.say } : {}),
    ...(m.emote ? { emote: m.emote } : {}),
    cam: m.cam,
    follow: m.follow,
    ...(m.focus ? { focus: m.focus } : {}),
    live: live(m, now),
    ...(headHidden(state, m) ? { hidden: true } : {}),
    ...(ridingView(state, m) ? { riding: ridingView(state, m) } : {}),
    ...(m.audio ? { audio: m.audio } : {}),
    ...(m.armed ? { armed: m.armed } : {}),
    ...(m.moved ? { moved: m.moved } : {}),
    ...(m.aide ? { aide: { asked: m.aide.asked, reply: m.aide.reply, ok: m.aide.ok, at: m.aide.at, thinking: !!m.ask } } : {}),
    // Finders Keepers: the lock on his mark and the show strip. Nothing while Story is off (FK-001).
    ...storyMayorView(state, now),
  };
}
function ridingView(state: DudesState, m: Mayor): MayorView['riding'] {
  const o = m.riding ? state.objects.find((x) => x.id === m.riding) : undefined;
  return o ? rideInfo(o) : undefined;
}
/** What a page steering a build needs to know about it: how it gets about, the seat, how high, how big, a gun. */
export function rideInfo(o: SafehouseObject): NonNullable<MayorView['riding']> {
  const moves = o.blueprint.moves ?? (abilitiesOf(o.blueprint).has('flies') ? 'fly' : 'vehicle');
  return { id: o.id, moves, seat: seatHeight(o, moves === 'drive' || moves === 'vehicle', false), altitude: altitudeOf(o), size: Math.max(o.footprint.width, o.footprint.depth), ...(armedBuild(o) ? { gun: true } : {}) };
}

/** The Mayor as a figure among the others (only while the operator page is open). */
export function mayorDudeView(state: DudesState, now: number): DudeView[] {
  const m = state.mayor;
  if (!m || !live(m, now) || headHidden(state, m)) return [];
  const riding = ridingView(state, m);
  return [
    {
      id: 'mayor',
      name: headName(state),
      mayor: true,
      position: m.position,
      facing: m.facing,
      activity: riding ? 'using' : m.moving ? 'walking' : m.emote ? 'emote' : 'idle',
      look: m.hatGift && m.hatGift.until > now ? { ...headLook(state), hat: m.hatGift.hat, hatColor: m.hatGift.color } : headLook(state),
      ...(riding ? { y: riding.seat + riding.altitude, riding: riding.id, emote: { pose: riding.moves === 'drive' || riding.moves === 'vehicle' ? 'drive' : 'sit', until: now + 60_000 } } : m.emote ? { emote: m.emote } : {}),
      ...(!riding && m.playing && m.y ? { y: m.y } : {}),
      ...(m.say ? { say: m.say } : {}),
      ...(m.armed && !riding ? { armed: m.armed } : {}),
    },
  ];
}

/** One line for every agent: where the Mayor is, when the streamer is walking about. */
export function mayorLine(state: DudesState, at: { x: number; z: number }, now: number): string | undefined {
  const m = state.mayor;
  if (!m || !live(m, now) || headHidden(state, m)) return undefined;
  const d = Math.round(Math.hypot(m.position.x - at.x, m.position.z - at.z));
  return `${headName(state)} (the Mayor: the streamer, walking round town and talking to everyone) is ${d < 3 ? 'right next to you' : `${d} m away`}.`;
}

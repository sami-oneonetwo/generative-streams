import type { Catalogue } from '../shared/catalogue.js';
import type { Config } from '../shared/config.js';
import { VIEW, type Weather } from '../shared/state.js';
import { stepBehaviours } from './behaviours.js';
import { advanceTime, ambientPrefix, makeAmbientEntity, pick, pickWeighted, randomBetween } from './drift.js';
import type { Store } from './store.js';
import { stepVitals, type VitalsHooks } from './vitals.js';

const CHARACTER_SPEED = 3; // px per 100ms tick, i.e. 30 px/s
const CAMERA_SPEED = 2;
const CAMERA_DEADZONE = 70;

export interface TickControl {
  stop(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Silence the character's unprompted lines; replies to viewers still show. */
  mute(): void;
  unmute(): void;
  readonly muted: boolean;
}

export type TickHooks = VitalsHooks;

/**
 * The world's own pulse. A fast tick moves the character and camera and
 * completes trips between worlds; a slow tick advances time, runs the body,
 * rolls weather, schedules ambient events, moves the other characters, lets
 * the character wander and speak, closes stale votes, and expires what
 * nobody has touched.
 */
export function startTick(store: Store, cfg: Config, worldOf: () => Catalogue, hooks: TickHooks): TickControl {
  let paused = false;
  let muted = !cfg.drift.chatter;
  let last = Date.now();
  let nextWeatherAt = last + randomBetween(cfg.drift.weatherMinMs, cfg.drift.weatherMaxMs);
  let nextWanderAt = last + randomBetween(8_000, 20_000);
  let nextLineAt = last + randomBetween(45_000, 120_000);
  const nextAmbientAt = new Map<string, number>();

  const say = (text: string | undefined, now: number, critical = false): void => {
    if (!text || (muted && !critical)) return;
    const c = store.state.character;
    const mode = c.mode === 'travel' ? 'travel' : c.targetX !== undefined ? 'walk' : 'talk';
    store.dispatch({ type: 'set_character', patch: { bubble: { text, until: now + cfg.drift.bubbleMs }, mode } }, critical ? 'critical' : 'character');
    hooks.say(text, critical);
  };

  const fast = setInterval(() => {
    const now = Date.now();
    const s = store.state;
    const c = s.character;

    if (s.transition && now - s.transition.startedAt >= s.transition.durationMs) {
      store.switchWorld(s.transition.to);
      say(pick(worldOf().lines?.ambient), now);
      return;
    }

    const down = Boolean(c.vitals.collapsed) || Boolean(c.sleeping);
    if (c.targetX !== undefined && !down) {
      const dx = c.targetX - c.x;
      if (Math.abs(dx) <= CHARACTER_SPEED) {
        const talking = c.bubble !== undefined && c.bubble.until > now;
        store.dispatch({ type: 'set_character', patch: { x: Math.round(c.targetX), targetX: undefined, mode: s.transition ? 'travel' : talking ? 'talk' : 'idle' } }, 'tick');
      } else {
        store.dispatch({ type: 'set_character', patch: { x: c.x + Math.sign(dx) * CHARACTER_SPEED, facing: dx < 0 ? 'l' : 'r', mode: s.transition ? 'travel' : 'walk' } }, 'tick');
      }
    } else if (c.bubble && c.bubble.until <= now) {
      store.dispatch({ type: 'set_character', patch: { bubble: undefined, mode: s.transition ? 'travel' : 'idle' } }, 'tick');
    }

    // The camera follows the character loosely, like a side-scroller, except while leaving.
    if (!s.transition) {
      const off = store.state.character.x - (s.camera.x + VIEW.w / 2);
      if (Math.abs(off) > CAMERA_DEADZONE) {
        const step = Math.min(CAMERA_SPEED, Math.abs(off) - CAMERA_DEADZONE);
        store.dispatch({ type: 'set_camera', x: s.camera.x + Math.sign(off) * step }, 'tick');
      }
    }
  }, 100);

  const slow = setInterval(() => {
    const now = Date.now();
    const elapsed = now - last;
    last = now;
    const s = store.state;
    const catalogue = worldOf();

    if (s.vote && now > s.vote.until) {
      store.dispatch({ type: 'set_vote', vote: undefined }, 'tick');
      say(`the vote to leave for the ${s.vote.to} fizzled out`, now);
    }

    if (paused || s.transition) return;

    store.dispatch({ type: 'set_time', time: advanceTime(s.time, elapsed, cfg.drift.minutesPerWorldHour) }, 'tick');

    stepVitals(
      {
        store,
        cfg,
        catalogue: worldOf,
        say: (text, critical) => say(text, Date.now(), critical),
        onSave: hooks.onSave,
        onDeath: hooks.onDeath,
        onNewDay: hooks.onNewDay,
      },
      now,
      elapsed,
    );

    if (now >= nextWeatherAt) {
      nextWeatherAt = now + randomBetween(cfg.drift.weatherMinMs, cfg.drift.weatherMaxMs);
      const next = pickWeighted<Weather>(catalogue.weatherWeights ?? {}, Math.random(), s.weather);
      if (next && next !== s.weather) {
        store.dispatch({ type: 'set_weather', weather: next }, 'drift');
        say(pick(catalogue.lines?.weather?.[next]), now);
      }
    }

    for (const a of catalogue.ambient ?? []) {
      const key = `${s.world}/${a.name}`;
      const at = nextAmbientAt.get(key);
      const scale = cfg.drift.ambientScale;
      if (at === undefined) {
        nextAmbientAt.set(key, now + randomBetween(a.everyMs[0] * 0.2, a.everyMs[1] * 0.5) * scale);
        continue;
      }
      if (now < at) continue;
      nextAmbientAt.set(key, now + randomBetween(a.everyMs[0], a.everyMs[1]) * scale);
      if (store.state.entities.some((e) => e.id.startsWith(ambientPrefix(a.name)))) continue;
      store.dispatch({ type: 'add_entity', entity: makeAmbientEntity(a, now) }, 'ambient');
      if (Math.random() < 0.5) say(pick(a.lines), now);
    }

    const c = store.state.character;
    const down = Boolean(c.vitals.collapsed) || Boolean(c.sleeping) || Boolean(c.vitals.blackout);
    if (!down && c.targetX === undefined && now >= nextWanderAt) {
      nextWanderAt = now + randomBetween(10_000, 30_000);
      const cam = store.state.camera.x;
      const targetX = Math.round(Math.max(16, Math.min(VIEW.worldW - 16, cam + 40 + Math.random() * (VIEW.w - 80))));
      store.dispatch({ type: 'set_character', patch: { targetX, facing: targetX < c.x ? 'l' : 'r', mode: 'walk' } }, 'tick');
    }

    if (!down && !c.bubble && now >= nextLineAt) {
      nextLineAt = now + randomBetween(60_000, 150_000) * cfg.drift.ambientScale;
      say(pick(catalogue.lines?.ambient), now);
    }

    stepBehaviours(store, catalogue, now);
    store.dispatch({ type: 'expire', now }, 'tick');
  }, 1000);

  return {
    stop() {
      clearInterval(fast);
      clearInterval(slow);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = Date.now();
    },
    get paused() {
      return paused;
    },
    mute() {
      muted = true;
    },
    unmute() {
      muted = false;
    },
    get muted() {
      return muted;
    },
  };
}

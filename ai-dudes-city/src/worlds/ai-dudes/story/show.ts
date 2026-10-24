// The show runtime (FK-017): story scenes (shared/storyScenes.ts) played from `city.story.scene`. They
// tick on their own, every world tick while Story is on (index.ts), whatever the caravan and town life
// are doing and with nobody awake; today's caravan scenes tick from here too while Story is on (FK-127,
// caravan.ts tickCaravanScene). A scene's clock is `now − at − shift`, frozen at `heldAt` while a hold is on
// (FK-035 sets both): `at` never moves, because the page keys a scene's shots by `id:at`.
//
// The watchdog: every beat runs inside its own try/catch, and so does the whole round. A beat that
// throws, a scene this build doesn't know, a broken clock, or a scene held past its hard lock cap
// (bible §5, shared/scenes.ts LOCK_CAPS) ends in the panic exit: the scene ends, everyone is let go,
// the head gets his WASD back, the page's camera goes back to autoFrame (cinema() lets go once
// `town.scene` is gone), and an alert goes in the log. The show never throws into the world's tick.
//
// The same release runs at every boot (index.ts `start`), at Story OFF and Stop (story/dev.ts), and at
// FK-037's panic key. A scene that ends as written lets its crowd go a few at a time instead (endShow,
// FK-019's staggered release).
import type { WorldCtx } from '../../../engine/world';
import type { TownView } from '../../../shared/dudesTypes';
import { LOCK_SLACK_MS, STEP_FORWARD, fillLine, type Beat, type Scene } from '../../../shared/scenes';
import { STORY_SCENES } from '../../../shared/storyScenes';
import { tickCaravanScene } from '../caravan'; // hook FK-127
import { ageOf } from '../city';
import type { DudesState, StorySceneState, Townie } from '../state';
import { castIn, castTownie } from './cast';
import { follyOf, unveilFolly } from './folly'; // hook FK-025
import { dropRing, gatherTally, releaseRing, ringView } from './gather';
import { RALLY_ID, rallyView, tickRally } from './rally'; // hook FK-026
import { wrenBeat } from './unveil'; // hook FK-025

type Log = WorldCtx<DudesState>['log'];

/** A story scene by id; undefined for one this build doesn't know (an id from another build, `constructor` …). */
export const storyScene = (id: string): Scene | undefined => (Object.hasOwn(STORY_SCENES, id) ? STORY_SCENES[id] : undefined);

/** How far into its script a story scene is (ms): holds don't count, and a hold that is on freezes it. */
export function sceneTime(sc: StorySceneState, now: number): number {
  const t = now - sc.at - sc.shift;
  return sc.heldAt === undefined ? t : Math.min(t, sc.heldAt);
}

/** The longest a scene may hold the town (bible §5), from its start, holds included. */
export const lockCapOf = (scene: Scene): number => scene.lockMs ?? scene.ms + LOCK_SLACK_MS;

/** How far behind a scene's start the clock may read before it counts as broken: a tick or two of jitter. */
const CLOCK_SLACK_MS = 2000;

const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * Start a story scene now, from its first beat, with `vars` for its lines' `{name}`s. Says why not, and
 * changes nothing, when there is no such scene or one is already playing (Stop it first). The caller
 * gates on Story being on.
 */
export function playShow(state: DudesState, id: string, now: number, vars: Record<string, string> = {}): string | undefined {
  const scene = storyScene(id);
  if (!scene) return `No story scene called "${clip(id, 40)}"`;
  const city = state.city;
  if (!city) return 'No town yet';
  const playing = city.story?.scene;
  if (playing) return `The ${playing.id} scene is playing: Stop it first`;
  // Within the save's limits (state.ts storyShape), so the save guard never has to cut them.
  const v = Object.fromEntries(Object.entries(vars).map(([k, x]) => [clip(k, 40), clip(x, 160)]));
  (city.story ??= {}).scene = { id: scene.id, at: now, shift: 0, beat: 0, vars: v };
  return undefined;
}

/** One of the age's cast, by their place in its caravan (Beat.who); undefined when they aren't in town. */
function castAt(state: DudesState, who: number): Townie | undefined {
  const m = castIn(ageOf(state))[who];
  return m && castTownie(state, m.role);
}

/** What a story beat does, by its `do`. A scene card adds the kinds it needs here (the tarp drop, the collapse …). */
type BeatRun = (state: DudesState, b: Beat, now: number) => void;
export const SHOW_BEATS: Record<string, BeatRun> = {
  // One of the cast steps forward the way they face (as the caravan's leader does to speak). Not in town: nothing to do.
  step: (state, b) => {
    const t = castAt(state, b.who);
    if (t) t.path = [{ x: t.position.x + Math.sin(t.facing) * STEP_FORWARD, z: t.position.z + Math.cos(t.facing) * STEP_FORWARD }];
  },
  // One of the cast strikes a pose for a while.
  emote: (state, b, now) => {
    const t = castAt(state, b.who);
    if (t && b.pose) t.emote = { pose: b.pose, until: now + (b.ms ?? 2500) };
  },
  // hook FK-025: the tarp comes off the age's Folly (the page drops it: dust, confetti). Already off, or none: nothing.
  unveil: (state, _b, now) => {
    if (follyOf(state)?.silhouette) {
      const why = unveilFolly(state, now);
      if (why) throw new Error(why);
    }
  },
  // Everyone in the ring strikes the pose (a cheer at the reveal).
  crowd: (state, b, now) => {
    for (const d of state.dudes) if (d.gather && b.pose) d.emote = { pose: b.pose, until: now + (b.ms ?? 2500) };
  },
  // Wren onto her vantage, facing the Folly (story/unveil.ts), with a pose if the beat has one.
  wren: (state, b, now) => wrenBeat(state, now, b.pose, b.ms),
};

function runBeat(state: DudesState, b: Beat, now: number): void {
  const run = Object.hasOwn(SHOW_BEATS, b.do) ? SHOW_BEATS[b.do] : undefined;
  if (!run) throw new Error(`no beat called "${b.do}" in the show runtime`);
  run(state, b, now);
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How long a scene's NOW card stays once it ends (client/dudes/show.ts NOW_MS). */
export const NOW_CARD_MS = 6000;
/** The NOW card a scene left as it ended, until when: in memory only (a restart loses six seconds of card, nothing else). */
const nowCards = new WeakMap<DudesState, NonNullable<NonNullable<TownView['show']>['now']>>();

/**
 * Every world tick while Story is on: the playing scene's beats come due in order, each once, and the
 * scene ends at its length. Anything wrong is a panic exit (the header); this never throws.
 */
export function tickShow(state: DudesState, now: number, log: Log): void {
  tickCaravanScene(state, now, log); // hook FK-127: today's caravan scenes (opening, Crossing, age turn …) tick here while Story is on
  const sc = state.city?.story?.scene;
  if (!sc) return;
  try {
    const scene = storyScene(sc.id);
    if (!scene) return void panicShow(state, `this build has no story scene called "${clip(String(sc.id), 40)}"`, log);
    const t = sceneTime(sc, now);
    if (!Number.isFinite(t)) return void panicShow(state, 'its clock is broken', log);
    // A clock stepped back past the scene's start: no beat would come due, it would never end and the cap would never trip.
    if (now < sc.at - CLOCK_SLACK_MS) return void panicShow(state, `its clock is broken (back ${secs(sc.at - now)} before it began)`, log);
    const cap = lockCapOf(scene);
    // Only holds can stretch a scene past its length: one that has simply run long (a stalled server) ends as written, below.
    if (t < scene.ms && now - sc.at > cap) return void panicShow(state, `held past its ${secs(cap)} lock cap (${secs(t)} into ${secs(scene.ms)})`, log);
    if (sc.id === RALLY_ID) tickRally(state, sc, now); // hook FK-026
    while (sc.beat < scene.beats.length && scene.beats[sc.beat].at <= t) {
      // Counted before it runs: a beat that throws is never run twice.
      const i = sc.beat++;
      const b = scene.beats[i];
      try {
        runBeat(state, b, now);
      } catch (e) {
        return void panicShow(state, `beat ${i + 1} (${b.do} at ${secs(b.at)}) threw: ${why(e)}`, log);
      }
    }
    if (t < scene.ms) return;
    // The end, as written: the head is free, and the crowd goes a few at a time (FK-019).
    const n = endShow(state, now);
    log(`story: the ${sc.id} scene ended${n > 1 ? `; let go of ${n - 1} held thing${n === 2 ? '' : 's'}` : ''}`);
  } catch (e) {
    panicShow(state, `the show runtime threw: ${why(e)}`, log);
  }
}

/**
 * The panic exit: the scene ends, every gathering is called off, the head gets his WASD and visibility
 * back, and the log gets an alert saying why. The page's camera goes back to autoFrame on its own once
 * `town.scene` is gone. Returns how many things it let go.
 */
export function panicShow(state: DudesState, reason: string, log: Log): number {
  const id = state.city?.story?.scene?.id;
  let n: number;
  try {
    n = releaseShow(state);
  } catch {
    // A state too broken even to let go of: the scene goes at least, so the town is never stuck in it.
    if (state.city?.story) state.city.story.scene = undefined;
    n = 1;
  }
  log(`story: PANIC EXIT${id ? ` from the ${clip(String(id), 40)} scene` : ''}: ${reason}; let go of ${n} held thing${n === 1 ? '' : 's'}`, 'alert');
  return n;
}

/**
 * What the show puts on the page: the story scene playing, as `scene`. Spread after the caravan's
 * (story/view.ts), so it plays ahead of today's scene; the page plays it once FK-124 lands. A Call's
 * ring and its banner come with it (FK-019; FK-021 draws the banner); FK-021 and FK-022 add the
 * prompt, the NOW card and the title card.
 */
export function showView(state: DudesState, now: number): Partial<TownView> {
  const sc = state.city?.story?.scene;
  const ring = ringView(state);
  const card = nowCards.get(state);
  if (card && now >= card.until) nowCards.delete(state);
  // hook FK-025: a scene's NOW card after it ends (the Board steps aside for it on the page).
  const after = card && now < card.until && !sc ? { show: { ...ring.show, now: { ...card } } } : {};
  const scene = sc && storyScene(sc.id);
  if (!sc || !scene) return { ...ring, ...after };
  const vars = sc.vars && Object.keys(sc.vars).length ? { vars: { ...sc.vars } } : {};
  // hook FK-025: the scene's prompt tile (RATE IT: chat's live average) while it is up.
  const t = sceneTime(sc, now);
  const p = scene.prompt;
  const rate = p && t >= p.at && t < p.at + p.ms ? gatherTally(state).rate : undefined;
  const prompt = p && t >= p.at && t < p.at + p.ms ? { show: { ...ring.show, prompt: { kind: p.kind, label: p.label, ...(rate ? { value: Math.round(rate.avg * 10) / 10, count: rate.n } : { count: 0 }) } } } : {};
  const view = { ...ring, ...prompt, scene: { id: sc.id, at: sc.at, shift: sc.shift, ...(sc.heldAt !== undefined ? { heldAt: sc.heldAt } : {}), ...vars } };
  return sc.id === RALLY_ID ? rallyView(state, sc, view, now) : view; // hook FK-026
}

/**
 * Let everyone go: end the story scene, call off every gathering, and give the head his WASD and his
 * visibility back. Run at every boot, Story on or off, so a crash mid-scene never boots into a frozen
 * town, and at the end of every scene. Returns how many things it let go, for the log.
 */
export function releaseShow(state: DudesState): number {
  let n = 0;
  nowCards.delete(state);
  const story = state.city?.story;
  if (story?.scene) {
    story.scene = undefined;
    n++;
  }
  dropRing(state);
  for (const d of state.dudes)
    if (d.gather) {
      // Nobody keeps walking into a ring that is gone (their path was the way to their slot).
      Object.assign(d, { gather: undefined, path: [], walkingFor: undefined });
      n++;
    }
  const m = state.mayor;
  if (m?.lock) {
    m.lock = undefined;
    n++;
  }
  if (m?.forcedHidden) {
    m.forcedHidden = undefined;
    n++;
  }
  return n;
}

/**
 * A scene's end as written: the scene goes, the head gets his WASD and his visibility back, and the
 * crowd is let go a few at a time over the next seconds (story/gather.ts releaseRing), never as one
 * block. Returns how many things it let go, as releaseShow counts them.
 */
export function endShow(state: DudesState, now: number): number {
  let n = releaseRing(state, now);
  const story = state.city?.story;
  // hook FK-025: the scene's NOW card ("BRIDGE · type red") as its crowd goes.
  const card = story?.scene && storyScene(story.scene.id)?.now;
  if (card) {
    const word = fillLine(card.word, story!.scene!.vars ?? {}) || card.word.replace(/\{\w+\}/g, '').trim();
    if (word) nowCards.set(state, { word, until: now + NOW_CARD_MS, ...(card.chip ? { chip: card.chip } : {}), ...(card.side ? { side: card.side } : {}) });
  }
  if (story?.scene) {
    story.scene = undefined;
    n++;
  }
  const m = state.mayor;
  if (m?.lock) {
    m.lock = undefined;
    n++;
  }
  if (m?.forcedHidden) {
    m.forcedHidden = undefined;
    n++;
  }
  return n;
}

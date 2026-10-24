// Story (dev) on /admin (FK-002): every scene and story piece behind one button, so Sami can look at
// any of them off-air from one place: no chat, no WASD, no waiting for conditions. Every button but
// Story ON refuses "Story is off" while Story is off, and a piece that hasn't landed yet refuses
// "not built yet: FK-0NN"; either way nothing in the world changes.
//
// Wiring a piece: each scene or piece card swaps its `card: 'FK-0NN'` here for a `run` (Lane A applies
// the hook, ten lines or fewer, the same day). The /admin card is drawn from storyDevButtons(), so the
// button there follows on its own.
import type { AdminAction, WorldCtx } from '../../../engine/world';
import type { StoryDevButton } from '../../../shared/dudesTypes';
import type { SceneId } from '../../../shared/scenes';
import { STORY_SITES } from '../../../shared/storyMap'; // hook FK-020
import { caravanOn, playScene, resetCast } from '../caravan';
import { ageOf, cityOf, headName } from '../city';
import { prepareHead } from '../mayor'; // hook FK-020
import { storyOn, type DudesState } from '../state';
import { playShow, releaseShow } from './show';
import { FOLLIES, FOLLY_DEV } from './folly'; // hook FK-023
import { callRing } from './gather';
import { SIDES_DEV } from './sides'; // hook FK-012

type Ctx = WorldCtx<DudesState>;
/** Does the thing, or says why it didn't (and then has changed nothing). */
type Run = (ctx: Ctx, value?: number | string) => void | string;
/** The Story switch's two actions are drawn as the card's switch, not as buttons. */
type Group = StoryDevButton['group'] | 'switch';

/** A scene `story-play` starts straight away, skipping the beat queue's arming and GO (FK-037). */
interface Play {
  id: string;
  label: string;
  /** Not built yet: the card that builds it. */
  card?: string;
  run?: Run;
}

/** Why the age's band isn't here to look at, if it isn't: today's caravan scenes and the cast need what
 * they need today, the caravan on, town life on, and this age's caravan come. */
function noBand(s: DudesState): string | undefined {
  const cv = cityOf(s).caravan;
  if (!caravanOn(s)) return 'The caravan is off (sandbox mode): switch it on first';
  if (s.ai.townLife === false) return 'Town life is off: switch it on first (the travellers are townsfolk)';
  // The caravan ticks its scenes and brings the band: before it has come to this age a scene would never end, or end at once.
  if (!cv || cv.age !== ageOf(s)) return 'No caravan in this age yet (it comes with the first chatter): play the opening first';
  return undefined;
}

/** Today's caravan scene, played as /admin scene-opening plays the opening (until FK-127 moves it onto the show runtime). */
const playToday =
  (id: SceneId): Run =>
  (ctx) => {
    const s = ctx.state;
    const city = cityOf(s);
    const why = noBand(s);
    if (why) return why;
    // Cutting another scene short would skip what follows it (the bridge ask after the opening, the age after the turn).
    if (city.scene && city.scene.id !== id) return `The ${city.scene.id} scene is playing: let it finish first`;
    if (city.story?.scene) return `The ${city.story.scene.id} scene is playing: Stop it first`;
    playScene(s, id, ctx.now);
    ctx.log(`story: today's ${id} is playing (admin, Story (dev))`);
  };

/**
 * A story scene, through the show runtime (story/show.ts) from its first beat: it needs nothing else,
 * not the caravan, not town life, not anyone awake. Not over today's scene (its camera would vanish
 * under this one's), and not over another story scene (Stop it first).
 */
const playStory =
  (id: string): Run =>
  (ctx) => {
    const today = cityOf(ctx.state).scene;
    if (today) return `Today's ${today.id} scene is playing: let it finish first`;
    const why = playShow(ctx.state, id, ctx.now);
    if (why) return why;
    ctx.log(`story: the ${id} scene is playing (admin, Story (dev))`);
  };

/**
 * Reset the cast (FK-014's band): the age's cast as new and back on their marks, as a new caravan brings
 * them: across the river while the bridge is down, else at the town gate; anyone missing comes back. Not
 * mid-scene (scenes move the band by its place in the caravan) and not while the age turns (they're
 * walking home).
 */
const resetTheCast: Run = (ctx) => {
  const s = ctx.state;
  const city = cityOf(s);
  const why = noBand(s);
  if (why) return why;
  const cv = city.caravan!;
  if (city.scene) return `The ${city.scene.id} scene is playing: let it finish first`;
  if (city.story?.scene) return `The ${city.story.scene.id} scene is playing: Stop it first`;
  // After the last age's finale the turn stays for good: no caravan comes after it.
  if (cv.turn?.final) return 'The journey is over (the last age has had its finale): no cast to reset';
  if (cv.turn) return 'The age is turning (the band is heading home): reset the cast once the next caravan is here';
  resetCast(s, cv, ctx.now);
  ctx.log(`story: the cast reset, on their marks ${cv.stranded ? 'across the river' : 'at the town gate'} (admin, Story (dev))`);
};

/**
 * The Call with no scene (FK-019): the head onto his mark facing the Folly (FK-020), and everyone awake
 * into the ring in front of him under the GATHER banner, until Stop (RING.holdMs at most). Not over a
 * story scene, and not twice.
 */
const gatherAll: Run = (ctx) => {
  const s = ctx.state;
  const playing = cityOf(s).story?.scene;
  if (playing) return `The ${playing.id} scene is playing: Stop it first`;
  const folly = FOLLIES[ageOf(s)] ?? FOLLIES[0];
  const called = callRing(s, ctx.now, { banner: { title: `GATHER: ${folly.name.toUpperCase()}`, premise: `${headName(s)}'s secret build` } });
  if (typeof called === 'string') return called;
  prepareHead(s, STORY_SITES.headMark.at, STORY_SITES.headMark.facing, ctx.now);
  const { called: n, away, gold, red } = called;
  ctx.log(`story: gather (admin): ${n} called into the ring at the Folly (${gold} gold in front, ${red} red at the back${away ? `, ${away} of them away, padding the crowd` : ''}); the head is on his mark`);
};

/** Every scene Story (dev) plays, in show order. */
export const STORY_PLAYS: Play[] = [
  { id: 'intro', label: 'Intro', card: 'FK-043' },
  // Today's Crossing; FK-127 plays it through the show runtime with the cast (FK-017).
  { id: 'crossing', label: 'Crossing', run: playToday('crossing') },
  { id: 'rally', label: 'Rally', card: 'FK-026' },
  { id: 'unveil', label: 'Unveiling', card: 'FK-025' },
  { id: 'ageTurn', label: 'Age turn', card: 'FK-127' },
  // FK-001's test scene: the runtime (FK-017) and the page (FK-124) end to end.
  { id: 'test', label: 'test', run: playStory('test') },
];

/**
 * Let go of everything a Story (dev) button can have started: FK-001's release (the story scene, every
 * gathering, the head's lock and hiding), and today's Crossing, which nothing follows, so cutting it is
 * safe. The opening and the age turn play on: they open the bridge ask and turn the age as they end
 * (Caravan → finish this visit's asks hurries them). Returns how many things it let go.
 */
function letGo(state: DudesState): number {
  const city = cityOf(state);
  let n = releaseShow(state);
  if (city.scene?.id === 'crossing') {
    city.scene = undefined;
    n++;
  }
  return n;
}
const things = (n: number) => `${n} held thing${n === 1 ? '' : 's'}`;

/** One Story (dev) action and its buttons on /admin. */
interface Piece {
  id: string;
  label: string;
  group: Group;
  input?: AdminAction<DudesState>['input'];
  card?: string;
  run?: Run;
  /** Its buttons, when it isn't one plain button called `label`. */
  buttons?: Omit<StoryDevButton, 'action' | 'group'>[];
  hint?: string;
  danger?: true;
  confirm?: string;
}

const PIECES: Piece[] = [
  {
    id: 'story-on',
    label: 'Story ON',
    group: 'switch',
    run: (ctx) => {
      if (storyOn(ctx.state)) return 'Story is already on';
      ctx.state.ai.story = true;
      ctx.log('Story ON (admin): Finders Keepers runs', 'alert');
    },
  },
  {
    id: 'story-off',
    label: 'Story OFF',
    group: 'switch',
    // The clean-up every boot runs (FK-001), as Stop: the scene ends, every gathering is called off, the
    // head walks and shows again. The page brings back the old band and its panels once `town.story` goes.
    run: (ctx) => {
      ctx.state.ai.story = false;
      const n = letGo(ctx.state);
      ctx.log(`Story OFF (admin): today's game${n ? `; let go of ${things(n)} (scene, gatherings, the head's lock)` : ''}`, 'alert');
    },
  },
  {
    id: 'story-play',
    label: 'play a scene now (skips arming and GO)',
    group: 'scene',
    input: { kind: 'text', label: STORY_PLAYS.map((p) => p.id).join(' | '), maxLength: 20 },
    run: (ctx, value) => {
      const v = String(value ?? '').trim();
      const play = STORY_PLAYS.find((p) => p.id.toLowerCase() === v.toLowerCase());
      if (!play) return `No scene called "${v.slice(0, 20)}": ${STORY_PLAYS.map((p) => p.id).join(', ')}`;
      if (play.card || !play.run) return `not built yet: ${play.card}`;
      return play.run(ctx);
    },
    buttons: STORY_PLAYS.map((p) => ({ label: `Play: ${p.label}`, value: p.id, ...(p.card ? { card: p.card } : {}) })),
  },
  {
    id: 'story-stop',
    label: 'Stop (panic exit)',
    group: 'scene',
    danger: true,
    hint: 'Ends the scene, lets everyone go, gives the head his WASD back',
    run: (ctx) => {
      const city = cityOf(ctx.state);
      // The scene it cuts, for the log: a story scene (the show runtime's), or today's Crossing.
      const cut = city.story?.scene?.id ?? (city.scene?.id === 'crossing' ? 'crossing' : undefined);
      const n = letGo(ctx.state);
      // Today's opening, arrival, age turn and finale play on (letGo), so say which one is, not just "nothing".
      const today = city.scene;
      if (!n && today) return `Nothing to stop: today's ${today.id} scene plays on to its end (Stop cuts only what Story (dev) starts)`;
      if (!n) return 'Nothing to stop: no scene playing, nobody gathered, the head free';
      ctx.log(`story: stopped${cut ? ` the ${cut} scene` : ''} (admin, panic exit): let go of ${things(n)}`, 'alert');
    },
  },
  {
    id: 'story-gather',
    label: 'Gather at the Folly (no scene)',
    group: 'scene',
    run: gatherAll,
    buttons: [{ label: 'Gather', hint: 'The Call: everyone walks into the ring at the Folly, no scene' }],
  },
  { id: 'folly-raise', label: 'Raise the cordon', group: 'folly', run: (ctx, v) => FOLLY_DEV['folly-raise'](ctx, v), hint: "The age's Folly goes up under its tarp" }, // hook FK-023 (wrapped: FOLLY_DEV isn't there yet while this file loads)
  {
    id: 'folly-progress',
    label: "set the Folly's progress",
    group: 'folly',
    input: { label: 'percent', min: 0, max: 100, step: 1 },
    run: (ctx, v) => FOLLY_DEV['folly-progress'](ctx, v), // hook FK-023
    buttons: [0, 50, 100].map((n) => ({ label: `Folly → ${n}`, value: n })),
  },
  { id: 'folly-retarp', label: 'Re-tarp', group: 'folly', run: (ctx, v) => FOLLY_DEV['folly-retarp'](ctx, v), hint: 'The tarp back over the Folly, for another Unveiling' }, // hook FK-023
  {
    id: 'side-set',
    label: "Set a chatter's side",
    group: 'people',
    input: { kind: 'text', label: 'name red|gold|none', maxLength: 40 },
    run: (ctx, v) => SIDES_DEV['side-set'](ctx, v), // hook FK-012 (wrapped, as FK-023's: the import loop)
    buttons: [{ label: 'Set side', arg: 'name red|gold|none' }],
  },
  {
    id: 'spotlight-test',
    label: "Spotlight a chatter's home",
    group: 'people',
    input: { kind: 'text', label: 'name', maxLength: 40 },
    card: 'FK-049',
    buttons: [{ label: 'Spotlight', arg: 'name' }],
  },
  {
    id: 'cast-reset',
    label: 'Reset the cast',
    group: 'people',
    run: resetTheCast,
    hint: "The age's cast as new, back on their marks: across the river while the bridge is down, else at the gate",
  },
  {
    id: 'stage-stream-1',
    label: 'Stage stream 1',
    group: 'stage',
    card: 'FK-056',
    hint: 'Copies the save, then: bridge intact, band offstage, cast reset, sides cleared. No world wipe',
    confirm: 'Stage stream 1?\n\nThe save is copied first. Lots and builds stay; the bridge, the band, the cast and the sides are set for the Intro.',
  },
];

/** The gate in front of every piece: Story on (but for Story ON itself), then built. */
function gate(p: Piece, state: DudesState): string | undefined {
  if (p.id !== 'story-on' && !storyOn(state)) return 'Story is off: switch Story ON first';
  if (p.card || !p.run) return `not built yet: ${p.card}`;
  return undefined;
}

/** Story (dev)'s admin actions, for adminActions in index.ts. */
export function storyDevActions(): AdminAction<DudesState>[] {
  return PIECES.map((p) => ({
    id: p.id,
    label: `Story (dev): ${p.label}`,
    ...(p.input ? { input: p.input } : {}),
    run: (ctx, value) => {
      const why = gate(p, ctx.state) ?? p.run!(ctx, value);
      if (!why) return;
      ctx.log(`${p.id}${value === undefined ? '' : ` ${String(value).slice(0, 40)}`}: ${why}`, 'warn');
      return why;
    },
  }));
}

/** The /admin card's buttons, in order (the Story switch is drawn on its own). */
export function storyDevButtons(): StoryDevButton[] {
  return PIECES.flatMap(({ group, ...p }) =>
    group === 'switch'
      ? []
      : (p.buttons ?? [{ label: p.label }]).map((b) => ({
          action: p.id,
          group,
          ...(p.hint ? { hint: p.hint } : {}),
          ...(p.danger ? { danger: p.danger } : {}),
          ...(p.confirm ? { confirm: p.confirm } : {}),
          ...(p.card ? { card: p.card } : {}),
          ...b,
        })),
  );
}

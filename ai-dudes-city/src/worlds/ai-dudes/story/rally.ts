// Wren's Rally v0 (FK-026): the `rally` story scene (shared/storyScenes.ts), played by the show runtime.
// Story (dev) → Play: Rally starts it; tickShow hands each tick here (hook FK-026 in show.ts), and
// showView hands its view (rallyView).
//
// - The Call, RALLY.callMs: Wren's whistle and the banner "WREN'S FIRE · type coming". Chat is in gather
//   mode (a scene plays), so "coming" is a keyword: the first RALLY.comers who type it are walked to a
//   slot round her fire (story/gather.ts summon, a `dude.gather` like the ring's). Oak, Moss and Kit take
//   the arc's ends and Wren her mark, so the fire never looks empty, comers or not.
// - From RALLY.callMs the page gets the scene: the letterbox on Wren and the group, two lines from the bank.
// - From RALLY.askAt, "Him or us? · type us": each chatter's "us" joins red (sides.ts takeSide, the one
//   pick per age: gold this age is refused through the crier) and lights a pip.
// - From RALLY.nowAt the NOW card; at the scene's end endShow lets the comers go a few at a time.
// The rally's own bookkeeping is in memory, keyed by the scene's `id:at`: a restart ends the scene anyway.
import type { TownView } from '../../../shared/dudesTypes';
import type { GroundPoint } from '../../../shared/objectTypes';
import { STORY_SITES } from '../../../shared/storyMap';
import { RALLY, RALLY_LINES, WREN_MARK } from '../../../shared/storyScenes';
import { hashOf } from '../agent';
import { cityOf, townieGo } from '../city';
import { crierReply } from '../crier';
import { RING, gatherTally, ringRows, summon, type RingSite } from './gather';
import { addEffect } from '../sim';
import type { DudesState, StorySceneState, Townie } from '../state';
import { castTownie, type CastRole } from './cast';
import { lockCapOf, playShow, sceneTime, storyScene } from './show';
import { takeSide } from './sides';

export const RALLY_ID = 'rally';
/** The comers' half ring round the fire, on its town side (+Z), everyone facing it. */
const SITE: RingSite = { at: STORY_SITES.wrenFire.at, side: 0, inner: 3, outer: 4.5 };
/** The cast who fill the arc's ends. */
const FILL: CastRole[] = ['oak', 'moss', 'kit'];

interface Memo {
  key: string;
  /** Free slots for comers, front row first, each row from the middle out. */
  slots: { at: GroundPoint; face: number }[];
  comers: string[];
  red: string[];
  /** Everyone whose "us" has been dealt with: joined red, or refused. */
  asked: Set<string>;
  /** The cast's marks, for the puff at the Call's end and their facing. */
  marks: { role: CastRole; at: GroundPoint; face: number }[];
}
const memos = new WeakMap<DudesState, Memo>();
const keyOf = (sc: StorySceneState) => `${sc.id}:${sc.at}`;

/** Two different lines from the bank, picked by when the rally starts. */
function twoLines(now: number): { w1: string; w2: string } {
  const h = hashOf(`rally:${now}`);
  const a = h % RALLY_LINES.length;
  const b = (a + 1 + ((h >>> 8) % (RALLY_LINES.length - 1))) % RALLY_LINES.length;
  return { w1: RALLY_LINES[a], w2: RALLY_LINES[b] };
}

/**
 * Story (dev) → Play: Rally. Says why not, and changes nothing, when Wren isn't in town, the band is
 * still across the river, a ring holds a crowd, or a scene plays.
 */
export function startRally(state: DudesState, now: number): string | undefined {
  const city = cityOf(state);
  if (!castTownie(state, 'wren')) return "Wren isn't in town: play the opening (or Reset the cast) first";
  if (city.caravan?.stranded) return 'The band is still across the river: Play: Crossing first';
  if (state.dudes.some((d) => d.gather)) return 'Everyone is gathered already: Stop it first';
  const why = playShow(state, RALLY_ID, now, twoLines(now));
  if (why) return why;
  stage(state, city.story!.scene!, now);
  return undefined;
}

/** The fire's slots and the cast onto their marks: Wren behind the fire, Oak, Moss and Kit at the arc's ends. */
function stage(state: DudesState, sc: StorySceneState, now: number): Memo {
  const rows = ringRows(state, SITE);
  // Middle out, so the last two of a row are its ends: the cast takes the front row's ends and the second row's.
  const ends = [rows[0]?.at(-1), rows[0]?.at(-2), rows[1]?.at(-1)];
  const slots = rows.flat().filter((s) => !ends.includes(s));
  const marks: Memo['marks'] = [{ role: 'wren', at: WREN_MARK.at, face: WREN_MARK.facing }];
  FILL.forEach((role, i) => {
    const s = ends[i] ?? slots.pop();
    if (s) marks.push({ role, at: s.at, face: s.face });
  });
  const until = sc.at + RALLY.ms + 2000;
  for (const m of marks) {
    const t = castTownie(state, m.role);
    if (!t) continue;
    Object.assign(t, { doing: 'stroll', until, placeId: undefined, hidden: undefined, emote: undefined, say: undefined });
    if (!townieGo(state, t, m.at)) puff(state, t, m.at, now);
  }
  const memo: Memo = { key: keyOf(sc), slots, comers: [], red: [], asked: new Set(), marks };
  memos.set(state, memo);
  return memo;
}

/** Out of sight where they are, and onto their mark in a puff of smoke. */
function puff(state: DudesState, t: Pick<Townie, 'position' | 'path'>, at: GroundPoint, now: number): void {
  addEffect(state, { kind: 'burst', at: now, to: { ...t.position }, label: 'smoke' });
  Object.assign(t, { position: { ...at }, path: [] });
  addEffect(state, { kind: 'burst', at: now, to: { ...at }, label: 'smoke' });
}

/** Every tick of the rally scene (show.ts tickShow, hook FK-026): comers to the fire, the cast on their marks, each "us" to red. */
export function tickRally(state: DudesState, sc: StorySceneState, now: number): void {
  const memo = memos.get(state)?.key === keyOf(sc) ? memos.get(state)! : stage(state, sc, now);
  const t = sceneTime(sc, now);
  const words = gatherTally(state).words;
  // Comers, first first, until Wren asks: a slot by the fire each, walked there at the ring's run.
  if (t < RALLY.askAt) {
    const until = sc.at + lockCapOf(storyScene(RALLY_ID)!) + RING.releaseMs;
    for (const id of words.coming) {
      if (memo.comers.length >= RALLY.comers || !memo.slots.length) break;
      const d = state.dudes.find((x) => x.id === id);
      if (!d || d.gather || memo.comers.includes(id)) continue;
      summon(state, d, { ...memo.slots.shift()!, off: 0 }, until, now);
      memo.comers.push(id);
    }
  }
  // Comers still on their way when the Call ends appear in their places, as a ring's stragglers do, so the shot has them.
  if (t >= RALLY.callMs)
    for (const id of memo.comers) {
      const d = state.dudes.find((x) => x.id === id);
      const g = d?.gather;
      if (d && g && Math.hypot(d.position.x - g.slot.x, d.position.z - g.slot.z) > RING.thereM) {
        puff(state, d, g.slot, now);
        d.facing = g.face;
      }
    }
  // The cast: anyone not on their mark when the Call ends appears there; once there, they face the fire.
  for (const m of memo.marks) {
    const c = castTownie(state, m.role);
    if (!c) continue;
    const off = Math.hypot(c.position.x - m.at.x, c.position.z - m.at.z) > 1;
    if (off && t >= RALLY.callMs) puff(state, c, m.at, now);
    else if (!c.path.length) c.facing = m.face;
    c.until = Math.max(c.until, sc.at + RALLY.ms + 2000);
  }
  // "Him or us?": each "us" joins red, once; the other side this age is refused through the crier.
  if (t >= RALLY.askAt && t < RALLY.nowAt)
    for (const id of words.us) {
      const d = !memo.asked.has(id) && state.dudes.find((x) => x.id === id);
      if (!d) continue;
      memo.asked.add(id);
      const refused = takeSide(state, d, 'red', now);
      if (refused) crierReply(state, d.id, 'side', refused, now);
      else memo.red.push(id);
    }
}

/** Who has come and who said "us" (dude ids), for the log and the tests. */
export function rallyCount(state: DudesState): { comers: string[]; red: string[] } {
  const m = memos.get(state);
  return { comers: [...(m?.comers ?? [])], red: [...(m?.red ?? [])] };
}

/**
 * The rally on the page, over showView's own: during the Call the banner (and the whistle) and no scene,
 * so the page keeps its strip; then the scene, the pips while Wren asks, and the NOW card.
 */
export function rallyView(state: DudesState, sc: StorySceneState, view: Partial<TownView>, now: number): Partial<TownView> {
  const t = sceneTime(sc, now);
  const { scene, ...rest } = view;
  const { comers, red } = rallyCount(state);
  if (t < RALLY.callMs) {
    const premise = comers.length ? `${comers.length} coming` : "Wren's whistle";
    return { ...rest, show: { banner: { title: "WREN'S FIRE · type coming", premise, until: sc.at + RALLY.callMs, sound: 'whistle' } } };
  }
  const show =
    t >= RALLY.nowAt
      ? { now: { word: 'STAND WITH WREN', chip: 'type red', side: 'red' as const, until: sc.at + RALLY.ms } }
      : t >= RALLY.askAt
        ? { prompt: { kind: 'pips', label: 'Him or us? · type us', count: red.length } }
        : undefined;
  return { ...rest, ...(scene ? { scene } : {}), ...(show ? { show } : {}) };
}

// The Board across the top of the stream (FK-011; the page draws it in FK-010): the head's Folly in
// gold, Wren's ask in red, the tug line's tally and the ticker. And the operator page's show strip
// (FK-038): the next beat, its lamp, the cue cards (until that lands, nothing to show there).
//
// Live truth only, read from what is already saved, every snapshot; nothing here is stored.
// - Gold: the age's Folly by its Board word (story/folly.ts FOLLIES), filled by `city.story.folly.pct`
//   (FK-023's timer) once this age's cordon is up, 0 before.
// - Red: the caravan's ask under way, so the existing ask engine drives it (free builds of the asked
//   kind count, bible §4). In Stone the band waits across the river, so it reads "BRIDGE · soon" until
//   the opening has played (no ask yet, caravan.ts openBridge), then "BRIDGE have/need" with need
//   ⌈0.4 × awake chatters⌉ (1 to 8), one shift per chatter. A later ask switches the word by itself
//   (FK-129's story jobs add theirs to RED_WORDS); between asks it reads "NEXT JOB · soon".
// - The tally: awake chatters on each side this age (sides.ts sideNow; FK-012 sets the sides).
// - The ticker: the premise for whoever just arrived, the newest joiners and the latest turncoat from
//   `city.story.sideLog`, and the !play line that lived in the invite panel. The page shows one line
//   at a time, 20 s each, and lets a new line cut in (FK-010), so this sends the whole list and keeps
//   each line's words stable while it stands.
// Only while Story is on (story/view.ts). Zero AI.
import { config } from '../../../config';
import type { BoardView, MayorView, TownView } from '../../../shared/dudesTypes';
import { caravanOf, caravanOn, type CaravanAsk } from '../caravan';
import { ageOf, cityOf, headName } from '../city';
import { awake } from '../sim';
import type { DudesState, SideLogEntry } from '../state';
import { CAST } from './cast';
import { FOLLIES, follyNow } from './folly';
import { sideNow } from './sides';

export const BOARD = {
  /** Joiners and turncoats on the ticker at once, newest first (the latest turncoat always among them). */
  sideLines: 3,
  /** A side line leaves the ticker this long after the join: by then it has come round a few times. */
  sideMs: 10 * 60_000,
  /** A name on the ticker is cut to this. */
  nameMax: 20,
};

/** Wren's job as its one word on the red bar, by the caravan ask's id (caravan.ts asksFor, openBridge).
 * An ask not listed reads as its id; the Wonder's reads as the Wonder ("FURNACE"). */
export const RED_WORDS: Readonly<Record<string, string>> = {
  bridge: 'BRIDGE',
  food: 'FOOD',
  fed: 'FEED THEM',
  work: 'WORKSHOP',
  shifts: 'SHIFTS',
  party: 'PARTY',
};
/** No ask under way: the visit is over and the next not open yet, or no caravan in this age. */
export const NEXT_JOB = 'NEXT JOB';

/** The Board (`board`). */
export function boardView(state: DudesState, now: number): Partial<TownView> {
  return { board: boardOf(state, now) };
}

/** The Board's data, as the page draws it. */
export function boardOf(state: DudesState, now: number): BoardView {
  const tally = { red: 0, gold: 0 };
  for (const d of state.dudes) {
    const side = sideNow(state, d);
    if (side && awake(d, now)) tally[side]++;
  }
  return { gold: goldBar(state), red: redBar(state), tally, ticker: boardTicker(state, now, playSite()) };
}

/** The head's Folly: this age's word, and how far its timer has filled it (whole percent, as `town.folly`, so 100 means done). */
function goldBar(state: DudesState): BoardView['gold'] {
  const f = follyNow(state);
  const pct = f && Number.isFinite(f.pct) ? Math.max(0, Math.min(100, Math.floor(f.pct))) : 0;
  return { word: (FOLLIES[ageOf(state)] ?? FOLLIES[0]).word, pct };
}

/** Wren's job: the caravan's ask under way (the first not yet met), its word and count; no count reads "· soon". */
function redBar(state: DudesState): BoardView['red'] {
  const age = ageOf(state);
  const cv = cityOf(state).caravan;
  if (!caravanOn(state)) return { word: NEXT_JOB };
  // Stone's band starts stuck across the river (caravan.ts startCaravan), even before it has come.
  if (!cv || cv.age !== age) return { word: age === 0 ? RED_WORDS.bridge : NEXT_JOB };
  if (cv.turn) return { word: NEXT_JOB };
  const ask = cv.asks.find((a) => a.have < a.need) ?? cv.asks.at(-1);
  if (!ask) return { word: cv.stranded ? RED_WORDS.bridge : NEXT_JOB };
  return { word: redWord(ask, cv.age), have: Math.max(0, Math.min(ask.have, ask.need)), need: ask.need };
}
const redWord = (ask: CaravanAsk, age: number) =>
  Object.hasOwn(RED_WORDS, ask.id) ? RED_WORDS[ask.id] : (ask.kind === 'project' ? caravanOf(age).wonder.replace(/^the /i, '') : ask.id).toUpperCase();

/** The ticker's lines, in the order the page goes round them. `play`: the play site's address (none: no line). */
export function boardTicker(state: DudesState, now: number, play: string | undefined): string[] {
  const head = headName(state);
  const wren = CAST.wren.name;
  const lines = [`${head} took ${wren}'s home`, `Red helps ${wren}. Gold helps ${head.replace(/^The /, 'the ')}.`, ...sideLines(cityOf(state).story?.sideLog ?? [], now)];
  if (play) lines.push(`Walk your character: ${play}`);
  return [...new Set(lines)];
}

/** "Nia joined gold", "Kev crossed to red": each person's newest, from the last BOARD.sideMs, newest first;
 * the latest turncoat always makes it (turncoats are content, bible §4). */
export function sideLines(log: readonly SideLogEntry[], now: number): string[] {
  const seen = new Set<string>();
  const out: { line: string; turned: boolean }[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (!e || now - e.at > BOARD.sideMs || seen.has(e.id)) continue;
    seen.add(e.id);
    const turned = !!e.from && e.from !== e.side;
    out.push({ line: `${who(e.name)} ${turned ? 'crossed to' : 'joined'} ${e.side}`, turned });
  }
  const shown = out.slice(0, BOARD.sideLines);
  const turncoat = out.find((x) => x.turned);
  if (turncoat && !shown.includes(turncoat)) shown[shown.length - 1] = turncoat;
  return shown.map((x) => x.line);
}

/** A chatter's name as the ticker says it: "kev" reads as Kev; a name typed with its own capitals keeps them. */
function who(name: string): string {
  const n = name.trim().replace(/^@+/, '');
  const cut = n.length > BOARD.nameMax ? `${n.slice(0, BOARD.nameMax - 1)}…` : n;
  return cut === cut.toLowerCase() ? cut.charAt(0).toUpperCase() + cut.slice(1) : cut;
}

/** Where chatters walk their own character, without the scheme, while the /play site is set up (its login
 * secret and address, as the snapshot's play line needs; the doors are the server's, src/index.ts). */
export function playSite(): string | undefined {
  if (!config.PLAY_SECRET || !config.PLAY_URL) return undefined;
  return config.PLAY_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The show strip on the operator page (`show`). */
export function mayorStripView(_state: DudesState, _now: number): Partial<MayorView> {
  return {};
}

// Gathering (FK-018, FK-019): while a Call or a scene runs, chat lines become bubbles and keywords
// (1–10, us, coming, red, gold, warn, help), never agent turns; moves and builds queue for the release.
// Everyone awake is walked to a tiered ring slot round a STORY_SITES anchor (`dude.gather`).
//
// Gather mode (FK-018). hear() and the /play page's `say` hand a line here once it has shown as a bubble
// (index.ts): nothing reaches an inbox, spokeTo, overhear or leaveVisit, and the turns characters take
// on their own wait for the release (pumpAgents, idleLife). So the crowd's own words are the show, and
// fifteen lines in a scene cost no model calls at all.
//
// A keyword counts only as the whole message: trimmed, any case, a trailing "!" or "." and Kick emotes
// aside (FK-012's rule), so "us" is a vote and "us lot should build a wall" is a line. A number 1–10 is
// RATE IT (each chatter's latest counts once in the average), and each word counts each chatter once:
// `us` (the Rally's pips), `coming` (who comes to Wren's fire), `warn` (gold's pings to /mayor), and the
// side words `red`, `gold` and `help` (FK-012 joins the side from hearInGather). The tally is one
// gathering's (a scene's `id:at`), kept in memory only: a restart ends the scene anyway (releaseShow).
//
// Free building keeps working: a move or build line ("build me a hut", "go to the café") waits on its
// chatter (`dude.queuedLine`, saved; their latest one wins, so one queued turn each at most) and goes to
// their agent after the release, one chatter at a time and at least 2 s apart (takeQueued). A newcomer's
// first line waits too, so their agent meets them; if all they said was a vote, their arrival stands in
// for it (a vote never goes to an agent: `red` joins a side, FK-012).
import { storyOn, type Dude, type DudesState } from '../state';

/** The words gather mode counts, besides a number 1–10. */
export const GATHER_WORDS = ['us', 'coming', 'warn', 'red', 'gold', 'help'] as const;
export type GatherWord = (typeof GATHER_WORDS)[number];
/** A line that was a keyword: a word, or a RATE IT number. */
export type Keyword = { word: GatherWord } | { word: 'rate'; n: number };

/** At least this long between two chatters' queued lines going to their agents after a release. */
export const REPLAY_GAP_MS = 2000;
/** The longest queued line kept (hear() cuts a chat line to this already). */
const LINE_MAX = 300;
/** What a newcomer's agent hears after the release when all they said in the gathering was a vote. */
export const ARRIVED_LINE = 'you arrived in town in the middle of the show and joined the crowd';

/** A scene playing, the head on his mark for one, or anyone called to a ring: chat is in gather mode. Never with Story off. */
export function gathering(state: DudesState): boolean {
  if (!storyOn(state)) return false;
  return !!state.city?.story?.scene || !!state.mayor?.lock || state.dudes.some((d) => d.gather);
}

const EMOTE = /\[emote:\d{1,12}:[^\]]{0,60}\]/g;

/** The message as one bare word, the way keywords are matched: trimmed, lower case, Kick emotes and a trailing "!" or "." aside. */
export function wholeWord(text: string): string {
  return text.replace(EMOTE, ' ').trim().toLowerCase().replace(/[!.]+$/, '').trimEnd();
}

/** The keyword a whole message is, if it is one: "US!", "coming", "7", "7/10", "8.5". "11", "0" and "us lot" are lines. */
export function keywordOf(text: string): Keyword | undefined {
  const w = wholeWord(text);
  if ((GATHER_WORDS as readonly string[]).includes(w)) return { word: w as GatherWord };
  const m = /^(\d{1,2}(?:\.\d)?)(?:\s*\/\s*10)?$/.exec(w);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 10 ? { word: 'rate', n } : undefined;
}

/**
 * A line that asks the character to do something in the world: build or change something, go
 * somewhere, take part. Only decides what waits for the release, so it leans towards yes: a line it
 * lets through costs one turn after the scene; a build it missed would be lost.
 */
const MOVE_OR_BUILD =
  /\b(build|make|create|construct|craft|put up|set up|add|plant|dig|design|paint|colou?r|decorate|edit|change|upgrade|extend|expand|rebuild|rename|fix|repair|mend|restore|remove|demolish|destroy|delete|tear (it |that )?down|knock (it |that )?down|bulldoze|get rid of|go|walk|run|move|head|visit|follow|ride|drive|fly|sail|come (to|over|here|back|with)|take me|bring|give|share|invite|rent|buy|sell|pay|chip in|contribute|donate|work|help (me|us|with|at|out|build|fix|mend)|throw|party|shoot|punch|attack|fight|hug|high ?five|explore|find|meet|eat|sleep|nap)\b/i;
export const movesOrBuilds = (line: string): boolean => MOVE_OR_BUILD.test(line);

/** One gathering's votes: each RATE IT voter's latest number, and who said each word, first first. */
interface Tally {
  key: string;
  lines: number;
  rates: Map<string, number>;
  words: Record<GatherWord, Set<string>>;
}
/** Per world state (tests make many): the tally, ones a new gathering cut off before a tick logged them, and when the next queued line may go. */
interface Memo {
  tally?: Tally;
  ended: Tally[];
  nextReplayAt: number;
}
const memos = new WeakMap<DudesState, Memo>();
const memoOf = (state: DudesState): Memo => memos.get(state) ?? memos.set(state, { ended: [], nextReplayAt: 0 }).get(state)!;

/** Which gathering this is: a scene by its `id:at`, else the ring or the head's mark on their own. */
function keyOf(state: DudesState): string {
  const sc = state.city?.story?.scene;
  return sc ? `${sc.id}:${sc.at}` : 'gather';
}

/** This gathering's tally, begun on its first line. One left from another gathering waits for tickGather to log it. */
function tallyOf(state: DudesState): Tally {
  const memo = memoOf(state);
  const key = keyOf(state);
  if (memo.tally?.key === key) return memo.tally;
  if (memo.tally && memo.ended.length < 4) memo.ended.push(memo.tally);
  memo.tally = { key, lines: 0, rates: new Map(), words: Object.fromEntries(GATHER_WORDS.map((w) => [w, new Set<string>()])) as Tally['words'] };
  return memo.tally;
}

/**
 * A chatter's line in gather mode, once the caller has shown its bubble. A keyword is counted; any other
 * line that is a move or build waits for the release (`queue`: hear()'s lines, not the /play page's,
 * whose builds have a button of their own). So does a newcomer's first line, so their agent meets them
 * after the release: their first words, or their arrival if all they have said is a vote. Says which
 * keyword it was, if any.
 */
export function hearInGather(state: DudesState, dude: Dude, line: string, now: number, queue = true): Keyword | undefined {
  const t = tallyOf(state);
  t.lines++;
  const k = keywordOf(line);
  if (k?.word === 'rate') t.rates.set(dude.id, k.n);
  else if (k) t.words[k.word].add(dude.id);
  if (!queue) return k;
  const newcomer = dude.turns === 0 && (!dude.queuedLine || !!dude.queuedLine.world);
  if (!k && (movesOrBuilds(line) || newcomer)) dude.queuedLine = { text: line.slice(0, LINE_MAX), at: now };
  else if (k && newcomer && !dude.queuedLine) dude.queuedLine = { text: ARRIVED_LINE, at: now, world: true };
  return k;
}

/** What chat has said in this gathering so far: for the prompt tiles (FK-022), the Rally (FK-026), the warn pings (FK-057) and the candles (FK-091). */
export interface GatherTally {
  /** Every line heard in gather mode, keywords included. */
  lines: number;
  /** RATE IT: the average of each voter's latest number, and how many voted. */
  rate?: { avg: number; n: number };
  /** Who said each word (dude ids), first first. */
  words: Record<GatherWord, string[]>;
}

/** This gathering's tally; an empty one when chat isn't in gather mode. */
export function gatherTally(state: DudesState): GatherTally {
  const t = gathering(state) ? memos.get(state)?.tally : undefined;
  const live = t?.key === keyOf(state) ? t : undefined;
  const rates = [...(live?.rates.values() ?? [])];
  return {
    lines: live?.lines ?? 0,
    ...(rates.length ? { rate: { avg: rates.reduce((a, b) => a + b, 0) / rates.length, n: rates.length } } : {}),
    words: Object.fromEntries(GATHER_WORDS.map((w) => [w, [...(live?.words[w] ?? [])]])) as GatherTally['words'],
  };
}

/** Every world tick: once a gathering is over (or another has begun), its tally goes into the log and is dropped. */
export function tickGather(state: DudesState, log: (line: string) => void): void {
  const memo = memos.get(state);
  if (!memo) return;
  for (const t of memo.ended.splice(0)) closeTally(state, t, log);
  const t = memo.tally;
  if (!t || (gathering(state) && t.key === keyOf(state))) return;
  memo.tally = undefined;
  closeTally(state, t, log);
}

/** A gathering's tally, summed up in one log line. */
function closeTally(state: DudesState, t: Tally, log: (line: string) => void): void {
  const rates = [...t.rates.values()];
  const counts = [
    ...(rates.length ? [`RATE IT ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)} from ${rates.length}`] : []),
    ...GATHER_WORDS.filter((w) => t.words[w].size).map((w) => `${w} ${t.words[w].size}`),
  ];
  const queued = state.dudes.filter((d) => d.queuedLine).length;
  const what = t.key === 'gather' ? 'the gathering' : `the ${t.key.slice(0, t.key.lastIndexOf(':'))} scene`;
  log(
    `story: gather mode over (${what}): ${t.lines} line${t.lines === 1 ? '' : 's'}, none to an agent` +
      `${counts.length ? `; ${counts.join(', ')}` : ''}${queued ? `; ${queued} queued for ${queued === 1 ? 'its agent' : 'their agents'} after the release` : ''}`,
  );
}

/**
 * The next queued line due to its agent, taken off its chatter: none while chat is in gather mode, nor
 * within REPLAY_GAP_MS of the last one; then the chatter who has waited longest.
 */
export function takeQueued(state: DudesState, now: number): { dude: Dude; text: string; at: number; world?: true } | undefined {
  if (gathering(state)) return undefined;
  const memo = memoOf(state);
  if (now < memo.nextReplayAt) return undefined;
  let next: Dude | undefined;
  for (const d of state.dudes) if (d.queuedLine && (!next || d.queuedLine.at < next.queuedLine!.at)) next = d;
  if (!next) return undefined;
  const q = next.queuedLine!;
  next.queuedLine = undefined;
  memo.nextReplayAt = now + REPLAY_GAP_MS;
  return { dude: next, ...q };
}

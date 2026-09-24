// Rook's own grudges: a small table of who keeps knocking his yard down (Regard, keyed by
// lowercased chatter). Nothing here is punitive in the pipeline — every request is still built
// and every piece still repaired — it is tone: a flat acknowledgement, a grumble on the walk, and
// their things last in his repair rounds. The neighbours keep their own tables (neighbours.ts);
// this module is just the arithmetic and the words, dependency-free so either side can use it.
import type { Regard } from '../../shared/safehouseTypes';

/** The app's numbers. Scores are points, time in ms of world time. */
export const GRUDGE = {
  max: 20,
  /** He sulks from here: the flat ack, the grudging walk line, their repairs last in the tier. */
  sulkAt: 4,
  /** One point off every quarter of an hour left alone. */
  decayMs: 15 * 60_000,
  /** A grudge that has sat at zero this long is forgotten outright. */
  forgetMs: 60 * 60_000,
  /** What a chatter's creature knocking something of his down costs them. */
  knockedDown: 2,
  /** Amends: a repair they ask for, a defense they build, a gift to a neighbour. */
  repaired: -3,
  defended: -2,
  gifted: -1,
  /** Chatters remembered at once; the coldest entries go past this. */
  remembered: 60,
};

/** The table key for a piece's creator, or nothing when it was not a chatter's doing. */
export function chatterKey(createdBy: string | undefined, notChatters: Iterable<string>): string | undefined {
  const key = (createdBy ?? '').trim().toLowerCase();
  if (!key) return undefined;
  for (const n of notChatters) if (n.toLowerCase() === key) return undefined;
  return key;
}

/**
 * Move a chatter's score. A grudge only starts on a slight (a negative delta on someone he has
 * nothing against does nothing); it never goes below zero or past the cap. Returns the entry.
 */
export function bump(
  table: Record<string, Regard>,
  user: string,
  delta: number,
  now: number,
  reason?: string,
): Regard | undefined {
  const key = user.trim().toLowerCase();
  if (!key || !Number.isFinite(delta) || delta === 0) return table[key];
  let entry = table[key];
  if (!entry) {
    if (delta < 0) return undefined;
    entry = table[key] = { score: 0, since: now, lastAt: now };
  }
  entry.score = Math.max(0, Math.min(GRUDGE.max, entry.score + delta));
  entry.lastAt = now;
  if (reason && delta > 0) entry.reason = reason.slice(0, 120);
  trimTable(table);
  return entry;
}

/** Past the cap on remembered chatters, the coldest (lowest score, then longest quiet) are dropped. */
function trimTable(table: Record<string, Regard>): void {
  const keys = Object.keys(table);
  if (keys.length <= GRUDGE.remembered) return;
  keys
    .sort((a, b) => table[a].score - table[b].score || table[a].lastAt - table[b].lastAt)
    .slice(0, keys.length - GRUDGE.remembered)
    .forEach((k) => delete table[k]);
}

/**
 * Time heals: a point off per quarter hour since the last change, and an entry that has sat at
 * zero for an hour is forgotten. Returns whether anything changed.
 */
export function decayTable(table: Record<string, Regard> | undefined, now: number): boolean {
  if (!table) return false;
  let changed = false;
  for (const [key, entry] of Object.entries(table)) {
    if (entry.score > 0) {
      const steps = Math.floor((now - entry.lastAt) / GRUDGE.decayMs);
      if (steps > 0) {
        entry.score = Math.max(0, entry.score - steps);
        entry.lastAt += steps * GRUDGE.decayMs;
        changed = true;
      }
    }
    if (entry.score <= 0 && now - entry.lastAt >= GRUDGE.forgetMs) {
      delete table[key];
      changed = true;
    }
  }
  return changed;
}

export const sulking = (table: Record<string, Regard> | undefined, user: string | undefined): boolean =>
  !!user && (table?.[user.trim().toLowerCase()]?.score ?? 0) >= GRUDGE.sulkAt;

/** How he would put it, by score: "a bit off with" … "done with". */
export function rookPhrase(score: number): string {
  if (score >= 14) return 'done with';
  if (score >= 8) return 'properly annoyed at';
  return 'a bit off with';
}

/** For his state summary: the chatters he is sulking at, strongest first, with the last reason. */
export function describeGrudges(state: { grudges?: Record<string, Regard> }): string | undefined {
  const entries = Object.entries(state.grudges ?? {})
    .filter(([, r]) => r.score >= GRUDGE.sulkAt)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 4);
  if (!entries.length) return undefined;
  return entries
    .map(([user, r]) => `you're ${rookPhrase(r.score)} ${user} (${Math.round(r.score)})${r.reason ? `: ${r.reason}` : ''}`)
    .join('; ');
}

/** Every entry, strongest first, for the operator's panel. */
export function grudgeSummary(state: { grudges?: Record<string, Regard> }): { user: string; score: number; since: number; reason?: string }[] {
  return Object.entries(state.grudges ?? {})
    .map(([user, r]) => ({ user, score: r.score, since: r.since, ...(r.reason ? { reason: r.reason } : {}) }))
    .sort((a, b) => b.score - a.score);
}

// The hoops scoreboard (`!shoot`, verbs.ts), read two ways: a line for Rook's state summary so
// "rook who's winning at hoops" has an answer, and rows for the operator's page. Writing the
// scores is verbs.ts's business; this module only reads `state.scores`.
import type { Score } from './state';

/** How long a shooter stays on Rook's mind after their last shot. */
export const RECENT_SHOT_MS = 30 * 60_000;

/** Best first: most baskets, then fewest shots taken to get them, then the name. */
export function scoreRows(scores: Record<string, Score> | undefined): { user: string; hits: number; shots: number; best: number; lastAt: number }[] {
  return Object.entries(scores ?? {})
    .map(([user, s]) => ({ user, hits: s.hits, shots: s.shots, best: s.best, lastAt: s.lastAt }))
    .sort((a, b) => b.hits - a.hits || a.shots - b.shots || a.user.localeCompare(b.user));
}
/** For the admin page: the top twenty. */
export function scoreSummary(state: { scores?: Record<string, Score> }): { user: string; hits: number; shots: number; best: number }[] {
  return scoreRows(state.scores).slice(0, 20).map(({ user, hits, shots, best }) => ({ user, hits, shots, best }));
}
/** "dave 3/5 (best run 2), erin 1/2": whoever has shot in the last half hour, top three; nothing when nobody has. */
export function describeHoops(state: { scores?: Record<string, Score> }, now: number): string | undefined {
  const rows = scoreRows(state.scores).filter((r) => now - r.lastAt <= RECENT_SHOT_MS);
  if (!rows.length) return undefined;
  const shown = rows.slice(0, 3).map((r) => `${r.user} ${r.hits}/${r.shots}${r.best >= 2 ? ` (best run ${r.best})` : ''}`);
  return `${shown.join(', ')}${rows.length > 3 ? `, and ${rows.length - 3} more` : ''}`;
}

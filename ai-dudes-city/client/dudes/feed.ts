// The feed in the corner (bottom left; on stream with Story OFF, and on /mayor): the last few things
// that happened, made readable. The server keeps every line it pushed (state.feed), so a troublemaker
// who comes back three times is three identical lines, and the operator's own speech ("The Chief: hi")
// is in there too, though his bubble already says it. The page shows each line once, at its newest,
// leaves the operator's out, and cuts a line too long for its row at a word, with an ellipsis, where
// CSS alone would stop mid-word ("Find the p…"). Pure: the page measures, this decides.
import { AGES } from '../../src/shared/ages';
import type { FeedItem } from './types';

/** What the streamer's character is called in each age ("The Chief" … "The Overseer"): his lines start with one. */
const AGE_HEADS = AGES.map((a) => `The ${a.head.title}`);

/**
 * The operator typing on /mayor: `mayor.ts` speak() pushes "<head>: <text>". `head` is the name the
 * town has for him now (TownView.head, a custom title included); every age's is checked too, so his
 * lines from before an age turn stay out.
 */
export function operatorLine(text: string, head?: string): boolean {
  if (head && text.startsWith(`${head}: `)) return true;
  return AGE_HEADS.some((h) => text.startsWith(`${h}: `));
}

/** Two lines that read the same are one line (case and spacing aside). */
const sameKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** The last `n` lines worth showing, oldest first: no operator lines, and each line once, where it last happened. */
export function feedLines(feed: readonly FeedItem[], head: string | undefined, n: number): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (let i = feed.length - 1; i >= 0 && out.length < n; i--) {
    const f = feed[i];
    const k = sameKey(f.text);
    if (!k || seen.has(k) || operatorLine(f.text, head)) continue;
    seen.add(k);
    out.push(f);
  }
  return out.reverse();
}

/** What may not sit right before an ellipsis: spaces and the punctuation that ends a clause or opens one. */
const DANGLING = /[\s,;:.\-–—(\[]+$/;

/**
 * `text` as it is if it `fits`; otherwise the most whole words from its start that fit with "…" after
 * them. A first word too long for the row on its own is kept (CSS clips it): never an empty line.
 * `fits` must say yes to anything shorter than something it said yes to (a width test is).
 */
export function fitWords(text: string, fits: (t: string) => boolean): string {
  if (fits(text)) return text;
  // Where each word ends, when another follows it.
  const ends = [...text.matchAll(/\S(?=\s)/g)].map((m) => m.index + 1);
  if (!ends.length) return text;
  const cut = (k: number) => {
    const words = text.slice(0, ends[k]);
    return `${words.replace(DANGLING, '') || words}…`;
  };
  if (!fits(cut(0))) return cut(0);
  let lo = 0;
  let hi = ends.length - 1;
  // The longest cut that fits: cut(lo) always does.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(cut(mid))) lo = mid;
    else hi = mid - 1;
  }
  return cut(lo);
}

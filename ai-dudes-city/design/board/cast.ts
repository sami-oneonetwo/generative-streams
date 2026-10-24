// The cast board (FK-006): who stands where in the line-up, and what the figures' pixels say. The
// board draws each member a second time flat (unlit, every part its own exact colour) and counts
// pixels: each member's main colours (the design gate's "4 at most") and how much of Wren's top third
// is red (her red is the biggest shape in any frame she is in). Pure data and arithmetic, so
// scripts/design-cast.test.ts can check it; design/board/main.ts does the drawing.
import { readsGold, readsRed } from '../colour';

/** The order they stand in, as the card names them. */
export const CAST_ORDER = ['wren', 'ash', 'moss', 'oak', 'kit', 'head'] as const;
/** Room for each along the line-up, metres: wide enough for the Chief's antlers, Oak's mallet and Moss's stump. */
export const SLOT = 2.1;

/** Each member's place along the line-up, centred on 0, in CAST_ORDER (members missing from the spec are left out). */
export function lineUpSlots(roles: readonly string[]): { role: string; x: number }[] {
  const here = CAST_ORDER.filter((r) => roles.includes(r));
  return here.map((role, i) => ({ role, x: (i - (here.length - 1) / 2) * SLOT }));
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Pixel counts of one flat-drawn figure: its silhouette and its top third, and how many of each are which colour. */
export interface Shares {
  /** Silhouette pixels (everything that isn't the background). */
  total: number;
  /** Silhouette pixels in the top third of its height. */
  top: number;
  by: Record<string, number>;
  topBy: Record<string, number>;
  /** The silhouette's bounding box in pixels (inclusive), when there is one. */
  box?: { x0: number; x1: number; y0: number; y1: number };
}
/**
 * Counts an RGBA picture of one figure drawn flat on `bg`: each pixel goes to the palette colour it
 * matches (within `tol`, so the antialiased edges between two parts count to neither). The top third
 * runs from the silhouette's first row down a third of its rows.
 */
export function colourShares(px: ArrayLike<number>, w: number, h: number, palette: readonly string[], bg: string, tol = 20): Shares {
  const back = rgb(bg),
    pal = palette.map((hex) => ({ hex, c: rgb(hex) }));
  const isBack = (i: number) => dist([px[i], px[i + 1], px[i + 2]], back) < tol;
  let first = -1,
    last = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!isBack((y * w + x) * 4)) {
        if (first < 0) first = y;
        last = y;
        break;
      }
  const out: Shares = { total: 0, top: 0, by: {}, topBy: {} };
  if (first < 0) return out;
  const topEnd = first + (last - first + 1) / 3;
  let x0 = w,
    x1 = -1;
  for (let y = first; y <= last; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isBack(i)) continue;
      const top = y < topEnd;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      out.total++;
      if (top) out.top++;
      const p = [px[i], px[i + 1], px[i + 2]];
      let best: string | undefined,
        bd = tol;
      for (const c of pal) {
        const d = dist(p, c.c);
        if (d < bd) [best, bd] = [c.hex, d];
      }
      if (!best) continue;
      out.by[best] = (out.by[best] ?? 0) + 1;
      if (top) out.topBy[best] = (out.topBy[best] ?? 0) + 1;
    }
  out.box = { x0, x1, y0: first, y1: last };
  return out;
}

/**
 * A figure's main colours, the way the design gate counts them: skin set aside, near shades of one
 * colour (closer than `merge` in RGB, like a hide's two browns) counted once under the biggest, and
 * only what covers at least `min` of the silhouette. Biggest first, with its share of the silhouette.
 */
export function mainColours(s: Shares, skin: readonly string[], min = 0.08, merge = 56): { hex: string; share: number }[] {
  const skins = skin.map(rgb);
  const groups: { hex: string; c: [number, number, number]; n: number }[] = [];
  for (const [hex, n] of Object.entries(s.by).sort((a, b) => b[1] - a[1])) {
    const c = rgb(hex);
    if (skins.some((k) => dist(k, c) < 12)) continue;
    const g = groups.find((x) => dist(x.c, c) < merge);
    if (g) g.n += n;
    else groups.push({ hex, c, n });
  }
  return groups
    .map((g) => ({ hex: g.hex, share: s.total ? g.n / s.total : 0 }))
    .filter((g) => g.share >= min)
    .sort((a, b) => b.share - a.share);
}

/**
 * Pixels of one colour family on a flat-drawn figure: `hex` and its tones as the page shades a part
 * (":dark" ×0.72, ":light" 40% of the way to white), each within `near`. Every member is drawn from the
 * same camera at the same size, so these compare across the line-up: Wren's red against Oak's orange.
 */
export function familyArea(s: Shares, hex: string, near = 40): number {
  const c = rgb(hex);
  const tones = [c, c.map((n) => n * 0.72), c.map((n) => n + (255 - n) * 0.4)];
  return Object.entries(s.by).reduce((n, [h, k]) => n + (tones.some((t) => dist(rgb(h), t) < near) ? k : 0), 0);
}
/** Pixels that read red (story red and anything a viewer reads as it, design/colour.ts readsRed). */
export const redArea = (s: Shares): number => Object.entries(s.by).reduce((n, [hex, k]) => n + (readsRed(hex) ? k : 0), 0);
/** Pixels that read as story gold (design/colour.ts readsGold). */
export const goldArea = (s: Shares): number => Object.entries(s.by).reduce((n, [hex, k]) => n + (readsGold(hex) ? k : 0), 0);
/** A member's own locked colour on them, in pixels: red and gold as a viewer reads them, a cast colour as its family. */
export const ownArea = (s: Shares, colour: string): number => (readsRed(colour) ? redArea(s) : readsGold(colour) ? goldArea(s) : familyArea(s, colour));

/** How much of the top third of a silhouette is red (story red and anything a viewer reads as it). */
export const topThirdRed = (s: Shares): number => (s.top ? Object.entries(s.topBy).reduce((n, [hex, k]) => n + (readsRed(hex) ? k : 0), 0) / s.top : 0);
/** How much of the whole silhouette is red. */
export const redShare = (s: Shares): number => (s.total ? redArea(s) / s.total : 0);

/** A picture's pixels to grey in place (Rec. 709 luma on the sRGB values, as a greyscale phone check sees it). */
export function toGrey(px: { length: number; [i: number]: number }): void {
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = y;
  }
}

/** The phone check (board/design-system.md §9): the stream's 1920-wide frame at 20%, 390 px wide. */
export const PHONE = { width: 390, frame: 1920, height: 1080 } as const;
/**
 * The stream camera's orthographic half-height for the phone strip: the auto camera's closest framing
 * (client/dudes/main.ts AUTO_MIN), about where the scenes' close shots sit (src/shared/scenes.ts 6.4–7).
 */
export const PHONE_HALF = 6;
/**
 * A typical free-play framing for the second strip: the auto camera frames the whole crowd between
 * AUTO_MIN 6 and AUTO_MAX 40 (FOCUS_HALF 8 on one person), so between scenes the cast are 1.3–6× smaller
 * than in close shots; at 14 m they are about 2.3× smaller.
 */
export const PHONE_FREE_HALF = 14;

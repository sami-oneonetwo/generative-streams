// Finders Keepers' line data (docs/story-bible-2026-10-24.md): the cue cards the head is offered in
// each Mayor slot, and how the Folly's plaque is read out. A Mayor slot is a held shot where Sami's mic
// is the line (bible §7): /mayor shows three short lines in large type (FK-038), keys 1/2/3 put one up
// as the stream's subtitle for viewers on mute, and a slot that times out with nobody on /mayor plays
// line 1 (FK-035). The coordinator's file (BOARD.md → Lanes, P): the cast's idle bits (FK-060) and the
// later ages' cards (FK-145, FK-152) join it here. Data and formatting only; zero AI.
//
// The head's voice: vain, never cruel (bible §1). He brags, takes the credit and admires his hat; his
// selfishness lives in what he builds. He never mocks the band's hurt, Wren or a chatter. Line 1 is
// the scripted line the scene cards quote; 2 and 3 are riffs for Sami to take or leave.
import type { AgeId } from '../../../shared/ages';

/** The longest line: one subtitle line at 58 px in the 1920 frame, still readable on a phone (board/design-system.md §3). */
export const CUE_MAX = 42;

/** Every Mayor slot, in the order a stream reaches them. Views only, never saved, so it may widen.
 * `intro-I8`: at the band's fire, waving across the river · `crossing`: the band walks over the mended
 * bridge · `unveil-U2`: the push-in on the tarp · `unveil-U4`: the hero shot, reading the plaque ·
 * `ribbon`: the age turn, cutting the Wonder's ribbon. Later ages add theirs (the Bronze Ask, FK-145). */
export const CUE_SLOTS = ['intro-I8', 'crossing', 'unveil-U2', 'unveil-U4', 'ribbon'] as const;
export type CueSlot = (typeof CUE_SLOTS)[number];

/** One slot's card: keys 1/2/3 pick a line, each at most CUE_MAX; line 1 plays at the slot's timeout.
 * `plaque`: the card (and the stream's plaque card) also shows `plaqueReadout` for him to read out. */
export interface CueCard {
  lines: readonly [string, string, string];
  plaque?: true;
}

export const CUE_CARDS: { [A in AgeId]?: { [S in CueSlot]?: CueCard } } = {
  // Stream 1: the Chief and the Big Hut (FK-073).
  stone: {
    // I8: Sami's live Chief at the band's fire, waving at them across the river they just came home to.
    'intro-I8': { lines: ['Hello! Welcome to my town!', "I'm the Chief. You can tell by the hat.", 'The bridge was like that when I got here.'] },
    // Ash limps over on Oak's shoulder, then Kit runs straight to the Chief.
    crossing: { lines: ["Mind the floor. It's new.", 'Make yourselves at home. Not that one.', 'Oh, a fan! Well, obviously.'] },
    // The slow push-in on the tarp, before it drops.
    'unveil-U2': { lines: ['Behold! A hut. For me.', "Trust me. It's going to be amazing.", "You may look. Don't touch."] },
    // From the hut looking back: his face, the crowd soft behind. The plaque first, then a riff.
    'unveil-U4': { lines: ['A hut fit for a Chief. One Chief.', "Hold your applause. No, don't. Clap!", "Yes, the door is small. It's exclusive."], plaque: true },
    // The Furnace, built from Ash's red stone by chat, and he cuts the ribbon.
    ribbon: { lines: ['My idea!', 'Bronze! Shiny, like me.', 'Next age: a bigger hat.'] },
  },
};

/** The card for a slot in an age; undefined where that age has none (yet). */
export const cueCard = (age: AgeId, slot: CueSlot): CueCard | undefined => CUE_CARDS[age]?.[slot];

/** A plaque name is cut to this, so a long one can't crowd out the rest. */
const NAME_MAX = 16;

/** The plaque read out (U4): a header, then gold's names in pledge order, capitalised, as many as fit
 * in `rows` lines of at most CUE_MAX, then "and N more!". Nobody on it: he built it all by himself.
 * `title` is the age's head title (ageStyle(age).head.title).
 *
 *     Built by friends of the Chief:
 *     Kev, Dana, Bo!                                                                       */
export function plaqueReadout(names: readonly string[], { title = 'Chief', rows = 2 }: { title?: string; rows?: number } = {}): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const n = raw.trim().replace(/^@+/, '');
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    const cut = n.length > NAME_MAX ? `${n.slice(0, NAME_MAX - 1)}…` : n;
    // "kev" reads as Kev, like the ticker; a name typed with its own capitals keeps them.
    clean.push(cut === cut.toLowerCase() ? cut.charAt(0).toUpperCase() + cut.slice(1) : cut);
  }
  if (!clean.length) return [`Built by the ${title}, all by himself!`];
  const most = Math.max(1, Math.floor(rows));
  // As many names as fit; the last one carries the "!" or the "and N more!".
  for (let shown = clean.length; ; shown--) {
    const tail = shown === clean.length ? '!' : ` and ${clean.length - shown} more!`;
    const out: string[] = [];
    let line = '';
    for (let i = 0; i < shown; i++) {
      const piece = clean[i] + (i < shown - 1 ? ',' : tail);
      if (line && line.length + 1 + piece.length <= CUE_MAX) line += ` ${piece}`;
      else {
        if (line) out.push(line);
        line = piece;
      }
    }
    out.push(line);
    if (out.length <= most || shown === 1) return [`Built by friends of the ${title}:`, ...out];
  }
}

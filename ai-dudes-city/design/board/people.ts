// Who stands on the design boards, dressed the way the town dresses them (FK-004): everyday people in
// the age's colours (dressFor) wearing its garment kits, the town's head in the age's head look and
// head kit (as mayor.ts headLook draws him), the caravan leader in the leader kit. Pure data for
// design/board/main.ts, so the people on a board are the shipped ones and scripts/design-boards.test.ts
// can check who stands where.
import { AGES, dressFor } from '../../src/shared/ages';
import type { DudeLook } from '../../src/shared/dudesTypes';
import type { AgeOutfits, Outfit } from '../../src/shared/outfits';

/** Two people who look nothing alike, so a kit shows how it takes each wearer's own colours. */
export const SAMPLES: DudeLook[] = [
  { skin: '#e0b08a', shirt: '#c4402f', pants: '#3f5f8a', hair: '#3a2a1e', hat: 'cap', hatColor: '#e0c040', accessory: 'none', accessoryColor: '#5d6f7a', height: 1.05, build: 1.05 },
  { skin: '#8a5a3c', shirt: '#4f9a5a', pants: '#d9c49a', hair: '#1a1410', hat: 'none', hatColor: '#8a5a44', accessory: 'scarf', accessoryColor: '#7a3fa0', height: 0.92, build: 0.9 },
];

/**
 * A kit's name as a board labels it: the role before the garment list ("Water Carrier — Jar Pad,
 * Shoulder Wool…" → "Water Carrier"). The export cuts names at 60 characters, often mid-word, so the
 * list is dropped rather than shown cut.
 */
export const kitLabel = (name: string | undefined): string => (name ?? '').split(/\s+[—–-]\s+/)[0].trim();

export interface Figure {
  look: DudeLook;
  outfit?: Outfit;
  /** Across the row, metres. */
  x: number;
}

/** Two townsfolk in the first two everyday kits, so the column shows the variety. */
function townsfolk(o: AgeOutfits, age: number, kits = o.kits.slice(0, 2)): Figure[] {
  return SAMPLES.map((look, i) => ({ look: dressFor(look, age), outfit: kits.length ? kits[i % kits.length] : undefined, x: (i - 0.5) * 1.0 }));
}
const headFigure = (o: AgeOutfits, age: number): Figure => ({ look: AGES[age].head.look, outfit: o.head, x: 0 });
const leaderFigure = (o: AgeOutfits, age: number): Figure => ({ look: dressFor(SAMPLES[0], age), outfit: o.leader, x: 0 });
const headLabel = (o: AgeOutfits, age: number) => kitLabel(o.head?.name) || `the ${AGES[age].head.title}`;
const leaderLabel = (o: AgeOutfits) => kitLabel(o.leader?.name) || 'the caravan leader';

/** A people column's figures and caption on the people-and-builds board (resident, head, leader); undefined for any other column. */
export function boardPeople(id: string, age: number, o: AgeOutfits): { figures: Figure[]; caption: string } | undefined {
  switch (id) {
    case 'resident':
      return { figures: townsfolk(o, age), caption: o.kits.slice(0, 2).map((k) => kitLabel(k.name)).join(' · ') || 'townsfolk' };
    case 'head':
      return { figures: [headFigure(o, age)], caption: headLabel(o, age) };
    case 'leader':
      return { figures: [leaderFigure(o, age)], caption: leaderLabel(o) };
    default:
      return undefined;
  }
}

/** One labelled stretch of the outfits line-up: a kit on its two wearers, the head or the leader. */
export interface Slot {
  role: 'kit' | 'head' | 'leader';
  label: string;
  /** Centre and width across the row, metres; the label sits under it. */
  x: number;
  width: number;
}
/** Room for a pair in one kit, and for the head or the leader on their own (wide enough for a two-line label). */
export const PAIR = 2.2;
export const ONE = 2.0;
/** Between the two wearers of a kit. */
export const APART = 0.95;

/**
 * The outfits row: every everyday kit on the two sample people, then the head, then the caravan
 * leader, centred on x 0, each in a slot its label fits under.
 */
export function lineUp(o: AgeOutfits, age: number): { figures: Figure[]; slots: Slot[]; width: number } {
  const groups: { role: Slot['role']; label: string; people: Omit<Figure, 'x'>[] }[] = [
    ...o.kits.map((k) => ({ role: 'kit' as const, label: kitLabel(k.name), people: SAMPLES.map((look) => ({ look: dressFor(look, age), outfit: k })) })),
    { role: 'head', label: headLabel(o, age), people: [headFigure(o, age)] },
    { role: 'leader', label: leaderLabel(o), people: [leaderFigure(o, age)] },
  ];
  const width = groups.reduce((w, g) => w + (g.people.length > 1 ? PAIR : ONE), 0);
  const figures: Figure[] = [];
  const slots: Slot[] = [];
  let left = -width / 2;
  for (const g of groups) {
    const w = g.people.length > 1 ? PAIR : ONE;
    const x = left + w / 2;
    g.people.forEach((p, i) => figures.push({ ...p, x: x + (i - (g.people.length - 1) / 2) * APART }));
    slots.push({ role: g.role, label: g.label, x, width: w });
    left += w;
  }
  return { figures, slots, width };
}

// The band who stay through every age (FK-014): Ash, Wren, Old Moss, Oak and Kit. While Story is on
// they are the caravan's travellers (caravan.ts bringTravellers), townies with a `role` and a fixed
// `cast-<role>` id instead of the caravan's `name:age` hash, so the same five walk through every age
// turn, and the caravan's and town life's wipes spare them (keepsCast). Ash leaves the table from
// Medieval on: he dies at the end of Bronze. On the page each tag carries the role ("Ash the hunter").
// The looks here are stand-ins in the locked cast colours (design-system.md §2, §6) until the designed
// kits land (FK-016); the scales are design/story.ts's.
import type { DudeLook, TownView } from '../../../shared/dudesTypes';
import type { GroundPoint } from '../../../shared/objectTypes';
import { storyOn, type DudesState, type Townie } from '../state';

export const CAST_ROLES = ['ash', 'wren', 'moss', 'oak', 'kit'] as const;
export type CastRole = (typeof CAST_ROLES)[number];
export interface CastMember {
  role: CastRole;
  /** What the town calls them (the saved townie's name). */
  name: string;
  /** Their tag on the page: the role, so cast words never read as chat. */
  tag: string;
  look: DudeLook;
  /** Figure scale by age; an age past the end of the list has no place for them (Ash, from Medieval). */
  scale: number[];
  /** Which of the age's garment kits they wear (shared/outfits.ts): Ash the leader's, Wren the daughter's, even once she leads. */
  dress?: 'leader' | 'daughter';
}
const every = (n: number) => [n, n, n, n, n, n];
/**
 * In caravan order, as the scenes stand them on the far bank (shared/scenes.ts STRANDED): the leader
 * at the front, the daughter at his side, the elder sitting behind, then Oak and Kit. The first of the
 * age's cast leads: Ash, then Wren from Medieval.
 */
export const CAST: Record<CastRole, CastMember> = {
  ash: {
    role: 'ash',
    name: 'Ash',
    tag: 'Ash the hunter',
    // Tall and thin, grey-streaked, worn furs; the red cord on his wrist is his only red.
    look: { skin: '#c68b5f', shirt: '#6b5a48', pants: '#4b4038', hair: '#6E7680', hat: 'none', hatColor: '#6E7680', accessory: 'none', accessoryColor: '#6E7680', height: 1.12, build: 0.88 },
    scale: [1.15, 1.2],
    dress: 'leader',
  },
  wren: {
    role: 'wren',
    name: 'Wren',
    tag: 'Wren',
    // The top third of her is red: a red hair cord and a red shoulder hide.
    look: { skin: '#e0ac85', shirt: '#B3262E', pants: '#5a3e2b', hair: '#2b2018', hat: 'headband', hatColor: '#B3262E', accessory: 'scarf', accessoryColor: '#B3262E', height: 1, build: 0.9 },
    scale: [0.82, 0.9, 1, 1, 1, 1],
    dress: 'daughter',
  },
  moss: {
    role: 'moss',
    name: 'Moss',
    tag: 'Old Moss',
    // Grey under a green shawl.
    look: { skin: '#d8a07a', shirt: '#4E8A3A', pants: '#4b4038', hair: '#c9c4ba', hat: 'none', hatColor: '#4E8A3A', accessory: 'scarf', accessoryColor: '#4E8A3A', height: 0.9, build: 1 },
    scale: every(1),
  },
  oak: {
    role: 'oak',
    name: 'Oak',
    tag: 'Oak the builder',
    // Big and broad, an orange apron and a tool belt.
    look: { skin: '#a26a42', shirt: '#E8762B', pants: '#4b4038', hair: '#2b2018', hat: 'none', hatColor: '#E8762B', accessory: 'toolbelt', accessoryColor: '#6a4a2a', height: 1.1, build: 1.2 },
    scale: every(1.25),
  },
  kit: {
    role: 'kit',
    name: 'Kit',
    tag: 'Kit',
    // Small and plain blue all over.
    look: { skin: '#f1c9a5', shirt: '#2F6FD0', pants: '#2F6FD0', hair: '#5a3a22', hat: 'none', hatColor: '#2F6FD0', accessory: 'none', accessoryColor: '#FFC633', height: 0.95, build: 0.9 },
    scale: every(0.7),
  },
};

export const castId = (role: CastRole) => `cast-${role}`;
const isRole = (role: string | undefined): role is CastRole => !!role && (CAST_ROLES as readonly string[]).includes(role);
/** The age's cast, in caravan order (Ash only in Stone and Bronze). */
export const castIn = (age: number): CastMember[] => CAST_ROLES.map((r) => CAST[r]).filter((m) => m.scale[age] !== undefined);
/** One of the band, by the id they always have. */
export const isCastId = (id: string) => id.startsWith('cast-');

/**
 * Spared when travellers are sent home (a new caravan, the caravan or town life switched off): one of
 * the age's cast, while Story is on. With it off they go like any traveller, so Story OFF is today's game.
 */
export const keepsCast = (state: DudesState, t: Townie, age: number): boolean => storyOn(state) && castIn(age).some((m) => m.role === t.role);

/** A cast member in town, by role: scenes and bits find the band this way, not by their place in the caravan. */
export const castTownie = (state: DudesState, role: CastRole): Townie | undefined => state.city?.townies.find((t) => t.id === castId(role));

/** A cast member arriving with the age's caravan: `i` is their place in it (the first leads). */
export function castArrival(m: CastMember, i: number, age: number, at: GroundPoint, facing: number, now: number): Townie {
  const scale = m.scale[age] ?? 1;
  return {
    id: castId(m.role),
    name: m.name,
    role: m.role,
    look: { ...m.look },
    position: { ...at },
    facing,
    path: [],
    doing: 'stroll',
    until: now + 2000 + i * 1500,
    traveller: true,
    ...(i === 0 ? { leader: true } : {}),
    ...(m.role === 'wren' ? { daughter: true } : {}),
    ...(scale !== 1 ? { scale } : {}),
  };
}

/** What the page shows over a townie while Story is on: a cast member's tag and kit; nothing for anyone else. */
export function castLabel(t: Townie): { tag: string; dress?: 'leader' | 'daughter' } | undefined {
  if (!isRole(t.role)) return undefined;
  const m = CAST[t.role];
  return { tag: m.tag, ...(m.dress ? { dress: m.dress } : {}) };
}

/** The cast on the page (`cast`: their ids and the role on their tags), in caravan order. */
export function castView(state: DudesState, _now: number): Partial<TownView> {
  const here = CAST_ROLES.filter((r) => castTownie(state, r)).map((r) => ({ id: castId(r), role: r, tag: CAST[r].tag }));
  return here.length ? { cast: here } : {};
}

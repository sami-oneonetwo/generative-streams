import { z } from 'zod';
import { tuning } from './tuning';

export const toppingSchema = z.enum(['chashu', 'egg', 'noodles', 'spicy']);

// A bowl currently sitting in front of a customer at their stool.
export const bowlSchema = z.object({
  broth: z.string(), // 'tonkotsu' | 'miso' | 'shoyu' | 'shio' — free text, moderated
  toppings: z.array(toppingSchema),
  servedAt: z.number(),
  eaten: z.boolean(),
});
export type Bowl = z.infer<typeof bowlSchema>;

export const stoolSchema = z.object({
  id: z.string(),
  index: z.number().int().min(0),
  ownerUserId: z.string(),
  ownerName: z.string(),
  bowlsServed: z.number().int(),
  lastOrderAt: z.number(),
  streamsMissed: z.number().int().min(0),
  bowl: bowlSchema.optional(),
});
export type Stool = z.infer<typeof stoolSchema>;

export const incidents = z.object({
  brothBoiling: z.object({ startedAt: z.number() }).optional(),
  rush: z.object({ startedAt: z.number(), endsAt: z.number() }).optional(),
  rat: z.object({ startedAt: z.number(), deadlineAt: z.number() }).optional(),
  vendingBroken: z.boolean(),
  burnerOut: z.boolean(),
  mess: z.object({ stoolId: z.string(), startedAt: z.number() }).optional(),
  delivery: z.object({ arrivedAt: z.number() }).optional(),
});
export type Incidents = z.infer<typeof incidents>;

export const noodleShopStateSchema = z.object({
  version: z.literal(1),
  stools: z.record(z.string(), stoolSchema),
  stoolCount: z.number().int().positive(),
  broth: z.object({ servings: z.number(), simmering: z.boolean() }),
  pots: z.number().int().positive(),
  till: z.number(),
  reputation: z.number().min(0).max(100),
  plant: z.object({
    vitality: z.number().min(0).max(100),
    lastWateredAt: z.number(),
    buds: z.number().int(), // small tender counter: new growth over time
  }),
  incidents,
  season: z.object({ period: z.number().int(), streams: z.number().int(), rentMissed: z.number().int() }),
  daysOpen: z.number().int(),
  lastInspectionResult: z.string().optional(),
  regularsBoard: z.array(z.object({ name: z.string(), bowls: z.number().int(), at: z.number() })),
  chatters: z.record(
    z.string(),
    z.object({
      stoolId: z.string().optional(),
      name: z.string().optional(),
      firstSeen: z.number(),
      lastSeen: z.number(),
      reports: z.number().int(),
      spent: z.number().int(),
    }),
  ),
  lastLiveAt: z.number(),
});
export type NoodleShopState = z.infer<typeof noodleShopStateSchema>;

export function createInitialState(now: number): NoodleShopState {
  return {
    version: 1,
    stools: {},
    stoolCount: tuning.stools,
    broth: { servings: tuning.brothServings, simmering: false },
    pots: tuning.pots,
    till: tuning.startingTill,
    reputation: tuning.startReputation,
    plant: { vitality: tuning.plantStart, lastWateredAt: now, buds: 1 },
    incidents: { vendingBroken: false, burnerOut: false },
    season: { period: 1, streams: 0, rentMissed: 0 },
    daysOpen: 0,
    regularsBoard: [],
    chatters: {},
    lastLiveAt: now,
  };
}

export type PlantStage = 'blooming' | 'healthy' | 'wilting' | 'critical';

export function plantStage(state: NoodleShopState): PlantStage {
  const v = state.plant.vitality;
  if (v >= 80) return 'blooming';
  if (v >= tuning.plantWiltBelow) return 'healthy';
  if (v >= tuning.plantCriticalBelow) return 'wilting';
  return 'critical';
}

export type ShopStage = 'STALL' | 'SHOP' | 'RESTAURANT';

export function shopStage(state: NoodleShopState): ShopStage {
  if (state.stoolCount >= 10 || state.pots >= 2) return 'RESTAURANT';
  if (state.stoolCount >= 8) return 'SHOP';
  return 'STALL';
}

export function reputationStars(state: NoodleShopState): number {
  return Math.round((state.reputation / 100) * 5 * 2) / 2; // nearest half-star
}

export function usedStools(state: NoodleShopState): number {
  return Object.keys(state.stools).length;
}

export function firstFreeStoolIndex(state: NoodleShopState): number | null {
  const taken = new Set(Object.values(state.stools).map((s) => s.index));
  for (let i = 0; i < state.stoolCount; i++) if (!taken.has(i)) return i;
  return null;
}

export function findStoolByOwner(state: NoodleShopState, userId: string): Stool | undefined {
  return Object.values(state.stools).find((s) => s.ownerUserId === userId);
}

export function canCook(state: NoodleShopState): boolean {
  return state.broth.servings > 0 && !state.incidents.burnerOut;
}

// Starting numbers for the noodle shop. Tune live. Prices in ¥.

export const tuning = {
  // seating
  stools: 6,
  maxStools: 12,
  stoolLoseAfterStreams: 3, // streams a regular can miss before losing their seat

  // broth: the shared, depletable scarcity resource
  brothServings: 12, // servings in a full pot
  brothSimmerMs: 90_000, // time to simmer a fresh pot
  pots: 1,
  maxPots: 2,

  // economy (¥)
  bowlBasePrice: 800,
  toppingChashuPrice: 200,
  toppingEggPrice: 100,
  toppingNoodlesPrice: 150,
  rentPerStream: 5000,
  growthSurplus: 4000, // surplus above rent that earns a growth milestone
  startingTill: 3000,

  // reputation (0–100): the shared score everyone protects
  startReputation: 70,
  repPerHappyBowl: 1,
  repPerTip: 2,
  repColdBowlPenalty: 2,
  repRatPenalty: 6,
  repMessPenalty: 3,
  repHinderPenalty: 4,
  inspectorPassBonus: 8,
  inspectorFailPenalty: 15,

  // bowls
  bowlEatMs: 25_000, // customer finishes a served bowl in this long
  bowlColdMs: 45_000, // an un-eaten bowl goes cold (waste) after this

  // the plant (Kenji's private want; his responsibility, not chat's)
  plantStart: 80,
  plantDecayPerHour: 3,
  plantWaterBelow: 60, // Kenji auto-waters when vitality drops past this
  plantWiltBelow: 40,
  plantCriticalBelow: 20,
  offlinePlantDecayPerDay: 5,

  // seasons
  streamsPerInspection: 5,

  // pacing
  offlineGapMinMs: 1_800_000,
  eventRollMsMin: 150_000,
  eventRollMsMax: 260_000,
  rushDurationMs: 120_000,
  ratHealthWindowMs: 150_000, // rat un-caught this long forces a reputation hit

  // task durations (walk + work)
  taskSeatMs: 4_000,
  taskCookMs: 15_000,
  taskSimmerMs: 90_000,
  taskWaterMs: 8_000,
  taskCleanMs: 12_000,
  taskRatMs: 20_000,
  taskVendingMs: 15_000,
  taskBurnerMs: 10_000,
  taskUnpackMs: 20_000,
  taskTendBrothMs: 12_000,
  taskHinderMs: 8_000,

  hinderCooldownMs: 60_000,
  askCooldownMs: 20_000,
  warnBrothAt: 3, // warn when only this many servings remain
} satisfies Record<string, number>;

export type Tuning = typeof tuning;

export type Topping = 'chashu' | 'egg' | 'noodles' | 'spicy';

export function toppingPrice(t: Topping): number {
  switch (t) {
    case 'chashu':
      return tuning.toppingChashuPrice;
    case 'egg':
      return tuning.toppingEggPrice;
    case 'noodles':
      return tuning.toppingNoodlesPrice;
    case 'spicy':
      return 0;
  }
}

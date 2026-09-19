// Starting numbers from the brief (§5.14). Tune live; flat record so the
// engine can hand them to world callbacks as ctx.tuning.

export const tuning = {
  slots: 8,
  powerBudgetW: 2000,
  baseDrawW: 150,
  legacyDrawW: 200,

  // Upgrades are one axis, not a parts list: each level makes a server carry
  // more chat and draw more power. That trade is the whole point — a room full
  // of upgraded servers is a room close to tripping its breaker.
  upgradeMaxLevel: 3,
  upgradeCapacityPerMin: 10, // a level-3 server carries 50
  upgradeDrawW: 40,

  healthDecayPerHourGreen: 3,
  decayBandMultiplier: 2, // doubles per status band below fine
  overheatMultiplier: 3, // room at/above the slow-down temperature
  overheatSevereMultiplier: 6, // room at/above the failure temperature

  offlineHealthDecayPerDay: 4,
  offlineGapMinMs: 1_800_000, // gaps under 30 min are a restart, not a new stream
  darkStreamsToDecommission: 3,

  // Passive ventilation offsets a fixed wattage-equivalent. More hardware
  // and overloaded traffic can still heat the room beyond that baseline.
  ambientTempC: 22,
  maxTempC: 46,
  heatPerWattHourC: 0.032, // °C per hour per watt of un-cooled draw
  passiveCoolingWattEquiv: 1900,
  throttleTempC: 30, // servers start slowing down
  failTempC: 38,
  tankStressTempC: 27, // the tank has no chiller, so the fish suffer first

  // Traffic / load (brief §5.7, §5.16). All rates are messages per minute, and
  // the only demand is THIS chat — there is no simulated background traffic, so
  // every number on screen is one a viewer can move by typing.
  //
  // Scaled to real chat, which is what makes the loop legible: a handful of
  // people talking is already work, one server triples what the room can take,
  // and a full rack of upgraded ones carries a genuinely busy chat.
  serverBasePerMin: 20,
  // Admin's own machine; never improves. Deliberately small — he can just about
  // hold a quiet chat alone, and the moment it picks up he needs help.
  adminFallbackPerMin: 10,
  throttleCapacityFactor: 0.7, // a hot room carries less
  backlogDropAt: 40, // messages queued above this are lost for good
  busyUtilisation: 0.7, // load bar goes amber; Admin starts asking for servers
  overloadFromUtilisation: 0.9, // extra heat and wear start here
  overloadCap: 1, // a 10x wave shouldn't insta-kill the rack
  overloadHealthDecayPerHour: 20,
  emergencyAfterMs: 2_000, // time above the room's current carrying capacity
  emergencyGraceMs: 60_000,
  emergencyPullMs: 8_000,
  emergencyExchangeMs: 5_000,
  emergencyInstallMs: 10_000,
  emergencyResetMs: 8_000,
  emergencyBootMs: 8_000,
  overloadHeatW: 600, // at full overload, comparable to a junk-traffic flood

  waveRippleExtraPerMin: 20, // unannounced wave: a scare, not a disaster
  wavePeakExtraPerMin: 60, // announced season peak: needs four or five servers
  waveDurationMs: 600_000,
  dropReminderMs: 300_000, // Admin reminds chat mid-spell, but not constantly
  // Faster than the drop reminder: this is the window where asking still
  // changes the outcome, so it is worth asking again while it is open.
  busyReminderMs: 90_000,

  // events. Tightened from 3-5 minutes: this is chat's supply of things to
  // spot and react to, and at the old cadence the room could go five minutes
  // without giving them anything to do.
  eventRollMsMin: 120_000,
  eventRollMsMax: 210_000,
  junkTrafficDurationMs: 300_000,
  junkTrafficHeatW: 800,
  ratHealthDrainPerHour: 30,
  flickerHealthHit: 3,
  flickerVictimHealthHit: 15,

  // season / growth
  streamsPerQuarter: 5,
  maxRacks: 3,
  rackRewardBudgetW: 600, // extra budget granted with a new rack
  cleanQuarterBudgetW: 200, // reward when already at max racks

  taskProvisionMs: 20_000,
  taskRestartMs: 15_000,
  taskUpgradeMs: 45_000,
  taskRepairMs: 60_000,
  taskInvestigateMs: 8_000,
  taskBlockMs: 30_000,
  taskRecableMs: 30_000,
  taskUnpackMs: 20_000,
  taskHinderMs: 10_000,

  // The board (brief §5.9).
  ticketQueueDepth: 2, // how much board work Admin will have queued at once
  ticketHistory: 12, // closed jobs kept for the board's tail
  investigateHealthGain: 15,

  hinderCooldownMs: 60_000,
  // Per-person gap between conversational replies. Short on purpose: a
  // back-and-forth is somebody answering within seconds, and a long gap here
  // drops the second half of every conversation. Spend is capped elsewhere.
  askCooldownMs: 8_000,
  warnBudgetPct: 0.9,
} satisfies Record<string, number>;

export type Tuning = typeof tuning;

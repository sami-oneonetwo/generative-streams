import { z } from 'zod';
import { tuning } from './tuning';

/**
 * A server in the rack. One viewer owns one, and every server does the same
 * single job: carry chat messages. There is deliberately nothing here about
 * patch levels, disks or which component is fitted — a viewer who has never
 * seen a server room has to be able to read this room in one sentence, so the
 * only thing they can change about their own is how big it is (`level`) and
 * whether it is running at all (`health`).
 */
export const serverSchema = z.object({
  id: z.string(),
  slot: z.number().int().min(0),
  ownerUserId: z.string(),
  ownerName: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
  health: z.number().min(0).max(100),
  temperature: z.number(),
  powerDrawW: z.number(),
  /** How many times it has been upgraded. More capacity, more power drawn. */
  level: z.number().int().min(0).max(tuning.upgradeMaxLevel),
  uptimeDays: z.number(),
  delivered: z.number().min(0), // lifetime messages this server has carried
  createdAt: z.number(),
  darkSince: z.number().optional(),
  darkStreams: z.number().int().min(0), // whole streams spent off; 3 = decommission
});
export type Server = z.infer<typeof serverSchema>;

/**
 * The room's traffic ledger (brief §5.7). The room carries THIS chat — the only
 * demand is what viewers type — and what it can carry comes from the servers
 * they own. The gap between the two is the whole game.
 */
export const trafficSchema = z.object({
  backlog: z.number().min(0), // messages queued, waiting to be carried
  delivered: z.number().min(0), // lifetime; the room's score
  dropped: z.number().min(0), // lifetime; the number nobody wants to see move
  demandPerMin: z.number().min(0), // last computed, for display and Admin
  capacityPerMin: z.number().min(0),
  peakDemandPerMin: z.number().min(0),
  // Traffic pushed through this room because another room fell over.
  wave: z
    .object({
      origin: z.string(),
      extraPerMin: z.number().min(0),
      startedAt: z.number(),
      endsAt: z.number(),
    })
    .optional(),
  // A losing spell, so Admin can announce it starting and ending rather than
  // repeating himself every tick.
  droppingSince: z.number().optional(),
  lastDropNoticeAt: z.number().optional(),
  // The same, one step earlier: the room is under pressure but nothing is lost
  // yet, which is the window where chat can still do something about it.
  // Optional, so an existing v6 snapshot parses without a migration.
  busySince: z.number().optional(),
  lastBusyNoticeAt: z.number().optional(),
  overloadForMs: z.number().min(0).optional(),
  recoveryForMs: z.number().min(0).optional(),
});
export type Traffic = z.infer<typeof trafficSchema>;

/**
 * A job on the board (brief §5.9). The floor is the room's public record of
 * work: what's wrong, who spotted it, who put their name on it. A viewer's own
 * upgrade or restart is a direct request and doesn't belong here.
 */
export const ticketSourceSchema = z.enum(['sensor', 'chat', 'upstream']);
export type TicketSource = z.infer<typeof ticketSourceSchema>;

export const ticketStateSchema = z.enum(['open', 'active', 'resolved', 'expired', 'nofault']);
export type TicketState = z.infer<typeof ticketStateSchema>;

export const ticketSchema = z.object({
  id: z.string(), // internal only — never spoken or shown
  kind: z.string(), // key into the kind registry in tickets.ts
  subject: z.string().optional(), // server id or room system this is about
  title: z.string(),
  severity: z.number().int().min(1).max(3),
  source: ticketSourceSchema,
  raisedBy: z.string(), // 'SENSOR' | 'UPSTREAM' | a username
  claimedBy: z.array(z.string()), // usernames; the count is the priority vote
  openedAt: z.number(),
  dueAt: z.number().optional(),
  state: ticketStateSchema,
  resolution: z.string().optional(),
  closedAt: z.number().optional(),
});
export type Ticket = z.infer<typeof ticketSchema>;

// Live trouble created by events; cleared by fixes, deadlines, or stream end.
export const incidentsSchema = z.object({
  junkTraffic: z.object({ startedAt: z.number(), endsAt: z.number() }).optional(),
  rat: z.object({ serverId: z.string(), startedAt: z.number() }).optional(),
  delivery: z.object({ arrivedAt: z.number() }).optional(),
});
export type Incidents = z.infer<typeof incidentsSchema>;

export const serverRoomStateSchema = z.object({
  version: z.literal(6),
  // Physical recovery survives a process restart; callbacks are rebuilt from this.
  emergency: z.object({
    startedAt: z.number(),
    serverIds: z.array(z.string()),
    index: z.number().int().min(0),
    stage: z.enum(['pull', 'exchange', 'install', 'reset', 'boot']),
  }).optional(),
  racks: z.array(z.object({ id: z.string(), slots: z.number().int().positive() })),
  servers: z.record(z.string(), serverSchema),
  traffic: trafficSchema,
  tickets: z.array(ticketSchema),
  ticketSeq: z.number().int().min(0),
  power: z.object({ budgetW: z.number(), breakerTripped: z.boolean() }),
  roomTempC: z.number(),
  // Deprecated v6 compatibility fields. No longer drive simulation or tasks.
  cooling: z.object({ working: z.boolean() }),
  door: z.object({
    open: z.boolean(),
    openedAt: z.number().optional(),
    openedBy: z.string().optional(),
  }),
  incidents: incidentsSchema,
  legacy: z.object({
    powerDrawW: z.number(),
    uptimeDays: z.number(),
    clues: z.number().int(),
    lastNoiseAt: z.number().optional(),
  }),
  season: z.object({
    quarter: z.number().int(),
    streams: z.number().int(),
    outages: z.number().int(),
  }),
  uptime: z.object({ startedAt: z.number(), lastOutageAt: z.number().optional() }),
  memorial: z.array(
    z.object({
      name: z.string(),
      ownerName: z.string(),
      at: z.number(),
      // Captured at decommission: the server is deleted, so a plaque that wants
      // a lifetime count has to be given it here or it's gone for good.
      delivered: z.number().min(0).default(0),
    }),
  ),
  chatters: z.record(
    z.string(),
    z.object({
      serverId: z.string().optional(),
      name: z.string().optional(),
      firstSeen: z.number(),
      lastSeen: z.number(),
      reports: z.number().int(),
    }),
  ),
  lastLiveAt: z.number(),
});
export type ServerRoomState = z.infer<typeof serverRoomStateSchema>;

export function emergencyServerPhase(state: ServerRoomState, serverId: string): 'damaged' | 'removing' | 'carried' | 'installing' | undefined {
  const e = state.emergency;
  if (!e) return undefined;
  const index = e.serverIds.indexOf(serverId);
  if (index < 0 || index < e.index || e.stage === 'reset' || e.stage === 'boot') return undefined;
  if (index > e.index) return 'damaged';
  return e.stage === 'pull' ? 'removing' : e.stage === 'exchange' ? 'carried' : 'installing';
}

export function createInitialState(now: number): ServerRoomState {
  return {
    version: 6,
    racks: [{ id: 'rack-0', slots: tuning.slots }],
    servers: {},
    traffic: {
      backlog: 0,
      delivered: 0,
      dropped: 0,
      demandPerMin: 0,
      capacityPerMin: 0,
      peakDemandPerMin: 0,
    },
    tickets: [],
    ticketSeq: 0,
    power: { budgetW: tuning.powerBudgetW, breakerTripped: false },
    roomTempC: tuning.ambientTempC,
    cooling: { working: true },
    door: { open: false },
    incidents: {},
    // LEGACY-01 has been up for over a decade. Nobody knows what it runs.
    legacy: { powerDrawW: tuning.legacyDrawW, uptimeDays: 4211, clues: 0 },
    season: { quarter: 1, streams: 0, outages: 0 },
    uptime: { startedAt: now },
    memorial: [],
    chatters: {},
    lastLiveAt: now,
  };
}

type RawState = Record<string, unknown> & {
  boxes?: Record<string, Record<string, unknown>>;
  servers?: Record<string, Record<string, unknown>>;
  chatters?: Record<string, Record<string, unknown>>;
};

/** Snapshots step up one version at a time, so old data survives any gap. */
export function migrateState(raw: unknown, fromVersion: number): ServerRoomState {
  if (fromVersion < 1 || fromVersion >= 6) {
    throw new Error(`no migration path from state version ${fromVersion}`);
  }
  let data = raw as RawState;
  // Every step before v6 speaks `boxes`; only v6 renamed the key. A snapshot
  // that has already been renamed (or hand-built from the current shape) still
  // has to walk the same chain, so give the older steps the key they expect.
  if (!data.boxes && data.servers) data = { ...data, boxes: data.servers };
  if (fromVersion < 2) data = v1ToV2(data);
  if (fromVersion < 3) data = v2ToV3(data);
  if (fromVersion < 4) data = v3ToV4(data);
  if (fromVersion < 5) data = v4ToV5(data);
  data = v5ToV6(data);
  return serverRoomStateSchema.parse(data);
}

/** v1 predates cooling/door/incidents/legacy/season and per-box darkStreams. */
function v1ToV2(old: RawState): RawState {
  const fresh = createInitialState(Date.now());
  return {
    ...old,
    version: 2,
    cooling: fresh.cooling,
    door: fresh.door,
    incidents: fresh.incidents,
    legacy: fresh.legacy,
    season: fresh.season,
    boxes: Object.fromEntries(
      Object.entries(old.boxes ?? {}).map(([id, b]) => [id, { darkStreams: 0, ...b }]),
    ),
    chatters: Object.fromEntries(
      Object.entries(old.chatters ?? {}).map(([id, c]) => [id, { reports: 0, ...c }]),
    ),
  };
}

/** v2 predates the traffic ledger and per-box delivered counts. */
function v2ToV3(old: RawState): RawState {
  const fresh = createInitialState(Date.now());
  return {
    ...old,
    version: 3,
    traffic: fresh.traffic,
    boxes: Object.fromEntries(
      Object.entries(old.boxes ?? {}).map(([id, b]) => [id, { delivered: 0, ...b }]),
    ),
  };
}

/**
 * v3 predates named jobs and the admission bucket. Both are gone again as of
 * v6, so this step only has to leave the shape v4 expected.
 */
function v3ToV4(old: RawState): RawState {
  return {
    ...old,
    version: 4,
    admission: { nextAdmitAt: 0, admitted: 0, heldTotal: 0 },
    moderation: { handled: 0 },
    boxes: Object.fromEntries(
      Object.entries(old.boxes ?? {}).map(([id, b]) => [id, { job: 'delivery', ...b }]),
    ),
  };
}

/**
 * v4 predates the board. Existing faults aren't backfilled as tickets — the
 * sweep in tickets.ts raises whatever is still wrong on the next tick, which is
 * both simpler and self-correcting.
 */
function v4ToV5(old: RawState): RawState {
  return { ...old, version: 5, tickets: [], ticketSeq: 0 };
}

/**
 * v5 is the technical room: named jobs, patch levels, disk fill, a list of
 * fitted components, break-ins. v6 keeps only what a viewer can act on.
 *
 * Nobody loses anything they earned: every box becomes a server with its
 * owner, name, health and lifetime message count intact, and each component
 * they had fitted becomes one upgrade level.
 */
function v5ToV6(old: RawState): RawState {
  // `boxes` first: the earlier steps in the chain rebuild that key, so it is
  // the up-to-date one by the time we get here.
  const boxes = old.boxes ?? old.servers ?? {};
  return {
    ...old,
    version: 6,
    servers: Object.fromEntries(
      Object.entries(boxes).map(([id, b]) => [
        id,
        {
          ...b,
          level: Math.min(
            tuning.upgradeMaxLevel,
            Array.isArray(b.upgrades) ? b.upgrades.length : Number(b.level ?? 0),
          ),
        },
      ]),
    ),
    chatters: Object.fromEntries(
      Object.entries(old.chatters ?? {}).map(([id, c]) => [
        id,
        { ...c, serverId: c.serverId ?? c.boxId },
      ]),
    ),
    // Ticket kinds changed underneath, and break-ins no longer exist at all.
    // The sweep re-raises anything still wrong on the next tick.
    tickets: [],
    ticketSeq: 0,
    incidents: {},
  };
}

export type ServerStatus = 'green' | 'amber' | 'red' | 'dark';

export function serverStatus(server: Server, state: ServerRoomState): ServerStatus {
  if (state.power.breakerTripped || state.emergency || server.health <= 0) return 'dark';
  if (server.health >= 70) return 'green';
  if (server.health >= 40) return 'amber';
  return 'red';
}

/** How a server reads out loud. No numbers — nobody needs a health percentage. */
export const SERVER_STATE_LABEL: Record<ServerStatus, string> = {
  green: 'fine',
  amber: 'struggling',
  red: 'in trouble',
  dark: 'off',
};

export const STATUS_COLORS: Record<ServerStatus, string> = {
  green: '#37d67a',
  amber: '#ffb020',
  red: '#ff4d4f',
  dark: '#333941',
};

export function serverColor(server: Server, state: ServerRoomState): string {
  return STATUS_COLORS[serverStatus(server, state)];
}

export function computeDrawW(server: Server): number {
  return tuning.baseDrawW + server.level * tuning.upgradeDrawW;
}

/** Room load: every viewer's server, plus LEGACY-01 on the same circuit. */
export function totalDrawW(state: ServerRoomState): number {
  return (
    Object.values(state.servers).reduce((sum, s) => sum + computeDrawW(s), 0) +
    state.legacy.powerDrawW
  );
}

export function slotCount(state: ServerRoomState): number {
  return state.racks.reduce((sum, r) => sum + r.slots, 0);
}

export function usedSlots(state: ServerRoomState): number {
  return Object.keys(state.servers).length;
}

export function firstFreeSlot(state: ServerRoomState): number | null {
  const taken = new Set(Object.values(state.servers).map((s) => s.slot));
  const total = slotCount(state);
  for (let i = 0; i < total; i++) if (!taken.has(i)) return i;
  return null;
}

export function findServerByOwner(state: ServerRoomState, userId: string): Server | undefined {
  return Object.values(state.servers).find((s) => s.ownerUserId === userId);
}

export function daysSinceLastOutage(state: ServerRoomState, now: number): number {
  const since = state.uptime.lastOutageAt ?? state.uptime.startedAt;
  return Math.max(0, Math.floor((now - since) / 86_400_000));
}

export function milestoneName(state: ServerRoomState): string {
  return state.racks.length >= 3 ? 'FLOOR' : state.racks.length === 2 ? 'ROOM' : 'CLOSET';
}

export function isRoomThrottling(state: ServerRoomState): boolean {
  return state.roomTempC >= tuning.throttleTempC;
}

// ------------------------------------------------------------------ traffic
// All rates are messages per minute. Everything here is derived, never stored,
// so what the room can carry can't drift from the servers actually standing in
// the rack.

/** Servers that are actually running. Every one of them carries chat. */
export function liveServers(state: ServerRoomState): Server[] {
  return Object.values(state.servers).filter((s) => serverStatus(s, state) !== 'dark');
}

/** Servers that are off, and whose owner has to say "restart mine". */
export function deadServers(state: ServerRoomState): Server[] {
  return Object.values(state.servers).filter((s) => s.health <= 0);
}

/**
 * Somebody to shout at by name when the room needs help, and what to ask them
 * for — a server if they haven't got one, a bigger one if they have. Shouting
 * at a person lands; announcing at the room does not.
 *
 * Most recently spoken first, so he calls on whoever is actually still there.
 */
export function someoneToAsk(
  state: ServerRoomState,
  now: number,
  withinMs = 10 * 60_000,
): { name: string; ask: string } | undefined {
  const candidates = Object.values(state.chatters)
    .filter((c) => c.name !== undefined && now - c.lastSeen < withinMs)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  // Prefer someone with no server: a new one is worth more than an upgrade, and
  // it gets another person invested in the room.
  const spare = candidates.find((c) => {
    const theirs = c.serverId ? state.servers[c.serverId] : undefined;
    return theirs === undefined;
  });
  const pick = spare ?? candidates[0];
  if (!pick?.name) return undefined;
  const theirs = pick.serverId ? state.servers[pick.serverId] : undefined;
  if (!theirs) return { name: pick.name, ask: 'say "give me a server"' };
  if (theirs.health <= 0) return { name: pick.name, ask: 'say "restart mine"' };
  if (theirs.level < tuning.upgradeMaxLevel) return { name: pick.name, ask: 'say "upgrade mine"' };
  return undefined;
}

/** A hot room slows down every machine in it, Admin's own included. */
function throttleFactor(state: ServerRoomState): number {
  return isRoomThrottling(state) ? tuning.throttleCapacityFactor : 1;
}

export function serverCapacityPerMin(server: Server, state: ServerRoomState): number {
  if (serverStatus(server, state) === 'dark') return 0;
  return (
    (tuning.serverBasePerMin + server.level * tuning.upgradeCapacityPerMin) *
    (server.health / 100) *
    throttleFactor(state)
  );
}

/**
 * Admin's own taped-together machine. It carries the room before any viewer
 * shows up, so a cold-start room is urgent without being a wipe — a viewer's
 * first "give me a server" has to be able to land. It never improves.
 */
export function adminFallbackCapacityPerMin(state: ServerRoomState): number {
  if (state.power.breakerTripped || state.emergency) return 0;
  return tuning.adminFallbackPerMin * throttleFactor(state);
}

/** Everything the room can carry. Zero means chat isn't reaching it at all. */
export function roomCapacityPerMin(state: ServerRoomState): number {
  if (state.power.breakerTripped || state.emergency) return 0;
  return (
    adminFallbackCapacityPerMin(state) +
    liveServers(state).reduce((sum, s) => sum + serverCapacityPerMin(s, state), 0)
  );
}

export function waveExtraPerMin(state: ServerRoomState, now: number): number {
  const wave = state.traffic.wave;
  return wave && now < wave.endsAt ? wave.extraPerMin : 0;
}

/**
 * What the room has to carry. This is THIS chat and nothing else: there used to
 * be a simulated regional baseline on top, which meant the number on the wall
 * barely moved when somebody typed and mostly reported a fiction. Now every
 * message anyone sends is visible in it, which is the whole point of showing it.
 */
export function demandPerMin(state: ServerRoomState, now: number, chatRatePerMin: number): number {
  return Math.max(0, chatRatePerMin) + waveExtraPerMin(state, now);
}

/** arriving / carried. Infinity while the room can carry nothing at all. */
export function utilisation(state: ServerRoomState): number {
  const { demandPerMin: demand, capacityPerMin: capacity } = state.traffic;
  if (capacity > 0) return demand / capacity;
  return demand > 0 ? Infinity : 0;
}

/** How far behind chat is, in seconds. Infinity while nothing is getting through. */
export function chatLagSeconds(state: ServerRoomState): number {
  const { backlog, capacityPerMin } = state.traffic;
  if (capacityPerMin > 0) return (backlog / capacityPerMin) * 60;
  return backlog > 0 ? Infinity : 0;
}

/** The failure gradient from brief §5.7, in the order chat experiences it. */
export type TrafficStatus = 'clear' | 'busy' | 'saturated' | 'dropping' | 'deaf';

export function trafficStatus(state: ServerRoomState): TrafficStatus {
  if (state.traffic.capacityPerMin <= 0) return 'deaf';
  if (state.traffic.backlog >= tuning.backlogDropAt) return 'dropping';
  const load = utilisation(state);
  if (load >= 1) return 'saturated';
  if (load >= tuning.busyUtilisation) return 'busy';
  return 'clear';
}

export type TankWater = 'cool' | 'warm' | 'hot' | 'lethal';

/**
 * The tank sits on a wooden cabinet with no chiller, so it just rides the
 * room. Derived, not persisted: the fish are an early warning that reads before
 * the servers start slowing down.
 */
export function tankWater(state: ServerRoomState): TankWater {
  const t = state.roomTempC;
  if (t >= tuning.failTempC) return 'lethal';
  if (t >= tuning.throttleTempC) return 'hot';
  if (t >= tuning.tankStressTempC) return 'warm';
  return 'cool';
}

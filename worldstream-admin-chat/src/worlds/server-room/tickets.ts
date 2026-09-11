// The board (brief §5.9). The board is the room's single legible to-do list,
// and it is also Admin's queue: an open job becomes work when he gets to it,
// ordered by how bad it is, then by how many people put their name on it, then
// by age.
//
// Jobs are declarative. Each kind knows how to tell whether its problem is
// still there, and how (if at all) Admin can fix it. That means the board
// self-corrects: a problem that clears on its own closes its own job, a problem
// nobody spotted gets raised by the sweep, and there is no bookkeeping to drift.
//
// Some kinds only the server's owner can action. Those sit on the board and
// nag, which is the point.
//
// Job ids exist for dedupe and lookup only. They are never spoken and never
// shown — "WO-0413" means nothing to somebody who just arrived, so Admin names
// the problem instead.

import type { WorldCtx } from '../../engine/world';
import {
  liveServers,
  serverStatus,
  totalDrawW,
  trafficStatus,
  type ServerRoomState,
  type Ticket,
  type TicketSource,
} from './state';
import { tuning } from './tuning';
import { enqueueRecable, enqueueTrafficBlock } from './fixes';
import { slotPos, deskX, crateX } from './scene';

type Ctx = WorldCtx<ServerRoomState>;

interface TicketKindDef {
  severity: 1 | 2 | 3;
  /** Board title. Subject is whatever the job was raised about. */
  title(state: ServerRoomState, subject?: string): string;
  /**
   * Is the problem still there? A job whose problem has gone closes itself.
   * Omitted for one-shots, which live until their work completes.
   */
  present?(state: ServerRoomState, subject?: string): boolean;
  /**
   * Admin's fix. Returns false if it couldn't be started right now. Omitted for
   * jobs somebody else has to action.
   */
  action?(ctx: Ctx, ticket: Ticket): boolean;
  /** The task kind action() enqueues, so the board can tell queued from underway. */
  taskKind?: string;
  /** What the board says when it closes. */
  resolution?: string;
  /** Who should be told to do something about it, for the board footer. */
  advice?(state: ServerRoomState, subject?: string): string;
}

const serverOf = (state: ServerRoomState, subject?: string) =>
  subject ? state.servers[subject] : undefined;
const serverLabel = (state: ServerRoomState, subject?: string) => {
  const server = serverOf(state, subject);
  return server ? `${server.ownerName}'s server` : 'a server';
};
const atServer = (state: ServerRoomState, subject?: string) => {
  const server = serverOf(state, subject);
  if (!server) return deskX();
  const pos = slotPos(server.slot);
  return pos.x + pos.w / 2 + 70;
};

export const TICKET_KINDS: Record<string, TicketKindDef> = {
  breaker: {
    severity: 1,
    title: () => 'the power is off — the whole room is down',
    present: (state) => state.power.breakerTripped,
    taskKind: 'breaker-repair',
    resolution: 'power back on',
    // The power task is raised by tripBreaker itself, at the top priority there
    // is; this job is the board's record of it.
  },

  'junk-traffic': {
    severity: 2,
    title: () => 'junk traffic is hammering the room',
    present: (state) => state.incidents.junkTraffic !== undefined,
    action: (ctx, ticket) => enqueueTrafficBlock(ctx, ticket.claimedBy[0]),
    taskKind: 'block-traffic',
    resolution: 'junk traffic shut out',
  },

  rat: {
    severity: 2,
    title: (state, subject) => `something has chewed a cable near ${serverLabel(state, subject)}`,
    present: (state) => state.incidents.rat !== undefined,
    action: (ctx, ticket) => enqueueRecable(ctx, ticket.claimedBy[0]),
    taskKind: 'recable',
    resolution: 'new cable in; the rat has relocated',
  },

  'server-down': {
    severity: 2,
    title: (state, subject) => {
      const server = serverOf(state, subject);
      const status = server ? serverStatus(server, state) : 'red';
      return `${serverLabel(state, subject)} is ${status === 'dark' ? 'off' : 'in trouble'}`;
    },
    present: (state, subject) => {
      const server = serverOf(state, subject);
      if (!server) return false;
      const status = serverStatus(server, state);
      return status === 'red' || status === 'dark';
    },
    // Admin can nurse a struggling server along, but only its owner can bring a
    // dead one back — so a dead server sits on the board saying whose it is.
    action: (ctx, ticket) => {
      const serverId = ticket.subject;
      const server = serverId ? ctx.state.servers[serverId] : undefined;
      if (!server || server.health <= 0) return false;
      if (ctx.queue.some((q) => q.kind === 'investigate')) return false;
      ctx.enqueueTask({
        kind: 'investigate',
        label: `look at ${server.ownerName}'s server`,
        requestedBy: ticket.claimedBy[0],
        targetX: atServer(ctx.state, serverId),
        workMs: tuning.taskInvestigateMs,
        onComplete(ctx) {
          const s = ctx.state.servers[serverId!];
          if (!s) return;
          s.health = Math.min(100, s.health + tuning.investigateHealthGain);
          ctx.log(`nursed ${s.ownerName}'s "${s.name}" along a bit`);
          ctx.say(`gave ${s.ownerName}'s server a once-over. it'll hold for now.`);
        },
      });
      return true;
    },
    taskKind: 'investigate',
    resolution: 'server is fine again',
    advice: (state, subject) => {
      const server = serverOf(state, subject);
      if (!server) return '';
      return server.health <= 0
        ? `${server.ownerName}: say "restart mine"`
        : `${server.ownerName}: it needs watching`;
    },
  },

  crate: {
    severity: 3,
    title: () => 'an unopened delivery beside the desk',
    present: (state) => state.incidents.delivery !== undefined,
    action: (ctx, ticket) => {
      if (ctx.queue.some((q) => q.kind === 'unpack')) return false;
      ctx.enqueueTask({
        kind: 'unpack',
        label: 'open the delivery',
        requestedBy: ticket.claimedBy[0],
        targetX: crateX(),
        workMs: tuning.taskUnpackMs,
        onComplete: unpackDelivery,
      });
      return true;
    },
    taskKind: 'unpack',
    resolution: 'delivery unpacked',
  },

  // ---- the one that connects the load model to the board ----

  capacity: {
    severity: 2,
    title: (state) =>
      `chat is arriving faster than we can carry it — ${state.traffic.demandPerMin} a minute in, ${state.traffic.capacityPerMin} carried`,
    present: (state) => {
      const status = trafficStatus(state);
      return status === 'dropping' || status === 'saturated';
    },
    resolution: 'back under what we can carry',
    advice: (state) => {
      const up = liveServers(state).length;
      return `chat: say "give me a server" — ${up} server${up === 1 ? '' : 's'} running`;
    },
  },

  upstream: {
    severity: 2,
    title: (_state, subject) => subject ?? 'a message from head office',
    resolution: 'acknowledged',
  },

  nofault: {
    severity: 3,
    title: (_state, subject) => `${subject ?? 'somebody'} said something was wrong`,
    resolution: 'nothing wrong',
  },
};

/**
 * Spare parts somebody ordered: give a free upgrade to the oldest server that
 * has room for one, if the power budget survives it.
 */
function unpackDelivery(ctx: Ctx): void {
  const state = ctx.state;
  state.incidents.delivery = undefined;
  const candidates = Object.values(state.servers)
    .filter((s) => s.health > 0 && s.level < tuning.upgradeMaxLevel)
    .sort((a, b) => a.createdAt - b.createdAt);
  const target = candidates[0];
  if (target && totalDrawW(state) + tuning.upgradeDrawW <= state.power.budgetW) {
    target.level++;
    ctx.log(`delivery unpacked: free upgrade fitted to ${target.ownerName}'s "${target.name}"`);
    ctx.say(
      `somebody shipped us parts with no name on the box. ${target.ownerName}'s server is the oldest, so it wins. it can carry more now.`,
    );
  } else {
    ctx.log('delivery unpacked: spare parts on the shelf');
    ctx.say('spare parts. on the shelf they go, like everything else i love.');
  }
}

// ------------------------------------------------------------------ raising

export const OPEN_STATES: Ticket['state'][] = ['open', 'active'];

export function openTickets(state: ServerRoomState): Ticket[] {
  return state.tickets.filter((t) => OPEN_STATES.includes(t.state));
}

export function findTicket(state: ServerRoomState, kind: string, subject?: string): Ticket | undefined {
  return openTickets(state).find((t) => t.kind === kind && t.subject === subject);
}

/** Board order: how bad it is first, then the claim vote, then age. */
export function boardOrder(a: Ticket, b: Ticket): number {
  if (a.severity !== b.severity) return a.severity - b.severity;
  if (a.claimedBy.length !== b.claimedBy.length) return b.claimedBy.length - a.claimedBy.length;
  return a.openedAt - b.openedAt;
}

export interface RaiseOptions {
  kind: string;
  subject?: string;
  source?: TicketSource;
  raisedBy?: string;
  title?: string;
  dueAt?: number;
  severity?: 1 | 2 | 3;
}

/**
 * Put a job on the board, or return the existing one for the same problem. One
 * open job per (kind, subject) — a problem six people spotted is one job with
 * six names on it, not six jobs.
 */
export function raiseTicket(ctx: Ctx, opts: RaiseOptions): { ticket: Ticket; created: boolean } {
  const state = ctx.state;
  const existing = findTicket(state, opts.kind, opts.subject);
  if (existing) return { ticket: existing, created: false };

  const def = TICKET_KINDS[opts.kind];
  state.ticketSeq++;
  const ticket: Ticket = {
    id: `job-${state.ticketSeq}`,
    kind: opts.kind,
    subject: opts.subject,
    title: opts.title ?? def?.title(state, opts.subject) ?? opts.kind,
    severity: opts.severity ?? def?.severity ?? 3,
    source: opts.source ?? 'sensor',
    raisedBy: opts.raisedBy ?? 'SENSOR',
    claimedBy: [],
    openedAt: ctx.now,
    dueAt: opts.dueAt,
    state: 'open',
  };
  state.tickets.push(ticket);
  ctx.log(`on the board (spotted by ${ticket.raisedBy}): ${ticket.title}`, ticket.severity === 1 ? 'alert' : 'warn');
  return { ticket, created: true };
}

export function closeTicket(ctx: Ctx, ticket: Ticket, state: Ticket['state'], resolution: string): void {
  ticket.state = state;
  ticket.resolution = resolution;
  ticket.closedAt = ctx.now;
  ctx.log(`off the board: ${ticket.title} — ${resolution}`);
}

/** Old v6 saves can contain jobs for fixtures that no longer exist. */
export function retireMaintenanceTickets(ctx: Ctx): void {
  for (const ticket of ctx.state.tickets) {
    if ((ticket.kind === 'door' || ticket.kind === 'cooling') && OPEN_STATES.includes(ticket.state)) {
      closeTicket(ctx, ticket, 'resolved', 'retired with the old room fixtures');
    }
  }
}

// ------------------------------------------------------------------- sweep

/**
 * Called every tick. Puts up anything wrong that nobody has spotted, takes down
 * jobs whose problem has gone, expires overdue notices, and hands Admin the top
 * of the board if he's free.
 */
export function sweepTickets(ctx: Ctx): void {
  retireMaintenanceTickets(ctx);
  const state = ctx.state;
  if (state.emergency) return; // Ordinary faults do not become "fixed" just because mains is off.

  detectFaults(ctx);

  for (const ticket of openTickets(state)) {
    const def = TICKET_KINDS[ticket.kind];
    if (def?.present && !def.present(state, ticket.subject)) {
      closeTicket(ctx, ticket, 'resolved', def.resolution ?? 'cleared');
      continue;
    }
    // Titles carry live numbers (what we can carry, which server is off), so
    // they're refreshed rather than frozen at the moment of raising.
    if (def?.present) ticket.title = def.title(state, ticket.subject);
    if (ticket.dueAt && ctx.now > ticket.dueAt && ticket.state === 'open') {
      closeTicket(ctx, ticket, 'expired', 'nobody got to it in time');
    }
  }

  actionTopTicket(ctx);
  pruneTickets(state);
}

/** Anything the room can notice about itself, whether or not chat spotted it. */
function detectFaults(ctx: Ctx): void {
  const state = ctx.state;
  const raise = (kind: string, subject?: string) => raiseTicket(ctx, { kind, subject });

  if (state.power.breakerTripped) raise('breaker');
  if (state.incidents.junkTraffic) raise('junk-traffic');
  if (state.incidents.rat) raise('rat', state.incidents.rat.serverId);
  if (state.incidents.delivery) raise('crate');

  const status = trafficStatus(state);
  if (status === 'dropping' || status === 'saturated') raise('capacity');

  for (const server of Object.values(state.servers)) {
    const serverState = serverStatus(server, state);
    // A server being off because the power went isn't the server's fault.
    if (!state.power.breakerTripped && (serverState === 'red' || serverState === 'dark')) {
      raise('server-down', server.id);
    }
  }
}

/**
 * Hand Admin the top of the board. One at a time: the queue is his, and chat
 * watching him work through it in a visible order is the point.
 */
function actionTopTicket(ctx: Ctx): void {
  const state = ctx.state;
  if (ctx.queue.length >= tuning.ticketQueueDepth) return;

  const candidates = openTickets(state)
    .filter((t) => t.state === 'open' && TICKET_KINDS[t.kind]?.action)
    .sort(boardOrder);
  for (const ticket of candidates) {
    const def = TICKET_KINDS[ticket.kind];
    if (def.action?.(ctx, ticket)) {
      ticket.state = 'active';
      return;
    }
  }
}

/** Keep every open job and a short tail of closed ones for the board. */
function pruneTickets(state: ServerRoomState): void {
  const closed = state.tickets.filter((t) => !OPEN_STATES.includes(t.state));
  if (closed.length <= tuning.ticketHistory) return;
  const keep = new Set(closed.slice(-tuning.ticketHistory));
  state.tickets = state.tickets.filter((t) => OPEN_STATES.includes(t.state) || keep.has(t));
}

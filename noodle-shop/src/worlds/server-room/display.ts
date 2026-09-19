// Presentation-only projections. Receipts assign displayed messages to
// simulated servers so the room can animate a message travelling to one; the
// aggregate ledger remains tick-based. Neither a receipt nor the estimated
// queue is a measured acknowledgement of anything.
import type { ChatReceipt, SceneTraffic } from '../../shared/sceneTypes';
import {
  adminFallbackCapacityPerMin,
  liveServers,
  roomCapacityPerMin,
  serverCapacityPerMin,
  type ServerRoomState,
} from './state';
import { tuning } from './tuning';

export function displayReceipt(state: ServerRoomState, sequence: number, now: number): ChatReceipt {
  const receipt = { sequence, at: now, label: 'held' };
  const capacity = roomCapacityPerMin(state);
  if (capacity <= 0) return receipt;
  // A low-discrepancy sequence shares receipts out by the same weights as the
  // ledger, without relabelling on later snapshots.
  let share = ((sequence * 0.6180339887498949) % 1) * capacity;
  for (const server of liveServers(state).sort((a, b) => a.slot - b.slot)) {
    share -= serverCapacityPerMin(server, state);
    if (share < 0) return { ...receipt, label: `slot ${server.slot + 1}`, targetId: server.id };
  }
  if (adminFallbackCapacityPerMin(state) > 0) {
    return { ...receipt, label: 'admin', targetId: 'station' };
  }
  return receipt;
}

// Capacity upgrades raise the ceiling; an emergency keeps the mess after power cuts.
export function chaosLevel(traffic: SceneTraffic, emergency: boolean): number {
  if (emergency) return 1;
  if (traffic.capacity <= 0) return traffic.demand > 0 ? 1 : 0;
  const load = traffic.load ?? 0;
  if (!Number.isFinite(load)) return load === Infinity ? 1 : 0;
  return Math.max(0, Math.min(1, (load - 0.3) / 0.7));
}

export function trafficReadout(state: ServerRoomState): SceneTraffic {
  const capacity = roomCapacityPerMin(state);
  const { demandPerMin: demand, backlog, delivered, dropped } = state.traffic;
  const load = capacity > 0 ? demand / capacity : null;
  return {
    demand,
    capacity,
    backlog,
    delivered: Math.floor(delivered),
    dropped: Math.floor(dropped),
    load,
    lagSeconds: capacity > 0 ? (backlog / capacity) * 60 : null,
    status:
      capacity <= 0
        ? 'NOTHING GETTING THROUGH'
        : backlog >= tuning.backlogDropAt
          ? 'LOSING MESSAGES'
          : load! >= 1
            ? 'AT THE LIMIT'
            : load! >= tuning.busyUtilisation
              ? 'GETTING BUSY'
              : 'FLOWING WELL',
  };
}

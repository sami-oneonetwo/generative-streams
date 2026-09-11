import type { Scene, SceneEntity } from '../../shared/sceneTypes';
import type { EngineView, WorldLayout } from '../../engine/world';
import {
  computeDrawW,
  emergencyServerPhase,
  daysSinceLastOutage,
  deadServers,
  isRoomThrottling,
  liveServers,
  milestoneName,
  serverColor,
  serverStatus,
  SERVER_STATE_LABEL,
  slotCount,
  totalDrawW,
  type ServerRoomState,
} from './state';
import { tuning } from './tuning';
import { persona } from './persona';
import { statusScreen } from './screens';
import { audible, deafSince } from './outage';
import { trafficReadout, chaosLevel } from './display';

// Geometry uses full-scene units; all artwork lives on a 480×270 pixel grid.
// The service alcove reserves space for all three racks, away from the desk.
const ADMIN_H = 280;

export const LAYOUT = {
  width: 1920,
  height: 1080,
  worldWidth: 1920,
  floorY: 896, // walking baseline, in front of furniture
  ceilingY: 48,
  rack: { firstX: 1456, pitch: 124, w: 108, topY: 564, slotH: 24, slotGap: 8, legacyH: 56 },
  window: { x: 464, y: 104, w: 864, h: 452 },
  station: { x: 584, y: 576, w: 744, monitorH: 188, benchY: 772, benchH: 32 },
  crate: { x: 504, y: 824, w: 72, h: 72 },
  chatMonitor: { x: 1392, y: 120, w: 480, h: 300 },
  trafficReadout: { x: 1392, y: 436, w: 480, h: 76 },
  whiteboard: { x: 72, y: 152, w: 344, h: 332 },
  aquariumCabinet: { x: 72, y: 640, w: 344, h: 248 },
  fishTank: { x: 136, y: 516, w: 216, h: 124 },
  homeX: 896,
};

export const layout: WorldLayout = {
  width: LAYOUT.width,
  height: LAYOUT.height,
  worldWidth: LAYOUT.worldWidth,
  protagonistHomeX: LAYOUT.homeX,
  walkSpeedPxPerSec: 340, // ~6s end to end; the gait timings in the renderer are matched to this
  protagonistHeightPx: ADMIN_H,
};

function rackX(index: number): number {
  return LAYOUT.rack.firstX + index * LAYOUT.rack.pitch;
}

/** Global slot index -> its bay rectangle within the correct rack. */
export function slotPos(globalSlot: number, slotsPerRack = tuning.slots): { x: number; y: number; w: number; h: number } {
  const r = LAYOUT.rack;
  const rack = Math.floor(globalSlot / slotsPerRack);
  const local = globalSlot % slotsPerRack;
  return {
    x: rackX(rack) + 8,
    y: r.topY + 8 + local * (r.slotH + r.slotGap),
    w: r.w - 16,
    h: r.slotH,
  };
}

export function rackCenterX(globalSlot = 0): number {
  return rackX(Math.floor(globalSlot / tuning.slots)) + LAYOUT.rack.w + 40;
}

export function powerServicePos(): { x: number; y: number; w: number; h: number } {
  return { x: rackX(0) + LAYOUT.rack.w - 28, y: LAYOUT.floorY - 88, w: 20, h: 24 };
}

export function powerServiceX(): number {
  return rackCenterX();
}

export function crateX(): number {
  return LAYOUT.crate.x + LAYOUT.crate.w + 40;
}

export function deskX(): number {
  return LAYOUT.homeX;
}

function roomBg(tempC: number): string {
  const f = Math.min(1, Math.max(0, (tempC - 22) / (tuning.failTempC - 22)));
  const ch = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${ch(6, 30)}, ${ch(11, 10)}, ${ch(14, 9)})`;
}

export function buildScene(state: ServerRoomState, view: EngineView): Scene {
  const entities: SceneEntity[] = [];
  const throttling = isRoomThrottling(state);
  const traffic = trafficReadout(state);
  const emergency = state.emergency;
  const dark = state.power.breakerTripped || !!emergency;
  const targetId = emergency?.serverIds[emergency.index];
  const target = targetId ? state.servers[targetId] : undefined;
  const stage = emergency?.stage;
  const progress = view.currentTask?.progress ?? 0;
  const working = view.protagonist.state === 'working';

  entities.push({ id: 'room', kind: 'apartmentShell', x: 0, y: 0, w: LAYOUT.worldWidth, h: LAYOUT.height, props: { dark } });
  entities.push({ id: 'city', kind: 'cityWindow', ...LAYOUT.window, props: { dark } });
  entities.push({ id: 'furnishings', kind: 'apartmentFurnishings', x: 0, y: 0, w: LAYOUT.worldWidth, h: LAYOUT.height, props: { dark } });

  const drawW = totalDrawW(state);

  // --- racks standing on the floor, with LEGACY-01 squat at the foot ---
  for (let i = 0; i < tuning.maxRacks; i++) {
    const rack = state.racks[i];
    entities.push({
      id: rack?.id ?? `rack-shell-${i}`,
      kind: 'rack',
      x: rackX(i),
      y: LAYOUT.rack.topY,
      w: LAYOUT.rack.w,
      h: LAYOUT.floorY - LAYOUT.rack.topY,
      props: { inactive: !rack, slots: rack?.slots ?? tuning.slots, slotH: LAYOUT.rack.slotH, slotGap: LAYOUT.rack.slotGap, firstSlotNumber: i * tuning.slots + 1 },
    });
  }
  entities.push({ id: 'power-service', kind: 'rackPowerSwitch', ...powerServicePos(), props: { tripped: dark } });
  entities.push({
    id: 'legacy-01',
    kind: 'legacy',
    x: rackX(0),
    y: LAYOUT.floorY - LAYOUT.rack.legacyH,
    w: LAYOUT.rack.w,
    h: LAYOUT.rack.legacyH,
    props: {
      uptimeDays: Math.floor(state.legacy.uptimeDays),
      humming: state.legacy.lastNoiseAt !== undefined && view.now - state.legacy.lastNoiseAt < 60_000,
      dark,
    },
  });

  // Every running server carries chat, so every running server gets a load
  // strip. `level` drives the upgrade pips that replaced the old job glyph.
  for (const server of Object.values(state.servers)) {
    const pos = slotPos(server.slot);
    const status = serverStatus(server, state);
    const phase = emergencyServerPhase(state, server.id);
    const selected = server.id === targetId;
    const damaged = phase === 'damaged' || phase === 'removing';
    const removed = phase === 'carried' || phase === 'installing';
    const withdraw = selected && stage === 'pull' && working ? progress : 0;
    if (removed) continue; // Ownership remains; only the physical chassis is out of the slot.
    entities.push({
      id: server.id,
      kind: 'server',
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      props: {
        owner: server.ownerName,
        level: server.level,
        load: status !== 'dark' ? traffic.load : null,
        status,
        color: serverColor(server, state),
        throttled: !dark && throttling && server.health > 0,
        damaged,
        withdraw,
      },
    });
    if (damaged) entities.push({
      id: `smoke-${server.id}`, kind: 'serverSmoke',
      x: pos.x + withdraw * 32, y: pos.y, w: pos.w, h: pos.h,
      props: { seed: server.slot + 1, sparks: true },
    });
  }

  if (state.incidents.rat) {
    entities.push({ id: 'rat', kind: 'rat', x: rackX(0) + 40, y: LAYOUT.floorY - 12, w: 26, h: 12 });
  }
  if (state.incidents.delivery) {
    entities.push({ id: 'crate', kind: 'crate', x: LAYOUT.crate.x, y: LAYOUT.crate.y, w: LAYOUT.crate.w, h: LAYOUT.crate.h, props: { layer: 'fore' } });
  }

  // Desk, screens and empty chair sit behind the animated protagonist.
  entities.push({
    id: 'station',
    kind: 'station',
    x: LAYOUT.station.x,
    y: LAYOUT.station.y,
    w: LAYOUT.station.w,
    h: LAYOUT.station.monitorH + LAYOUT.station.benchH + (LAYOUT.floorY - (LAYOUT.station.benchY + LAYOUT.station.benchH)),
    props: { lines: view.logLines.slice(-6), dark,
      controlRemoved: !!emergency && !emergency.serverIds.length && (stage === 'exchange' || stage === 'install'),
    },
  });
  if (emergency && !emergency.serverIds.length && stage === 'pull') entities.push({
    id: 'smoke-control', kind: 'serverSmoke', x: 1268, y: 684, w: 48, h: 48,
    props: { seed: 31, sparks: true },
  });
  if (dark) {
    entities.push({ id: 'backup-rack', kind: 'emergencyLight', x: rackX(0), y: LAYOUT.rack.topY - 24, w: 100, h: 24 });
    entities.push({ id: 'backup-room', kind: 'emergencyLight', x: 1704, y: 64, w: 100, h: 24 });
  }
  if (emergency) entities.push({ id: 'spare-servers', kind: 'spareServers', x: 444, y: 824, w: 112, h: 68 });

  entities.push({ id: 'foreground', kind: 'apartmentForeground', x: 0, y: 0, w: LAYOUT.worldWidth, h: LAYOUT.height, props: { layer: 'fore' } });
  // Deaf: the room is carrying nothing, so nothing is on that screen. Sending
  // no messages at all is what keeps stale rows from showing through static
  // Admin provably cannot read (brief §5.7).
  const deaf = !audible(state);
  const since = deafSince(state);
  entities.push({
    id: 'chat-monitor', kind: 'chatMonitor', ...LAYOUT.chatMonitor,
    props: {
      mount: 'wall',
      traffic,
      deaf,
      emergency: !!emergency,
      ...(since !== undefined ? { deafSince: since } : {}),
      messages: deaf ? [] : view.recentChat.slice(-6).map(({ username, text, receipt }) => ({
        username: Array.from(username).slice(0, 40).join(''), text: Array.from(text).slice(0, 500).join(''),
        ...(receipt ? { receipt: { ...receipt } } : {}),
      })),
      receipts: deaf ? [] : view.recentChat.slice(-30).flatMap(m => m.receipt ? [{ ...m.receipt }] : []),
    },
  });

  entities.push({ id: 'traffic-readout', kind: 'trafficReadout', ...LAYOUT.trafficReadout, props: { traffic } });

  entities.push({
    id: 'room-whiteboard', kind: 'whiteboard', ...LAYOUT.whiteboard,
    props: { dark }, screen: statusScreen(state, view),
  });
  entities.push({ id: 'aquarium-cabinet', kind: 'aquariumCabinet', ...LAYOUT.aquariumCabinet });
  entities.push({ id: 'fish-tank', kind: 'fishTank', ...LAYOUT.fishTank, props: { dark } });

  const serviceTarget = target ? slotPos(target.slot) : { x: 1268, y: 684, w: 48, h: 48 };
  const servers = Object.values(state.servers).sort((a, b) => a.slot - b.slot);

  return {
    width: LAYOUT.width,
    height: LAYOUT.height,
    worldWidth: LAYOUT.worldWidth,
    bg: dark ? '#0b0d16' : roomBg(state.roomTempC),
    chaos: chaosLevel(traffic, !!emergency),
    ...(dark ? { power: { mode: stage === 'boot' ? 'booting' as const : 'backup' as const, since } } : {}),
    entities,
    protagonist: {
      name: persona.name.toUpperCase(),
      x: view.protagonist.x,
      y: LAYOUT.floorY,
      state: view.protagonist.state,
      heightPx: ADMIN_H,
      art: 'server-room',
      tint: '#4d3c57',
      rim: dark ? '#d9a36a' : '#75bec4',
      pose: !emergency && view.protagonist.state !== 'walking' && Math.abs(view.protagonist.x - LAYOUT.homeX) < 44 ? 'console' : 'stand',
      ...(stage ? { service: {
        action: stage,
        ...(stage === 'exchange' ? { carrying: 'damaged' as const } : stage === 'install' ? { carrying: 'replacement' as const } : {}),
        targetX: stage === 'exchange' ? 500 : stage === 'reset' ? powerServicePos().x + powerServicePos().w / 2 : serviceTarget.x + serviceTarget.w,
        targetY: stage === 'reset' ? powerServicePos().y + powerServicePos().h / 2 : serviceTarget.y + serviceTarget.h / 2,
        progress,
      } } : {}),
      walk: view.protagonist.walk,
    },
    speech: view.speech,
    chatRevision: view.chatRevision,
    hud: {
      title: 'THE SERVER ROOM',
      meters: [
        { id: 'chat-load', label: `CHAT / ${traffic.status}`, value: traffic.demand, max: traffic.capacity, unit: ' a min', warnAt: traffic.capacity * tuning.busyUtilisation },
        { id: 'power', label: 'POWER', value: drawW, max: state.power.budgetW, unit: 'W', warnAt: state.power.budgetW * tuning.warnBudgetPct },
        {
          id: 'temp',
          label: 'TEMPERATURE',
          value: Math.round(state.roomTempC * 10) / 10,
          max: tuning.maxTempC,
          unit: '°C',
          warnAt: tuning.throttleTempC,
        },
      ],
      counters: [
        { id: 'delivered', label: 'CHAT MESSAGES CARRIED', value: traffic.delivered.toLocaleString('en-GB') },
        { id: 'dropped', label: 'MESSAGES LOST', value: traffic.dropped.toLocaleString('en-GB') },
        { id: 'uptime', label: 'DAYS SINCE LAST OUTAGE', value: String(daysSinceLastOutage(state, view.now)) },
        { id: 'stage', label: 'STAGE', value: milestoneName(state) },
        {
          id: 'quarter',
          label: `QUARTER ${state.season.quarter}`,
          value: `${state.season.streams}/${tuning.streamsPerQuarter} streams · ${state.season.outages} outages`,
        },
        { id: 'servers', label: 'SERVERS', value: `${liveServers(state).length} running, ${deadServers(state).length} off` },
      ],
      board: [
        ...servers.map((s) => ({
          label: `${s.ownerName} · ${s.name}`,
          detail: `${SERVER_STATE_LABEL[serverStatus(s, state)]} · ${computeDrawW(s)}W${s.level ? ` · upgraded ${s.level}x` : ''}`,
          color: serverColor(s, state),
        })),
        {
          label: 'LEGACY-01 · ???',
          detail: `${state.legacy.powerDrawW}W · on for ${Math.floor(state.legacy.uptimeDays)}d`,
          color: state.power.breakerTripped ? '#333941' : '#8a7a50',
        },
      ],
      queue: {
        current: view.currentTask
          ? { label: view.currentTask.label, requestedBy: view.currentTask.requestedBy, progress: view.currentTask.progress }
          : undefined,
        pending: view.pendingTasks,
      },
      logLines: view.logLines,
      pinned: "This chat runs on these servers. Say 'give me a server' to run one.",
    },
  };
}

import type { ChatReceipt, Scene, SceneEntity, SceneTraffic } from '../../src/shared/sceneTypes';
import { P } from './draw/pixelArt';

const DURATION = 1500;
const LIMIT = 30;

export class MessagePulses {
  private sequence: number | undefined;
  private active: ChatReceipt[] = [];

  reset(): void { this.sequence = undefined; this.active = []; }

  observe(receipts: ChatReceipt[], now: number): void {
    const newest = receipts.reduce((n, r) => Math.max(n, r.sequence), 0);
    if (this.sequence === undefined || newest < this.sequence) {
      this.sequence = newest; this.active = []; return; // history isn't live activity
    }
    const previous = this.sequence;
    this.active = [...this.active, ...receipts.filter(r => r.sequence > previous && r.targetId)]
      .filter(r => now >= r.at && now - r.at < DURATION).slice(-LIMIT);
    this.sequence = newest;
  }

  visible(now: number): ChatReceipt[] {
    this.active = this.active.filter(r => now >= r.at && now - r.at < DURATION);
    return this.active;
  }
}

export function chatReceipts(scene: Scene): ChatReceipt[] {
  return (scene.entities.find(e => e.kind === 'chatMonitor')?.props?.receipts ?? []) as ChatReceipt[];
}

export function pulseTarget(scene: Scene, receipt: ChatReceipt): SceneEntity | undefined {
  const target = scene.entities.find(e => e.id === receipt.targetId);
  // Every running server carries chat, so a running server is always a valid
  // destination; one that has gone off is not.
  if (target?.kind === 'server') return target.props?.status !== 'dark' ? target : undefined;
  return target?.kind === 'station' && !target.props?.dark && !target.props?.controlRemoved ? target : undefined;
}

export type CablePoint = readonly [number, number];

/** One route for both the physical wire and its receipt-driven packet. */
export function messageCableRoute(scene: Scene, target: SceneEntity): CablePoint[] {
  const monitor = scene.entities.find(e => e.kind === 'chatMonitor');
  const racks = scene.entities.filter(e => e.kind === 'rack');
  if (!monitor || !racks.length) return [];
  const readout = scene.entities.find(e => e.kind === 'trafficReadout');
  const outletX = monitor.x + monitor.w - 24;
  const outletY = monitor.y + monitor.h - 12;
  const sideX = Math.max(monitor.x + monitor.w, readout ? readout.x + readout.w : 0) + 16;
  const busY = Math.min(...racks.map(e => e.y)) - 36;
  const trunk: CablePoint[] = [[outletX, outletY], [sideX, outletY], [sideX, busY]];
  if (target.kind === 'station') {
    // Admin's starter machine still carries its own share; skirt the desk edge.
    const side = target.x + target.w + 32;
    const portX = target.x + 724, portY = target.y + 112;
    return [...trunk, [side, busY], [side, portY], [portX, portY]];
  }
  const rack = target.kind === 'rack' ? target : racks.find(e =>
    target.x >= e.x && target.x + target.w <= e.x + e.w && target.y >= e.y && target.y < e.y + e.h);
  if (!rack) return [];
  const dropX = rack.x + rack.w + 4;
  const portY = target.kind === 'rack' ? rack.y + 12 : target.y + 8;
  const portX = target.kind === 'rack' ? rack.x + rack.w - 8 : target.x + target.w - 8;
  return [...trunk, [dropX, busY], [dropX, portY], [portX, portY]];
}

export function cablePointAt(points: CablePoint[], fraction: number): CablePoint | undefined {
  if (!points.length) return undefined;
  const lengths = points.slice(1).map((p, i) => Math.abs(p[0] - points[i][0]) + Math.abs(p[1] - points[i][1]));
  let distance = lengths.reduce((sum, n) => sum + n, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (distance > lengths[i]) { distance -= lengths[i]; continue; }
    const f = lengths[i] ? distance / lengths[i] : 1;
    return [0, 1].map(axis => Math.round((points[i][axis] + (points[i + 1][axis] - points[i][axis]) * f) / 4) * 4) as [number, number];
  }
  return points.at(-1);
}

export function drawMessageCables(g: CanvasRenderingContext2D, scene: Scene): void {
  const targets = scene.entities.filter(e => e.kind === 'rack' || e.kind === 'server' || e.kind === 'station');
  g.save();
  g.lineJoin = 'round';
  // Outline first, then the muted cable core, so shared runs don't erase branches.
  for (const [width, color] of [[12, P.ink], [4, P.tealDark]] as const) {
    g.lineWidth = width; g.strokeStyle = color;
    for (const target of targets) {
      const points = messageCableRoute(scene, target);
      if (!points.length) continue;
      g.beginPath(); g.moveTo(...points[0]);
      for (const p of points.slice(1)) g.lineTo(...p);
      g.stroke();
    }
  }
  for (const target of targets) {
    const points = messageCableRoute(scene, target);
    for (const p of [points[0], points.at(-1)]) {
      if (!p) continue;
      g.fillStyle = P.slate; g.fillRect(p[0] - 4, p[1] - 4, 12, 12);
      g.fillStyle = P.tealDark; g.fillRect(p[0], p[1], 4, 4);
    }
  }
  g.restore();
}

export function drawMessagePulses(g: CanvasRenderingContext2D, scene: Scene, receipts: ChatReceipt[], now: number): void {
  const monitor = scene.entities.find(e => e.kind === 'chatMonitor');
  if (!monitor || (monitor.props?.traffic as SceneTraffic | undefined)?.capacity === 0) return;
  g.save();
  for (const receipt of receipts) {
    const target = pulseTarget(scene, receipt);
    if (!target) continue;
    const points = messageCableRoute(scene, target);
    // Spend the last 180ms acknowledging arrival at the actual destination port.
    const fraction = (now - receipt.at) / (DURATION - 180);
    const point = cablePointAt(points, fraction);
    if (!point) continue;
    const [px, py] = point;
    const trail = cablePointAt(points, Math.max(0, fraction - 0.045));
    if (trail && fraction < 1) {
      g.fillStyle = P.cyan; g.fillRect(trail[0], trail[1], 4, 4);
    }
    g.fillStyle = P.teal; g.fillRect(px - 4, py - 4, 12, 12);
    g.fillStyle = P.ice; g.fillRect(px, py, 4, 4);
  }
  g.restore();
}

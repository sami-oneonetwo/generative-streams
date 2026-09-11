import type { SceneEntity, SceneTraffic } from '../../src/shared/sceneTypes';
import { P } from './draw/pixelArt';
import { TERMINAL_FONT } from './terminalFont';

const count = (n: number) => n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.floor(n).toLocaleString('en-GB');

export function drawTrafficReadout(g: CanvasRenderingContext2D, e: SceneEntity): void {
  const t = e.props?.traffic as SceneTraffic | undefined;
  if (!t) return;
  const x = e.x + 12, w = e.w - 24;
  g.save();
  g.beginPath(); g.rect(e.x + 4, e.y + 4, e.w - 8, e.h - 8); g.clip();
  g.textBaseline = 'top'; g.textAlign = 'left';
  g.font = `bold 14px ${TERMINAL_FONT}`;
  g.fillStyle = P.ice;
  g.fillText(`CHAT · ${t.status}`, x, e.y + 10);
  g.textAlign = 'right';
  // "340 of 0 a min" reads as a broken readout rather than as a dead room.
  g.fillText(
    t.capacity > 0
      ? `${Math.round(t.demand)} of ${Math.round(t.capacity)} a min`
      : `${Math.round(t.demand)} a min arriving`,
    x + w,
    e.y + 10,
  );
  g.textAlign = 'left';
  const y = e.y + 31;
  g.fillStyle = P.blue; g.fillRect(x, y, w, 5);
  g.fillStyle =
    t.status === 'NOTHING GETTING THROUGH' || t.status === 'LOSING MESSAGES' || t.status === 'AT THE LIMIT'
      ? P.red
      : t.status === 'GETTING BUSY'
        ? P.amber
        : P.cyan;
  g.fillRect(x, y, w * Math.min(1, Math.max(0, t.load ?? 0)), 5);
  // Threshold ticks and the status in words make this readable without relying
  // on hue: the state is never carried by colour alone.
  g.fillStyle = P.dark;
  for (const fraction of [0.7, 0.9]) g.fillRect(x + w * fraction, y, 2, 5);
  g.font = `14px ${TERMINAL_FONT}`; g.fillStyle = P.ice;
  g.fillText(`CARRIED ${count(t.delivered)}`, x, e.y + 47);
  g.textAlign = 'right';
  g.fillText(`LOST ${count(t.dropped)}`, x + w, e.y + 47);
  g.restore();
}

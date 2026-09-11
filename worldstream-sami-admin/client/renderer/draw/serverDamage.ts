import { P, rect as r, line } from './pixelArt';

// Native pixels. A fixed number of puffs, no retained particles or random state.
export function drawServerDamage(g: CanvasRenderingContext2D, x: number, y: number, now: number, seed: number, sparks = false): void {
  for (let i = 0; i < 9; i++) {
    const phase = ((now / 2900 + i / 9 + seed * 0.17) % 1 + 1) % 1;
    const px = x + Math.round(Math.sin(i * 7 + phase * 5) * (3 + phase * 9));
    const py = y - 3 - Math.round(phase * 35);
    const size = 2 + Math.floor(phase * 6);
    g.save();
    g.globalAlpha = 0.85 * (1 - phase);
    r(g, px - size / 2, py, size, size, i % 2 ? P.steel : '#9d91a5');
    r(g, px - size / 2 - 1, py + 2, size + 2, Math.max(1, size - 3), P.slate);
    g.restore();
  }
  const beat = ((now + seed * 617) % 5100 + 5100) % 5100;
  if (sparks && beat < 180) {
    line(g, x, y, x + 5, y - 6, P.cream);
    line(g, x - 2, y + 1, x - 7, y + 6, P.amber);
    r(g, x + 7, y - 7, 1, 2, P.cream);
    r(g, x - 8, y + 8, 2, 1, P.amber);
  }
}

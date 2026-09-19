// Integer-grid primitives. All coordinates here are native art pixels.
export const P = {
  ink: '#10121f', dark: '#171929', shadow: '#202338', wall: '#2b2b43', wallLit: '#39364f',
  plum: '#4d3c57', mauve: '#71506a', rose: '#ad637d', pink: '#e38baf',
  blue: '#303d58', slate: '#465671', steel: '#667b8e',
  tealDark: '#244b58', teal: '#397682', cyan: '#75bec4', ice: '#b4e3d5',
  woodDark: '#382c36', wood: '#66434a', woodLight: '#986052', amber: '#d99a6c', cream: '#f1c99a',
  greenDark: '#284542', green: '#49745a', leaf: '#82a071', red: '#dd6b7d',
} as const;

export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    rect(g, x0, y0, 1, 1, color);
    if (x0 === x1 && y0 === y1) break;
    const e = 2 * err;
    if (e >= dy) { err += dy; x0 += sx; }
    if (e <= dx) { err += dx; y0 += sy; }
  }
}

// Scanline polygons avoid the antialiasing of Canvas paths even at 1x.
export function poly(g: CanvasRenderingContext2D, points: number[][], color: string): void {
  const min = Math.ceil(Math.min(...points.map(p => p[1])));
  const max = Math.ceil(Math.max(...points.map(p => p[1])));
  for (let y = min; y < max; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) rect(g, Math.ceil(xs[i]), y, Math.ceil(xs[i + 1]) - Math.ceil(xs[i]), 1, color);
  }
}

const FONT: Record<string, string> = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101',
  I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'010101101101010', P:'110101110100100',
  Q:'010101101111011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111', '0':'111101101101111', '1':'010110010010111',
  '2':'110001010100111', '3':'110001010001110', '4':'101101111001001', '5':'111100110001110',
  '6':'011100111101111', '7':'111001010010010', '8':'111101111101111', '9':'111101111001110',
  '-':'000000111000000', '.':'000000000000010', ':':'000010000010000', '/':'001001010100100',
  '?':'110001010000010', '+':'000010111010000', ' ':'000000000000000',
};

export function text(g: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, scale = 1): void {
  for (const c of value.toUpperCase()) {
    const glyph = FONT[c] ?? FONT['?'];
    for (let i = 0; i < 15; i++) if (glyph[i] === '1') rect(g, x + i % 3 * scale, y + Math.floor(i / 3) * scale, scale, scale, color);
    x += 4 * scale;
  }
}

export function plant(g: CanvasRenderingContext2D, x: number, y: number, size = 1): void {
  g.save(); g.translate(Math.round(x), Math.round(y));
  // Scale geometry before rasterizing so fractional sizes stay on the pixel grid.
  line(g, 0, -3 * size, size, -24 * size, P.green);
  line(g, 0, -9 * size, -10 * size, -20 * size, P.green);
  line(g, size, -13 * size, 10 * size, -25 * size, P.green);
  for (const [lx, ly, flip] of [[-12,-23,1],[-8,-15,1],[2,-28,1],[5,-21,-1],[9,-27,-1],[4,-12,-1]]) {
    poly(g, [[lx,ly+5],[lx-3*flip,ly+1],[lx-2*flip,ly-3],[lx+4*flip,ly],[lx+5*flip,ly+3]].map(([px, py]) => [px * size, py * size]), P.green);
    line(g, lx * size, (ly+2) * size, (lx+3*flip) * size, (ly+3) * size, P.leaf);
  }
  rect(g, -7 * size, -4 * size, 14 * size, 3 * size, P.woodLight);
  poly(g, [[-6,-1],[6,-1],[4,9],[-4,9]].map(([px, py]) => [px * size, py * size]), P.wood);
  rect(g, -4 * size, 0, 3 * size, 7 * size, P.woodLight);
  rect(g, -7 * size, -4 * size, 13 * size, 1, P.amber);
  g.restore();
}

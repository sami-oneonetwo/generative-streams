// Original 480×270 pixel artwork: a quiet apartment over a sleepless city.
// Entity geometry arrives in output pixels; each draw works in native pixels.
import type { SceneEntity } from '../../../src/shared/sceneTypes';
import { register } from './registry';
import { lightDip, STILL_EFFECTS, type FrameEffects } from '../chaos';
import { drawServerDamage } from './serverDamage';
import { BOARD_PAPER } from '../whiteboard';
import { P, rect as r, line, poly, plant, text } from './pixelArt';

type ArtFn = (g: CanvasRenderingContext2D, e: SceneEntity, now: number, effects: FrameEffects) => void;
function art(kind: string, draw: ArtFn): void {
  register(kind, (g, e, now, effects) => {
    g.save();
    g.scale(4, 4);
    draw(g, { ...e, x: e.x / 4, y: e.y / 4, w: e.w / 4, h: e.h / 4 }, now, effects);
    g.restore();
  });
}

// Static layers are rasterized once, not rebuilt on every animation frame.
function cached(kind: string, draw: ArtFn, overlay?: ArtFn): void {
  let image: HTMLCanvasElement | undefined;
  let key = '';
  art(kind, (g, e, now, effects) => {
    const next = `${e.x},${e.y},${e.w},${e.h},${!!e.props?.dark}`;
    if (!image || key !== next) {
      image = document.createElement('canvas');
      image.width = Math.ceil(e.w); image.height = Math.ceil(e.h);
      const ctx = image.getContext('2d')!;
      ctx.translate(-e.x, -e.y);
      draw(ctx, e, now, STILL_EFFECTS);
      key = next;
    }
    g.drawImage(image, Math.round(e.x), Math.round(e.y));
    overlay?.(g, e, now, effects);
  });
}

function frame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, body: string, edge: string = P.slate): void {
  r(g, x, y, w, h, P.ink);
  r(g, x + 1, y + 1, w - 2, h - 2, body);
  r(g, x + 1, y + 1, w - 2, 1, edge);
  r(g, x + 1, y + 1, 1, h - 2, edge);
}

cached('apartmentShell', (g, e) => {
  const right = e.w;
  r(g, 0, 0, right, 270, P.ink);
  r(g, 8, 10, right - 16, 218, P.wall);
  r(g, 110, 18, right - 127, 196, '#323047');
  poly(g, [[8,10],[110,18],[110,214],[8,235]], P.shadow);
  // Recessed utility alcove; architectural shadows, not a wallpaper of gear.
  r(g, 15, 29, 90, 196, P.dark);
  r(g, 15, 29, 2, 196, P.blue);
  r(g, 103, 28, 3, 196, P.ink);
  r(g, 15, 219, 90, 8, P.woodDark);
  r(g, 8, 12, right - 18, 5, P.dark);
  r(g, 110, 17, right - 124, 2, P.plum);
  r(g, 10, 8, right - 18, 3, P.ink);
  r(g, 13, 12, 92, 1, P.slate);
  // Window light steps across plaster and picks out scratches.
  r(g, 111, 23, 228, 119, P.wallLit);
  r(g, 110, 142, 228, 6, P.plum);
  for (let i = 0; i < 30; i++) {
    const x = 113 + (i * 47 % 216), y = 149 + (i * 31 % 54);
    if (i % 3 === 0) { r(g, x, y, 3, 1, P.wallLit); r(g, x + 3, y + 1, 1, 1, P.wallLit); }
  }
  // Warm wood floor in shallow perspective.
  poly(g, [[8,224],[110,208],[right-8,208],[right,270],[0,270]], P.woodDark);
  poly(g, [[110,208],[right-8,208],[right,256],[78,256]], '#44333d');
  for (const y of [216,229,244,263]) line(g, 6, y + 10, right - 4, y, P.dark);
  for (let x = 360; x < right - 8; x += 32) {
    line(g, x, 220, x - 5, 233, P.dark);
    line(g, x + 10, 242, x + 5, 255, P.dark);
    line(g, x + 4, 236, x + 23, 235, '#503b43');
  }
  for (const [x,y] of [[19,232],[74,229],[132,226],[195,224],[267,222],[322,220],[43,246],[105,243],[176,241],[250,239],[315,237],[10,263],[81,260],[153,258],[228,255],[302,253]]) {
    line(g, x, y, x - 5, y + 13, P.dark);
    line(g, x + 7, y + 3, x + 29, y + 2, '#503b43');
  }
  // A soft woven rug, with stepped edges rather than a smooth ellipse.
  poly(g, [[155,218],[294,218],[317,249],[127,249]], P.dark);
  poly(g, [[156,219],[292,219],[312,247],[132,247]], '#4b3b52');
  poly(g, [[160,222],[288,222],[304,244],[141,244]], P.mauve);
  poly(g, [[163,224],[286,224],[299,242],[146,242]], P.plum);
  for (let y = 225; y < 242; y += 3) for (let x = 160; x < 289; x += 7) r(g, x + y % 2, y, 2, 1, '#5b445d');
  for (let x = 135; x < 314; x += 4) r(g, x, 249, 1, 2, P.woodLight);
  r(g, 7, 222, 99, 2, P.slate);
  r(g, 108, 208, right - 124, 2, P.woodLight);
  // The media corner shares the apartment's plaster, skirting and warm practicals.
  r(g, 340, 22, right - 352, 113, P.wall);
  r(g, 339, 22, 1, 182, P.plum);
  // An old pipe is tucked into the architecture; one quiet pink practical.
  line(g, 10, 21, 106, 21, P.slate);
  line(g, 10, 22, 106, 22, P.dark);
  r(g, 112, 14, 204, 1, e.props?.dark ? P.blue : P.rose);
  if (!e.props?.dark) r(g, 145, 14, 109, 1, P.pink);
  for (const x of [17,54,95]) r(g, x, 20, 2, 4, P.blue);
}, (g, e, now, effects) => {
  if (e.props?.dark || !effects.animate) return;
  const dip = lightDip(now, 3, effects.chaos);
  if (dip <= 0) return;
  g.save();
  g.globalAlpha = dip * 0.8;
  r(g, 112, 14, 204, 1, P.blue);
  g.globalAlpha = dip * 0.12;
  r(g, 110, 17, e.w - 124, 2, P.ink);
  g.restore();
});

const cityImages = new Map<boolean, HTMLCanvasElement>();
const cityBuildings = [[-5,59,29],[30,48,32],[69,67,23],[104,36,35],[146,62,27],[179,47,31]];
function city(g: CanvasRenderingContext2D, dark: boolean): void {
  r(g, 0, 0, 210, 105, '#272b49');
  r(g, 0, 33, 210, 39, '#303452');
  r(g, 0, 72, 210, 33, '#41394f');
  // Haze is a sparse, fixed dither band, never film grain.
  for (let x = 0; x < 210; x += 3) r(g, x, 31 + x % 2, 1, 1, '#303452');
  const distant = [[1,35,14],[19,25,13],[38,41,21],[64,17,15],[85,30,18],[110,23,14],[132,43,19],[157,26,12],[180,14,19],[203,36,14]];
  for (const [x,y,w] of distant) {
    r(g, x, y, w, 105 - y, '#343d58');
    r(g, x + 3, y - 3, w - 6, 3, '#343d58');
    line(g, x + Math.floor(w / 2), y - 8, x + Math.floor(w / 2), y, P.slate);
    for (let yy = y + 5; yy < 101; yy += 6) for (let xx = x + 3; xx < x + w - 2; xx += 4) {
      if (!dark && (xx * 7 + yy * 3) % 11 < 5) r(g, xx, yy, 1, 2, '#666279');
    }
  }
  for (const [x,y,w] of cityBuildings) {
    r(g, x, y, w, 105 - y, P.dark);
    r(g, x, y, 2, 105 - y, P.blue);
    r(g, x + 2, y + 1, w - 3, 2, P.slate);
    r(g, x + 7, y - 5, w - 13, 5, P.shadow);
    for (let yy = y + 8; yy < 106; yy += 7) for (let xx = x + 5; xx < x + w - 3; xx += 6) {
      const n = (xx * 13 + yy * 17) % 19;
      r(g, xx, yy, 3, 4, dark ? P.ink : n < 5 ? '#ab7b87' : n < 9 ? '#557f8d' : P.shadow);
      if (!dark && n < 3) r(g, xx, yy, 2, 1, '#d6a499');
    }
    line(g, x + w - 4, y + 6, x + w - 4, 105, P.blue);
  }
  // Dead signs keep their silhouettes, not their illuminated letters.
  if (dark) {
    frame(g, 89, 48, 13, 38, P.shadow, P.blue);
    frame(g, 149, 72, 36, 13, P.shadow, P.blue);
  } else {
  // Neon belongs to the city, not every object in the room.
  frame(g, 89, 48, 13, 38, '#54334e', P.rose);
  for (const y of [52,62,72]) {
    r(g, 92, y, 6, 1, P.pink); r(g, 94, y - 1, 1, 7, P.pink);
    r(g, 91, y + 3, 9, 1, P.rose); r(g, 98, y + 1, 1, 5, P.pink);
    r(g, 92, y + 6, 6, 1, P.pink);
  }
  frame(g, 149, 72, 36, 13, P.tealDark, P.teal);
  text(g, 'HOTEL', 152, 76, P.cyan);
  r(g, 186, 27, 2, 9, P.rose); r(g, 183, 30, 8, 2, P.rose);
  r(g, 8, 80, 14, 2, '#be829c');
  }
  // Elevated train line cuts across the far city.
  r(g, 0, 96, 210, 3, P.blue);
  r(g, 0, 97, 210, 1, '#657087');
  for (const x of [22,91,166]) r(g, x, 99, 3, 6, P.blue);
}

art('cityWindow', (g, e, now, effects) => {
  const { x, y, w, h } = e;
  r(g, x - 3, y - 3, w + 6, h + 8, P.ink);
  frame(g, x, y, w, h, P.blue, P.steel);
  const dark = !!e.props?.dark;
  let cityImage = cityImages.get(dark);
  if (!cityImage) {
    cityImage = document.createElement('canvas'); cityImage.width = 210; cityImage.height = 105;
    city(cityImage.getContext('2d')!, dark);
    cityImages.set(dark, cityImage);
  }
  g.save();
  g.beginPath(); g.rect(x + 3, y + 3, w - 6, h - 7); g.clip();
  g.drawImage(cityImage, x + 3, y + 3);
  if (!dark && effects.animate && effects.chaos > 0.15) {
    g.save();
    g.translate(x + 3, y + 3);
    for (let i = 0; i < cityBuildings.length; i++) {
      const [bx, by, bw] = cityBuildings[i];
      const dip = lightDip(now, i + 7, effects.chaos);
      if (dip <= 0) continue;
      g.globalAlpha = dip * 0.85;
      for (let yy = by + 8; yy < 96; yy += 7) for (let xx = bx + 5; xx < bx + bw - 3; xx += 6) {
        // Neon signs and the elevated railway stay in front of the windows.
        if ((xx < 102 && xx + 3 > 89 && yy + 4 > 48 && yy < 86) ||
            (xx < 185 && xx + 3 > 149 && yy + 4 > 72 && yy < 85) ||
            (xx < 22 && xx + 3 > 8 && yy + 4 > 80 && yy < 82)) continue;
        if ((xx * 13 + yy * 17) % 19 < 9) r(g, xx, yy, 3, 4, P.shadow);
      }
    }
    g.restore();
  }
  const trainX = Math.floor(now / 140) % 285 - 60;
  if (!dark) for (let i = 0; i < 7; i++) r(g, x + trainX + i * 4, y + 97, 2, 1, P.amber);
  // Small slanted rain strokes, snapped to pixels and confined to the glass.
  for (let i = 0; i < 42; i++) {
    const rx = x + 4 + (i * 43 % 205);
    const ry = y + 3 + ((Math.floor(now / (80 + i % 5 * 12)) + i * 17) % 104);
    line(g, rx, ry, rx - 1, ry + 3 + i % 3, i % 5 === 0 ? '#788298' : '#515870');
  }
  g.restore();
  r(g, x + 71, y + 2, 3, h - 4, P.ink);
  r(g, x + 74, y + 2, 1, h - 4, P.slate);
  r(g, x + 143, y + 2, 3, h - 4, P.ink);
  r(g, x + 146, y + 2, 1, h - 4, P.plum);
  r(g, x + 2, y + 76, w - 4, 3, P.ink);
  r(g, x + 2, y + 79, w - 4, 1, P.slate);
  r(g, x - 4, y + h, w + 8, 3, P.mauve);
  r(g, x - 4, y + h + 3, w + 8, 3, P.woodDark);
  r(g, x - 2, y + h, w + 4, 1, P.rose);
  // Half-raised Venetian blind, with its pull against the far frame.
  for (let i = 0; i < 4; i++) {
    r(g, x + 2, y + 2 + i * 3, w - 4, 2, i < 2 ? P.wallLit : P.plum);
    r(g, x + 2, y + 2 + i * 3, w - 4, 1, P.mauve);
  }
  line(g, x + w - 6, y + 2, x + w - 6, y + 45, P.woodLight);
  r(g, x + w - 7, y + 45, 3, 4, P.amber);
});

cached('apartmentFurnishings', (g, e) => {
  // Window-seat cushions in the gap between the alcove and work desk.
  frame(g, 114, 177, 38, 33, P.woodDark, P.wood);
  r(g, 116, 178, 34, 5, P.mauve);
  r(g, 118, 175, 28, 5, P.plum);
  r(g, 118, 175, 27, 1, P.rose);
  r(g, 118, 187, 28, 1, P.wood);
  r(g, 129, 190, 6, 1, P.woodLight);
  plant(g, 131, 162, 1);
  r(g, 119, 172, 28, 2, P.dark);
  // Trailing plant on the high window shelf.
  plant(g, 319, 135);
  line(g, 323, 140, 324, 162, P.greenDark);
  for (let y = 146; y < 165; y += 5) {
    r(g, 323, y, 4, 2, P.green); r(g, 325, y + 2, 3, 2, P.greenDark);
  }
  // Books and small belongings on the sill.
  for (const [x,w,h,c] of [[121,4,12,P.rose],[126,3,15,P.teal],[130,5,13,P.amber],[136,3,10,P.slate]] as const) {
    r(g, x, 139 - h, w, h, c); r(g, x, 141 - h, w, 1, P.cream);
  }
  r(g, 145, 135, 11, 4, P.woodLight); r(g, 146, 134, 9, 1, P.cream);
  // A taped print, and notes that add human-scale detail.
  frame(g, 158, 150, 20, 28, P.woodDark, P.mauve);
  r(g, 160, 152, 16, 22, P.plum);
  r(g, 163, 155, 10, 7, P.rose);
  poly(g, [[160,170],[165,161],[169,167],[174,159],[176,174],[160,174]], P.blue);
  r(g, 164, 173, 7, 1, P.cream);
  r(g, 157, 149, 4, 2, P.amber); r(g, 175, 149, 4, 2, P.amber);
  r(g, 183, 156, 6, 8, P.woodLight); r(g, 184, 158, 4, 1, P.woodDark);
  r(g, 186, 167, 7, 6, P.rose); r(g, 187, 169, 4, 1, P.plum);
  // Localized warm lamp light on plaster, with a dithered outside edge.
  if (e.props?.dark) return;
  poly(g, [[287,163],[305,163],[326,199],[266,199]], '#4b3b48');
  poly(g, [[288,164],[303,164],[318,191],[276,191]], '#59414b');
  for (let y = 178; y < 199; y += 2) {
    r(g, 270 + (199-y)/2, y, 1, 1, P.woodLight);
    r(g, 317 - (199-y)/3, y, 1, 1, P.woodLight);
  }
});

function coffeeCup(g: CanvasRenderingContext2D, x: number, y: number, color: string, tipped = false): void {
  r(g, x - 2, y, tipped ? 14 : 11, 2, P.woodDark);
  if (tipped) {
    poly(g, [[x+4,y],[x+11,y],[x+11,y+1],[x+16,y+1],[x+18,y+3],[x+13,y+5],[x+6,y+4],[x+3,y+2]], '#674538');
    r(g, x + 9, y + 2, 5, 1, P.woodLight);
    poly(g, [[x-1,y-4],[x+6,y-5],[x+8,y-1],[x+2,y+1],[x-1,y-1]], color);
    r(g, x + 6, y - 4, 2, 4, P.cream);
    r(g, x + 7, y - 3, 1, 2, P.woodDark);
    line(g, x, y - 5, x + 2, y - 7, color); line(g, x + 2, y - 7, x + 4, y - 5, color);
  } else {
    r(g, x, y - 7, 7, 7, color);
    r(g, x, y - 7, 7, 1, P.cream);
    r(g, x + 1, y - 6, 5, 1, P.woodDark);
    r(g, x + 1, y - 4, 1, 3, P.cream);
    r(g, x + 7, y - 5, 3, 4, color);
    r(g, x + 7, y - 4, 2, 2, P.woodDark);
  }
}

art('station', (g, e, now, effects) => {
  const dark = Boolean(e.props?.dark);
  const x = e.x, y = e.y;
  g.save(); g.translate(x, y);
  if (!dark) {
    poly(g, [[100,9],[145,9],[145,50],[87,50],[87,25]], '#334554');
    poly(g, [[98,17],[140,17],[140,45],[90,45]], '#385160');
    for (let yy = 24; yy < 47; yy += 2) r(g, 85 + yy % 3, yy, 1, 1, P.tealDark);
  }
  // A wide wood desktop, seen slightly from above, on two real supports.
  poly(g, [[0,48],[173,48],[186,56],[-9,56]], P.woodLight);
  r(g, -9, 56, 195, 4, P.wood);
  r(g, -9, 56, 195, 1, P.amber);
  r(g, -7, 60, 191, 2, P.woodDark);
  for (const [xx,w] of [[0,22],[136,48]]) {
    frame(g, xx, 62, w, 18, P.woodDark, P.wood);
    r(g, xx + 2, 65, w - 4, 1, P.wood);
    r(g, xx + 2, 74, w - 4, 1, P.wood);
    r(g, xx + Math.floor(w / 2) - 3, 67, 6, 1, P.woodLight);
    r(g, xx + 2, 80, 3, 2, P.ink); r(g, xx + w - 5, 80, 3, 2, P.ink);
  }
  r(g, 130, 61, 3, 19, P.dark);
  // Power strip and coiled cords tucked below the desktop.
  line(g, 122, 49, 125, 68, P.ink); line(g, 125, 68, 112, 73, P.ink);
  line(g, 112, 73, 105, 69, P.ink); line(g, 105, 69, 117, 65, P.ink);
  frame(g, 111, 77, 20, 4, P.shadow, P.slate);
  for (let xx = 115; xx < 128; xx += 4) r(g, xx, 78, 2, 1, P.steel);
  // Left companion display: muted warm phosphor, unmistakably a CRT.
  frame(g, 32, 15, 29, 28, P.slate, P.steel);
  r(g, 33, 17, 2, 22, P.blue);
  frame(g, 36, 18, 22, 20, dark ? P.ink : '#3d3443', P.wood);
  if (!dark) {
    text(g, 'MAIL', 38, 21, P.amber);
    for (let i = 0; i < 4; i++) r(g, 39, 29 + i * 2, 8 + i % 3 * 3, 1, i % 2 ? P.woodLight : P.rose);
  }
  r(g, 44, 43, 5, 5, P.blue); r(g, 39, 47, 17, 2, P.slate);
  r(g, 54, 40, 2, 1, dark ? P.shadow : P.amber);
  // Padded chair stays in place when he gets up.
  r(g, 68, 70, 2, 8, P.steel);
  line(g, 69, 78, 56, 82, P.slate); line(g, 69, 78, 80, 82, P.slate);
  r(g, 56, 81, 3, 2, P.ink); r(g, 78, 81, 3, 2, P.ink);
  frame(g, 54, 30, 23, 37, P.woodDark, P.mauve);
  r(g, 55, 32, 19, 24, P.plum); r(g, 56, 33, 2, 22, P.mauve);
  r(g, 56, 66, 29, 4, P.woodDark); r(g, 56, 66, 29, 1, P.mauve);
  // Main CRT: the highest contrast object, with an asymmetrical thick casing.
  poly(g, [[102,7],[148,7],[154,12],[154,44],[149,47],[102,47]], P.ink);
  r(g, 103, 8, 45, 36, P.slate);
  r(g, 104, 9, 42, 2, P.steel);
  poly(g, [[148,9],[152,13],[152,42],[148,44]], P.blue);
  for (let yy = 16; yy < 36; yy += 3) r(g, 149, yy, 2, 1, P.ink);
  frame(g, 106, 12, 39, 28, dark ? P.dark : P.tealDark, P.ink);
  if (!dark) {
    r(g, 108, 14, 35, 2, P.teal);
    r(g, 109, 15, 2, 1, P.ice); r(g, 112, 15, 2, 1, P.rose);
    r(g, 108, 18, 8, 19, '#316370'); r(g, 117, 18, 26, 19, '#478c96');
    const logLines = (e.props?.lines as string[] | undefined) ?? [];
    for (let row = 0; row < 6; row++) {
      const yy = 20 + row * 3;
      const length = logLines[row]?.length ?? row * 3;
      r(g, 109, yy, 4 + row % 2, 1, P.teal);
      r(g, 119 + row % 2 * 2, yy, 3, 1, row % 3 ? P.cyan : P.amber);
      r(g, 124 + row % 2 * 2, yy, 5 + length % 11, 1, row % 3 ? P.ice : P.cyan);
    }
    if (Math.floor(now / 650) % 2 === 0) r(g, 134, 35, 2, 1, P.ice);
  }
  r(g, 106, 41, 32, 1, P.blue);
  r(g, 140, 42, 2, 1, dark ? P.shadow : P.cyan);
  r(g, 120, 47, 9, 3, P.blue); r(g, 113, 50, 22, 2, P.steel);
  // Keyboard in perspective, mouse, notebook and a steaming coffee cup.
  poly(g, [[88,50],[111,50],[115,54],[85,54]], P.ink);
  poly(g, [[89,50],[110,50],[112,53],[87,53]], P.steel);
  for (let xx = 90; xx < 110; xx += 3) r(g, xx, 51, 1, 1, P.shadow);
  r(g, 115, 52, 4, 2, P.slate); r(g, 116, 51, 2, 1, P.steel);
  r(g, 9, 50, 13, 4, P.plum); r(g, 10, 50, 11, 2, P.cream); r(g, 15, 50, 1, 2, P.woodLight);
  r(g, 22, 51, 5, 1, P.rose);
  r(g, 159, 49, 9, 2, P.woodDark);
  r(g, 160, 44, 6, 6, P.rose); r(g, 160, 44, 6, 1, P.cream);
  r(g, 161, 45, 2, 4, P.amber); r(g, 166, 45, 2, 3, P.rose); r(g, 166, 46, 1, 1, P.woodDark);
  const steam = Math.floor(now / 600) % 3;
  line(g, 162, 41, 163 + steam % 2, 37, P.steel); r(g, 161 + steam, 34, 1, 2, P.slate);
  // The desk lamp loses mains too; only the emergency fixtures stay lit.
  r(g, 143, 49, 11, 2, P.woodDark); r(g, 144, 48, 8, 1, P.amber);
  line(g, 150, 47, 152, 28, P.woodLight); line(g, 151, 47, 153, 28, P.amber);
  line(g, 152, 28, 142, 18, P.woodLight); line(g, 153, 28, 143, 18, P.amber);
  poly(g, [[140,15],[147,20],[145,24],[134,19]], P.woodDark);
  poly(g, [[139,16],[145,20],[143,22],[135,19]], dark ? P.shadow : P.amber);
  if (!dark) {
    line(g, 134, 20, 142, 24, P.cream);
    const dip = effects.animate ? lightDip(now, 11, effects.chaos) : 0;
    if (dip > 0) {
      g.save(); g.globalAlpha = dip * 0.85;
      poly(g, [[139,16],[145,20],[143,22],[135,19]], P.shadow);
      line(g, 134, 20, 142, 24, P.woodDark);
      g.restore();
    }
  }
  // A compact PC tower on the desk, with two quiet ventilation grilles.
  if (!e.props?.controlRemoved) {
    frame(g, 171, 25, 13, 25, P.shadow, P.slate);
    for (let yy = 30; yy < 45; yy += 3) r(g, 174, yy, 7, 1, P.ink);
    r(g, 177, 27, 2, 1, dark ? P.dark : P.rose);
  }
  // Fixed spots keep the mess legible: spare cups first, then accidents on the floor.
  if (effects.mess >= 1) coffeeCup(g, 29, 54, P.cream);
  if (effects.mess >= 2) {
    coffeeCup(g, 137, 55, P.teal);
    coffeeCup(g, 16, 48, P.rose);
  }
  if (effects.mess >= 3) {
    coffeeCup(g, -3, 53, P.amber, true);
    coffeeCup(g, 37, 91, P.cream, true);
    coffeeCup(g, 158, 87, P.teal);
  }
  if (effects.mess >= 4) {
    coffeeCup(g, 101, 94, P.rose, true);
    coffeeCup(g, 149, 100, P.amber, true);
    coffeeCup(g, 176, 56, P.cream, true);
    // Coffee has run over the front edge of the desk.
    line(g, 1, 57, 1, 63, '#674538'); r(g, 1, 64, 2, 2, P.woodLight);
  }
  g.restore();
});

art('whiteboard', (g, e) => {
  const { x, y, w, h } = e;
  r(g, x + 2, y + 3, w, h, P.ink);
  frame(g, x, y, w, h, P.woodLight, P.steel);
  r(g, x + 2, y + 2, w - 4, h - 4, BOARD_PAPER);
  r(g, x + 3, y + 3, w - 6, 1, '#eeeadd');
  for (const [dx, dy, length] of [[8,15,12],[48,33,18],[18,61,22]]) r(g, x + dx, y + dy, length, 1, '#d3d4c9');
  r(g, x + 4, y + h, w - 8, 2, P.slate);
  r(g, x + 7, y + h, 12, 1, P.rose);
  r(g, x + 22, y + h, 10, 1, P.ink);
  r(g, x + w - 17, y + h - 1, 9, 3, P.woodDark);
  for (const [dx, color] of [[2,'#d8c180'],[30,'#b9c6ac'],[58,'#c99d9d']] as const) {
    r(g, x + dx + 1, y - 14, 24, 12, P.shadow);
    r(g, x + dx, y - 15, 24, 12, color);
    r(g, x + dx + 8, y - 16, 7, 2, '#d5cbb2');
    poly(g, [[x+dx+21,y-6],[x+dx+24,y-6],[x+dx+21,y-3]], '#a79b7b');
  }
});

art('aquariumCabinet', (g, e) => {
  const { x, y, w, h } = e;
  r(g, x - 1, y + h, w + 3, 2, P.ink);
  frame(g, x + 2, y + 3, w - 4, h - 6, P.woodDark, P.wood);
  r(g, x, y, w, 4, P.woodLight);
  r(g, x + 2, y + 1, w - 4, 1, P.amber);
  frame(g, x + 5, y + 7, w - 10, 11, P.wood, P.woodLight);
  r(g, x + w / 2 - 3, y + 11, 6, 2, P.woodDark);
  for (const dx of [5, w / 2 + 1]) {
    frame(g, x + dx, y + 21, w / 2 - 6, h - 28, P.wood, P.woodLight);
    r(g, x + dx + 3, y + 24, w / 2 - 12, h - 34, P.woodDark);
    line(g, x + dx + 6, y + 28, x + dx + 6, y + h - 13, P.wood);
  }
  r(g, x + w / 2 - 5, y + 34, 2, 4, P.amber);
  r(g, x + w / 2 + 3, y + 34, 2, 4, P.amber);
  r(g, x + 5, y + h - 3, 5, 5, P.woodDark);
  r(g, x + w - 10, y + h - 3, 5, 5, P.woodDark);
});

art('rackPowerSwitch', (g, e) => {
  frame(g, e.x, e.y, e.w, e.h, P.shadow, P.slate);
  r(g, e.x + 1, e.y + (e.props?.tripped ? 3 : 1), e.w - 2, 2, e.props?.tripped ? P.woodLight : P.steel);
});

art('rack', (g, e) => {
  const slots = Number(e.props?.slots ?? 8);
  const sh = Number(e.props?.slotH ?? 24) / 4, gap = Number(e.props?.slotGap ?? 8) / 4;
  r(g, e.x - 1, e.y + e.h, e.w + 4, 2, P.ink);
  frame(g, e.x, e.y, e.w, e.h, e.props?.inactive ? P.dark : P.blue, P.slate);
  r(g, e.x + e.w - 3, e.y + 2, 2, e.h - 3, P.shadow);
  for (let i = 0; i < slots; i++) {
    const yy = e.y + 2 + i * (sh + gap);
    r(g, e.x + 2, yy, e.w - 4, sh, P.ink);
    r(g, e.x + 4, yy + 2, e.w - 8, 1, P.shadow);
    r(g, e.x + 1, yy + 2, 1, 1, P.steel);
    r(g, e.x + e.w - 2, yy + 2, 1, 1, P.steel);
  }
  text(g, String(Number(e.props?.firstSlotNumber ?? 1)).padStart(2, '0'), e.x + 4, e.y + e.h - 8, P.steel);
});

art('server', (g, e, now, effects) => {
  const shift = Math.round(Number(e.props?.withdraw ?? 0) * 8);
  if (shift) {
    r(g, e.x, e.y + 1, e.w + shift, 1, P.steel);
    e = { ...e, x: e.x + shift };
  }
  if (e.props?.damaged) {
    r(g, e.x, e.y, e.w, e.h, P.woodDark);
    r(g, e.x, e.y, e.w, 1, P.slate);
    for (let i = 2; i < e.w - 2; i += 3) r(g, e.x + i, e.y + 2, 2, 3, P.ink);
    return;
  }
  const status = String(e.props?.status ?? 'green');
  const dark = status === 'dark';
  const pulse = !dark && !shift && effects.animate
    ? Math.max(0, Math.sin(now / (390 + e.y % 7 * 23) + e.y * 0.73)) * effects.chaos : 0;
  // Breathe out by at most two native pixels sideways and one into the slot gap.
  const swell = Math.round(pulse * 2);
  const lift = pulse > 0.65 ? 1 : 0;
  e = { ...e, x: e.x - swell, y: e.y - lift, w: e.w + swell * 2, h: e.h + lift };
  const alert = status === 'red';
  const color = dark ? P.slate : alert ? P.red : status === 'amber' || e.props?.throttled ? P.amber : P.cyan;
  r(g, e.x, e.y, e.w, e.h, dark ? P.shadow : P.slate);
  r(g, e.x, e.y, e.w, 1, dark ? P.blue : P.steel);
  r(g, e.x + 2, e.y + 2, 9, 2, P.dark);
  for (let i = 0; i < 3; i++) r(g, e.x + 13 + i * 2, e.y + 2, 1, 2, P.shadow);
  const blink = !effects.animate || Math.floor(now / (alert ? 500 : 900 - effects.chaos * 400) + e.y) % 3 !== 0;
  r(g, e.x + e.w - 3, e.y + 2, 1, 2, blink || dark ? color : P.blue);
  if (pulse > 0.5) {
    r(g, e.x + 1, e.y, e.w - 2, 1, effects.chaos > 0.8 ? P.rose : P.cyan);
    r(g, e.x + e.w - 4, e.y + 1, 2, 1, P.ice);
  }
  if (!dark) r(g, e.x + 3, e.y + 2, 2 + Math.floor(now / 1300 + e.y) % 4, 1, color);
  // Up to three pips in the old vent space: how many times this one has been
  // upgraded. A bigger server is visibly a bigger server.
  const level = Math.max(0, Math.min(3, Number(e.props?.level ?? 0)));
  r(g, e.x + 12, e.y + 1, 5, 5, dark ? P.shadow : P.slate);
  for (let i = 0; i < 3; i++) {
    r(g, e.x + 13 + i, e.y + 3, 1, 1, i < level ? (dark ? P.steel : P.ice) : P.dark);
  }
  const load = e.props?.load;
  if (!dark && typeof load === 'number') {
    r(g, e.x + 2, e.y + 5, 9, 1, P.dark);
    r(g, e.x + 2, e.y + 5, Math.round(9 * Math.min(1, Math.max(0, load))), 1,
      load >= 1 ? P.red : load >= 0.7 ? P.amber : P.cyan);
  }
});

art('trafficReadout', (g, e) => {
  frame(g, e.x, e.y, e.w, e.h, P.dark, P.slate);
});

art('legacy', (g, e, now) => {
  frame(g, e.x, e.y, e.w, e.h, P.wood, P.woodLight);
  r(g, e.x + 3, e.y + 3, 12, 2, P.woodDark);
  for (let xx = 4; xx < e.w - 5; xx += 2) r(g, e.x + xx, e.y + 8, 1, 3, P.woodDark);
  const on = !e.props?.dark && (!e.props?.humming || Math.floor(now / 200) % 2 === 0);
  r(g, e.x + e.w - 5, e.y + 3, 2, 2, on ? P.amber : P.woodDark);
  r(g, e.x + 3, e.y + 5, 8, 1, P.amber);
});

art('crate', (g, e) => {
  frame(g, e.x, e.y, e.w, e.h, P.wood, P.woodLight);
  r(g, e.x + 7, e.y + 1, 4, e.h - 2, P.amber);
  r(g, e.x + 2, e.y + 8, 5, 5, P.cream);
  r(g, e.x + 3, e.y + 9, 3, 1, P.woodDark);
});

function monitor(g: CanvasRenderingContext2D, e: SceneEntity): void {
  const { x, y, w, h } = e;
  if (e.props?.mount === 'wall') {
    r(g, x + 3, y + 3, w, h, P.dark);
    r(g, x + w / 2 - 4, y + h, 8, 4, P.ink);
    if (e.kind !== 'chatMonitor') {
      line(g, x + w / 2, y + h, x + w / 2, y + h + 10, P.ink);
      line(g, x + w / 2, y + h + 10, x + w - 6, y + h + 10, P.ink);
    }
  } else if (e.props?.mount === 'floor' || e.props?.mount === 'stack') {
    // Chunky CRTs sit directly on each other, with only the bottom one on feet.
    r(g, x + 2, y + h - 2, w - 2, 3, P.ink);
    if (e.props.mount === 'floor') {
      r(g, x - 3, y + h + 3, w + 10, 2, P.woodDark);
      r(g, x + 7, y + h, 9, 3, P.ink);
      r(g, x + w - 20, y + h, 9, 3, P.ink);
      line(g, x + w + 2, y + h - 9, x + w + 9, y + h - 5, P.ink);
      line(g, x + w + 9, y + h - 5, x + w + 15, y + h - 6, P.ink);
    }
  } else {
    // A low wood console and short feet anchor the near-viewer screens.
    r(g, x - 3, y + h + 3, w + 8, 3, P.woodLight);
    r(g, x - 3, y + h + 6, w + 8, 2, P.wood);
    r(g, x + 1, y + h + 8, 3, 2, P.woodDark);
    r(g, x + w - 4, y + h + 8, 3, 2, P.woodDark);
    r(g, x + 9, y + h - 1, 12, 4, P.slate);
    r(g, x + w - 25, y + h - 1, 12, 4, P.slate);
  }
  poly(g, [[x+w-3,y+2],[x+w+2,y+5],[x+w+2,y+h-3],[x+w-3,y+h]], P.woodDark);
  frame(g, x, y, w - 2, h, '#242f35', P.steel);
  r(g, x + 2, y + 2, w - 6, h - 9, P.ink);
  // Same inset as chatScreen(), expressed in native artwork pixels.
  r(g, x + 4, y + 3, w - 10, h - 12, '#0b1919');
  line(g, x + 4, y + 3, x + w - 7, y + 3, P.tealDark);
  for (let i = 0; i < 4; i++) r(g, x + 5 + i * 3, y + h - 5, 2, 1, P.ink);
  r(g, x + w - 12, y + h - 5, 2, 1, e.props?.deaf ? P.amber : '#9bea80');
  r(g, x + w - 8, y + h - 5, 2, 1, P.slate);
}
/** Integer hash, so the grain is deterministic per frame without RNG state. */
function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}

/**
 * Static on a dead screen (brief §5.7). Sparse dark grain and a slow roll bar
 * rather than full-field snow: time is quantised so the pattern changes a few
 * times a second instead of strobing at frame rate, and every colour stays
 * near the tube's own black — this is on a stream for minutes at a time.
 */
function staticNoise(g: CanvasRenderingContext2D, e: SceneEntity, now: number): void {
  const x = e.x + 4, y = e.y + 3, w = e.w - 10, h = e.h - 12;
  const frame = Math.floor(now / 200);
  const cell = 2;
  for (let row = 0; row * cell < h - 1; row++) {
    for (let col = 0; col * cell < w - 1; col++) {
      const v = hash(frame * 7919 + row * 131 + col);
      if (v > 0.82) r(g, x + col * cell, y + row * cell, cell, cell, v > 0.95 ? P.slate : P.blue);
    }
  }
  const bar = y + (Math.floor(now / 90) % (h + 20)) - 10;
  if (bar > y && bar < y + h - 3) r(g, x, bar, w, 2, P.shadow);
}

art('chatMonitor', (g, e, now) => {
  monitor(g, e);
  if (e.props?.deaf) staticNoise(g, e, now);
  if (e.props?.emergency && now % 5700 < 240) {
    const y = e.y + 12 + Math.floor(now / 5700) % Math.max(1, e.h - 30);
    r(g, e.x + 4, y, e.w - 10, 4, P.ink);
    r(g, e.x + 7, y + 1, e.w - 20, 1, P.slate);
  }
});
art('infoMonitor', monitor);

art('fishTank', (g, e, now) => {
  const { x, y, w, h } = e;
  const dark = !!e.props?.dark;
  frame(g, x, y, w, h, P.ink, P.slate);
  r(g, x + 2, y + 3, w - 4, h - 6, dark ? '#11212b' : '#193f4d');
  r(g, x + 3, y + 5, w - 6, 1, dark ? P.tealDark : P.teal);
  r(g, x + 2, y + 2, w - 4, 1, dark ? P.blue : P.ice);
  r(g, x + 2, y + h - 6, w - 4, 3, P.wood);
  for (let i = 0; i < w - 6; i += 3) r(g, x + 3 + i, y + h - 5 + i % 2, 1, 1, P.amber);
  for (const px of [x + 8, x + w - 10, x + w - 16]) {
    const sway = Math.round(Math.sin(now / 1800 + px));
    line(g, px, y + h - 6, px + sway, y + h - 17, P.green);
    line(g, px, y + h - 11, px - 3, y + h - 15, P.leaf);
    line(g, px, y + h - 14, px + 3, y + h - 19, P.green);
  }
  for (let i = 0; i < 2; i++) {
    const phase = now / (2600 + i * 700) + i * 2.6;
    const fx = Math.round(x + w / 2 + Math.sin(phase) * (w / 2 - 12));
    const fy = Math.round(y + 12 + i * 7 + Math.sin(phase * 1.3) * 2);
    const dir = Math.cos(phase) >= 0 ? 1 : -1;
    r(g, fx - 2, fy, 5, 3, i ? P.rose : P.amber);
    r(g, fx - dir * 4, fy - 1, 2, 5, i ? P.pink : P.woodLight);
    r(g, fx + dir * 2, fy, 1, 1, P.ink);
  }
  if (!dark) for (let i = 0; i < 3; i++) {
    const by = y + h - 8 - Math.floor((now / 350 + i * 6) % (h - 14));
    r(g, x + w - 6 + i % 2, by, 1, 1, P.cyan);
  }
  // Glass edge highlights and a solid lid/base keep the tank grounded on the CRT.
  r(g, x + 2, y + 4, 1, h - 8, P.cyan);
  r(g, x + w - 3, y + 4, 1, h - 8, P.teal);
  r(g, x + 5, y + 7, 1, 6, P.steel);
  r(g, x, y, w, 2, P.slate);
  r(g, x, y + h - 3, w, 3, P.ink);
  r(g, x + 1, y + h - 3, w - 2, 1, P.slate);
});

art('serverSmoke', (g, e, now) => {
  drawServerDamage(g, e.x + e.w / 2, e.y, now, Number(e.props?.seed ?? 1), !!e.props?.sparks);
});

art('emergencyLight', (g, e) => {
  const cx = e.x + e.w / 2, y = e.y + e.h;
  g.save();
  for (let i = 4; i >= 1; i--) {
    g.globalAlpha = 0.055;
    poly(g, [[cx-8,y],[cx+8,y],[cx+12+i*9,y+i*24],[cx-12-i*9,y+i*24]], P.amber);
  }
  g.restore();
  frame(g, e.x, e.y, e.w, e.h, P.blue, P.steel);
  for (const x of [e.x + 3, e.x + e.w - 8]) {
    r(g, x, e.y + 2, 5, 3, P.amber);
    r(g, x + 1, e.y + 3, 3, 2, P.cream);
  }
  r(g, cx, e.y + 2, 1, 1, P.red);
});

art('spareServers', (g, e) => {
  r(g, e.x - 2, e.y + e.h, e.w + 4, 2, P.ink);
  r(g, e.x, e.y + e.h - 5, e.w, 3, P.slate);
  for (const x of [e.x + 3, e.x + e.w - 5]) r(g, x, e.y + e.h - 2, 3, 3, P.ink);
  line(g, e.x + e.w - 1, e.y - 2, e.x + e.w - 1, e.y + e.h - 4, P.steel);
  for (let i = 0; i < 3; i++) {
    frame(g, e.x + 2, e.y + e.h - 9 - i * 4, e.w - 6, 4, P.blue, P.steel);
    for (let j = 0; j < 5; j++) r(g, e.x + 4 + j * 3, e.y + e.h - 7 - i * 4, 2, 1, P.ink);
  }
});

art('rat', (g, e, now) => {
  const x = e.x + Math.floor(Math.sin(now / 650) * 3), y = e.y;
  line(g, x - 5, y + 2, x, y + 1, P.rose);
  r(g, x, y, 6, 3, P.slate); r(g, x + 1, y - 1, 3, 1, P.slate);
  r(g, x + 5, y, 2, 2, P.steel); r(g, x + 5, y, 1, 1, P.ink);
});

cached('apartmentForeground', (g, e) => {
  // Low sofa and knitted throw frame the room without covering the walk lane.
  poly(g, [[4,242],[14,237],[90,237],[103,248],[103,270],[4,270]], P.ink);
  r(g, 10, 241, 82, 26, P.woodDark);
  r(g, 15, 239, 34, 23, P.plum); r(g, 52, 239, 35, 23, P.plum);
  r(g, 16, 239, 31, 2, P.mauve); r(g, 53, 239, 31, 2, P.mauve);
  r(g, 16, 242, 1, 15, P.mauve); r(g, 53, 242, 1, 15, P.mauve);
  r(g, 12, 262, 79, 8, P.plum); r(g, 12, 262, 79, 1, P.mauve);
  frame(g, 5, 249, 10, 21, P.woodDark, P.mauve);
  frame(g, 88, 249, 11, 21, P.woodDark, P.mauve);
  poly(g, [[59,244],[81,244],[87,270],[62,270]], '#394b55');
  for (let y = 246; y < 270; y += 3) line(g, 61, y, 82 + Math.floor((y - 244)/5), y, P.tealDark);
  for (let x = 64; x < 83; x += 5) line(g, x, 246, x + 3, 269, P.slate);
  poly(g, [[24,247],[38,243],[44,256],[30,260]], P.wood);
  line(g, 25, 247, 38, 244, P.woodLight);
  // Tuck the foreground plant into the corner, clear of the rack fronts.
  plant(g, e.w - 12, 263, 1);
  r(g, 0, 0, e.w, 5, P.ink); r(g, 0, 5, 6, 265, P.ink);
  r(g, e.w - 5, 5, 5, 265, P.ink);
  r(g, 6, 5, 1, 224, P.blue);
});

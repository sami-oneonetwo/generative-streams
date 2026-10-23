// Ground surfaces for the ages (docs/ages.md): a pattern (mud with cart ruts, cobbles, setts, a
// glowing grid …) painted once on a canvas from an age's surface spec (src/shared/ageBibles.json) and
// tiled over the ground. Shared by the town (environment.ts) and the design board (design/board), so
// the board shows exactly what the stream will. Deterministic: the same spec paints the same texture.
import * as THREE from 'three';

export interface Surface {
  pattern: string;
  base: string;
  accent?: string;
  accent2?: string;
  scale?: number;
  glow?: boolean;
}

// ---- small helpers -------------------------------------------------------------------------------
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
export const col = (hex: string | undefined, fallback = '#888888') => new THREE.Color(/^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex! : fallback);
/** A colour a little lighter or darker (amount −1..1), as css. */
export function vary(hex: string, amount: number): string {
  const c = col(hex);
  return `#${(amount >= 0 ? c.lerp(new THREE.Color(1, 1, 1), amount) : c.lerp(new THREE.Color(0, 0, 0), -amount)).getHexString()}`;
}

// ---- surfaces: a pattern painted on a canvas, tiled over the ground -----------------------------
export const PATCH = 4; // metres one texture covers
const PX = 512;
/** How much of each pattern is washed back to its base colour (0 keeps it all, 1 leaves a flat colour). */
const CALM: Record<string, number> = { grass: 0.9, meadow: 0.88, mud: 0.84, dirt: 0.9, sand: 0.9, gravel: 0.86, moss: 0.9, snow: 0.9, asphalt: 0.88, concrete: 0.84, cobble: 0.8, flagstone: 0.82, setts: 0.8, brick: 0.82, tiles: 0.82, planks: 0.8, water: 0.6, glowgrid: 0.45 };
const textures = new Map<string, { map: THREE.CanvasTexture; glow?: THREE.CanvasTexture }>();

export function paint(s: Surface): { map: THREE.CanvasTexture; glow?: THREE.CanvasTexture } {
  const key = JSON.stringify(s);
  const hit = textures.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const g = canvas.getContext('2d')!;
  const glowCanvas = s.glow ? document.createElement('canvas') : undefined;
  if (glowCanvas) glowCanvas.width = glowCanvas.height = PX;
  const gg = glowCanvas?.getContext('2d');
  if (gg) {
    gg.fillStyle = '#000';
    gg.fillRect(0, 0, PX, PX);
  }
  const r = seeded(hash(key));
  const base = `#${col(s.base).getHexString()}`;
  const accent = `#${col(s.accent, vary(base, -0.25)).getHexString()}`;
  const accent2 = `#${col(s.accent2, vary(base, 0.2)).getHexString()}`;
  const ppm = PX / PATCH;
  const unit = Math.max(0.15, Math.min(3, s.scale ?? 0.6)) * ppm; // one stone, slab or tuft, in pixels
  g.fillStyle = base;
  g.fillRect(0, 0, PX, PX);
  const blob = (x: number, y: number, rx: number, ry: number, fill: string, alpha = 1) => {
    g.globalAlpha = alpha;
    g.fillStyle = fill;
    for (const dx of [-PX, 0, PX])
      for (const dy of [-PX, 0, PX]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, rx, ry, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    g.globalAlpha = 1;
  };
  const speckle = (n: number, size: number, colours: string[], alpha = 1) => {
    for (let i = 0; i < n; i++) blob(r() * PX, r() * PX, size * (0.5 + r()), size * (0.5 + r()), colours[i % colours.length], alpha);
  };
  /** Stones laid in rows (cobbles, setts, bricks, flags): joints in the accent, each stone a shade of the base. */
  const laid = (w: number, h: number, opts: { offset: number; jitter: number; round: number; joint: number }) => {
    g.fillStyle = accent;
    g.fillRect(0, 0, PX, PX);
    const rows = Math.max(2, Math.round(PX / h)),
      hh = PX / rows;
    for (let row = 0; row < rows; row++) {
      const cols = Math.max(2, Math.round(PX / w)),
        ww = PX / cols;
      const shift = (row % 2) * ww * opts.offset;
      for (let c = -1; c <= cols; c++) {
        const x = c * ww + shift + (r() - 0.5) * opts.jitter * ww,
          y = row * hh + (r() - 0.5) * opts.jitter * hh * 0.4;
        const sw = ww * (1 - opts.joint) * (0.85 + r() * 0.15),
          sh = hh * (1 - opts.joint) * (0.85 + r() * 0.15);
        g.fillStyle = vary(base, (r() - 0.5) * 0.28);
        const rad = Math.min(sw, sh) * opts.round;
        for (const dx of [-PX, 0, PX]) {
          g.beginPath();
          g.roundRect(x + dx + (ww - sw) / 2, y + (hh - sh) / 2, sw, sh, rad);
          g.fill();
        }
      }
    }
  };
  switch (s.pattern) {
    case 'grass':
    case 'meadow': {
      speckle(260, unit * 0.18, [vary(base, -0.12), vary(base, 0.1)], 0.55);
      g.lineWidth = 2;
      for (let i = 0; i < 900; i++) {
        const x = r() * PX,
          y = r() * PX,
          l = unit * (0.08 + r() * 0.12);
        g.strokeStyle = i % 3 ? accent : vary(base, 0.15);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * l * 0.6, y - l);
        g.stroke();
      }
      if (s.pattern === 'meadow') speckle(70, 4, [accent2, '#f2e9c8'], 1);
      break;
    }
    case 'mud': {
      // Clumps of darker and drier earth, two wavy pairs of cart ruts along the road (x), and a few
      // irregular puddles: never a regular pattern.
      const clump = (cx: number, cy: number, n: number, rad: number, fill: string, alpha: number) => {
        for (let k = 0; k < n; k++) blob(cx + (r() - 0.5) * rad * 3, cy + (r() - 0.5) * rad * 2, rad * (0.4 + r() * 0.8), rad * (0.3 + r() * 0.6), fill, alpha);
      };
      for (let i = 0; i < 45; i++) clump(r() * PX, r() * PX, 5 + Math.floor(r() * 8), unit * (0.08 + r() * 0.18), i % 3 ? accent : vary(base, 0.14), 0.14);
      for (const y0 of [0.33, 0.67]) {
        const phase = r() * 6;
        for (const off of [-0.045, 0.045])
          for (let x = 0; x < PX; x += 3) blob(x, (y0 + off + Math.sin(x / 90 + phase) * 0.015) * PX, 5 + r() * 3, 3 + r() * 2, vary(accent, -0.15), 0.35);
      }
      for (let i = 0; i < 4; i++) {
        const cx = r() * PX,
          cy = r() * PX,
          rad = unit * (0.15 + r() * 0.2);
        clump(cx, cy, 4, rad, accent2, 0.9);
        blob(cx - rad * 0.3, cy - rad * 0.2, rad * 0.5, rad * 0.18, vary(accent2, 0.35), 0.6);
      }
      speckle(90, 1.8, [vary(base, 0.16), vary(base, -0.14)], 0.5);
      break;
    }
    case 'dirt':
    case 'sand':
    case 'snow':
      speckle(s.pattern === 'sand' ? 1400 : 600, s.pattern === 'sand' ? 1.6 : 2.6, [accent, accent2, vary(base, -0.08)], 0.7);
      if (s.pattern === 'dirt') speckle(40, unit * 0.12, [accent], 0.9);
      break;
    case 'gravel':
      speckle(2200, unit * 0.06 + 1.5, [accent, accent2, vary(base, 0.15), vary(base, -0.15)], 1);
      break;
    case 'moss':
      speckle(160, unit * 0.35, [accent, accent2, vary(base, -0.1)], 0.6);
      break;
    case 'cobble':
      laid(unit, unit * 0.9, { offset: 0.5, jitter: 0.35, round: 0.5, joint: 0.16 });
      break;
    case 'flagstone':
      laid(unit * 1.6, unit, { offset: 0.37, jitter: 0.25, round: 0.08, joint: 0.06 });
      break;
    case 'setts':
      laid(unit * 0.9, unit * 0.5, { offset: 0.5, jitter: 0.06, round: 0.15, joint: 0.12 });
      break;
    case 'brick':
      laid(unit, unit * 0.45, { offset: 0.5, jitter: 0, round: 0.05, joint: 0.1 });
      break;
    case 'tiles':
      laid(unit, unit, { offset: 0, jitter: 0, round: 0.04, joint: 0.06 });
      break;
    case 'concrete':
      laid(unit * 2.5, unit * 2.5, { offset: 0, jitter: 0, round: 0, joint: 0.015 });
      speckle(500, 1.5, [vary(base, -0.08), vary(base, 0.08)], 0.6);
      break;
    case 'planks': {
      const rows = Math.max(2, Math.round(PX / (unit * 0.35)));
      for (let i = 0; i < rows; i++) {
        g.fillStyle = vary(base, (r() - 0.5) * 0.2);
        g.fillRect(0, (i * PX) / rows, PX, PX / rows - 3);
        g.fillStyle = accent;
        g.fillRect(r() * PX, (i * PX) / rows, 3, PX / rows);
      }
      break;
    }
    case 'asphalt':
      speckle(2600, 1.2, [vary(base, -0.1), vary(base, 0.1), accent], 0.8);
      break;
    case 'glowgrid': {
      speckle(800, 1.2, [vary(base, 0.06)], 0.6);
      const n = Math.max(1, Math.round(PX / Math.max(16, unit))),
        step = PX / n;
      for (const ctx of [g, gg].filter(Boolean) as CanvasRenderingContext2D[]) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k <= n; k++) {
          const p = k * step;
          ctx.moveTo(p, 0);
          ctx.lineTo(p, PX);
          ctx.moveTo(0, p);
          ctx.lineTo(PX, p);
        }
        ctx.stroke();
      }
      break;
    }
    case 'water': {
      g.strokeStyle = accent2;
      g.lineWidth = 3;
      for (let i = 0; i < 60; i++) {
        const x = r() * PX,
          y = r() * PX,
          l = 20 + r() * 50;
        g.globalAlpha = 0.6;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + l / 2, y - 5, x + l, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    default:
      speckle(400, 2, [accent, accent2], 0.5);
  }
  // Calm it down (Sami, 2026-10-20 and again 10-21: the ground was too busy to see things against; near-flat colour, people and builds carry the detail): wash the pattern
  // back towards the base colour. Natural ground is washed hardest; laid stone keeps enough of its
  // joints that a cobbled lane still reads as one.
  g.globalAlpha = CALM[s.pattern] ?? 0.55;
  g.fillStyle = base;
  g.fillRect(0, 0, PX, PX);
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const glow = glowCanvas ? new THREE.CanvasTexture(glowCanvas) : undefined;
  if (glow) {
    glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
    glow.colorSpace = THREE.SRGBColorSpace;
  }
  const out = { map, glow };
  textures.set(key, out);
  return out;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** One shared material per surface: textures are laid by world-space UVs, so every plane of it shares one texture and patterns run on across neighbouring planes. */
export function surfaceMaterial(s: Surface): THREE.MeshStandardMaterial {
  const key = JSON.stringify(s);
  let mat = materials.get(key);
  if (mat) return mat;
  const { map, glow } = paint(s);
  const water = s.pattern === 'water';
  mat = new THREE.MeshStandardMaterial({ map, roughness: water ? 0.25 : 0.95, metalness: water ? 0.1 : 0 });
  if (glow) {
    mat.emissiveMap = glow;
    mat.emissive = col(s.accent, '#66ffff');
    mat.emissiveIntensity = 1.1;
  }
  materials.set(key, mat);
  return mat;
}
/** Shared textures and materials outlive any one scene: never dispose these. */
export const isShared = (m: THREE.Material | THREE.Texture | null | undefined) =>
  !!m && ([...materials.values()].includes(m as THREE.MeshStandardMaterial) || [...textures.values()].some((t) => t.map === m || t.glow === m));

/** A flat rectangle of ground, x0..x1 by z0..z1 at height y, in a surface; world-space UVs. `alongZ` turns the pattern a quarter (an avenue's ruts and setts run along it). */
export function ground(parent: THREE.Object3D, s: Surface | undefined | null, x0: number, x1: number, z0: number, z1: number, y = 0, alongZ = false): THREE.Mesh | undefined {
  if (!s) return undefined;
  const w = x1 - x0,
    d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d);
  // The plane lies in x/−z once turned flat; UVs from where each corner lands in the world.
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = (x0 + w / 2 + pos.getX(i)) / PATCH,
      v = (-(z0 + d / 2) + pos.getY(i)) / PATCH;
    if (alongZ) uv.setXY(i, v, u);
    else uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  const plane = new THREE.Mesh(geo, surfaceMaterial(s));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  plane.receiveShadow = true;
  parent.add(plane);
  return plane;
}

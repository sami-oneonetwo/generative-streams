// The Folly's look (FK-024, board/design-system.md §5): what stands on STORY_SITES.folly once the
// head's cordon goes up, drawn by the engine from a handful of numbers, with no LLM, so it is the
// same in every age. A draped cream canvas over the build's box, cinched by two gold ropes, with a
// giant gold crown stencilled on its front and its top, growing with the Folly's timer; the cordon
// round the plot (an ink stake every 2 m with a gold knob, a gold rope sagging between them, gold
// and ink pennants swaying under it); a 4 × 1.6 m sign, "KEEP OUT. SOMETHING AMAZING." on a gold
// face, whose frame alone changes with the age; a gold plaque plate with a crown emboss; and a gold
// beam of light up through the tarp, thin and faint while the cordon is up, wide and pulsing
// through the Unveiling's Call.
//
// The reveal: on the `unveil` beat the server takes `silhouette` off the Folly, and the page drops
// the tarp in 0.4 s, rolls out six big dust puffs and bursts up to 24 big pieces of gold confetti
// off the top, while the camera holds still (motion-budget.md: the reveal moves only the tarp, the
// dust and the build). Under reduced motion the tarp is simply gone. The build itself is drawn by
// objects.ts, hidden while the tarp is on, so nothing of it pokes through a tarp that is still growing.
//
// About ten draw calls a Folly: the canvas, its crowns, its ropes and their ink rim, the cordon's
// stakes with the sign's frame and the plaque (one merged mesh in vertex colours), the cordon's rope
// and its rim, the pennants (one instanced mesh), the sign's face and the beam; two more while the
// tarp drops (the dust, the confetti). Only the canvas and the merged kit cast shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AGE_IDS, clampAge, type AgeId } from '../../src/shared/ages';
import { primitiveGeometry } from './primitives';
import { INK, SIDE_HEX } from './sideMarks';
import type { GroundPoint, Primitive, Vec3 } from './types';

/** The locked story gold (design-system.md §2), its deep shade, the canvas, and the dust it raises. */
export const GOLD = SIDE_HEX.gold;
export const GOLD_DEEP = '#A86E00';
export const CANVAS = '#EFE3C2';
const DUST = '#D9CDB2';

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ---- the tarp ------------------------------------------------------------------------------------

/** The tarp's box at full size: half its width (x), half its depth (z), its height; centred on the Folly, on the ground. */
export interface FollyBox {
  a: number;
  c: number;
  h: number;
}
/** The box a build's parts fill, in its own frame (objects.ts partsBounds). */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export const TARP = {
  /** Clear of the build all round (m): more than the rounding takes off a corner, so a boxy build's corners stay under it. */
  pad: 0.3,
  /** How big the tarp stands at 0% and at 100% of the Folly's timer, as fractions of its full box: the secret grows. */
  grow: { xz: [0.72, 1], y: [0.4, 1] },
  /** The edges' radius over the top and down the corners. */
  round: 0.55,
  /** How far the middle of the top rises, as canvas over a peak does. */
  dome: 0.35,
  /** How far the walls belly out between the ropes, in the middle of each wall. */
  bulge: 0.22,
  /** Under the low rope the canvas hangs loose: how far the hem kicks out, and its folds. */
  flare: 0.3,
  folds: { wave: 1.8, depth: 0.14 },
  /** The two gold ropes round it, as fractions of its height; how thick, their ink rim, how far they pull it in. */
  bands: [0.2, 0.82],
  rope: 0.1,
  rim: 0.05,
  pinch: 0.06,
  /** Mesh spacing (m): fine enough for the folds. */
  step: 0.45,
} as const;

/** How far the Folly's timer has grown the tarp (0..1 of the way from its 0% size to its full box). */
export const growthOf = (pct: number) => clamp01((Number.isFinite(pct) ? pct : 100) / 100);
/** The tarp's box at a growth (0..1): the full box at 1, 72% across and 40% tall at 0. */
export function grownBox(full: FollyBox, grow: number): FollyBox {
  const k = clamp01(grow);
  const xz = lerp(TARP.grow.xz[0], TARP.grow.xz[1], k),
    y = lerp(TARP.grow.y[0], TARP.grow.y[1], k);
  return { a: full.a * xz, c: full.c * xz, h: full.h * y };
}
/** The tarp's full box over a build's parts: centred on the Folly (the cordon is square round it), clear of the build, its hem inside the cordon's stakes. */
export function tarpBox(b: Bounds, plot: number): FollyBox {
  const most = cordonHalf(plot) - CORDON.stake.w - TARP.flare - TARP.folds.depth;
  return {
    a: Math.min(most, Math.max(1, Math.abs(b.minX), Math.abs(b.maxX)) + TARP.pad),
    c: Math.min(most, Math.max(1, Math.abs(b.minZ), Math.abs(b.maxZ)) + TARP.pad),
    h: Math.max(1.5, b.maxY) + TARP.pad,
  };
}

const roundOf = (b: FollyBox) => Math.min(TARP.round, b.a * 0.4, b.c * 0.4, b.h * 0.3);

/**
 * Where a point of the box's surface (y up from the ground) ends up once the canvas is draped over
 * it: on a box rounded over the top and down the corners, its walls bellied out between the ropes
 * and pinched in where they go round, its skirt kicked out at the hem in loose folds, its top domed.
 * A function of the point alone, so the faces meet without a crack, and the crowns and the ropes can
 * be laid on the same canvas.
 */
export function drape(px: number, py: number, pz: number, b: FollyBox, out = new THREE.Vector3()): THREE.Vector3 {
  const r = roundOf(b);
  const ix = Math.max(-(b.a - r), Math.min(b.a - r, px)),
    iy = Math.min(b.h - r, py),
    iz = Math.max(-(b.c - r), Math.min(b.c - r, pz));
  let nx = px - ix,
    ny = py - iy,
    nz = pz - iz;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return out.set(px, py, pz); // the bottom, which is never drawn
  nx /= len;
  ny /= len;
  nz /= len;
  const x = ix + nx * r,
    y = iy + ny * r,
    z = iz + nz * r;
  const side = Math.hypot(nx, nz);
  const hx = side > 1e-9 ? nx / side : 0,
    hz = side > 1e-9 ? nz / side : 0;
  const u = x / b.a,
    w = z / b.c;
  const y0 = b.h * TARP.bands[0],
    y1 = b.h * TARP.bands[1];
  // Between the ropes the walls belly out, most in the middle of each wall.
  const belly = y > y0 && y < y1 ? Math.sin((Math.PI * (y - y0)) / (y1 - y0)) : 0;
  let push = TARP.bulge * belly * (nz * nz * (1 - u * u) + nx * nx * (1 - w * w));
  // The ropes pull it in where they go round.
  for (const k of TARP.bands) push -= TARP.pinch * side * Math.exp(-(((y - b.h * k) / 0.22) ** 2));
  // Under the low rope it hangs loose: kicked out at the hem, in folds.
  const skirt = y < y0 ? 1 - y / y0 : 0;
  push += side * skirt * (TARP.flare * skirt + TARP.folds.depth * Math.sin((TAU / TARP.folds.wave) * (x + z) + 0.7));
  // The top rises a little in the middle.
  const lift = TARP.dome * ny * ny * Math.max(0, 1 - u * u) * Math.max(0, 1 - w * w);
  return out.set(x + hx * push, y + lift, z + hz * push);
}

/** The draped canvas: a box with no bottom, every vertex draped. Flat-shaded, like the rest of the toy town. */
export function tarpGeometry(b: FollyBox): THREE.BufferGeometry {
  const seg = (m: number) => Math.max(4, Math.ceil(m / TARP.step));
  const g = new THREE.BoxGeometry(2 * b.a, b.h, 2 * b.c, seg(2 * b.a), seg(b.h), seg(2 * b.c));
  g.translate(0, b.h / 2, 0);
  // BoxGeometry's groups are +x, −x, +y, −y, +z, −z: the bottom (−y) stays on the ground, unseen.
  const index = g.getIndex()!;
  const keep: number[] = [];
  g.groups.forEach((gr, i) => {
    if (i !== 3) for (let k = gr.start; k < gr.start + gr.count; k++) keep.push(index.getX(k));
  });
  g.setIndex(keep);
  g.clearGroups();
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    drape(pos.getX(i), pos.getY(i), pos.getZ(i), b, v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Round the box's foot at one height: points every `step` metres, with the way out (x, z) at each. */
export function perimeter(b: FollyBox, step = 0.5): { x: number; z: number; nx: number; nz: number }[] {
  const r = roundOf(b),
    ax = b.a - r,
    cz = b.c - r;
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  const arc = (cx: number, cz0: number, from: number) => {
    const n = Math.max(3, Math.ceil((r * Math.PI) / 2 / (step * 0.6)));
    for (let i = 0; i < n; i++) {
      const t = from + (i / n) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(t) * r, z: cz0 + Math.sin(t) * r, nx: Math.cos(t), nz: Math.sin(t) });
    }
  };
  const edge = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let i = 0; i < n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz });
  };
  // Counter-clockwise from above, starting on the right-hand wall's front corner.
  arc(ax, cz, 0);
  edge(ax, b.c, -ax, b.c, 0, 1);
  arc(-ax, cz, Math.PI / 2);
  edge(-b.a, cz, -b.a, -cz, -1, 0);
  arc(-ax, -cz, Math.PI);
  edge(-ax, -b.c, ax, -b.c, 0, -1);
  arc(ax, -cz, (3 * Math.PI) / 2);
  edge(b.a, -cz, b.a, cz, 1, 0);
  return out;
}

/** A closed rope through `points`, `radius` thick. */
function ropeTube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  const g = new THREE.TubeGeometry(curve, points.length * 2, radius, 6, true);
  g.deleteAttribute('uv');
  return g;
}

/** The two gold ropes round the canvas, lying in the grooves they pinch, and their ink rims (drawn from the inside, so only the edge shows). */
export function tarpBands(b: FollyBox): { rope: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const ropes: THREE.BufferGeometry[] = [],
    rims: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (const k of TARP.bands) {
    const y = b.h * k;
    const pts = perimeter(b, 0.6).map((p) => {
      drape(p.x, y, p.z, b, v);
      return new THREE.Vector3(v.x + p.nx * TARP.rope * 0.8, v.y, v.z + p.nz * TARP.rope * 0.8);
    });
    ropes.push(ropeTube(pts, TARP.rope));
    rims.push(ropeTube(pts, TARP.rope + TARP.rim));
  }
  return { rope: merge(ropes), rim: merge(rims) };
}

// ---- the crown ---------------------------------------------------------------------------------

// The gold side's crown (sideMarks.ts CROWN, the tag icon), 1 m across its band, its base on y = 0:
// a band with three points and a ball on each. The same crown everywhere: tag, tarp, plaque.
const CROWN_OUTLINE: [number, number][] = [
  [-0.5, 0],
  [0.5, 0],
  [0.5, 0.571],
  [0.25, 0.357],
  [0, 0.702],
  [-0.25, 0.357],
  [-0.5, 0.571],
];
const CROWN_BALLS: [number, number][] = [
  [-0.5, 0.643],
  [0, 0.774],
  [0.5, 0.643],
];
const CROWN_BALL = 0.107;
/** The crown's full size, balls included, in crown units (1 = the band's width). */
export const CROWN_SIZE = { w: 1 + 2 * CROWN_BALL, h: 0.774 + CROWN_BALL };
/** Its ink rim on the tarp, in crown units. */
const CROWN_RIM = 0.06;

/** A counter-clockwise polygon grown outward by `d` (mitred, the sharp points capped). */
export function grow(points: [number, number][], d: number): [number, number][] {
  return points.map(([x, y], i) => {
    const [px, py] = points[(i + points.length - 1) % points.length],
      [qx, qy] = points[(i + 1) % points.length];
    const l1 = Math.hypot(x - px, y - py),
      l2 = Math.hypot(qx - x, qy - y);
    // Outward normals of the edges either side (counter-clockwise: the outside is on the right).
    const n1x = (y - py) / l1,
      n1y = -(x - px) / l1,
      n2x = (qy - y) / l2,
      n2y = -(qx - x) / l2;
    let mx = n1x + n2x,
      my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const miter = Math.min(2.5 * d, d / Math.max(0.2, mx * n1x + my * n1y));
    return [x + mx * miter, y + my * miter];
  });
}

/** The crown as a flat shape in x/y, facing +z, in crown units; `rim` grows it (for its ink edge). */
export function crownGeometry(rim = 0): THREE.BufferGeometry {
  const body = new THREE.Shape(grow(CROWN_OUTLINE, rim).map(([x, y]) => new THREE.Vector2(x, y)));
  const balls = CROWN_BALLS.map(([x, y]) => new THREE.Shape().absarc(x, y, CROWN_BALL + rim, 0, TAU, false));
  return new THREE.ShapeGeometry([body, ...balls], 10);
}

/** Lay a crown's vertices on the canvas: `at` maps crown units to a point on the box's surface (before the drape). */
function onCanvas(g: THREE.BufferGeometry, b: FollyBox, at: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3, lift: THREE.Vector3): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    at(pos.getX(i), pos.getY(i), v);
    drape(v.x, v.y, v.z, b, v).add(lift);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/**
 * The giant crown stencilled on the canvas, gold edged in ink: on the front, as tall as the taut
 * canvas between the ropes allows; and on the top, upright as the stream's camera sees it (its points
 * away from the front), because from 40° up the top is the biggest thing a phone sees of the tarp.
 */
export function tarpCrowns(b: FollyBox): THREE.BufferGeometry {
  const r = roundOf(b);
  const y0 = b.h * TARP.bands[0],
    y1 = b.h * TARP.bands[1];
  const front = Math.min(((y1 - y0) * 0.72) / CROWN_SIZE.h, ((b.a - r) * 2 * 0.62) / CROWN_SIZE.w);
  const base = (y0 + y1) / 2 - (CROWN_SIZE.h * front) / 2;
  const top = Math.min(((b.a - r) * 2 * 0.66) / CROWN_SIZE.w, ((b.c - r) * 2 * 0.72) / CROWN_SIZE.h);
  const mid = (CROWN_SIZE.h * top) / 2;
  const parts: THREE.BufferGeometry[] = [];
  for (const [rim, hex, lift] of [
    [CROWN_RIM, INK, 0.025],
    [0, GOLD, 0.045],
  ] as const) {
    parts.push(painted(onCanvas(crownGeometry(rim), b, (x, y, o) => o.set(x * front, base + y * front, b.c), new THREE.Vector3(0, 0, lift)), hex));
    parts.push(painted(onCanvas(crownGeometry(rim), b, (x, y, o) => o.set(x * top, b.h, mid - y * top), new THREE.Vector3(0, lift, 0)), hex));
  }
  return merge(parts);
}

// ---- the cordon, the sign and the plaque ---------------------------------------------------------

export const CORDON = {
  /** Inside the plot's edge (m), so the rope stays on the Folly's own ground. */
  inset: 0.3,
  /** A stake at every corner and at most this far apart. */
  every: 2,
  stake: { w: 0.14, h: 1.12 },
  knob: 0.26,
  /** The rope: its height at the stakes, how far it sags between them, how thick, its ink rim. */
  ropeY: 1.02,
  sag: 0.13,
  rope: 0.045,
  rim: 0.03,
  /** Pennants hung from the rope, so many a span, gold and ink by turns, swaying about the rope. */
  pennant: { w: 0.36, h: 0.46, per: 3 },
  sway: { amp: 0.3, hz: 0.55 },
} as const;
/** The cordon's half-side on a plot `plot` metres square. */
export const cordonHalf = (plot: number) => plot / 2 - CORDON.inset;

/** The stakes round a square of half-side `half`: one at each corner and evenly between, never more than `every` apart; counter-clockwise from the front-left corner. */
export function cordonStakes(half: number, every: number = CORDON.every): GroundPoint[] {
  const n = Math.max(1, Math.ceil((2 * half) / every - 1e-9));
  const corners: [number, number][] = [
    [-half, half],
    [half, half],
    [half, -half],
    [-half, -half],
  ];
  const out: GroundPoint[] = [];
  for (let s = 0; s < 4; s++) {
    const [x0, z0] = corners[s],
      [x1, z1] = corners[(s + 1) % 4];
    for (let i = 0; i < n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
  }
  return out;
}
/** The rope's height `u` (0..1) of the way along a span. */
const ropeY = (u: number) => CORDON.ropeY - CORDON.sag * 4 * u * (1 - u);

/** Where each pennant hangs (the rope's span it hangs in, how far along, its turn) and its colour. */
export function pennantPlaces(stakes: GroundPoint[]): { x: number; y: number; z: number; turn: number; gold: boolean }[] {
  const out: { x: number; y: number; z: number; turn: number; gold: boolean }[] = [];
  for (let i = 0; i < stakes.length; i++) {
    const a = stakes[i],
      b = stakes[(i + 1) % stakes.length];
    for (let k = 1; k <= CORDON.pennant.per; k++) {
      const u = k / (CORDON.pennant.per + 1);
      out.push({ x: lerp(a.x, b.x, u), y: ropeY(u) - 0.02, z: lerp(a.z, b.z, u), turn: Math.atan2(-(b.z - a.z), b.x - a.x), gold: out.length % 2 === 0 });
    }
  }
  return out;
}

/** The sign: 4 × 1.6 m, its face 1 m up, standing in front of the cordon's left half, turned a little toward the stream's camera. */
export const SIGN = {
  w: 4,
  h: 1.6,
  lift: 1,
  frame: 0.14,
  at: { x: -4.4, z: 8.75 },
  turn: 0.35,
  lines: ['KEEP OUT.', 'SOMETHING AMAZING.'],
} as const;
/** The only thing about the sign that changes with the age: what its frame (and its posts) are made of. */
export const SIGN_FRAME: Record<AgeId, string> = {
  stone: '#8A5E3B', // lashed timber
  bronze: '#B0702F', // cast bronze
  medieval: '#5C3B22', // dark oak
  industrial: '#454B52', // riveted iron
  modern: '#D9DEE3', // painted steel
  future: '#8C4A2A', // rusted scrap
};
export const signFrame = (age: number): string => SIGN_FRAME[AGE_IDS[clampAge(age)]];

/** The plaque: a gold plate, edged in ink, with a crown emboss, on an ink stand in front of the cordon's right half, leaning back to be read. */
export const PLAQUE = { at: { x: 4.4, z: 8.75 }, stand: { w: 1.1, h: 0.95, d: 0.55 }, plate: { w: 1.36, h: 0.86 }, tilt: 0.5 } as const;

const m4 = new THREE.Matrix4(),
  quat = new THREE.Quaternion(),
  euler = new THREE.Euler(),
  vec = new THREE.Vector3(),
  ONE = new THREE.Vector3(1, 1, 1);

/** A part as geometry where it stands, painted. */
function part(shape: Primitive['shape'], position: Vec3, size: Vec3, hex: string, rotation: Vec3 = [0, 0, 0], order: THREE.EulerOrder = 'XYZ'): THREE.BufferGeometry {
  const g = primitiveGeometry({ shape, position: [0, 0, 0], size, rotation: [0, 0, 0], color: hex }, true);
  g.applyMatrix4(m4.compose(vec.set(...position), quat.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2], order)), ONE));
  return painted(g, hex);
}
/** A point in a piece's own frame (turned by `turn`, standing at `at`) in the Folly's frame. */
const placed = (at: { x: number; z: number }, turn: number, x: number, y: number, z: number): Vec3 => [at.x + x * Math.cos(turn) + z * Math.sin(turn), y, at.z - x * Math.sin(turn) + z * Math.cos(turn)];

/** Everything of the kit that never moves, as one geometry in vertex colours: the stakes and their knobs, the sign's frame and posts, the plaque. */
export function kitGeometry(stakes: GroundPoint[], age: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of stakes) {
    parts.push(part('box', [s.x, CORDON.stake.h / 2, s.z], [CORDON.stake.w, CORDON.stake.h, CORDON.stake.w], INK));
    parts.push(part('sphere', [s.x, CORDON.stake.h + 0.04, s.z], [CORDON.knob, CORDON.knob, CORDON.knob], GOLD));
  }
  // The sign: two posts, a back board and a frame round the face, all in the age's material.
  const frame = signFrame(age),
    t = SIGN.turn,
    cy = SIGN.lift + SIGN.h / 2,
    f = SIGN.frame;
  const at = (x: number, y: number, z: number) => placed(SIGN.at, t, x, y, z);
  for (const x of [-SIGN.w * 0.36, SIGN.w * 0.36]) parts.push(part('box', at(x, (SIGN.lift + 0.2) / 2, -0.14), [0.16, SIGN.lift + 0.2, 0.16], frame, [0, t, 0]));
  parts.push(part('box', at(0, cy, -0.07), [SIGN.w + 2 * f, SIGN.h + 2 * f, 0.1], frame, [0, t, 0]));
  for (const y of [cy + SIGN.h / 2 + f / 2, cy - SIGN.h / 2 - f / 2]) parts.push(part('box', at(0, y, 0), [SIGN.w + 2 * f, f, 0.14], frame, [0, t, 0]));
  for (const x of [SIGN.w / 2 + f / 2, -SIGN.w / 2 - f / 2]) parts.push(part('box', at(x, cy, 0), [f, SIGN.h, 0.14], frame, [0, t, 0]));
  // The plaque: an ink stand, and on it the plate leaning back, edged in ink, the crown embossed in deep gold.
  const p = PLAQUE;
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -p.tilt);
  // The plate's centre, its bottom edge resting on the stand's top; a point `z` in front of its face.
  const centre = new THREE.Vector3(p.at.x, p.stand.h + (p.plate.h / 2) * Math.cos(p.tilt) - 0.05, p.at.z + 0.05);
  const onPlate = (y: number, z: number): Vec3 => new THREE.Vector3(0, y, z).applyQuaternion(lean).add(centre).toArray() as Vec3;
  parts.push(part('box', [p.at.x, p.stand.h / 2, p.at.z], [p.stand.w, p.stand.h, p.stand.d], INK));
  parts.push(part('box', onPlate(0, 0), [p.plate.w + 0.12, p.plate.h + 0.12, 0.06], INK, [-p.tilt, 0, 0]));
  parts.push(part('box', onPlate(0, 0.03), [p.plate.w, p.plate.h, 0.06], GOLD, [-p.tilt, 0, 0]));
  const emboss = crownGeometry(0);
  const s = (p.plate.h * 0.62) / CROWN_SIZE.h;
  emboss.applyMatrix4(m4.compose(vec.set(...onPlate((-CROWN_SIZE.h * s) / 2, 0.066)), lean, new THREE.Vector3(s, s, s)));
  parts.push(painted(emboss, GOLD_DEEP));
  return merge(parts);
}

/** The cordon's gold rope from stake to stake, sagging between, and its ink rim. */
export function cordonRope(stakes: GroundPoint[]): { rope: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < stakes.length; i++) {
    const a = stakes[i],
      b = stakes[(i + 1) % stakes.length];
    for (let k = 0; k < 4; k++) {
      const u = k / 4;
      pts.push(new THREE.Vector3(lerp(a.x, b.x, u), ropeY(u), lerp(a.z, b.z, u)));
    }
  }
  return { rope: ropeTube(pts, CORDON.rope), rim: ropeTube(pts, CORDON.rope + CORDON.rim) };
}

/** The sign's face: gold, an ink line inside its edge, the two lines in ink (Fredoka 700), each as big as the face allows. */
function drawSignFace(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width,
    H = canvas.height;
  g.fillStyle = GOLD;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = INK;
  g.lineWidth = 14;
  g.beginPath();
  g.roundRect(22, 22, W - 44, H - 44, 30);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = (text: string, size: number, y: number) => {
    g.font = `700 ${size}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
    const k = Math.min(1, (W - 120) / g.measureText(text).width);
    g.font = `700 ${Math.floor(size * k)}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
    g.fillText(text, W / 2, y);
  };
  fit(SIGN.lines[0], 168, H * 0.37);
  fit(SIGN.lines[1], 112, H * 0.72);
}

// ---- the beam ----------------------------------------------------------------------------------

/** The gold beam up from the Folly: thin and faint while the cordon is up; wide, stronger and pulsing through the Unveiling's Call. */
export const BEAM = { height: 60, up: { r: 0.6, a: 0.2 }, call: { r: 1.6, a: 0.45, hz: 0.4 }, ease: 2.5 } as const;
/** The beam's radius (m) and opacity, `call` 0 (the cordon up) … 1 (a Call), `t` seconds; held at its peak when still. */
export function beamLook(call: number, t: number, still = false): { r: number; a: number } {
  const k = clamp01(call);
  const wave = still ? 1 : 0.5 + 0.5 * Math.cos(TAU * BEAM.call.hz * t);
  return { r: lerp(BEAM.up.r, BEAM.call.r * (0.96 + 0.04 * wave), k), a: lerp(BEAM.up.a, BEAM.call.a * (0.7 + 0.3 * wave), k) };
}
/** A unit beam: an open tube a metre high, fading out toward the top (alpha in its vertex colours). */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 8, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) col.set([1, 1, 1, (1 - clamp01(pos.getY(i))) ** 1.4], i * 4);
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.deleteAttribute('uv');
  return g;
}

// ---- the drop ----------------------------------------------------------------------------------

export const DROP = {
  /** The tarp falls in this long, lies in a heap a second, then sinks away. */
  ms: 400,
  settle: 1000,
  sink: 600,
  /** Six big dust puffs as it lands, each a puff of `size` metres growing as it rises and fades. */
  puffs: 6,
  puffAt: 320,
  puffMs: 1600,
  puffSize: [1.2, 2.8],
  /** Gold confetti off the top as it falls away: at most 24 big pieces, fluttering down. */
  confetti: 24,
  confettiAt: 240,
  piece: { w: 0.72, h: 0.46 },
  /** Fall no faster than this (m/s): confetti flutters, it doesn't drop; down from an 11 m Folly in about 4 s. */
  flutter: 3.2,
  /** How long a piece lies on the ground before it goes; the whole show is over by `life`. */
  lie: 1000,
  life: 6500,
} as const;
/** The tarp `t` ms after the beat: its height (1 standing … a heap … 0 gone) and how far it has spread. */
export function dropPose(t: number): { y: number; xz: number; gone: boolean } {
  if (t <= 0) return { y: 1, xz: 1, gone: false };
  if (t < DROP.ms) {
    const e = (t / DROP.ms) ** 2; // falling: slow, then fast
    return { y: 1 - 0.94 * e, xz: 1 + 0.1 * e, gone: false };
  }
  const s = (t - DROP.ms - DROP.settle) / DROP.sink;
  if (s <= 0) return { y: 0.06, xz: 1.1, gone: false };
  if (s < 1) return { y: 0.06 * (1 - s), xz: 1.1 - 0.12 * s, gone: false };
  return { y: 0, xz: 1, gone: true };
}

/** A steady random for the confetti, so a drop is the same every time (and in tests). */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- helpers -------------------------------------------------------------------------------------

/** A geometry ready to merge with others: no index, no uv, normals, every vertex painted `hex`. */
function painted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute('uv');
  out.computeVertexNormals();
  const c = new THREE.Color(hex);
  const n = out.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
/** Many geometries as one (and the parts freed). */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list) ?? new THREE.BufferGeometry();
  for (const x of list) x.dispose();
  g.computeBoundingSphere();
  return g;
}

// ---- one Folly's look ----------------------------------------------------------------------------

/** What the page knows of a Folly: its tarp's full box, the timer (0..100), whether it is under wraps, the town's age. */
export interface FollyState {
  box: FollyBox;
  pct: number;
  wrapped: boolean;
  age: number;
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  landed?: number;
}

/**
 * One Folly's cordon, tarp, sign, plaque and beam, standing at its spot (the props' frame: the
 * Folly's centre, its front toward +z). `build`: a build of its own to show once unveiled (the
 * demo's; a real Folly's build is the objects layer's).
 */
export class FollyLook {
  readonly group = new THREE.Group();
  /** The canvas and everything on it (crowns, ropes): what the drop squashes. */
  readonly tarp = new THREE.Group();
  readonly beam: THREE.Mesh;
  readonly pennants: THREE.InstancedMesh;
  readonly face: THREE.Mesh;
  readonly kit: THREE.Mesh;
  readonly dust: THREE.InstancedMesh;
  readonly confetti: THREE.InstancedMesh;
  private readonly canvas: THREE.Mesh;
  private readonly crowns: THREE.Mesh;
  private readonly bands: THREE.Mesh;
  private readonly bandRim: THREE.Mesh;
  private readonly stakes: GroundPoint[];
  private readonly places: ReturnType<typeof pennantPlaces>;
  private full?: FollyBox;
  /** The growth the tarp was last built at, and the box it was built over. */
  private built?: { grow: number; box: FollyBox; size: FollyBox };
  private grow = 1;
  private growTo = 1;
  private wrapped?: boolean;
  private age = Number.NaN;
  private dropAt?: number;
  private drops = 0;
  private callMix = 0;
  private lastNow?: number;
  private swaying = true;
  private bits: Bit[] = [];
  private puffsAt: { x: number; z: number }[] = [];
  private readonly scratch = new THREE.Object3D();

  constructor(
    parent: THREE.Object3D,
    at: GroundPoint,
    plot: number,
    private readonly build?: THREE.Object3D,
  ) {
    this.group.position.set(at.x, 0, at.z);
    this.group.name = 'folly-look';
    parent.add(this.group);
    if (build) this.group.add(build);
    this.stakes = cordonStakes(cordonHalf(plot));
    this.places = pennantPlaces(this.stakes);

    const flat = (hex: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, flatShading: true, ...extra });
    const lit = (extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...extra });
    const rim = (hex: string) => new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide });

    // The tarp: the canvas (casts the Folly's big shadow), the crowns, the ropes and their rims.
    this.canvas = new THREE.Mesh(new THREE.BufferGeometry(), flat(CANVAS));
    this.canvas.castShadow = this.canvas.receiveShadow = true;
    this.crowns = new THREE.Mesh(new THREE.BufferGeometry(), lit({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.crowns.receiveShadow = true;
    this.bands = new THREE.Mesh(new THREE.BufferGeometry(), flat(GOLD, { roughness: 0.6 }));
    this.bandRim = new THREE.Mesh(new THREE.BufferGeometry(), rim(INK));
    this.tarp.add(this.canvas, this.crowns, this.bands, this.bandRim);
    this.group.add(this.tarp);

    // The cordon, the sign's frame and the plaque, merged; the rope and its rim; the pennants.
    this.kit = new THREE.Mesh(new THREE.BufferGeometry(), lit({ roughness: 0.85 }));
    this.kit.castShadow = this.kit.receiveShadow = true;
    const rope = cordonRope(this.stakes);
    const ropeMesh = new THREE.Mesh(rope.rope, flat(GOLD, { roughness: 0.6 }));
    const ropeRim = new THREE.Mesh(rope.rim, rim(INK));
    const tri = new THREE.BufferGeometry();
    const { w, h } = CORDON.pennant;
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, 0, -h, 0], 3));
    tri.computeVertexNormals();
    this.pennants = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), this.places.length);
    const colour = new THREE.Color();
    this.places.forEach((p, i) => this.pennants.setColorAt(i, colour.set(p.gold ? GOLD : INK)));
    this.pose(0, false);

    // The sign's face: unlit, so the gold and the ink are the locked colours whatever the light.
    const faceMat = new THREE.MeshBasicMaterial({ color: GOLD, toneMapped: false });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.w, SIGN.h), faceMat);
    this.face.position.set(...placed(SIGN.at, SIGN.turn, 0, SIGN.lift + SIGN.h / 2, 0.075));
    this.face.rotation.y = SIGN.turn;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 410;
      drawSignFace(c);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      faceMat.map = tex;
      faceMat.color.set('#ffffff');
      faceMat.needsUpdate = true;
      // Redrawn once Fredoka has loaded (the story look asks for it), so it never stays in a fallback face.
      document.fonts?.load('700 168px Fredoka').then(
        () => {
          drawSignFace(c);
          tex.needsUpdate = true;
        },
        () => undefined,
      );
    }

    // The beam: unlit gold, no depth written, so it glows over whatever is behind it and the tarp hides its foot.
    this.beam = new THREE.Mesh(beamGeometry(), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: BEAM.up.a, depthWrite: false, vertexColors: true, toneMapped: false }));
    this.beam.renderOrder = 2;

    // The drop's dust (six puffs, one draw call: they rise and fade together) and its confetti.
    this.dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), flat(DUST, { transparent: true, depthWrite: false, roughness: 1 }), DROP.puffs);
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(DROP.piece.w, DROP.piece.h), new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), DROP.confetti);
    for (let i = 0; i < DROP.confetti; i++) this.confetti.setColorAt(i, colour.set(i % 3 === 2 ? GOLD_DEEP : GOLD));
    this.dust.visible = this.confetti.visible = false;
    this.dust.frustumCulled = this.confetti.frustumCulled = false;

    this.group.add(this.kit, ropeMesh, ropeRim, this.pennants, this.face, this.beam, this.dust, this.confetti);
  }

  /** Under the tarp (or not), how far the timer is, the tarp's full box, the age: the drop when it comes off. `now`: page time (ms). */
  set(s: FollyState, now: number): void {
    if (s.age !== this.age) {
      this.age = s.age;
      this.kit.geometry.dispose();
      this.kit.geometry = kitGeometry(this.stakes, s.age);
    }
    this.full = s.box;
    this.growTo = growthOf(s.pct);
    const first = this.wrapped === undefined;
    if (this.wrapped === true && !s.wrapped) {
      // The `unveil` beat: the tarp drops, from its full size (the server fills the timer as it unveils).
      this.grow = this.growTo = 1;
      this.dropAt = now;
      this.drops++;
      this.bits = [];
      this.puffsAt = [];
    } else if (!first && !this.wrapped && s.wrapped) {
      // Back under wraps (Story (dev)'s Re-tarp, the demo's next round): at once, no drop left playing.
      this.dropAt = undefined;
      this.grow = this.growTo;
      this.dust.visible = this.confetti.visible = false;
    }
    if (first) this.grow = this.growTo;
    this.wrapped = s.wrapped;
    if (this.build) this.build.visible = !s.wrapped;
  }

  /** Is the tarp dropping (or its dust and confetti still about)? */
  get dropping(): boolean {
    return this.dropAt !== undefined;
  }
  /** Is it under wraps? */
  get underWraps(): boolean {
    return this.wrapped === true;
  }

  /** Per frame (`now` page ms): the tarp grows with the timer, the beam answers a Call, the pennants sway (not while `still`: a scene), the drop plays. */
  update(now: number, call: boolean, still: boolean, reduced: boolean): void {
    const dt = this.lastNow === undefined ? 0 : Math.max(0, Math.min(0.1, (now - this.lastNow) / 1000));
    this.lastNow = now;
    if (!this.full) return;
    // The tarp grows with the Folly's timer, eased, so Story (dev)'s jump to 100 grows rather than pops.
    if (this.grow !== this.growTo) {
      this.grow = reduced ? this.growTo : this.grow + (this.growTo - this.grow) * (1 - Math.exp(-dt * 3));
      if (Math.abs(this.growTo - this.grow) < 0.002) this.grow = this.growTo;
    }
    const size = grownBox(this.full, this.grow);
    const drop = this.dropAt === undefined ? undefined : now - this.dropAt;
    const b = this.built;
    // Rebuilt when it has grown a percent (or its box changed); in between it is stretched the last little way.
    if ((this.wrapped || drop !== undefined) && (!b || Math.abs(b.grow - this.grow) >= 0.01 || !sameBox(b.box, this.full))) this.rebuild(size);
    const k = this.built?.size ?? size;
    if (this.wrapped) {
      this.tarp.visible = true;
      this.tarp.scale.set(size.a / k.a, size.h / k.h, size.c / k.c);
    } else if (drop === undefined || reduced) this.tarp.visible = false;
    else {
      const p = dropPose(drop);
      this.tarp.visible = !p.gone;
      this.tarp.scale.set((p.xz * size.a) / k.a, (p.y * size.h) / k.h, (p.xz * size.c) / k.c);
    }

    // The beam: up while it is under wraps, wide and pulsing through a Call; it fades out as the tarp falls.
    const want = this.wrapped && call ? 1 : 0;
    this.callMix = reduced ? want : this.callMix + (want - this.callMix) * (1 - Math.exp(-dt * BEAM.ease));
    const fade = this.wrapped ? 1 : drop === undefined || reduced ? 0 : 1 - clamp01(drop / DROP.ms);
    const look = beamLook(this.callMix, now / 1000, still || reduced);
    this.beam.visible = fade > 0;
    this.beam.scale.set(look.r, BEAM.height, look.r);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = look.a * fade;

    // The pennants: a slow sway about the rope, a ripple running round; still in a scene.
    const sway = !still && !reduced;
    if (sway || this.swaying) this.pose(sway ? now / 1000 : 0, sway);

    if (drop !== undefined) this.playDrop(drop, now, dt, reduced);
  }

  /** The canvas, its crowns and ropes, built over `size` (the box at this growth). */
  private rebuild(size: FollyBox): void {
    this.canvas.geometry.dispose();
    this.canvas.geometry = tarpGeometry(size);
    this.crowns.geometry.dispose();
    this.crowns.geometry = tarpCrowns(size);
    const bands = tarpBands(size);
    this.bands.geometry.dispose();
    this.bands.geometry = bands.rope;
    this.bandRim.geometry.dispose();
    this.bandRim.geometry = bands.rim;
    this.built = { grow: this.grow, box: { ...this.full! }, size };
  }

  /** The pennants at `t` seconds: swaying, or (`sway` false) hanging straight down. */
  private pose(t: number, sway: boolean): void {
    const o = this.scratch;
    o.rotation.order = 'YXZ';
    o.scale.setScalar(1); // the drop's dust and confetti share the scratch
    this.places.forEach((p, i) => {
      const swing = sway ? CORDON.sway.amp * Math.sin(TAU * CORDON.sway.hz * t - i * 0.45) : 0;
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(swing, p.turn, 0);
      o.updateMatrix();
      this.pennants.setMatrixAt(i, o.matrix);
    });
    this.pennants.instanceMatrix.needsUpdate = true;
    this.swaying = sway;
  }

  /** The dust and the confetti, `t` ms after the beat. */
  private playDrop(t: number, now: number, dt: number, reduced: boolean): void {
    if (reduced || t > DROP.life) {
      this.dropAt = undefined;
      this.dust.visible = this.confetti.visible = false;
      return;
    }
    const box = this.full!;
    const o = this.scratch;
    o.rotation.order = 'XYZ';
    // Six big puffs round the foot, the front ones first in line for the camera.
    const k = (t - DROP.puffAt) / DROP.puffMs;
    this.dust.visible = k >= 0 && k < 1;
    if (this.dust.visible) {
      if (!this.puffsAt.length)
        this.puffsAt = [
          { x: -0.55 * box.a, z: box.c + 0.6 },
          { x: 0.55 * box.a, z: box.c + 0.6 },
          { x: -box.a - 0.6, z: 0.15 * box.c },
          { x: box.a + 0.6, z: 0.15 * box.c },
          { x: -0.4 * box.a, z: -box.c - 0.6 },
          { x: 0.4 * box.a, z: -box.c - 0.6 },
        ];
      const out = 1 - (1 - k) ** 2;
      const size = lerp(DROP.puffSize[0], DROP.puffSize[1], out);
      this.puffsAt.forEach((p, i) => {
        o.position.set(p.x * (1 + 0.15 * out), 0.5 + 1.5 * out, p.z * (1 + 0.15 * out));
        o.rotation.set(0, i, 0);
        o.scale.set(size, size * 0.8, size);
        o.updateMatrix();
        this.dust.setMatrixAt(i, o.matrix);
      });
      this.dust.instanceMatrix.needsUpdate = true;
      (this.dust.material as THREE.MeshStandardMaterial).opacity = 0.9 * (1 - k) ** 1.5;
    }
    // The confetti: up off the top as the tarp falls away, then fluttering down to lie a moment on the ground.
    if (t < DROP.confettiAt) return;
    if (!this.bits.length) {
      const r = random(this.drops * 7919 + 17);
      for (let i = 0; i < DROP.confetti; i++) {
        const x = (r() - 0.5) * 1.2 * box.a,
          z = (r() - 0.5) * 1.2 * box.c;
        this.bits.push({ x, y: box.h + 0.3, z, vx: (x / box.a) * 2.6 + (r() - 0.5) * 1.6, vy: 3 + r() * 2.5, vz: (z / box.c) * 2.6 + (r() - 0.5) * 1.6, rx: r() * TAU, ry: r() * TAU, rz: r() * TAU, sx: 3 + r() * 5, sy: 2 + r() * 4 });
      }
    }
    let live = 0;
    this.bits.forEach((b, i) => {
      if (b.landed === undefined) {
        b.vy = Math.max(-DROP.flutter, b.vy - 9.8 * dt);
        const drag = Math.exp(-dt * 1.2);
        b.vx *= drag;
        b.vz *= drag;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        b.rx += b.sx * dt;
        b.rz += b.sy * dt;
        if (b.y <= 0.06 && b.vy < 0) {
          b.y = 0.06;
          b.landed = now;
          b.rx = -Math.PI / 2;
          b.rz = 0;
        }
      }
      const gone = b.landed !== undefined && now - b.landed > DROP.lie;
      if (!gone) live++;
      o.position.set(b.x, b.y, b.z);
      o.rotation.set(b.rx, b.ry, b.rz);
      o.scale.setScalar(gone ? 0 : 1);
      o.updateMatrix();
      this.confetti.setMatrixAt(i, o.matrix);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    this.confetti.visible = live > 0;
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const m = child.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.dispose();
    });
    this.group.removeFromParent();
  }
}
const sameBox = (a: FollyBox, b: FollyBox) => Math.abs(a.a - b.a) < 1e-6 && Math.abs(a.c - b.c) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;

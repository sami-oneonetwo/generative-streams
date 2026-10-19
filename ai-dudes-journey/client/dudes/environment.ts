// The forest the group walks through. The trail and every tree come from the journey's seed
// (src/shared/trail.ts), the same functions the server routes with, so the trees drawn here are the
// ones characters walk round and chop. The ground is laid in 40 m chunks along the path: a mown
// glade, a dirt path down the middle, tufts and flowers, the edge trees and boulders, and dense
// forest either side. Chunks stream in ahead of the camera and are dropped behind it; each chunk is a
// handful of instanced draw calls. A chunk is rebuilt when one of its edge trees is felled.
// The sun's shadow box follows the camera's framing (`frame`), so shadows stay crisp at any zoom.

import * as THREE from 'three';
import { chunkOf, sceneryChunk, seeded, trailX, TRAIL, type SceneryItem } from '../../src/shared/trail';
import type { JourneyView } from './types';

export interface EnvironmentHandles {
  world: THREE.Group;
  /** Per frame: keep the sun's shadow box on what the camera is framing, and the forest round it. */
  frame(x: number, z: number, half: number): void;
  /** Where the group is and which trees are down: from every applied snapshot. */
  journey(view: JourneyView | undefined): void;
  update(now: number, reducedMotion: boolean): void;
}

const MOWN = 0x6d8a4f,
  MEADOW = 0x5f7444,
  DIRT = 0x9a7f5a,
  DIRT_EDGE = 0x7f7a4f,
  SKY = 0xb9c2a6;
const TUFTS = [0x5f7a45, 0x84955c, 0x6b8549, 0x8a8a58];
const FLOWERS = [0xe9e2c9, 0xd9c26a, 0xc98f8a, 0xb7a6c9];
const LEAVES = [0x4f6440, 0x5e6f4d, 0x697b55, 0x77875c, 0x627452];
const PINES = [0x3d5a3f, 0x456546, 0x4c6b48];
const BARK = 0x655b49,
  BIRCH_BARK = 0xd9d4c4,
  STONE = [0x8a8a82, 0x7d7c74, 0x96948a];
const SUN_DIR = new THREE.Vector3(-15, 28, 10).normalize();
const SHADOW_MAP = 2048;
/** How far round the view the forest is kept: further ahead (−z), where the camera looks. */
const KEEP_BEHIND = 140,
  KEEP_AHEAD = 220;

// Shared geometry and one white material per kind: instances carry their own colours.
const GEO = {
  trunk: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  blob: new THREE.IcosahedronGeometry(1, 1),
  cone: new THREE.ConeGeometry(1, 1, 7),
  rock: new THREE.DodecahedronGeometry(1, 0),
  tuft: new THREE.ConeGeometry(0.5, 1, 4),
  flower: new THREE.BoxGeometry(1, 1, 1),
};
const material = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const MATS = { trunk: material(), blob: material(), cone: material(), rock: material(), tuft: material(), flower: material() };
const GROUND_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });

interface Chunk {
  i: number;
  group: THREE.Group;
  felledKey: string;
}

/** Instanced copies of one geometry with a colour each. */
function instanced(kind: keyof typeof GEO, count: number, parent: THREE.Object3D, castShadow: boolean) {
  const inst = new THREE.InstancedMesh(GEO[kind], MATS[kind], Math.max(1, count));
  inst.castShadow = castShadow;
  inst.receiveShadow = true;
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
  parent.add(inst);
  const c = new THREE.Color();
  let n = 0;
  return {
    place(m: THREE.Matrix4, color: number) {
      inst.setMatrixAt(n, m);
      inst.setColorAt(n, c.set(color));
      n++;
    },
    finish() {
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
    },
  };
}

/** A strip of ground following the path between z0 and z1 (z1 < z0), `half` metres either side of it. */
function ribbon(seed: number, z0: number, z1: number, half: number, y: number, color: number, edgeColor = color): THREE.Mesh {
  const steps = Math.max(2, Math.ceil((z0 - z1) / 4));
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  const c = new THREE.Color(color),
    e = new THREE.Color(edgeColor);
  for (let k = 0; k <= steps; k++) {
    const z = z0 - ((z0 - z1) * k) / steps;
    const x = trailX(seed, z);
    // Four vertices across: edge, inner, inner, edge, so the edges can be shaded.
    for (const [dx, cc] of [
      [-half, e],
      [-half * 0.7, c],
      [half * 0.7, c],
      [half, e],
    ] as const) {
      pos.push(x + dx, y, z);
      col.push(cc.r, cc.g, cc.b);
    }
    if (k > 0) {
      const a = (k - 1) * 4,
        b = k * 4;
      // Wound so the faces look up (+y).
      for (let q = 0; q < 3; q++) idx.push(a + q, a + q + 1, b + q, a + q + 1, b + q + 1, b + q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, GROUND_MAT);
  m.receiveShadow = true;
  return m;
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const world = new THREE.Group();
  scene.add(world);
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3();
  const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
    m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz));

  // --- the forest floor: one wide plane that moves with the view, under everything ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: MEADOW, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.14;
  floor.receiveShadow = true;
  world.add(floor);

  // --- chunks ---
  let seed: number | undefined;
  let felled = new Set<string>();
  const chunks = new Map<number, Chunk>();
  const felledIn = (i: number) =>
    [...felled]
      .filter((id) => id.startsWith(`s${i}l`) || id.startsWith(`s${i}r`))
      .sort()
      .join(',');

  function drawTree(t: SceneryItem, trunks: ReturnType<typeof instanced>, blobs: ReturnType<typeof instanced>, cones: ReturnType<typeof instanced>, rocks: ReturnType<typeof instanced>, r: () => number) {
    const k = t.scale;
    if (t.kind === 'boulder') {
      compose(t.x, 0.35 * k, t.z, 1.0 * k, 0.75 * k, 0.9 * k, r() * 3, r() * 0.3, r() * 0.3);
      rocks.place(m4, STONE[Math.floor(r() * STONE.length)]);
      return;
    }
    if (t.kind === 'pine') {
      compose(t.x, 1.0 * k, t.z, 0.26 * k, 2.0 * k, 0.26 * k);
      trunks.place(m4, BARK);
      for (let j = 0; j < 3; j++) {
        const w = (1.9 - j * 0.5) * k;
        compose(t.x, (1.9 + j * 1.15) * k, t.z, w, 1.9 * k, w, r() * 3);
        cones.place(m4, PINES[(j + Math.floor(r() * 3)) % PINES.length]);
      }
      return;
    }
    const birch = t.kind === 'birch';
    compose(t.x, 1.3 * k, t.z, (birch ? 0.2 : 0.3) * k, 2.6 * k, (birch ? 0.2 : 0.3) * k);
    trunks.place(m4, birch ? BIRCH_BARK : BARK);
    for (let j = 0; j < 3; j++) {
      const rad = (birch ? 0.9 - j * 0.12 : 1.35 - j * 0.18) * k * (0.9 + r() * 0.25);
      compose(t.x + (j % 2) * 0.3 * k, (2.6 + j * 0.62) * k, t.z + ((j + 1) % 2) * 0.2 * k, rad, rad * 0.85, rad, r() * 3);
      blobs.place(m4, birch ? [0x8fa25c, 0x9aab64, 0x84985a][j] : LEAVES[(j + Math.floor(r() * 5)) % LEAVES.length]);
    }
  }

  function buildChunk(i: number): Chunk {
    const group = new THREE.Group();
    const sd = seed!;
    const z0 = -i * TRAIL.chunk,
      z1 = z0 - TRAIL.chunk;
    // Ground: the glade, a darker fringe, the dirt path. A hair of overlap hides the seams.
    group.add(ribbon(sd, z0 + 0.3, z1 - 0.3, TRAIL.glade + 3, -0.1, MOWN, MEADOW));
    group.add(ribbon(sd, z0 + 0.3, z1 - 0.3, 2.2, -0.08, DIRT, DIRT_EDGE));
    const r = seeded((sd * 31 + i * 7919) >>> 0);
    // Tufts and flowers: on the glade and thicker in the rough beyond it.
    const tufts = instanced('tuft', 120, group, false);
    for (let k = 0; k < 120; k++) {
      const z = z0 - r() * TRAIL.chunk;
      const rough = k % 3 !== 0;
      const side = r() < 0.5 ? -1 : 1;
      const lateral = rough ? TRAIL.glade + 2 + r() * 30 : 3 + r() * (TRAIL.glade - 3);
      const h = rough ? 0.2 + r() * 0.35 : 0.08 + r() * 0.08,
        w = rough ? 0.2 + r() * 0.25 : 0.14 + r() * 0.1;
      compose(trailX(sd, z) + side * lateral, h / 2 - 0.03, z, w, h, w, r() * Math.PI);
      tufts.place(m4, TUFTS[Math.floor(r() * TUFTS.length)]);
    }
    tufts.finish();
    const flowers = instanced('flower', 18, group, false);
    for (let patch = 0; patch < 2; patch++) {
      const z = z0 - r() * TRAIL.chunk,
        x = trailX(sd, z) + (r() < 0.5 ? -1 : 1) * (5 + r() * (TRAIL.glade - 8));
      const color = FLOWERS[Math.floor(r() * FLOWERS.length)];
      for (let j = 0; j < 9; j++) {
        compose(x + (r() - 0.5) * 1.6, 0.05, z + (r() - 0.5) * 1.6, 0.07, 0.07, 0.07);
        flowers.place(m4, color);
      }
    }
    flowers.finish();
    // Trees and boulders: the edge ones (minus any chopped down) and the forest proper.
    const items = sceneryChunk(sd, i).filter((t) => !felled.has(t.id));
    const trunks = instanced('trunk', items.length, group, true),
      blobs = instanced('blob', items.length * 3, group, true),
      cones = instanced('cone', items.length * 3, group, true),
      rocks = instanced('rock', items.length, group, true);
    for (const t of items) drawTree(t, trunks, blobs, cones, rocks, r);
    for (const x of [trunks, blobs, cones, rocks]) x.finish();
    world.add(group);
    return { i, group, felledKey: felledIn(i) };
  }

  function dropChunk(c: Chunk) {
    world.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  /** Keep the chunks round `z` (the view's ground centre) and the camp; drop the rest; rebuild felled ones. */
  function stream(z: number, campZ: number) {
    if (seed === undefined) return;
    const want = new Set<number>();
    for (const at of [z, campZ]) for (let i = chunkOf(at + KEEP_BEHIND); i <= chunkOf(at - KEEP_AHEAD); i++) want.add(i);
    for (const [i, c] of chunks)
      if (!want.has(i) || c.felledKey !== felledIn(i)) {
        dropChunk(c);
        chunks.delete(i);
      }
    // A few new chunks a frame at most, nearest the view first, so a jump never stalls the page.
    const missing = [...want].filter((i) => !chunks.has(i)).sort((a, b) => Math.abs(a - chunkOf(z)) - Math.abs(b - chunkOf(z)));
    for (const i of missing.slice(0, 3)) chunks.set(i, buildChunk(i));
  }

  // --- rivers: water across the glade, sandy banks, the bridge plank by plank, the ice spreading ---
  const riverGroup = new THREE.Group();
  world.add(riverGroup);
  let riverKey = '';
  const foam: { m: THREE.Mesh; z: number; half: number; phase: number }[] = [];
  const WATER = new THREE.MeshStandardMaterial({ color: 0x3f86b0, roughness: 0.35, metalness: 0.05 });
  const SAND = new THREE.MeshStandardMaterial({ color: 0xb9a77a, roughness: 1 });
  const PLANK = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 });
  const ICE = new THREE.MeshStandardMaterial({ color: 0xdff1fb, roughness: 0.15, transparent: true, opacity: 0.92 });
  const FOAM = new THREE.MeshBasicMaterial({ color: 0xe9f6ff, transparent: true, opacity: 0.55 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  function drawRivers(rivers: NonNullable<JourneyView['rivers']>) {
    const key = rivers.map((r) => `${r.id}:${r.z}:${Math.round(r.bridge * 40)}:${Math.round(r.ice * 40)}`).join('|');
    if (key === riverKey || seed === undefined) return;
    riverKey = key;
    riverGroup.clear();
    foam.length = 0;
    const put = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, shadow = false) => {
      const m = new THREE.Mesh(unitBox, mat);
      m.position.set(x, y, z);
      m.scale.set(w, h, d);
      m.receiveShadow = true;
      m.castShadow = shadow;
      riverGroup.add(m);
      return m;
    };
    for (const r of rivers) {
      const mid = trailX(seed, r.z);
      const width = 2 * (TRAIL.glade + 80);
      put(WATER, mid, -0.08, r.z, width, 0.1, r.half * 2, false);
      for (const side of [1, -1]) put(SAND, mid, -0.075, r.z + side * (r.half + 0.7), width, 0.1, 1.4);
      // White streaks drifting downstream.
      for (let k = 0; k < 10; k++) {
        const m = put(FOAM, mid, -0.02, r.z + (((k * 7919) % 100) / 100 - 0.5) * r.half * 1.6, 1.5 + (k % 3), 0.02, 0.18);
        foam.push({ m, z: m.position.z, half: TRAIL.glade + 20, phase: k * 13.7 });
      }
      // The bridge: planks laid out from the near bank (+z) toward the far one; rails once it is done.
      const span = r.half * 2 + 2.4,
        planks = 16,
        laid = Math.round(Math.min(1, r.bridge) * planks);
      for (let k = 0; k < laid; k++) put(PLANK, mid, 0.12, r.z + span / 2 - (k + 0.5) * (span / planks), 3.8, 0.16, span / planks - 0.06, true);
      if (r.bridge >= 1) for (const side of [-1, 1]) put(PLANK, mid + side * 1.85, 0.6, r.z, 0.14, 0.12, span, true);
      // The ice: spreading from the near bank across the whole river.
      if (r.ice > 0) {
        const len = r.half * 2 * Math.min(1, r.ice);
        put(ICE, mid, 0.0, r.z + r.half - len / 2, width, 0.12, len);
      }
    }
  }

  // --- Day light: a bright sky, a warm sun with shadows that follow the framing ---
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 130, 300);
  const hemi = new THREE.HemisphereLight(0xdde3d2, 0x6b7a4f, 2.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  scene.add(sun);
  scene.add(sun.target);
  let shadowHalf = 0;
  let campZ = 0;

  function frame(x: number, z: number, half: number): void {
    // The box only ever grows or shrinks in steps, and its centre snaps to whole texels, so the
    // shadow edges never crawl while the camera eases.
    const h = Math.max(14, Math.min(64, Math.ceil(half / 4) * 4));
    if (h !== shadowHalf) {
      shadowHalf = h;
      Object.assign(sun.shadow.camera, { left: -h, right: h, top: h, bottom: -h });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texel = (2 * h) / SHADOW_MAP;
    const sx = Math.round(x / texel) * texel,
      sz = Math.round(z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + SUN_DIR.x * 70, SUN_DIR.y * 70, sz + SUN_DIR.z * 70);
    floor.position.x = Math.round(x / 20) * 20;
    floor.position.z = Math.round(z / 20) * 20;
    stream(z, campZ);
  }
  frame(0, 0, 40);

  function journey(view: JourneyView | undefined): void {
    if (!view) return;
    if (view.seed !== seed) {
      for (const c of chunks.values()) dropChunk(c);
      chunks.clear();
      seed = view.seed;
    }
    campZ = view.camp.z;
    drawRivers(view.rivers ?? []);
    if (view.felled.length !== felled.size || view.felled.some((id) => !felled.has(id))) felled = new Set(view.felled);
  }

  function update(now: number, reducedMotion: boolean): void {
    // The river runs: foam streaks drift across the glade and come round again.
    if (reducedMotion || seed === undefined) return;
    for (const f of foam) {
      const mid = trailX(seed, f.z);
      const u = (((now * 1.6 + f.phase) % (2 * f.half)) + 2 * f.half) % (2 * f.half);
      f.m.position.x = mid - f.half + u;
    }
  }

  return { world, frame, journey, update };
}

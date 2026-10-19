// The field: an empty, mown meadow where the dudes live. Everything inside FIELD is walkable and
// buildable; beyond it is backdrop — rougher grass, a low hedge ringing the field, and a treeline
// along the far sides (the camera always sits on the +x/+z side, so tall trees go only where they
// can never stand between it and the field). All of it is static and instanced: the whole backdrop
// is a handful of draw calls. The sun's shadow box follows the camera's framing (`frame`), so the
// shadows stay crisp whether the view is on three dudes or the whole field.

import * as THREE from 'three';
import { box, createInstancedBoxes, newMaterialCache } from './primitives';
import { FIELD } from './types';

export interface EnvironmentHandles {
  world: THREE.Group;
  /** Ground rectangle everything playable lives in. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Per frame: keep the sun's shadow box on what the camera is framing (centre, half-size in metres). */
  frame(x: number, z: number, half: number): void;
  update(now: number, reducedMotion: boolean): void;
}

const MOWN = 0x6d8a4f,
  STRIPE = 0x77955a,
  MEADOW = 0x7d8653,
  SKY = 0xb9c2a6;
const TUFTS = [0x5f7a45, 0x84955c, 0x6b8549, 0x8a8a58];
const FLOWERS = [0xe9e2c9, 0xd9c26a, 0xc98f8a, 0xb7a6c9];
const LEAVES = [0x5e6f4d, 0x697b55, 0x77875c, 0x627452];
const HEDGE = [0x4f6a3e, 0x587446, 0x5d7849];
const SUN_DIR = new THREE.Vector3(-15, 28, 10).normalize();
const SHADOW_MAP = 2048;

/** A small seeded generator, so the meadow is the same on every page load. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Instanced copies of one geometry with a colour each; for the trees (trunks and canopies) and tufts. */
function instancedOf(
  geometry: THREE.BufferGeometry,
  count: number,
  parent: THREE.Object3D,
  castShadow: boolean,
): { place: (i: number, m: THREE.Matrix4, color: number) => void; finish: () => void } {
  const inst = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), count);
  inst.castShadow = castShadow;
  inst.receiveShadow = true;
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  parent.add(inst);
  const c = new THREE.Color();
  return {
    place(i, m, color) {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(color));
    },
    finish() {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
    },
  };
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const world = new THREE.Group();
  scene.add(world);
  const cache = newMaterialCache();
  const random = rng(7);
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3();
  const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
    m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz));

  // --- Ground: a wide rough meadow, the mown field a step above it, lighter mowing stripes ---
  const fw = FIELD.maxX - FIELD.minX,
    fd = FIELD.maxZ - FIELD.minZ,
    cx = (FIELD.minX + FIELD.maxX) / 2,
    cz = (FIELD.minZ + FIELD.maxZ) / 2;
  box(420, 0.2, 420, MEADOW, 0, -0.13, 0, world, cache).castShadow = false;
  box(fw + 4, 0.2, fd + 4, MOWN, cx, -0.1, cz, world, cache).castShadow = false;
  {
    // Stripes run along x, four metres wide, every other band a shade lighter.
    const bands = Math.floor((fd + 4) / 4);
    const { place, finish } = createInstancedBoxes(Math.ceil(bands / 2), world, false);
    let n = 0;
    for (let i = 0; i < bands; i += 2) {
      place(n++, cx, 0.003, FIELD.minZ - 2 + i * 4 + 2, fw + 4, 0.006, 4, STRIPE);
    }
    finish();
  }

  // --- Tufts and the odd patch of flowers: one draw call each, no shadows cast ---
  {
    const count = 1600;
    const tufts = instancedOf(new THREE.ConeGeometry(0.5, 1, 4), count, world, false);
    for (let i = 0; i < count; i++) {
      // Most tufts out in the rough, a sprinkling on the mown field.
      const rough = i % 3 !== 0;
      let x: number, z: number;
      if (rough) {
        x = (random() - 0.5) * 190;
        z = (random() - 0.5) * 150;
        if (x > FIELD.minX - 2 && x < FIELD.maxX + 2 && z > FIELD.minZ - 2 && z < FIELD.maxZ + 2) {
          // Inside the field after all: push it out past the nearer edge.
          if (Math.abs(x) / fw > Math.abs(z) / fd) x += Math.sign(x || 1) * (fw / 2 + 4);
          else z += Math.sign(z || 1) * (fd / 2 + 4);
        }
      } else {
        x = FIELD.minX + random() * fw;
        z = FIELD.minZ + random() * fd;
      }
      const h = rough ? 0.18 + random() * 0.3 : 0.08 + random() * 0.08;
      const w = rough ? 0.2 + random() * 0.25 : 0.14 + random() * 0.1;
      compose(x, h / 2 - 0.03, z, w, h, w, random() * Math.PI);
      tufts.place(i, m4, TUFTS[Math.floor(random() * TUFTS.length)]);
    }
    tufts.finish();
    const patches = 26,
      per = 9;
    const flowers = createInstancedBoxes(patches * per, world, false);
    let n = 0;
    for (let k = 0; k < patches; k++) {
      const px = FIELD.minX + 3 + random() * (fw - 6),
        pz = FIELD.minZ + 3 + random() * (fd - 6);
      const color = FLOWERS[k % FLOWERS.length];
      for (let j = 0; j < per; j++)
        flowers.place(n++, px + (random() - 0.5) * 1.6, 0.05, pz + (random() - 0.5) * 1.6, 0.07, 0.07, 0.07, color);
    }
    flowers.finish();
  }

  // --- A low hedge round the field, with gaps; tall enough to read, low enough never to hide anyone ---
  {
    const specs: Array<[number, number, number, number, number, number]> = []; // x, z, w, d, h, colour
    const inset = 3.5;
    const run = (from: number, to: number, fixed: number, alongX: boolean) => {
      for (let a = from; a < to; ) {
        const len = 2.4 + random() * 2.2;
        const gap = random() < 0.12 ? 2.5 : 0.1;
        const mid = a + len / 2;
        const h = 0.75 + random() * 0.35;
        const color = HEDGE[Math.floor(random() * HEDGE.length)];
        if (alongX) specs.push([mid, fixed, len, 1.1, h, color]);
        else specs.push([fixed, mid, 1.1, len, h, color]);
        a += len + gap;
      }
    };
    run(FIELD.minX - inset, FIELD.maxX + inset, FIELD.minZ - inset, true);
    run(FIELD.minX - inset, FIELD.maxX + inset, FIELD.maxZ + inset, true);
    run(FIELD.minZ - inset + 1.2, FIELD.maxZ + inset - 1.2, FIELD.minX - inset, false);
    run(FIELD.minZ - inset + 1.2, FIELD.maxZ + inset - 1.2, FIELD.maxX + inset, false);
    const hedge = createInstancedBoxes(specs.length, world, true);
    specs.forEach(([x, z, w, d, h, color], i) => hedge.place(i, x, h / 2, z, w, h, d, color));
    hedge.finish();
  }

  // --- Treeline: dense along the far sides (−z, −x), a sparse low fringe on the near ones ---
  {
    const trees: Array<[number, number, number]> = []; // x, z, scale
    const band = (n: number, pick: () => [number, number], scale: () => number) => {
      for (let i = 0; i < n; i++) {
        const [x, z] = pick();
        trees.push([x, z, scale()]);
      }
    };
    band(
      70,
      () => [FIELD.minX - 30 + random() * (fw + 70), FIELD.minZ - 8 - random() * 18],
      () => 1 + random() * 0.6,
    );
    band(
      45,
      () => [FIELD.minX - 8 - random() * 18, FIELD.minZ - 8 + random() * (fd + 30)],
      () => 1 + random() * 0.6,
    );
    // Near sides: small and far out, only ever seen at the widest framing.
    band(
      18,
      () => [FIELD.minX + random() * (fw + 20), FIELD.maxZ + 16 + random() * 12],
      () => 0.6 + random() * 0.3,
    );
    band(
      14,
      () => [FIELD.maxX + 16 + random() * 12, FIELD.minZ + random() * (fd + 10)],
      () => 0.6 + random() * 0.3,
    );
    const trunks = instancedOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 7), trees.length, world, true);
    const canopy = instancedOf(new THREE.IcosahedronGeometry(1, 1), trees.length * 3, world, true);
    trees.forEach(([x, z, k], i) => {
      compose(x, 1.2 * k, z, 0.28 * k, 2.4 * k, 0.28 * k);
      trunks.place(i, m4, 0x655b49);
      for (let j = 0; j < 3; j++) {
        const r = (1.25 - j * 0.18) * k * (0.9 + random() * 0.25);
        compose(x + (j % 2) * 0.3 * k, (2.4 + j * 0.62) * k, z + ((j + 1) % 2) * 0.2 * k, r, r * 0.85, r, random() * 3);
        canopy.place(i * 3 + j, m4, LEAVES[(i + j) % LEAVES.length]);
      }
    });
    trunks.finish();
    canopy.finish();
  }

  // --- Day light: a bright sky, a warm sun with shadows that follow the framing ---
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 120, 260);
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
  }
  frame(0, 0, 40);

  function update(_now: number, _reducedMotion: boolean): void {
    // Nothing in the backdrop moves yet; kept so the page's loop has one place to add it.
  }

  return { world, bounds: { ...FIELD }, frame, update };
}

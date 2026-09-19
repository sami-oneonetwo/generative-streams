// The approved neighborhood: elevated isometric camera, cutaway safehouse,
// weathered materials, a fenced yard, garden, garage, and ambient zombies
// staying outside the perimeter. Refactored from the approved sample
// (.claude/preview-tools/safehouse.js) with the agreed layout change so the
// yard has room for chat-driven generation: the back fence now runs to
// z=-18 (was z=-10), opening a rear lot at x[-9,11] z[-17,-11]. The one
// background house and the two trees that would otherwise have landed
// inside that lot were removed or pushed further out. Everything here is
// static — the only server-driven pieces (generated objects, the survivor)
// live in objects.ts/survivor.ts and attach to the same `world` group.

import * as THREE from 'three';
import {
  box,
  buildPersonGroup,
  cachedMaterial,
  createInstancedBoxes,
  cyl,
  newMaterialCache,
  type MaterialCache,
} from './primitives';

export interface EnvironmentHandles {
  world: THREE.Group;
  /** Ground rectangle the camera should keep in frame. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  setLighting(night: boolean): void;
  update(now: number, reducedMotion: boolean): void;
}

interface ClutterSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const world = new THREE.Group();
  scene.add(world);
  const cache = newMaterialCache();
  const moving: Array<(t: number) => void> = [];
  const lights: THREE.PointLight[] = [];

  function treeAt(x: number, z: number, s = 1): void {
    cyl(0.13 * s, 2.4 * s, 0x655b49, x, 1.2 * s, z, world, cache);
    const colors = [0x5e6f4d, 0x697b55, 0x77875c];
    for (let j = 0; j < 3; j++) {
      const radius = (1.15 - j * 0.16) * s;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), cachedMaterial(cache, colors[j]));
      m.position.set(x + (j % 2) * 0.25 * s, (2.3 + j * 0.58) * s, z);
      m.scale.y = 0.85;
      m.castShadow = true;
      m.receiveShadow = true;
      world.add(m);
    }
  }


  function buildGroundClutter(): void {
    const specs: ClutterSpec[] = [];
    for (let i = 0; i < 460; i++) {
      const x = Math.sin(i * 8.23) * 58;
      const z = Math.cos(i * 4.81) * 26;
      specs.push({
        x,
        y: -0.05,
        z,
        w: 0.08 + (i % 5) * 0.08,
        h: 0.015,
        d: 0.07 + (i % 3) * 0.09,
        color: i % 3 ? 0x7d805c : 0x9d936b,
      });
    }
    for (let i = -60; i < 63; i += 3) {
      specs.push({ x: i, y: -0.06, z: 10, w: 1.3, h: 0.01, d: 0.12, color: 0xc4bfa1 });
    }
    for (let x = -60; x < 62; x += 1.5) {
      specs.push({ x, y: -0.01, z: 5.7, w: 0.025, h: 0.014, d: 1.2, color: 0x7e8276 });
      specs.push({ x, y: -0.01, z: 14.4, w: 0.025, h: 0.014, d: 1.2, color: 0x7e8276 });
    }
    const { place, finish } = createInstancedBoxes(specs.length, world, false);
    specs.forEach((s, i) => place(i, s.x, s.y, s.z, s.w, s.h, s.d, s.color));
    finish();
  }

  function distantHouse(x: number, z: number): void {
    box(9, 3.6, 7, 0x8c8b78, x, 1.8, z, world, cache);
    const roofA = box(10, 0.28, 4.8, 0x656d63, x, 4.05, z - 1.75, world, cache);
    roofA.rotation.x = 0.4;
    const roofB = box(10, 0.28, 4.8, 0x656d63, x, 4.05, z + 1.75, world, cache);
    roofB.rotation.x = -0.4;
    for (const xx of [-2.8, 2.8]) box(1.4, 1.35, 0.04, 0x47554e, x + xx, 1.9, z + 3.53, world, cache);
    box(1.15, 2.1, 0.04, 0x655f4c, x, 1.05, z + 3.54, world, cache);
  }

  function zombieAt(
    x: number,
    z: number,
    rot: number,
  ): { group: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; baseX: number; baseZ: number } {
    const parts = buildPersonGroup(world, cache, true);
    parts.group.position.set(x, 0.13, z);
    parts.group.rotation.y = rot;
    return { group: parts.group, leftArm: parts.leftArm, rightArm: parts.rightArm, baseX: x, baseZ: z };
  }

  // --- Street: the whole block, three lots wide (playable x −54…54), with backdrop beyond ---
  box(130, 0.2, 70, 0x68745a, 0, -0.2, 0, world, cache);
  box(130, 0.025, 7.5, 0x525a58, 0, -0.08, 10, world, cache);
  box(130, 0.035, 1.25, 0x9c9d8a, 0, -0.04, 5.7, world, cache);
  box(130, 0.035, 1.25, 0x9c9d8a, 0, -0.04, 14.4, world, cache);
  box(5, 0.035, 13, 0x8b8d7d, 9, 0, -0.5, world, cache);
  box(4, 0.035, 10, 0x8b8d7d, -42, 0, 0, world, cache); // the shop's forecourt
  buildGroundClutter();

  // The safehouse, its furniture, the garage, cars, trees, poles and the fence
  // are server objects now (src/worlds/safehouse/scenery.ts): they render via
  // objects.ts so chat can move, repaint or destroy them. Only the backdrop
  // beyond the playable rectangle stays hand-placed here.
  distantHouse(-10, -22);
  distantHouse(-44, -23);
  distantHouse(44, -23);
  treeAt(3, -20, 1.3);
  treeAt(-16, -20, 1.2);
  treeAt(-30, -21, 1.2);
  treeAt(30, -21, 1.1);
  treeAt(-58, 4, 1.3);
  treeAt(58, -6, 1.2);

  // Street lights keep fixed positions even if someone moves a pole.
  for (const x of [-45, -15, 15, 45]) {
    const l = new THREE.PointLight(0xf1c17c, 0, 9, 2);
    l.position.set(x, 5.5, 5.1);
    scene.add(l);
    lights.push(l);
  }

  const zombies: ReturnType<typeof zombieAt>[] = []; // server-driven actors render in combat.ts

  // --- Lighting rig: day/night is server-driven (scene.safehouse.lighting)
  // via setLighting(), not a local UI toggle. ---
  const hemi = new THREE.HemisphereLight(0xc9d1cb, 0x69745c, 2.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xe0ddc8, 2.2);
  sun.position.set(-15, 28, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 40, bottom: -40 });
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  // Porch light under Rook's porch roof, and the garage lamp.
  const bulbSpots: Array<[number, number, number]> = [
    [0, 2.3, -2.6],
    [8, 2, -3],
  ];
  for (const [x, y, z] of bulbSpots) {
    const l = new THREE.PointLight(0xffc47d, 0, 10, 2);
    l.position.set(x, y, z);
    scene.add(l);
    lights.push(l);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), cachedMaterial(cache, 0xe9c18a, true));
    bulb.position.set(x, y + 0.2, z);
    world.add(bulb);
  }

  function setLighting(night: boolean): void {
    scene.background = new THREE.Color(night ? 0x283840 : 0x7e897e);
    scene.fog = new THREE.Fog(night ? 0x283840 : 0x7e897e, 85, 150); // the far lots stay readable
    hemi.intensity = night ? 0.55 : 2.4;
    hemi.color.set(night ? 0x829eb8 : 0xc9d1cb);
    sun.intensity = night ? 0.65 : 2.2;
    sun.color.set(night ? 0x93aec7 : 0xe0ddc8);
    lights.forEach((l) => (l.intensity = night ? 12 : 0));
  }
  setLighting(false);

  function update(now: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    for (const z of zombies) {
      z.group.position.y = 0.13 + Math.sin(now * 0.8 + z.baseX) * 0.015;
      z.group.position.x = z.baseX + Math.sin(now * 0.17 + z.baseX) * 0.32;
      z.group.position.z = z.baseZ + Math.sin(now * 0.12 + z.baseZ) * 0.22;
      z.rightArm.rotation.x = -1.1 + Math.sin(now + z.baseX) * 0.1;
      z.leftArm.rotation.x = -1.1 + Math.sin(now + z.baseX + 0.4) * 0.1;
    }
  }

  return {
    world,
    // The whole block; the camera roams it rather than framing it all at once.
    bounds: { minX: -56, maxX: 56, minZ: -20, maxZ: 20 },
    setLighting,
    update,
  };
}

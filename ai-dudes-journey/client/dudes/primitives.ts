// Low-level Three.js builders shared by environment.ts (static neighborhood),
// objects.ts (server-generated blueprints) and survivor.ts (the controlled
// figure). Kept free of any world/network state so it stays trivially
// testable and reusable.

import * as THREE from 'three';
import type { Primitive, Vec3 } from './types';

export type MaterialCache = Map<string, THREE.MeshStandardMaterial>;

export function newMaterialCache(): MaterialCache {
  return new Map();
}

export function cachedMaterial(
  cache: MaterialCache,
  color: number | string,
  glow = false,
): THREE.MeshStandardMaterial {
  const key = `${color}:${glow}`;
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      emissive: glow ? color : 0x000000,
      emissiveIntensity: glow ? 0.6 : 0,
    });
    cache.set(key, mat);
  }
  return mat;
}

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function box(
  w: number,
  h: number,
  d: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
  cache: MaterialCache,
): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), cachedMaterial(cache, color), x, y, z, parent);
}

export function cyl(
  r: number,
  h: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
  cache: MaterialCache,
  radialSegments = 10,
): THREE.Mesh {
  return mesh(
    new THREE.CylinderGeometry(r, r, h, radialSegments),
    cachedMaterial(cache, color),
    x,
    y,
    z,
    parent,
  );
}

export function rod(
  a: Vec3,
  b: Vec3,
  r: number,
  color: number | string,
  parent: THREE.Object3D,
  cache: MaterialCache,
): THREE.Mesh {
  const av = new THREE.Vector3(...a);
  const bv = new THREE.Vector3(...b);
  const delta = bv.clone().sub(av);
  const m = cyl(r, delta.length(), color, 0, 0, 0, parent, cache);
  m.position.copy(av.clone().add(bv).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return m;
}

export function sign(
  text: string,
  x: number,
  y: number,
  z: number,
  w: number,
  bg: string,
  ink: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  cx.fillStyle = bg;
  cx.fillRect(0, 0, 512, 160);
  cx.fillStyle = ink;
  cx.font = 'bold 60px monospace';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText(text, 256, 84, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w * 0.3125),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * One InstancedMesh standing in for many identical boxes (fence boards,
 * ground litter). Caller fills instances via `place`, then must call
 * `finish()` once. Cuts hundreds of draw calls down to one.
 */
export function createInstancedBoxes(
  count: number,
  parent: THREE.Object3D,
  castShadow = true,
): {
  inst: THREE.InstancedMesh;
  place: (
    i: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    rotY?: number,
    rotZ?: number,
  ) => void;
  finish: () => void;
} {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const inst = new THREE.InstancedMesh(geometry, material, count);
  inst.castShadow = castShadow;
  inst.receiveShadow = true;
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  parent.add(inst);
  const scratch = new THREE.Object3D();
  const colorScratch = new THREE.Color();
  const place = (
    i: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    rotY = 0,
    rotZ = 0,
  ): void => {
    scratch.position.set(x, y, z);
    scratch.rotation.set(0, rotY, rotZ);
    scratch.scale.set(w, h, d);
    scratch.updateMatrix();
    inst.setMatrixAt(i, scratch.matrix);
    inst.setColorAt(i, colorScratch.set(color));
  };
  const finish = (): void => {
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
  };
  return { inst, place, finish };
}

/** Pure geometry for one generated-blueprint primitive; caller owns the material. */
export function primitiveGeometry(part: Primitive): THREE.BufferGeometry {
  // `size` is uniformly [width, height, depth] across every shape (the
  // shared validator's contract): build each shape at a canonical unit size,
  // then scale the geometry itself so size behaves as a literal bounding box
  // no matter the primitive.
  const w = Math.max(0.02, Math.abs(part.size[0]));
  const h = Math.max(0.02, Math.abs(part.size[1]));
  const d = Math.max(0.02, Math.abs(part.size[2]));
  let geometry: THREE.BufferGeometry;
  switch (part.shape) {
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 14, 10);
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(0.5, 1, 12);
      break;
    case 'box':
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
  }
  geometry.scale(w, h, d);
  return geometry;
}

/** Builds one committed (opaque, cached-material) generated-blueprint part. */
export function buildPrimitiveMesh(part: Primitive, cache: MaterialCache): THREE.Mesh {
  const m = new THREE.Mesh(primitiveGeometry(part), cachedMaterial(cache, part.color));
  m.position.set(part.position[0], part.position[1], part.position[2]);
  m.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Recursively frees geometries/materials/textures under `obj`, then detaches
 * it. Only for dynamically-created groups (generated objects, ghost
 * previews) - the static environment lives for the whole page and is never
 * disposed.
 */
export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const withMap = m as THREE.Material & { map?: THREE.Texture | null };
        if (withMap.map) withMap.map.dispose();
        m.dispose();
      }
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}

export interface PersonParts {
  group: THREE.Group;
  rightArm: THREE.Group;
  leftArm: THREE.Group;
}
/** A blocky human silhouette (survivor or ambient zombie), matching the approved sample proportions. */
export function buildPersonGroup(
  parent: THREE.Object3D,
  cache: MaterialCache,
  zombie: boolean,
  tint?: number,
  scale = 1,
): PersonParts {
  const p = new THREE.Group();
  p.scale.setScalar(scale);
  parent.add(p);
  const skin = zombie ? 0x85947c : 0xbb9b79;
  const shirt = tint ?? (zombie ? 0x6c7773 : 0x7a8060);
  box(0.45, 0.6, 0.28, shirt, 0, 0.97, 0, p, cache);
  box(0.31, 0.37, 0.29, skin, 0, 1.47, 0, p, cache);
  box(0.35, 0.11, 0.32, zombie ? 0x66665b : 0x5a5445, 0, 1.68, 0, p, cache);
  for (const xx of [-0.13, 0.13]) {
    box(0.16, 0.53, 0.18, zombie ? 0x535b58 : 0x525c66, xx, 0.42, 0, p, cache);
    box(0.21, 0.13, 0.32, 0x3a403b, xx, 0.15, 0.05, p, cache);
  }
  const arms: THREE.Group[] = [];
  for (const xx of [-0.32, 0.32]) {
    const a = new THREE.Group();
    a.position.set(xx, 1.15, 0);
    p.add(a);
    box(0.13, 0.42, 0.16, shirt, 0, -0.17, 0, a, cache);
    box(0.12, 0.16, 0.14, skin, 0, -0.45, 0, a, cache);
    a.rotation.x = zombie ? -1.1 : -0.2;
    arms.push(a);
  }
  if (!zombie) {
    box(0.38, 0.45, 0.2, 0x6d5941, 0, 1, -0.23, p, cache);
    rod([0, -0.45, 0], [0, -0.45, 0.4], 0.035, 0x9b815d, arms[1], cache);
    box(0.23, 0.12, 0.11, 0x77817d, 0, -0.45, 0.42, arms[1], cache);
  }
  return { group: p, leftArm: arms[0], rightArm: arms[1] };
}

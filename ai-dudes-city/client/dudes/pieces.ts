// The town's fabric as pieces (docs/ages.md): each piece is the design board's low-poly parts for one
// age (client/dudes/agePieces.json), merged into one geometry with its colours in the vertices, plus
// a second, unlit one for the parts that give light (fire, lamps, light strips). A piece used many
// times (road details, trees) is drawn as instances: one draw call however many there are. Shared by
// the town (environment.ts) and the design board.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { primitiveGeometry } from './primitives';
import type { Primitive } from '../../src/shared/objectTypes';

export interface PiecePart extends Primitive {
  glow?: boolean;
}
export interface Piece {
  name: string;
  parts: PiecePart[];
}
export interface MergedPiece {
  solid?: THREE.BufferGeometry;
  glow?: THREE.BufferGeometry;
  bounds: THREE.Box3;
  /** Top centre of the parts in the owner's colour (OWNER_COLOUR), where a name plate goes. */
  ownerTop?: THREE.Vector3;
  /** Built on first use: the same piece mirrored in x with its triangles rewound (instances can't mirror through their matrix). */
  mirrored?: { solid?: THREE.BufferGeometry; glow?: THREE.BufferGeometry };
}

/** The colour the design board's claimed lot marks the owner's parts with; the town swaps in the owner's own. */
export const OWNER_COLOUR = '#d9534f';

const m4 = new THREE.Matrix4(),
  q = new THREE.Quaternion(),
  e = new THREE.Euler(),
  v = new THREE.Vector3(),
  one = new THREE.Vector3(1, 1, 1);

/** One piece's parts as merged geometry. `recolour` swaps colours (the owner's colour on a claimed lot). */
export function mergePiece(piece: Piece | undefined, recolour?: (hex: string) => string): MergedPiece {
  const solid: THREE.BufferGeometry[] = [],
    glow: THREE.BufferGeometry[] = [];
  const bounds = new THREE.Box3();
  const owner = new THREE.Box3();
  const c = new THREE.Color();
  for (const p of piece?.parts ?? []) {
    const g = primitiveGeometry(p, true);
    g.applyMatrix4(m4.compose(v.set(p.position[0], p.position[1], p.position[2]), q.setFromEuler(e.set(p.rotation[0], p.rotation[1], p.rotation[2])), one));
    g.deleteAttribute('uv');
    const hex = recolour ? recolour(p.color) : p.color;
    c.set(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#8f8a82');
    const n = g.getAttribute('position').count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    g.computeBoundingBox();
    bounds.union(g.boundingBox!);
    if (p.color.toLowerCase() === OWNER_COLOUR) owner.union(g.boundingBox!);
    (p.glow ? glow : solid).push(g);
  }
  const merged: MergedPiece = {
    ...(solid.length ? { solid: mergeGeometries(solid) ?? undefined } : {}),
    ...(glow.length ? { glow: mergeGeometries(glow) ?? undefined } : {}),
    bounds,
    ...(!owner.isEmpty() ? { ownerTop: new THREE.Vector3((owner.min.x + owner.max.x) / 2, owner.max.y, (owner.min.z + owner.max.z) / 2) } : {}),
  };
  for (const g of [...solid, ...glow]) g.dispose();
  return merged;
}

const SOLID = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

/** A geometry mirrored in x, its triangles rewound so they still face out. */
function mirrorGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const index = m.getIndex();
  if (index) {
    const a = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    index.needsUpdate = true;
  }
  return m;
}
export function mirroredOf(merged: MergedPiece): NonNullable<MergedPiece['mirrored']> {
  return (merged.mirrored ??= {
    ...(merged.solid ? { solid: mirrorGeometry(merged.solid) } : {}),
    ...(merged.glow ? { glow: mirrorGeometry(merged.glow) } : {}),
  });
}
/** Free a merged piece's geometry (and its mirrored copy). */
export function disposePiece(merged: MergedPiece): void {
  for (const g of [merged.solid, merged.glow, merged.mirrored?.solid, merged.mirrored?.glow]) g?.dispose();
}
/** The two materials every piece shares (never disposed). */
export const PIECE_MATERIALS = [SOLID, GLOW];

/** Where and how a piece goes: position, turn about y, scale, and a mirror in its own x. */
export interface Placement {
  x: number;
  z: number;
  y?: number;
  turn?: number;
  scale?: number;
  /** Height scale, when it differs from `scale` (a lot piece stretched to its lot, not made taller). */
  scaleY?: number;
  mirror?: boolean;
}
export const placementMatrix = (p: Placement, out = new THREE.Matrix4()) => {
  const s = p.scale ?? 1;
  return out.compose(v.set(p.x, p.y ?? 0, p.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.turn ?? 0), new THREE.Vector3(p.mirror ? -s : s, p.scaleY ?? s, s));
};

/**
 * A piece placed many times: instanced meshes for its solid and lit parts, split into grid cells
 * (`cell` metres) so the frustum and the shadow camera can skip the cells out of view. Mirrored
 * placements use the mirrored geometry with an unmirrored matrix (an instance matrix can't flip
 * a triangle's facing).
 */
export function instancePiece(merged: MergedPiece, places: Placement[], parent: THREE.Object3D, castShadow = true, cell = 64): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const buckets = new Map<string, Placement[]>();
  for (const p of places) {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)},${p.mirror ? 1 : 0}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p);
  }
  for (const [key, list] of buckets) {
    const mirrored = key.endsWith(',1');
    const geos = mirrored ? mirroredOf(merged) : merged;
    for (const [geo, mat, shadow] of [
      [geos.solid, SOLID, castShadow],
      [geos.glow, GLOW, false],
    ] as const) {
      if (!geo) continue;
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => inst.setMatrixAt(i, placementMatrix({ ...p, mirror: false }, m4)));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = shadow;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      parent.add(inst);
      out.push(inst);
    }
  }
  return out;
}

/** A piece placed once, as plain meshes in a group. */
export function placePiece(merged: MergedPiece, place: Placement, parent: THREE.Object3D, castShadow = true): THREE.Group {
  const g = new THREE.Group();
  if (merged.solid) {
    const m = new THREE.Mesh(merged.solid, SOLID);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    g.add(m);
  }
  if (merged.glow) g.add(new THREE.Mesh(merged.glow, GLOW));
  placementMatrix(place).decompose(g.position, g.quaternion, g.scale);
  parent.add(g);
  return g;
}

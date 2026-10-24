// Finders Keepers side marks (FK-013): a ground disc under every chatter on a side, and a crown
// (gold) or a pennant flag (red) on their name tag; neutrals get neither. Sides have to read on a
// phone and in greyscale, so they never rest on hue alone: dark red and bright gold differ in
// brightness (relative luminance 0.11 against 0.62), and the icon's shape says it again. Every mark
// wears the sticker rim (board/design-system.md §2): 0.1 m of cream, then 0.05 m of ink, so gold
// still reads on mud.
//
// The discs are two InstancedMeshes, one per colour: two draw calls for every disc in town. With
// nobody on a side (Story OFF, where the server sends no `side`) both are empty and hidden, so the
// frame is exactly today's. They are unlit and skip tone mapping, so the colours on screen are the
// locked hex values whatever the age's light. They draw after the opaque world without writing
// depth: a disc lies on the ground, under the dude's feet and behind anything in front of it, and
// overlapping discs in a crowd stack cleanly instead of flickering.
//
// `?demo=board` (with FK-010's fake Board) hands out fake sides to the chatters in view, locally,
// so the marks can be seen before the server sends real ones (FK-012). A real side always wins.

import * as THREE from 'three';
import type { DudeView } from './types';

export type Side = 'red' | 'gold';

/** The story colours, locked (design-system.md §2): they skip the age palette in every age. */
export const SIDE_HEX: Record<Side, string> = { red: '#B3262E', gold: '#FFC633' };
export const CREAM = '#FFF6E0';
export const INK = '#1E1914';

/** The disc, in metres: the side's colour 1.3 m across, then the sticker rim; and how far above the ground it lies. */
export const SIDE_DISC = { face: 0.65, cream: 0.1, ink: 0.05, segments: 36, y: 0.03 };
/** Off the ground by more than this (up on a build, or aboard one), a dude has no disc: the tag still carries the side. */
const ON_GROUND = 0.05;

// --- whose side ------------------------------------------------------------------------------------

/** `?demo=board`: fake sides for the chatters in view. */
export const demoSidesOn = (search: string): boolean => new URLSearchParams(search).get('demo') === 'board';

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A chatter's fake side for the demo, steady per id: two in five gold, two in five red, one neutral. Never the town's own people. */
export function demoSide(v: Pick<DudeView, 'id' | 'npc' | 'resident' | 'traveller' | 'mayor'>): Side | undefined {
  if (v.npc || v.resident || v.traveller || v.mayor) return undefined;
  const k = hashOf(v.id) % 5;
  return k < 2 ? 'gold' : k < 4 ? 'red' : undefined;
}

/** The side to draw: the server's, else the demo's when `?demo=board` is on, else none. */
export function sideOf(v: DudeView, demo: boolean): Side | undefined {
  if (v.side === 'red' || v.side === 'gold') return v.side;
  return demo ? demoSide(v) : undefined;
}

/**
 * Where a dude's disc lies this frame (its height), or undefined for none: on foot only. Up on a
 * build, aboard one, inside one or swimming, the disc goes (it would float); the tag still shows the side.
 */
export function discHeight(v: Pick<DudeView, 'hidden' | 'riding'>, lift: number, pose: string): number | undefined {
  if (v.hidden || v.riding || lift > ON_GROUND || pose === 'swim') return undefined;
  return SIDE_DISC.y;
}

// --- the tag icon ------------------------------------------------------------------------------------

// Inline SVG, like the badges (badges.ts), so OBS draws it exactly as a browser does. Each shape is
// drawn twice: first fat in cream (the sticker rim), then in its colour with an ink line.
const svg = (body: string) => `<svg viewBox="-1 -1 22 18" aria-hidden="true">${body}</svg>`;
const rim = (shapes: string) => `<g fill="${CREAM}" stroke="${CREAM}" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round">${shapes}</g>`;
const face = (shapes: string, fill: string) => `<g fill="${fill}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${shapes}</g>`;
// A chunky three-point crown with a ball on each point: the gold fills most of it, so it reads small.
const CROWN_SHAPES = '<path d="M2.6 15.2V5.6l4.2 3.6L11 3.4l4.2 5.8 4.2-3.6v9.6z"/><circle cx="2.6" cy="4.4" r="1.8"/><circle cx="11" cy="2.2" r="1.8"/><circle cx="19.4" cy="4.4" r="1.8"/>';
const CROWN = svg(`${rim(CROWN_SHAPES)}${face(CROWN_SHAPES, SIDE_HEX.gold)}`);
// A pennant on a pole: the pole a fat ink line, the pennant a long triangle flying right.
const POLE = '<path d="M3.6 1.6v14.8" fill="none"/>';
const PENNANT = '<path d="M4.6 1.8l15.2 5.5-15.2 5.5z"/>';
const FLAG = svg(`${rim(`${POLE}${PENNANT}`)}<path d="M3.6 1.6v14.8" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>${face(PENNANT, SIDE_HEX.red)}`);

/** The tag's icon for a side: a crown for gold, a pennant flag for red, nothing for a neutral. */
export function sideIcon(side: Side | undefined): string {
  return side === 'gold' ? CROWN : side === 'red' ? FLAG : '';
}
/** About how many tag characters wide the icon is, for the tag declutter's width estimate. */
export const SIDE_ICON_CHARS = 3;

/** The icon's place on the tag: in front of the name, a little over a line tall, without making the tag taller. */
export const SIDE_ICON_CSS =
  '.tag .s{display:inline-block;width:1.55em;height:1.3em;margin:-.15em .35em -.15em 0;vertical-align:-.3em}.tag .s[hidden]{display:none}.tag .s svg{display:block;width:100%;height:100%;overflow:visible}';

// --- the discs ---------------------------------------------------------------------------------------

/** Linear RGB, as vertex colours want it (THREE.Color converts from the sRGB hex). */
const linear = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/**
 * One flat disc lying face-up at y = 0: the face colour out to `face`, then the cream ring, then the
 * ink ring, as vertex colours (so one mesh, one material, one draw call per face colour).
 */
export function stickerDisc(faceHex: string, d = SIDE_DISC): THREE.BufferGeometry {
  const bands: [number, number, [number, number, number]][] = [
    [0, d.face, linear(faceHex)],
    [d.face, d.face + d.cream, linear(CREAM)],
    [d.face + d.cream, d.face + d.cream + d.ink, linear(INK)],
  ];
  const pos: number[] = [],
    colour: number[] = [];
  const n = d.segments;
  // x = cos, z = −sin: counter-clockwise seen from above, so every face points up.
  const at = (r: number, i: number): [number, number, number] => [Math.cos((i / n) * Math.PI * 2) * r, 0, -Math.sin((i / n) * Math.PI * 2) * r];
  const tri = (a: number[], b: number[], c: number[], rgb: number[]) => {
    pos.push(...a, ...b, ...c);
    colour.push(...rgb, ...rgb, ...rgb);
  };
  for (const [r0, r1, rgb] of bands)
    for (let i = 0; i < n; i++) {
      if (r0 === 0) {
        tri([0, 0, 0], at(r1, i), at(r1, i + 1), rgb);
        continue;
      }
      tri(at(r0, i), at(r1, i), at(r1, i + 1), rgb);
      tri(at(r0, i), at(r1, i + 1), at(r0, i + 1), rgb);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  g.computeBoundingSphere();
  return g;
}

/** Drawn after the opaque world (renderOrder 0), before the transparent pass (the selection ring, the plans). */
export const DISC_ORDER = 1;

/** Every side disc in town, one InstancedMesh per colour. Per frame: `begin`, `add` each dude on a side, `finish`. */
export class SideDiscs {
  readonly meshes = {} as Record<Side, THREE.InstancedMesh>;
  private readonly n: Record<Side, number> = { red: 0, gold: 0 };
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor(
    private readonly parent: THREE.Object3D,
    private capacity = 32,
  ) {
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, depthWrite: false });
    for (const side of ['gold', 'red'] as Side[]) {
      const g = stickerDisc(SIDE_HEX[side]);
      this.geometries.push(g);
      this.meshes[side] = this.make(g, capacity);
    }
  }
  private make(geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const inst = new THREE.InstancedMesh(geometry, this.material, capacity);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
    inst.castShadow = inst.receiveShadow = false;
    inst.frustumCulled = false; // instances span the whole field
    inst.renderOrder = DISC_ORDER;
    inst.count = 0;
    inst.visible = false;
    this.parent.add(inst);
    return inst;
  }
  /** Before a frame's `add`s: room for this many of each colour. */
  begin(most: number) {
    if (most > this.capacity) {
      let c = this.capacity;
      while (c < most) c *= 2;
      this.capacity = c;
      for (const side of ['gold', 'red'] as Side[]) {
        const old = this.meshes[side];
        this.parent.remove(old);
        old.dispose();
        this.meshes[side] = this.make(old.geometry, c);
      }
    }
    this.n.red = this.n.gold = 0;
  }
  /** One disc at (x, y, z), `scale` times its size (shrinking away into a build, a bigger figure), dimmed by `dim` (napping). */
  add(side: Side, x: number, y: number, z: number, scale: number, dim: number) {
    const inst = this.meshes[side];
    const i = this.n[side];
    if (i >= this.capacity) return;
    this.n[side] = i + 1;
    inst.setMatrixAt(i, this.m.makeScale(scale, 1, scale).setPosition(x, y, z));
    inst.setColorAt(i, this.c.setScalar(dim));
  }
  finish() {
    for (const side of ['gold', 'red'] as Side[]) {
      const inst = this.meshes[side];
      inst.count = this.n[side];
      inst.visible = inst.count > 0; // nobody on this side: no draw call at all
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }
  count(side: Side): number {
    return this.n[side];
  }
  dispose() {
    for (const side of ['gold', 'red'] as Side[]) {
      this.parent.remove(this.meshes[side]);
      this.meshes[side].dispose();
    }
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}

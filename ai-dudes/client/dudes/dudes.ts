// The dudes, as the page draws them: one small blocky figure per chatter, dressed from its
// `DudeLook` (skin, shirt, trousers, hair, a hat, one accessory, height and build), slid between
// snapshots on its own Track (motion.ts) like every other mover, and posed every frame from what
// the server says it is doing — walking, building, napping, or one of the emotes.
//
// A hundred and fifty figures as Groups of boxes would be thousands of draw calls. Instead every
// figure is a list of parts (a unit box, cylinder, cone or sphere scaled into place on one of eight
// bones), and every part of every figure goes into one of four InstancedMeshes: four draw calls for
// the whole field, plus their shadows. Each frame a single scratch skeleton is posed per figure,
// its bone matrices read off, and each part's matrix written as bone × part. A figure's part list
// is rebuilt only when its look changes (compared by a JSON key).
//
// The overlay (HTML in `#people`): a name tag pinned over each head, a speech bubble while a line
// lasts, an animated "…" while its agent is mid-turn, a small "z" over a napping dude, and a job
// line under the tag while it has work on. Tags that would overlap are thinned greedily, most
// recent speaker first; bubbles never hide but stack upward when they would cover each other.
import * as THREE from 'three';
import { Track, turn } from './motion';
import type { Accessory, DudeLook, DudeView, Hat } from './types';

// --- the part vocabulary -------------------------------------------------------------------------

const BOX = 0,
  CYL = 1,
  CONE = 2,
  SPHERE = 3;
const SHAPE_COUNT = 4;
// Bones. The body is the root at the feet; hips carry the torso, head, arms and cape; legs hang off the body.
const B_BODY = 0,
  B_HIPS = 1,
  B_HEAD = 2,
  B_ARM_L = 3,
  B_ARM_R = 4,
  B_LEG_L = 5,
  B_LEG_R = 6,
  B_CAPE = 7,
  BONES = 8;

interface Part {
  shape: number;
  bone: number;
  local: THREE.Matrix4;
  color: THREE.Color; // linear, undimmed
  tool: Tool; // carried things (hammer, toy gun, bomb): drawn only while that one is in hand
}
/** Where the bones sit for one figure's height and build. Metres, in the parent bone's frame. */
interface Dims {
  k: number; // height factor
  hk: number; // head scale: heads vary less than bodies
  hipY: number;
  hipX: number;
  neckY: number;
  shoulderX: number;
  shoulderY: number;
  capeZ: number;
  /** From the head bone to just above the hat, for the overlay anchor. */
  crown: number;
}
interface Figure {
  id: string;
  view: DudeView;
  track: Track;
  lookKey: string;
  parts: Part[];
  counts: number[]; // parts per shape, so the batches can be sized before a frame
  dims: Dims;
  /** The pose as drawn (eased toward each frame's target) and its name, for the smoke handle. */
  cur: Float32Array;
  poseName: string;
  fresh: boolean;
  /** Seen in a snapshot the drawn clock has reached; until then it is not drawn (it is still ahead of the world). */
  synced: boolean;
  phase: number; // ms; so no two dudes wave, dance or walk in lockstep
  facing: number;
  x: number;
  z: number;
  rise: number;
  /** Metres off the ground (on top of a build, or aboard one), eased toward the server's `y`. */
  lift: number;
  /** Ground speed as drawn, m/s, eased; and the gait's phase, advanced by it, so a run is a run. */
  speed: number;
  gait: number;
  /** 1 drawn … 0 inside a build (`hidden`): the figure shrinks away over ~0.3 s rather than popping. */
  vis: number;
  dim: number; // 1 awake … 0.6 napping, eased
  tool: Tool;
  anchor: THREE.Vector3; // world point just above the head, for the overlay
  // Overlay
  tag: HTMLElement;
  tagName: HTMLElement;
  tagTitle: HTMLElement;
  tagJob: HTMLElement;
  say: HTMLElement;
  think: HTMLElement;
  zz: HTMLElement;
  nameLine: string;
  jobLine: string;
  sayText: string;
  sayW: number;
  sayH: number;
  last: { tag: string; say: string; think: string; zz: string };
}

// Pose channels: one Float32Array per figure, eased toward a target written fresh every frame.
const P_RISE = 0,
  P_PITCH = 1,
  P_SHIFT = 2,
  P_ROLL = 3,
  P_YAW = 4,
  P_HIPS_X = 5,
  P_HIPS_Z = 6,
  P_HEAD_X = 7,
  P_HEAD_Y = 8,
  P_ARML_X = 9,
  P_ARML_Z = 10,
  P_ARMR_X = 11,
  P_ARMR_Z = 12,
  P_LEGL_X = 13,
  P_LEGR_X = 14,
  P_SPREAD = 15,
  P_CAPE_X = 16,
  CHANNELS = 17;
const REST = new Float32Array(CHANNELS);
REST[P_ARML_Z] = 0.07;
REST[P_ARMR_Z] = -0.07;
REST[P_CAPE_X] = 0.06;

// Arms rotate about x (negative raises them forward, past −π overhead) and z (the left arm sits at
// +x, so outward is +z for it and −z for the right). Legs: negative x swings forward.
const HEARD_MS = 2500; // the quick wave after a message
const TAG_RECENT_MS = 20_000; // a recent speaker's tag shows even if it would otherwise be thinned
const POSE_RATE = 16; // per second: how fast a pose eases to its target
const TURN_RATE = 9;
const LIFT_RATE = 10; // about 0.3 s to climb on or off a build
const HIDE_RATE = 10; // about 0.3 s to vanish into one

type Tool = '' | 'hammer' | 'gun' | 'bomb';
const TOY_BODY = 0xe8a33a,
  TOY_TIP = 0x3a6fd8,
  TOY_GRIP = 0x4a4a52,
  BOMB = 0x222226,
  FUSE = 0xc9b48a,
  STAR = 0xffd84a;
const SHOES = 0x3b3631,
  EYES = 0x2a2522,
  WOOD = 0x7a5a3a,
  STEEL = 0x6f7470,
  GEM = 0xb04848;
const DEFAULT_LOOK: DudeLook = {
  skin: '#c9a27e',
  shirt: '#7a8060',
  pants: '#525c66',
  hair: '#4a3b2c',
  hat: 'none',
  hatColor: '#8a5a44',
  accessory: 'none',
  accessoryColor: '#5d6f7a',
  height: 1,
  build: 1,
};

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const colour = (hex: unknown, fallback: string): THREE.Color =>
  new THREE.Color(typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback);
const shade = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
const tint = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color(1, 1, 1), k);

// --- building a figure's parts from its look ----------------------------------------------------

/** Above the head bone, by hat, before head scale: where the overlay anchor goes. */
const HAT_TOP: Record<Hat, number> = {
  none: 0.37,
  cap: 0.39,
  beanie: 0.48,
  tophat: 0.64,
  cowboy: 0.48,
  crown: 0.5,
  bucket: 0.45,
  helmet: 0.47,
  party: 0.56,
  headband: 0.37,
  wizard: 0.86,
};
/** Hats that sit on the hair rather than replacing its top. */
const OVER_HAIR = new Set<Hat>(['none', 'crown', 'party', 'headband']);

function compose(look: DudeLook): { parts: Part[]; dims: Dims; counts: number[] } {
  const k = clamp(Number(look.height) || 1, 0.85, 1.15),
    b = clamp(Number(look.build) || 1, 0.85, 1.2),
    hk = (1 + k) / 2;
  const skin = colour(look.skin, DEFAULT_LOOK.skin),
    shirt = colour(look.shirt, DEFAULT_LOOK.shirt),
    pants = colour(look.pants, DEFAULT_LOOK.pants),
    hair = colour(look.hair, DEFAULT_LOOK.hair),
    hat = colour(look.hatColor, DEFAULT_LOOK.hatColor),
    acc = colour(look.accessoryColor, DEFAULT_LOOK.accessoryColor);
  const hatKind: Hat = (look.hat in HAT_TOP ? look.hat : 'none') as Hat;
  const accessory: Accessory = look.accessory ?? 'none';
  const torsoD = 0.26 * (0.6 + 0.4 * b);
  const dims: Dims = {
    k,
    hk,
    hipY: 0.8 * k,
    hipX: 0.11 * b,
    neckY: 0.6 * k + 0.02,
    shoulderX: 0.22 * b + 0.075,
    shoulderY: 0.55 * k,
    capeZ: -torsoD / 2 - 0.01,
    crown: HAT_TOP[hatKind] * hk + 0.12,
  };
  const parts: Part[] = [];
  const counts = new Array<number>(SHAPE_COUNT).fill(0);
  const pos = new THREE.Vector3(),
    quat = new THREE.Quaternion(),
    euler = new THREE.Euler(),
    scl = new THREE.Vector3();
  const add = (
    shape: number,
    bone: number,
    at: [number, number, number],
    size: [number, number, number],
    color: THREE.Color | number,
    rot: [number, number, number] = [0, 0, 0],
    tool: Tool = '',
  ) => {
    const local = new THREE.Matrix4().compose(
      pos.set(...at),
      quat.setFromEuler(euler.set(...rot)),
      scl.set(Math.max(0.005, size[0]), Math.max(0.005, size[1]), Math.max(0.005, size[2])),
    );
    parts.push({ shape, bone, local, color: color instanceof THREE.Color ? color : new THREE.Color(color), tool });
    counts[shape]++;
  };
  /** A head part: given at a 1.0 head, scaled by hk. */
  const head = (
    shape: number,
    at: [number, number, number],
    size: [number, number, number],
    color: THREE.Color | number,
    rot?: [number, number, number],
  ) =>
    add(
      shape,
      B_HEAD,
      [at[0] * hk, at[1] * hk, at[2] * hk],
      [size[0] * hk, size[1] * hk, size[2] * hk],
      color,
      rot,
    );

  // Legs and shoes: from the hip pivot down to the ground.
  const legLen = dims.hipY - 0.09;
  for (const bone of [B_LEG_L, B_LEG_R]) {
    add(BOX, bone, [0, (0.02 - legLen) / 2, 0], [0.17, legLen + 0.02, 0.19], pants);
    add(BOX, bone, [0, -dims.hipY + 0.045, 0.04], [0.19, 0.09, 0.27], SHOES);
  }
  // Torso, with the trousers' waist showing under it.
  add(BOX, B_HIPS, [0, 0.3 * k, 0], [0.44 * b, 0.6 * k, torsoD], shirt);
  add(BOX, B_HIPS, [0, 0.02, 0], [0.42 * b, 0.12, torsoD - 0.01], pants);
  // Arms: a sleeve and a hand, hinged at the shoulder. The right one carries the hammer while building.
  for (const bone of [B_ARM_L, B_ARM_R]) {
    add(BOX, bone, [0, -0.18 * k, 0], [0.13, 0.4 * k, 0.15], shirt);
    add(BOX, bone, [0, -0.4 * k - 0.06, 0], [0.12, 0.12, 0.13], skin);
  }
  const hand = -0.4 * k - 0.06;
  add(BOX, B_ARM_R, [0, -0.46 * k, 0.15], [0.04, 0.04, 0.34], WOOD, [0, 0, 0], 'hammer');
  add(BOX, B_ARM_R, [0, -0.46 * k, 0.32], [0.16, 0.07, 0.07], STEEL, [0, 0, 0], 'hammer');
  // A toy gun: the barrel runs on down the arm, so it points wherever the arm does; the grip hangs under it.
  add(BOX, B_ARM_R, [0, hand - 0.17, 0.02], [0.07, 0.26, 0.08], TOY_BODY, [0, 0, 0], 'gun');
  add(BOX, B_ARM_R, [0, hand - 0.31, 0.02], [0.05, 0.04, 0.06], TOY_TIP, [0, 0, 0], 'gun');
  add(BOX, B_ARM_R, [0, hand - 0.07, -0.06], [0.05, 0.07, 0.12], TOY_GRIP, [0, 0, 0], 'gun');
  // A cartoon bomb, carried until it is planted.
  add(SPHERE, B_ARM_R, [0, hand - 0.1, 0.06], [0.22, 0.22, 0.22], BOMB, [0, 0, 0], 'bomb');
  add(CYL, B_ARM_R, [0, hand - 0.1, 0.19], [0.03, 0.08, 0.03], FUSE, [Math.PI / 2, 0, 0], 'bomb');
  // Head, eyes, hair.
  head(BOX, [0, 0.16, 0], [0.3, 0.32, 0.28], skin);
  for (const x of [-0.065, 0.065]) head(BOX, [x, 0.18, 0.141], [0.045, 0.055, 0.02], EYES);
  head(BOX, [0, 0.22, -0.13], [0.32, 0.2, 0.06], hair);
  if (OVER_HAIR.has(hatKind)) head(BOX, [0, 0.335, 0], [0.32, 0.07, 0.3], hair);

  // Hats, on the head bone. HB is the crown of the head; hats over hair start a little higher.
  const HB = OVER_HAIR.has(hatKind) ? 0.37 : 0.33;
  const hd = shade(hat, 0.7),
    hl = tint(hat, 0.45);
  switch (hatKind) {
    case 'cap':
      head(BOX, [0, HB + 0.03, 0], [0.33, 0.1, 0.31], hat);
      head(BOX, [0, HB - 0.01, 0.2], [0.28, 0.025, 0.16], hd);
      break;
    case 'beanie':
      head(BOX, [0, HB + 0.04, 0], [0.34, 0.15, 0.32], hat);
      head(BOX, [0, HB - 0.04, 0], [0.35, 0.06, 0.33], hd);
      head(SPHERE, [0, HB + 0.14, 0], [0.1, 0.1, 0.1], hl);
      break;
    case 'tophat':
      head(CYL, [0, HB + 0.01, 0], [0.46, 0.025, 0.46], hat);
      head(CYL, [0, HB + 0.17, 0], [0.28, 0.3, 0.28], hat);
      head(CYL, [0, HB + 0.05, 0], [0.29, 0.05, 0.29], hd);
      break;
    case 'cowboy':
      head(CYL, [0, HB + 0.01, 0], [0.58, 0.025, 0.5], hat);
      head(BOX, [0, HB + 0.09, 0], [0.27, 0.15, 0.25], hat);
      head(BOX, [0, HB + 0.04, 0], [0.28, 0.04, 0.26], hd);
      head(BOX, [0.27, HB + 0.04, 0], [0.05, 0.035, 0.36], hat, [0, 0, 0.5]);
      head(BOX, [-0.27, HB + 0.04, 0], [0.05, 0.035, 0.36], hat, [0, 0, -0.5]);
      break;
    case 'crown': {
      head(CYL, [0, HB + 0.02, 0], [0.3, 0.09, 0.3], hat);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        head(CONE, [Math.sin(a) * 0.12, HB + 0.11, Math.cos(a) * 0.12], [0.07, 0.11, 0.07], hat);
      }
      head(SPHERE, [0, HB + 0.03, 0.15], [0.05, 0.05, 0.05], GEM);
      break;
    }
    case 'bucket':
      head(CYL, [0, HB + 0.05, 0], [0.3, 0.13, 0.3], hat);
      head(CYL, [0, HB - 0.01, 0], [0.42, 0.025, 0.42], hd);
      break;
    case 'helmet':
      head(SPHERE, [0, HB - 0.02, 0], [0.38, 0.3, 0.36], hat);
      head(BOX, [0, HB - 0.04, 0.17], [0.3, 0.025, 0.1], hd);
      head(BOX, [0, HB + 0.12, 0], [0.05, 0.04, 0.34], hl);
      break;
    case 'party':
      head(CONE, [0, HB + 0.16, 0], [0.2, 0.32, 0.2], hat, [0, 0, 0.12]);
      head(SPHERE, [-0.02, HB + 0.33, 0], [0.08, 0.08, 0.08], hl);
      break;
    case 'headband':
      head(BOX, [0, 0.25, 0], [0.33, 0.06, 0.31], hat);
      head(BOX, [0.05, 0.2, -0.16], [0.05, 0.12, 0.03], hat, [0, 0, 0.3]);
      head(BOX, [-0.03, 0.19, -0.16], [0.05, 0.12, 0.03], hat, [0, 0, -0.2]);
      break;
    case 'wizard':
      head(CYL, [0, HB + 0.01, 0], [0.5, 0.025, 0.5], hat);
      head(CONE, [0, HB + 0.28, -0.02], [0.34, 0.55, 0.34], hat, [-0.18, 0, 0]);
      head(SPHERE, [0, HB + 0.14, 0.15], [0.05, 0.05, 0.05], hl);
      break;
    case 'none':
      break;
  }

  // Accessories.
  const ad = shade(acc, 0.72);
  switch (accessory) {
    case 'backpack':
      add(BOX, B_HIPS, [0, 0.32 * k, -(torsoD / 2 + 0.08)], [0.34 * b, 0.4 * k, 0.16], acc);
      add(BOX, B_HIPS, [0, 0.2 * k, -(torsoD / 2 + 0.17)], [0.24 * b, 0.14 * k, 0.05], ad);
      for (const x of [-0.11, 0.11]) add(BOX, B_HIPS, [x * b, 0.33 * k, torsoD / 2 + 0.005], [0.05, 0.42 * k, 0.02], ad);
      break;
    case 'cape':
      add(BOX, B_CAPE, [0, -0.36 * k, -0.01], [0.42 * b, 0.75 * k, 0.03], acc);
      add(BOX, B_HIPS, [0, 0.58 * k, 0], [0.46 * b, 0.05, torsoD + 0.03], ad);
      break;
    case 'scarf':
      add(BOX, B_HIPS, [0, 0.61 * k, 0], [0.3, 0.08, 0.3], acc);
      add(BOX, B_HIPS, [0.08 * b, 0.44 * k, torsoD / 2 + 0.025], [0.09, 0.28 * k, 0.04], ad);
      break;
    case 'glasses':
      for (const x of [-0.07, 0.07]) head(BOX, [x, 0.18, 0.15], [0.1, 0.075, 0.02], acc);
      head(BOX, [0, 0.19, 0.15], [0.05, 0.02, 0.02], acc);
      for (const x of [-0.155, 0.155]) head(BOX, [x, 0.19, 0.07], [0.02, 0.02, 0.16], acc);
      break;
    case 'toolbelt':
      add(BOX, B_HIPS, [0, 0.05, 0], [0.45 * b, 0.08, torsoD + 0.02], acc);
      for (const x of [-0.16, 0.16]) add(BOX, B_HIPS, [x * b, -0.02, torsoD / 2 + 0.04], [0.1, 0.13, 0.08], ad);
      add(BOX, B_HIPS, [0.25 * b, -0.06, 0], [0.03, 0.18, 0.03], STEEL);
      break;
    case 'none':
      break;
  }
  return { parts, dims, counts };
}

// --- instanced batches ----------------------------------------------------------------------------

class Batch {
  inst!: THREE.InstancedMesh;
  capacity = 0;
  n = 0;
  owners: string[] = [];
  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private parent: THREE.Object3D,
    private shadows = true,
    initial = 256,
  ) {
    this.alloc(initial);
  }
  private alloc(capacity: number) {
    if (this.inst) {
      this.parent.remove(this.inst);
      this.inst.dispose();
    }
    const inst = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
    inst.castShadow = this.shadows;
    inst.receiveShadow = this.shadows;
    inst.frustumCulled = false; // instances span the whole field; the geometry's own sphere would cull them
    inst.count = 0;
    inst.userData.dudes = true;
    this.parent.add(inst);
    this.inst = inst;
    this.capacity = capacity;
  }
  ensure(needed: number) {
    if (needed <= this.capacity) return;
    let c = this.capacity;
    while (c < needed) c *= 2;
    this.alloc(c);
  }
  finish() {
    this.inst.count = this.n;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.parent.remove(this.inst);
    this.inst.dispose();
  }
}

// --- the layer ------------------------------------------------------------------------------------

export interface OverlayOptions {
  hovered?: string;
  selected?: string;
  uiScale: number;
  /** A screen rect the HUD has taken (the troublemaker banner): bubbles drop below it, ordinary tags under it hide. */
  reserve?: { l: number; t: number; r: number; b: number };
}
export interface DudesHandles {
  root: THREE.Group;
  /** A snapshot just landed: note where every dude is at that server time. */
  sample(list: DudeView[], serverTime: number): void;
  /** The drawn world has reached this snapshot: who is here, how they look, what they said. */
  sync(list: DudeView[], nameOf?: (objectId: string) => string | undefined, serverNow?: number): void;
  /** Where a figure's head is drawn right now (the overlay anchor), for effects aimed at it. */
  headOf(id: string): THREE.Vector3 | undefined;
  /** Per frame, before the render: place and pose every figure at the drawn server time. */
  pose(now: number, reduced: boolean, renderTime: number, serverNow: number, live: boolean): void;
  /** After the render: pin tags, bubbles and the rest over the heads. */
  overlay(camera: THREE.Camera, serverNow: number, opts: OverlayOptions): void;
  /** The dude under a screen point, if any (screen-space, so it costs nothing per instance). */
  pick(clientX: number, clientY: number, camera: THREE.Camera): string | undefined;
  view(id: string): DudeView | undefined;
  positionOf(id: string): { x: number; y: number; z: number } | undefined;
  poseOf(id: string): string | undefined;
  count(): number;
  /** Where every figure is drawn now (for the camera's framing). */
  each(fn: (x: number, z: number, view: DudeView) => void): void;
  /** Re-measure the tag font after a resize or a stream-scale change. */
  measure(): void;
  dispose(): void;
}

const anchorScratch = new THREE.Vector3();
const footScratch = new THREE.Vector3();
const tmp = new THREE.Matrix4();
const col = new THREE.Color();
const target = new Float32Array(CHANNELS);

export function createDudesLayer(parent: THREE.Object3D, overlay: HTMLElement): DudesHandles {
  const root = new THREE.Group();
  parent.add(root);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const geometries: THREE.BufferGeometry[] = [];
  geometries[BOX] = new THREE.BoxGeometry(1, 1, 1);
  geometries[CYL] = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  geometries[CONE] = new THREE.ConeGeometry(0.5, 1, 10);
  geometries[SPHERE] = new THREE.SphereGeometry(0.5, 10, 8);
  const batches = geometries.map((g) => new Batch(g, material, root));
  // KO stars: a little five-pointed star, flat-shaded and unlit so it reads as a cartoon.
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.045 : 0.1,
      a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeometry = new THREE.ExtrudeGeometry(starShape, { depth: 0.03, bevelEnabled: false });
  starGeometry.center();
  const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const stars = new Batch(starGeometry, starMaterial, root, false, 16);
  const starScratch = new THREE.Object3D();
  const figures = new Map<string, Figure>();

  // One scratch skeleton, posed once per figure per frame.
  const rig = new THREE.Object3D();
  const bones: THREE.Object3D[] = [];
  for (let i = 0; i < BONES; i++) bones.push(new THREE.Object3D());
  rig.add(bones[B_BODY]);
  bones[B_BODY].add(bones[B_HIPS], bones[B_LEG_L], bones[B_LEG_R]);
  bones[B_HIPS].add(bones[B_HEAD], bones[B_ARM_L], bones[B_ARM_R], bones[B_CAPE]);

  // The selected dude stands on a soft ring.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.56, 28),
    new THREE.MeshBasicMaterial({ color: 0xe5c98c, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  root.add(ring);

  // Tag metrics, measured from probes so declutter needs no per-frame layout reads.
  const metrics = { char: 6.7, pad: 14, height: 20, jobChar: 5.6, jobHeight: 12 };
  function measure() {
    const probe = (cls: string, text: string) => {
      const el = document.createElement('div');
      el.className = cls;
      el.style.visibility = 'hidden';
      el.textContent = text;
      overlay.append(el);
      const r = { w: el.offsetWidth, h: el.offsetHeight };
      el.remove();
      return r;
    };
    const a = probe('tag', 'MMMMMMMMMM'),
      b = probe('tag', 'MMMMMMMMMMMMMMMMMMMM'),
      j = probe('tag', 'MMMMMMMMMM');
    if (b.w > a.w) {
      metrics.char = (b.w - a.w) / 10;
      metrics.pad = a.w - 10 * metrics.char;
      metrics.height = a.h;
    }
    const jobProbe = document.createElement('div');
    jobProbe.className = 'tag';
    jobProbe.style.visibility = 'hidden';
    const line = document.createElement('div');
    line.className = 'job';
    line.textContent = 'MMMMMMMMMMMMMMMMMMMM';
    jobProbe.append('x', line);
    overlay.append(jobProbe);
    metrics.jobChar = line.offsetWidth / 20 || metrics.char * 0.85;
    metrics.jobHeight = Math.max(0, jobProbe.offsetHeight - j.h) || metrics.height * 0.6;
    jobProbe.remove();
  }
  measure();

  function el(cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    e.hidden = true;
    overlay.append(e);
    return e;
  }

  function lookKeyOf(look: DudeLook | undefined): string {
    return JSON.stringify(look ?? DEFAULT_LOOK);
  }

  function build(v: DudeView): Figure {
    const look = { ...DEFAULT_LOOK, ...(v.look ?? {}) };
    const { parts, dims, counts } = compose(look);
    const tag = el('tag dude');
    const tagName = document.createElement('span');
    tagName.className = 'n';
    const tagTitle = document.createElement('span');
    tagTitle.className = 't';
    const tagJob = document.createElement('div');
    tagJob.className = 'job';
    tagJob.hidden = true;
    tag.append(tagName, tagTitle, tagJob);
    const think = el('think');
    for (let i = 0; i < 3; i++) think.append(document.createElement('i'));
    const zz = el('zz');
    zz.textContent = 'z';
    return {
      id: v.id,
      view: v,
      track: new Track(),
      lookKey: lookKeyOf(v.look),
      parts,
      counts,
      dims,
      cur: new Float32Array(REST),
      poseName: 'idle',
      fresh: true,
      synced: false,
      phase: hashOf(v.id) % 10_000,
      facing: v.facing ?? 0,
      x: v.position.x,
      z: v.position.z,
      rise: 0,
      lift: v.y ?? 0,
      speed: 0,
      gait: 0,
      vis: v.hidden ? 0 : 1,
      dim: v.away ? 0.6 : 1,
      tool: '',
      anchor: new THREE.Vector3(v.position.x, 2, v.position.z),
      tag,
      tagName,
      tagTitle,
      tagJob,
      say: el('say'),
      think,
      zz,
      nameLine: '',
      jobLine: '',
      sayText: '',
      sayW: 0,
      sayH: 0,
      last: { tag: '', say: '', think: '', zz: '' },
    };
  }
  function remove(id: string) {
    const f = figures.get(id);
    if (!f) return;
    f.tag.remove();
    f.say.remove();
    f.think.remove();
    f.zz.remove();
    figures.delete(id);
  }

  /** What a build is called, from the objects in the applied snapshot (set by `sync`). */
  let objectName: (id: string) => string | undefined = () => undefined;
  /**
   * The tag's second line: using a build ("using · drive Burnt Orange RX-7") beats a job in flight
   * ("building · Duck tower 45%", "designing…").
   */
  function jobLineOf(v: DudeView, serverNow: number): string {
    if (v.ko !== undefined && v.ko > serverNow) return 'knocked out';
    if (v.attacking) {
      const who = figures.get(v.attacking.targetId)?.view.name ?? objectName(v.attacking.targetId) ?? 'someone';
      return `attacking · ${v.attacking.with} ${who}`;
    }
    if (v.use) {
      const name = objectName(v.use.targetId) ?? 'a build';
      return `${v.use.phase === 'going' ? 'heading off' : 'using'} · ${v.use.how} ${name}`;
    }
    const j = v.job;
    if (!j) return '';
    const verb = j.kind === 'edit' ? 'changing' : j.kind === 'remove' ? 'taking down' : 'building';
    switch (j.status) {
      case 'queued':
        return `next · ${j.label}`;
      case 'designing':
        return 'designing…';
      case 'ready':
      case 'walking':
        return `on the way · ${j.label}`;
      case 'building':
        return `${verb} · ${j.label} ${Math.round(clamp(j.progress ?? 0, 0, 1) * 100)}%`;
      case 'done':
        return `done · ${j.label}`;
      case 'failed':
        return `couldn't · ${j.label}`;
      default:
        return j.label;
    }
  }

  // --- poses ---

  /** Writes this frame's target pose for `f` into `T`; returns the pose's name. */
  function targetPose(
    f: Figure,
    T: Float32Array,
    now: number,
    serverNow: number,
    reduced: boolean,
    moving: boolean,
    activity: string,
  ): string {
    T.set(REST);
    const v = f.view,
      d = f.dims;
    const t = now + f.phase;
    const osc = (rate: number, still = 0) => (reduced ? still : Math.sin(t * rate));
    const cycle = (period: number) => (((t / period) % 1) + 1) % 1;
    const sitDrop = 0.1 - d.hipY;
    const emote = v.emote && v.emote.until > serverNow ? v.emote.pose : undefined;
    const heard = v.heardAt !== undefined && serverNow - v.heardAt >= 0 && serverNow - v.heardAt < HEARD_MS;
    const waveArm = () => {
      T[P_ARMR_X] = -2.75;
      T[P_ARMR_Z] = -0.3 + osc(0.0188) * 0.35;
    };

    if (v.ko !== undefined && v.ko > serverNow) {
      // Knocked out: flat on its back (centred on its spot), arms and legs splayed, seeing stars.
      T[P_PITCH] = -Math.PI / 2;
      T[P_RISE] = 0.14;
      T[P_SHIFT] = 0.85 * d.k;
      T[P_ARML_Z] = 0.6;
      T[P_ARMR_Z] = -0.6;
      T[P_SPREAD] = 0.22;
      T[P_HEAD_Y] = osc(0.003) * 0.25;
      T[P_CAPE_X] = 0;
      return 'ko';
    }
    if (v.away || activity === 'sleeping') {
      // Napping where it stands: sat down, slumped forward, head on its chest, breathing slowly.
      T[P_RISE] = sitDrop;
      T[P_LEGL_X] = T[P_LEGR_X] = -1.6;
      T[P_SPREAD] = 0.12;
      T[P_HIPS_X] = 0.5 + osc(0.0011) * 0.03;
      T[P_HEAD_X] = 0.5;
      T[P_ARML_X] = T[P_ARMR_X] = -0.55;
      T[P_ARML_Z] = 0.12;
      T[P_ARMR_Z] = -0.12;
      T[P_CAPE_X] = 0.6;
      return 'away';
    }
    if (moving) {
      // Stride and lean grow from a stroll (1.3 m/s) through a walk (2.4) to a run (4.2, the troublemakers).
      const run = clamp((f.speed - 2.4) / 1.8, 0, 1);
      const g = reduced ? 0 : Math.sin(f.gait);
      T[P_LEGL_X] = (0.55 + 0.3 * run) * g;
      T[P_LEGR_X] = -(0.55 + 0.3 * run) * g;
      T[P_ARML_X] = -(0.45 + 0.25 * run) * g - 0.35 * run;
      T[P_ARMR_X] = (0.45 + 0.25 * run) * g - 0.35 * run;
      T[P_RISE] = reduced ? 0 : Math.abs(Math.cos(f.gait)) * (0.045 + 0.05 * run);
      T[P_HIPS_X] = 0.06 + 0.16 * run;
      T[P_CAPE_X] = 0.35 + osc(0.019) * 0.06;
      if (heard || emote === 'wave' || emote === 'cheer') waveArm();
      else if (emote === 'point') T[P_ARMR_X] = -1.55;
      return 'walk';
    }
    if (emote) {
      switch (emote) {
        case 'wave':
          waveArm();
          break;
        case 'cheer':
          T[P_ARML_X] = T[P_ARMR_X] = -2.85 + osc(0.0126) * 0.15;
          T[P_ARML_Z] = 0.35;
          T[P_ARMR_Z] = -0.35;
          T[P_RISE] = reduced ? 0 : Math.abs(Math.sin(t * 0.0063)) * 0.16;
          T[P_HEAD_X] = -0.15;
          break;
        case 'dance': {
          const swing = osc(0.01257) * 0.9;
          T[P_ARMR_X] = reduced ? -2.4 : -1.5 + swing;
          T[P_ARML_X] = reduced ? -2.4 : -1.5 - swing;
          T[P_ARML_Z] = 0.3;
          T[P_ARMR_Z] = -0.3;
          T[P_RISE] = reduced ? 0 : Math.abs(Math.sin(t * 0.00628)) * 0.08;
          T[P_ROLL] = osc(0.00314) * 0.1;
          T[P_YAW] = osc(0.0025) * 0.3;
          T[P_HIPS_Z] = osc(0.00628) * 0.08;
          T[P_LEGL_X] = osc(0.01257) * 0.25;
          T[P_LEGR_X] = -osc(0.01257) * 0.25;
          T[P_HEAD_Y] = osc(0.00628) * 0.2;
          break;
        }
        case 'sit':
          T[P_RISE] = sitDrop;
          T[P_LEGL_X] = T[P_LEGR_X] = -1.6;
          T[P_SPREAD] = 0.08;
          T[P_HIPS_X] = -0.12;
          T[P_ARML_X] = T[P_ARMR_X] = 0.55;
          T[P_ARML_Z] = 0.2;
          T[P_ARMR_Z] = -0.2;
          T[P_HEAD_Y] = osc(0.0004) * 0.35;
          T[P_CAPE_X] = 0.5;
          break;
        case 'lie':
          // Flat on its back, centred on its spot rather than pivoting at the feet.
          T[P_PITCH] = -Math.PI / 2;
          T[P_RISE] = 0.14;
          T[P_SHIFT] = 0.85 * d.k;
          T[P_ARML_Z] = 0.25;
          T[P_ARMR_Z] = -0.25;
          T[P_SPREAD] = 0.08;
          T[P_HEAD_Y] = osc(0.0003) * 0.3;
          T[P_CAPE_X] = 0;
          break;
        case 'jump': {
          const u = reduced ? 0.5 : cycle(900);
          const h = 4 * u * (1 - u);
          T[P_RISE] = reduced ? 0 : 0.45 * h;
          T[P_ARML_X] = T[P_ARMR_X] = -0.4 - 2.3 * h;
          T[P_ARML_Z] = 0.25 * h;
          T[P_ARMR_Z] = -0.25 * h;
          T[P_LEGL_X] = T[P_LEGR_X] = -0.35 * h;
          T[P_CAPE_X] = 0.06 + 0.4 * (1 - h);
          break;
        }
        case 'punch': {
          // A jab every 0.65 s from the guard, with a small twist and lean behind it.
          const ext = reduced ? 1 : Math.max(0, Math.sin(2 * Math.PI * cycle(650)));
          T[P_ARMR_X] = -0.45 - 1.15 * ext;
          T[P_ARMR_Z] = 0.15;
          T[P_ARML_X] = -1.25;
          T[P_ARML_Z] = -0.25;
          T[P_HIPS_X] = 0.08 + 0.06 * ext;
          T[P_YAW] = -0.18 * ext;
          T[P_LEGL_X] = -0.25;
          T[P_LEGR_X] = 0.25;
          break;
        }
        case 'bow': {
          // Down, hold, up, a beat upright; a hand across the stomach, the other behind the back.
          const u = cycle(2600);
          const ease = (x: number) => x * x * (3 - 2 * x);
          const c = reduced ? 1 : u < 0.25 ? ease(u / 0.25) : u < 0.65 ? 1 : u < 0.9 ? 1 - ease((u - 0.65) / 0.25) : 0;
          T[P_HIPS_X] = 0.85 * c;
          T[P_HEAD_X] = 0.25 * c;
          T[P_ARMR_X] = -0.5 * c;
          T[P_ARMR_Z] = 0.45 * c;
          T[P_ARML_X] = 0.45 * c;
          break;
        }
        case 'think':
          T[P_ARMR_X] = -2.0;
          T[P_ARMR_Z] = 0.6;
          T[P_ARML_X] = -1.0;
          T[P_ARML_Z] = -0.55;
          T[P_HEAD_X] = -0.12 + osc(0.002) * 0.03;
          T[P_HEAD_Y] = 0.22;
          T[P_HIPS_Z] = osc(0.0015) * 0.03;
          break;
        case 'point':
          T[P_ARMR_X] = -1.55 + osc(0.004) * 0.04;
          T[P_ARMR_Z] = -0.05;
          T[P_HEAD_X] = 0.05;
          T[P_HIPS_X] = 0.04;
          break;
        case 'kick': {
          // The right leg swings forward every 0.8 s, leaning back into it, arms out for balance.
          const ext = reduced ? 1 : Math.max(0, Math.sin(2 * Math.PI * cycle(800)));
          T[P_LEGR_X] = -1.3 * ext;
          T[P_LEGL_X] = 0.1;
          T[P_HIPS_X] = -0.12 * ext;
          T[P_ARML_X] = -0.6;
          T[P_ARML_Z] = 0.3;
          T[P_ARMR_X] = 0.4;
          T[P_ARMR_Z] = -0.3;
          break;
        }
        case 'hug':
          // Both arms forward and in, a slow sway.
          T[P_ARML_X] = T[P_ARMR_X] = -1.45;
          T[P_ARML_Z] = -0.35;
          T[P_ARMR_Z] = 0.35;
          T[P_ROLL] = osc(0.003) * 0.06;
          T[P_HIPS_X] = 0.08;
          T[P_HEAD_X] = 0.1;
          break;
        case 'push':
          // The whole body leaning in about 20°, arms straight ahead, the back leg driving.
          T[P_PITCH] = 0.35 + osc(0.006) * 0.03;
          T[P_ARML_X] = T[P_ARMR_X] = -1.8;
          T[P_ARML_Z] = -0.08;
          T[P_ARMR_Z] = 0.08;
          T[P_LEGL_X] = -0.25;
          T[P_LEGR_X] = 0.35;
          T[P_HEAD_X] = -0.2;
          break;
        case 'lean':
          // Relaxed against something on its right: tilted about 12°, that arm out against it, ankles crossed.
          T[P_ROLL] = 0.21;
          T[P_ARMR_X] = -0.2;
          T[P_ARMR_Z] = -1.0;
          T[P_ARML_X] = 0.1;
          T[P_ARML_Z] = 0.15;
          T[P_SPREAD] = -0.08;
          T[P_LEGL_X] = -0.08;
          T[P_HEAD_Y] = 0.15 + osc(0.0005) * 0.2;
          T[P_HEAD_X] = -0.05;
          break;
        case 'drive': {
          // Sat at the wheel: legs forward, both hands ahead on it, a small steering wobble.
          const steer = osc(0.004) * 0.12;
          T[P_RISE] = sitDrop;
          T[P_LEGL_X] = T[P_LEGR_X] = -1.5;
          T[P_SPREAD] = 0.08;
          T[P_ARML_X] = -1.25 + steer;
          T[P_ARMR_X] = -1.25 - steer;
          T[P_ARML_Z] = -0.2;
          T[P_ARMR_Z] = 0.2;
          T[P_HIPS_X] = -0.05;
          T[P_HIPS_Z] = steer * 0.3;
          T[P_HEAD_Y] = steer;
          T[P_CAPE_X] = 0.5;
          break;
        }
      }
      return emote;
    }
    if (v.attacking?.with === 'shoot') {
      // Aiming the toy gun: right arm straight out, the left steadying it.
      T[P_ARMR_X] = -1.57 + osc(0.003) * 0.02;
      T[P_ARMR_Z] = 0.05;
      T[P_ARML_X] = -1.35;
      T[P_ARML_Z] = -0.45;
      T[P_HEAD_X] = 0.02;
      T[P_LEGL_X] = -0.2;
      T[P_LEGR_X] = 0.15;
      return 'aim';
    }
    if (activity === 'building') {
      // Hammering at the work: arm up and down, leaning in, looking at it.
      const swing = reduced ? -1 : Math.sin(t * 0.0125);
      T[P_ARMR_X] = -1.3 + 0.6 * swing;
      T[P_ARML_X] = -0.6;
      T[P_ARML_Z] = -0.15;
      T[P_HIPS_X] = 0.18;
      T[P_HEAD_X] = 0.25;
      T[P_LEGL_X] = -0.15;
      T[P_LEGR_X] = 0.12;
      return 'building';
    }
    if (heard) {
      waveArm();
      return 'wave';
    }
    // Idle: breathing and the odd look around.
    T[P_HIPS_X] = osc(0.0016) * 0.012;
    T[P_HEAD_Y] = osc(0.00037) * 0.35;
    T[P_HEAD_X] = 0.04;
    return 'idle';
  }

  function placeRig(f: Figure, P: Float32Array) {
    const d = f.dims;
    rig.position.set(f.x, f.lift, f.z);
    rig.rotation.set(0, f.facing + P[P_YAW], 0);
    rig.scale.setScalar(Math.max(0.001, f.vis));
    bones[B_BODY].position.set(0, P[P_RISE], P[P_SHIFT]);
    bones[B_BODY].rotation.set(P[P_PITCH], 0, P[P_ROLL]);
    bones[B_HIPS].position.set(0, d.hipY, 0);
    bones[B_HIPS].rotation.set(P[P_HIPS_X], 0, P[P_HIPS_Z]);
    bones[B_HEAD].position.set(0, d.neckY, 0);
    bones[B_HEAD].rotation.set(P[P_HEAD_X], P[P_HEAD_Y], 0);
    bones[B_ARM_L].position.set(d.shoulderX, d.shoulderY, 0);
    bones[B_ARM_L].rotation.set(P[P_ARML_X], 0, P[P_ARML_Z]);
    bones[B_ARM_R].position.set(-d.shoulderX, d.shoulderY, 0);
    bones[B_ARM_R].rotation.set(P[P_ARMR_X], 0, P[P_ARMR_Z]);
    bones[B_LEG_L].position.set(d.hipX, d.hipY, 0);
    bones[B_LEG_L].rotation.set(P[P_LEGL_X], 0, P[P_SPREAD]);
    bones[B_LEG_R].position.set(-d.hipX, d.hipY, 0);
    bones[B_LEG_R].rotation.set(P[P_LEGR_X], 0, -P[P_SPREAD]);
    bones[B_CAPE].position.set(0, d.shoulderY, d.capeZ);
    bones[B_CAPE].rotation.set(P[P_CAPE_X], 0, 0);
    rig.updateMatrixWorld(true);
  }

  let lastPoseAt = 0;
  let latestIds = new Set<string>(); // dudes in the newest snapshot, applied or not
  let selectedForRing: string | undefined;

  function pose(now: number, reduced: boolean, renderTime: number, serverNow: number, live: boolean) {
    const dt = lastPoseAt ? Math.min(0.1, (now - lastPoseAt) / 1000) : 0;
    lastPoseAt = now;
    const ease = reduced ? 1 : 1 - Math.exp(-dt * POSE_RATE);
    const turnEase = reduced ? 1 : 1 - Math.exp(-dt * TURN_RATE);
    const needed = new Array<number>(SHAPE_COUNT).fill(0);
    for (const f of figures.values()) for (let s = 0; s < SHAPE_COUNT; s++) needed[s] += f.counts[s];
    batches.forEach((b, s) => {
      b.ensure(needed[s]);
      b.n = 0;
    });
    stars.ensure(figures.size * 3);
    stars.n = 0;
    for (const f of figures.values()) {
      if (!f.synced) continue;
      const v = f.view;
      const p = f.track.at(renderTime);
      const moving = live && !!p?.moving;
      // Speed from how far the drawn figure moved this frame; the gait's phase advances with it.
      if (dt > 0 && p) {
        const inst = Math.min(6, Math.hypot(p.x - f.x, p.z - f.z) / dt);
        f.speed += ((moving ? inst : 0) - f.speed) * (1 - Math.exp(-dt * 6));
        f.gait += dt * 9.5 * clamp(f.speed / 2.4, 0.6, 1.9);
      }
      if (p) {
        f.x = p.x;
        f.z = p.z;
      }
      const activity = p?.tag ?? v.activity;
      // Building faces the work; everything else faces the way the server says.
      let facing = p?.facing ?? v.facing;
      const at = v.job?.at;
      if (activity === 'building' && !moving && at && Math.hypot(at.x - f.x, at.z - f.z) > 0.3)
        facing = Math.atan2(at.x - f.x, at.z - f.z);
      // Aboard a build the figure turns with it, unsmoothed, so it never lags the vehicle.
      f.facing = f.fresh || v.riding ? facing : turn(f.facing, facing, turnEase);
      const wantLift = p?.y ?? v.y ?? 0;
      f.lift = f.fresh || reduced ? wantLift : f.lift + (wantLift - f.lift) * (1 - Math.exp(-dt * LIFT_RATE));
      const wantVis = v.hidden ? 0 : 1;
      f.vis = f.fresh || reduced ? wantVis : f.vis + (wantVis - f.vis) * (1 - Math.exp(-dt * HIDE_RATE));
      if (Math.abs(f.vis - wantVis) < 0.01) f.vis = wantVis;
      f.poseName = targetPose(f, target, now, serverNow, reduced, moving, activity);
      if (f.fresh) {
        f.cur.set(target);
        f.fresh = false;
      } else {
        const k = f.poseName === 'walk' && !reduced ? 1 - Math.exp(-dt * POSE_RATE * 2.2) : ease;
        for (let i = 0; i < CHANNELS; i++) f.cur[i] += (target[i] - f.cur[i]) * k;
      }
      const armed = v.attacking?.with;
      f.tool =
        f.poseName === 'ko' ? '' : f.poseName === 'building' ? 'hammer' : armed === 'shoot' ? 'gun' : armed === 'bomb' ? 'bomb' : '';
      const wantDim = v.away ? 0.6 : 1;
      f.dim = reduced ? wantDim : f.dim + (wantDim - f.dim) * (1 - Math.exp(-dt * 3));
      f.rise = f.cur[P_RISE];
      placeRig(f, f.cur);
      if (f.vis <= 0) continue; // inside a build: nothing to draw
      // The overlay anchor: just above the hat, wherever the head is (sitting, lying, bowing).
      f.anchor.setFromMatrixPosition(bones[B_HEAD].matrixWorld);
      f.anchor.y += f.dims.crown;
      for (const part of f.parts) {
        if (part.tool && part.tool !== f.tool) continue;
        const b = batches[part.shape];
        const i = b.n++;
        tmp.multiplyMatrices(bones[part.bone].matrixWorld, part.local);
        b.inst.setMatrixAt(i, tmp);
        b.inst.setColorAt(i, col.copy(part.color).multiplyScalar(f.dim));
        b.owners[i] = f.id;
      }
      // Seeing stars: three little ones circling over the head while knocked out.
      if (f.poseName === 'ko') {
        for (let k = 0; k < 3; k++) {
          const a = (reduced ? 0 : now * 0.004) + (k * Math.PI * 2) / 3 + f.phase;
          starScratch.position.set(
            f.anchor.x + Math.cos(a) * 0.32,
            f.anchor.y - 0.1 + (reduced ? 0 : Math.sin(a * 2) * 0.05),
            f.anchor.z + Math.sin(a) * 0.32,
          );
          starScratch.rotation.set(0, a * 2, 0);
          starScratch.updateMatrix();
          if (stars.n >= stars.capacity) stars.ensure(stars.n + 1);
          stars.inst.setMatrixAt(stars.n, starScratch.matrix);
          stars.inst.setColorAt(stars.n, col.setHex(STAR));
          stars.owners[stars.n++] = f.id;
        }
      }
    }
    for (const b of batches) b.finish();
    stars.finish();
    const sel = selectedForRing ? figures.get(selectedForRing) : undefined;
    ring.visible = !!sel;
    if (sel) ring.position.set(sel.x, 0.02, sel.z);
  }

  // --- overlay ---

  interface Rect {
    l: number;
    t: number;
    r: number;
    b: number;
  }
  const hit = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const setTransform = (e: HTMLElement, key: 'tag' | 'say' | 'think' | 'zz', f: Figure, value: string) => {
    if (f.last[key] === value) return;
    f.last[key] = value;
    e.style.transform = value;
  };
  const show = (e: HTMLElement, on: boolean) => {
    if (e.hidden === on) e.hidden = !on;
  };

  function overlayPass(camera: THREE.Camera, serverNow: number, opts: OverlayOptions) {
    selectedForRing = opts.selected;
    const W = innerWidth,
      H = innerHeight,
      margin = 8;
    type Item = { f: Figure; rx: number; ry: number; on: boolean; prio: number; tagW: number; tagH: number; tagShown: boolean };
    const items: Item[] = [];
    for (const f of figures.values()) {
      if (!f.synced) continue;
      const v = f.view;
      anchorScratch.copy(f.anchor).project(camera);
      // Inside a build: no tag, no bubble, nothing over a figure that is not there.
      const on =
        !v.hidden && anchorScratch.z < 1 && Math.abs(anchorScratch.x) < 1.02 && Math.abs(anchorScratch.y) < 1.02;
      const rx = ((anchorScratch.x + 1) / 2) * W,
        ry = ((1 - anchorScratch.y) / 2) * H;
      const sayActive = !!v.say && v.say.until > serverNow;
      const spokeRecently = sayActive || (v.heardAt !== undefined && serverNow - v.heardAt < TAG_RECENT_MS);
      const pinned = f.id === opts.hovered || f.id === opts.selected;
      // Recency of speech ranks the tags; the hovered or selected one always wins.
      // Troublemakers always keep their tag; so do the hovered and the selected.
      const prio = pinned || v.npc
        ? Infinity
        : Math.max(v.heardAt ?? 0, sayActive ? serverNow : 0) + (v.thinking ? 2 : 0) + (v.job ? 1 : 0);
      const tagW = Math.max(f.nameLine.length * metrics.char, f.jobLine.length * metrics.jobChar) + metrics.pad;
      const tagH = metrics.height + (f.jobLine ? metrics.jobHeight : 0);
      const busy = !!v.thinking || !!v.job || !!v.use || !!v.attacking || v.activity === 'using' || (v.ko ?? 0) > serverNow;
      const wanted = on && (!v.away || pinned || spokeRecently || busy || !!v.npc);
      items.push({ f, rx, ry, on, prio, tagW, tagH, tagShown: wanted });
    }
    // Tags: greedy, most recent speaker first; one that would overlap an accepted tag is hidden.
    items.sort((a, b) => (a.prio === b.prio ? 0 : b.prio > a.prio ? 1 : -1)); // Infinity − Infinity is NaN
    const taken: Rect[] = opts.reserve ? [opts.reserve] : [];
    for (const it of items) {
      if (!it.tagShown) continue;
      const r: Rect = { l: it.rx - it.tagW / 2, t: it.ry - it.tagH, r: it.rx + it.tagW / 2, b: it.ry };
      if (it.prio !== Infinity && taken.some((o) => hit(o, r))) {
        it.tagShown = false;
        continue;
      }
      taken.push(r);
    }
    /** A bubble whose top would sit under the reserved rect drops to just below it instead. */
    const belowReserve = (l: number, r: number, bottom: number, h: number) => {
      const z = opts.reserve;
      if (!z || r < z.l || l > z.r || bottom - h > z.b || bottom < z.t) return bottom;
      return z.b + 4 + h;
    };
    // Bubbles: never hidden for crowding, but nudged up above one already placed. Placed in the
    // same order (most recent first), then any other dude's tag a bubble covers is dropped.
    const bubbles: (Rect & { owner: Figure })[] = [];
    for (const it of items) {
      const f = it.f,
        v = f.view;
      const sayActive = !!f.sayText && !!v.say && v.say.until > serverNow;
      const thinking = !sayActive && !!v.thinking;
      const base = it.ry - (it.tagShown ? it.tagH + 5 : 4);
      if (sayActive && it.on) {
        if (f.say.hidden) {
          f.say.hidden = false;
          f.sayW = f.say.offsetWidth;
          f.sayH = f.say.offsetHeight;
        }
        const w = f.sayW,
          h = f.sayH;
        const cx = clamp(it.rx, margin + w / 2, W - margin - w / 2);
        let bottom = base;
        for (let tries = 0; tries < 6; tries++) {
          const r: Rect = { l: cx - w / 2, t: bottom - h, r: cx + w / 2, b: bottom };
          const over = bubbles.find((o) => hit(o, r));
          if (!over) break;
          bottom = over.t - 4;
        }
        bottom = belowReserve(cx - w / 2, cx + w / 2, Math.max(margin + h, bottom), h);
        bubbles.push({ l: cx - w / 2, t: bottom - h, r: cx + w / 2, b: bottom, owner: f });
        const tail = clamp(it.rx - (cx - w / 2), 14, w - 14);
        setTransform(f.say, 'say', f, `translate(${Math.round(cx)}px,${Math.round(bottom)}px) translate(-50%,-100%)`);
        f.say.style.setProperty('--tail', `${Math.round(tail)}px`);
      } else show(f.say, false);
      show(f.think, thinking && it.on);
      if (thinking && it.on) {
        // The "…" stacks like a bubble, so a line being said never sits on top of it.
        const w = 40 * opts.uiScale,
          h = 20 * opts.uiScale;
        let bottom = base;
        for (let tries = 0; tries < 6; tries++) {
          const r: Rect = { l: it.rx - w / 2, t: bottom - h, r: it.rx + w / 2, b: bottom };
          const over = bubbles.find((o) => hit(o, r));
          if (!over) break;
          bottom = over.t - 4;
        }
        bottom = belowReserve(it.rx - w / 2, it.rx + w / 2, bottom, h);
        bubbles.push({ l: it.rx - w / 2, t: bottom - h, r: it.rx + w / 2, b: bottom, owner: f });
        setTransform(f.think, 'think', f, `translate(${Math.round(it.rx)}px,${Math.round(bottom)}px) translate(-50%,-100%)`);
      }
      const napping = !!v.away && it.on;
      show(f.zz, napping);
      if (napping)
        setTransform(f.zz, 'zz', f, `translate(${Math.round(it.rx + 10 * opts.uiScale)}px,${Math.round(it.ry + 4)}px)`);
    }
    // Last, the tags: a line being said beats a name underneath it.
    for (const it of items) {
      const f = it.f;
      if (it.tagShown && it.prio !== Infinity) {
        const r: Rect = { l: it.rx - it.tagW / 2, t: it.ry - it.tagH, r: it.rx + it.tagW / 2, b: it.ry };
        if (bubbles.some((o) => o.owner !== f && hit(o, r))) it.tagShown = false;
      }
      show(f.tag, it.tagShown);
      if (it.tagShown)
        setTransform(f.tag, 'tag', f, `translate(${Math.round(it.rx)}px,${Math.round(it.ry)}px) translate(-50%,-100%)`);
    }
  }

  return {
    root,
    sample(list, serverTime) {
      latestIds = new Set(list.map((v) => v.id));
      for (const v of list) {
        let f = figures.get(v.id);
        if (!f) figures.set(v.id, (f = build(v)));
        f.track.sample({ t: serverTime, x: v.position.x, y: v.y ?? 0, z: v.position.z, facing: v.facing, tag: v.activity });
      }
    },
    sync(list, nameOf, serverNow = Infinity) {
      if (nameOf) objectName = nameOf;
      const seen = new Set<string>();
      for (const v of list) {
        seen.add(v.id);
        let f = figures.get(v.id);
        if (!f) figures.set(v.id, (f = build(v)));
        f.view = v;
        f.synced = true;
        const key = lookKeyOf(v.look);
        if (key !== f.lookKey) {
          const { parts, dims, counts } = compose({ ...DEFAULT_LOOK, ...(v.look ?? {}) });
          f.parts = parts;
          f.dims = dims;
          f.counts = counts;
          f.lookKey = key;
        }
        // "dave · the pigeon whisperer", and under it what it is working on.
        // A troublemaker's tag is just the name, in its own colours.
        const title = v.npc ? undefined : v.title;
        const nameLine = title ? `${v.name} · ${title}` : v.name;
        if (nameLine !== f.nameLine) {
          f.nameLine = nameLine;
          f.tagName.textContent = v.name;
          f.tagTitle.textContent = title ? ` · ${title}` : '';
        }
        if (f.tag.classList.contains('npc') !== !!v.npc) f.tag.classList.toggle('npc', !!v.npc);
        const jobLine = jobLineOf(v, serverNow);
        if (jobLine !== f.jobLine) {
          f.jobLine = jobLine;
          f.tagJob.textContent = jobLine;
          f.tagJob.hidden = !jobLine;
          f.tagJob.classList.toggle('ko', jobLine === 'knocked out');
        }
        const text = v.say?.text ?? '';
        if (text !== f.sayText) {
          f.sayText = text;
          f.say.textContent = text;
          f.say.classList.toggle('long', text.length > 90);
          // Re-measured the next time it is placed; a fresh line pops in.
          f.say.hidden = true;
          f.say.classList.remove('pop');
          if (text) {
            void f.say.offsetWidth;
            f.say.classList.add('pop');
          }
        }
      }
      // Gone from this snapshot and from the newest one too: gone. One only the newest knows waits for its turn.
      for (const id of [...figures.keys()]) if (!seen.has(id) && !latestIds.has(id)) remove(id);
    },
    pose,
    overlay: overlayPass,
    pick(clientX, clientY, camera) {
      let best: string | undefined,
        bestD = Infinity;
      for (const f of figures.values()) {
        if (!f.synced || f.view.hidden) continue;
        footScratch.set(f.x, f.lift + Math.max(0, f.rise) + 0.1, f.z).project(camera);
        anchorScratch.copy(f.anchor).project(camera);
        const ax = ((footScratch.x + 1) / 2) * innerWidth,
          ay = ((1 - footScratch.y) / 2) * innerHeight,
          bx = ((anchorScratch.x + 1) / 2) * innerWidth,
          by = ((1 - anchorScratch.y) / 2) * innerHeight;
        const dx = bx - ax,
          dy = by - ay,
          len2 = dx * dx + dy * dy;
        const u = len2 ? clamp(((clientX - ax) * dx + (clientY - ay) * dy) / len2, 0, 1) : 0;
        const d = Math.hypot(clientX - (ax + dx * u), clientY - (ay + dy * u));
        // Half a body's width either side of the spine, in pixels at this zoom, and never fiddly.
        const tolerance = Math.max(10, (Math.sqrt(len2) / 2) * 0.35);
        if (d < tolerance && d < bestD) {
          bestD = d;
          best = f.id;
        }
      }
      return best;
    },
    view: (id) => figures.get(id)?.view,
    positionOf(id) {
      const f = figures.get(id);
      return f ? { x: f.x, y: f.lift + f.rise, z: f.z } : undefined;
    },
    poseOf: (id) => figures.get(id)?.poseName,
    headOf: (id) => figures.get(id)?.anchor,
    count: () => [...figures.values()].filter((f) => f.synced).length,
    each(fn) {
      for (const f of figures.values()) if (f.synced) fn(f.x, f.z, f.view);
    },
    measure,
    dispose() {
      for (const id of [...figures.keys()]) remove(id);
      for (const b of batches) b.dispose();
      for (const g of geometries) g.dispose();
      stars.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      material.dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      parent.remove(root);
    },
  };
}

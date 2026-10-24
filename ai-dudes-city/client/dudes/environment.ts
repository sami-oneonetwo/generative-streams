// The town. The layout comes from src/shared/city.ts, the same functions the server hands lots out
// with, so the lot drawn here is the lot a character owns and builds on. What everything looks like
// comes from the town's age (docs/ages.md): the age's world rules (src/shared/ageBibles.json: ground
// surfaces, whether there are pavements and kerbs, light) and its pieces, designed on the design board
// (client/dudes/agePieces.json: road details, lot markers and boundaries, street trees, lights, the
// square's centrepiece, seating and stall, the arrival point, the river crossing, the caravan camp,
// the countryside's trees). Mud tracks and a bonfire in the Stone Age, cobbles and a market cross in
// the Middle Ages, setts and gas lamps in the Industrial, a fire barrel in the Wasteland.
// Pieces used many times are instanced (pieces.ts); only the lots change with the snapshot. A new age
// throws the scenery away and builds it again (`setAge`); the builds and people on top stay.
// The sun's shadow box follows the camera's framing (`frame`), so shadows stay crisp at any zoom.

import * as THREE from 'three';
import { BLOCK_HALF, CITY, CITY_BOUNDS, PITCH, RIVER, SQUARE, BUS_STOP, allPlots, avenueName, courtyards, parks, roadLines, streetName, type PlotInfo } from '../../src/shared/city';
import { AGE_IDS, MODERN } from '../../src/shared/ages';
import BIBLES from '../../src/shared/ageBibles.json';
import PIECES from './agePieces.json';
import { ground, isShared, seeded, vary, type Surface } from './surfaces';
import { OWNER_COLOUR, PIECE_MATERIALS, disposePiece, instancePiece, mergePiece, placePiece, placementMatrix, type MergedPiece, type Piece, type Placement } from './pieces';
import type { TownView } from './types';
import { STORY_SITES } from '../../src/shared/storyMap'; // hook FK-023

export interface EnvironmentHandles {
  world: THREE.Group;
  /** Per frame: keep the sun's shadow box on what the camera is framing. */
  frame(x: number, z: number, half: number): void;
  /** Who owns which lot, the districts, the party: from every applied snapshot. */
  town(view: TownView | undefined): void;
  update(now: number, reducedMotion: boolean): void;
  /** The town's age from the snapshot: a different age rebuilds the scenery in its style. */
  setAge(age: number): void;
}

interface Bible {
  id: string;
  name: string;
  rules?: { sidewalks?: boolean; kerbs?: boolean };
  surfaces: Record<'countryside' | 'road' | 'lotRough' | 'lotClaimed' | 'square' | 'bank' | 'water', Surface> & { pavement?: Surface | null };
  light?: { sky?: string; fog?: string; sun?: string; sunIntensity?: number; hemiSky?: string; hemiGround?: string; hemiIntensity?: number };
  palette?: string[];
}
const AGE_BIBLES = BIBLES as unknown as Bible[];
const AGE_PIECES = PIECES as unknown as Record<string, Record<string, Piece | undefined>>;

const SUN_DIR = new THREE.Vector3(-15, 28, 10).normalize();
/** The stream camera's usual turn (main.ts): name plates face it. */
const CAMERA_YAW = 0.65;
/** The stream camera stands 12× further back than it used to (main.ts CAM_FAR); fog is measured from it, so it starts that much further away. */
const FOG_SHIFT = Math.hypot(43, 36) * (12 - 1);
const SHADOW_MAP = 2048;
/** The road's centre lines, and where the road is between them (junctions are a road wide). */
const ROAD_HALF = CITY.road / 2;
/** Where the camp and the path to it are, across the river. */
const CAMP = { x: RIVER.x + RIVER.width / 2 + 22, z: 0 };

const colour = (hex: string | undefined, fallback: string) => new THREE.Color(/^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex! : fallback);

/** A sign's face: a name painted on a board, as a texture. */
function signTexture(lines: string[], bg: string, fg: string, w = 256, h = 96): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, 14);
  g.fill();
  g.strokeStyle = fg;
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(5, 5, w - 10, h - 10, 10);
  g.stroke();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    let size = Math.round((lines.length === 1 ? 44 : i ? 24 : 38) * (h / 96));
    g.font = `700 ${size}px 'Trebuchet MS', sans-serif`;
    while (g.measureText(line).width > w - 26 && size > 12) g.font = `700 ${(size -= 2)}px 'Trebuchet MS', sans-serif`;
    g.fillText(line, w / 2, lines.length === 1 ? h / 2 : h * (0.36 + i * 0.34));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A floating label (street names), always facing the camera. */
function label(text: string, colourCss: string, scale: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext('2d')!;
  g.font = `800 52px 'Trebuchet MS', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(20,32,26,0.85)';
  g.strokeText(text, 256, 48);
  g.fillStyle = colourCss;
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(scale * 5.33, scale, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/** The town in one age: everything static, the lots, the lights. `dispose` takes it all away again. */
interface Scenery {
  frame(x: number, z: number, half: number): void;
  town(view: TownView | undefined): void;
  update(now: number, reducedMotion: boolean): void;
  dispose(): void;
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const world = new THREE.Group();
  scene.add(world);
  let age = -1,
    current: Scenery | undefined,
    lastView: TownView | undefined,
    lastFrame: [number, number, number] = [0, 0, 40];
  function setAge(next: number): void {
    if (next === age) return;
    age = next;
    current?.dispose();
    current = buildScenery(scene, world, next);
    current.frame(...lastFrame);
    current.town(lastView);
  }
  setAge(MODERN);
  return {
    world,
    frame(x, z, half) {
      lastFrame = [x, z, half];
      current!.frame(x, z, half);
    },
    town(view) {
      if (view) lastView = view;
      current!.town(view);
    },
    update: (now, reducedMotion) => current!.update(now, reducedMotion),
    setAge,
  };
}

/** Turn about y that points a piece's own +z the way (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

function buildScenery(scene: THREE.Scene, parent: THREE.Group, ageIndex: number): Scenery {
  const ageId = AGE_IDS[ageIndex] ?? AGE_IDS[MODERN];
  const bible = AGE_BIBLES.find((b) => b.id === ageId) ?? AGE_BIBLES[MODERN];
  const pieces = AGE_PIECES[ageId] ?? {};
  const S = bible.surfaces;
  const pavement = bible.rules?.sidewalks === false ? null : (S.pavement ?? null);
  const world = new THREE.Group();
  parent.add(world);
  const merged = new Map<string, MergedPiece>();
  const piece = (id: string, recolour?: (hex: string) => string, key = id): MergedPiece => {
    let m = merged.get(key);
    if (!m) merged.set(key, (m = mergePiece(pieces[id], recolour)));
    return m;
  };
  const b = CITY_BOUNDS;
  const R = CITY.rings;
  const r = seeded(20261020 + ageIndex);
  const lines = roadLines();

  // --- the ground: countryside (with a gap where the river runs), the roads, then every block on top ---
  const rx0 = RIVER.x - RIVER.width / 2,
    rx1 = RIVER.x + RIVER.width / 2;
  ground(world, S.countryside, -450, rx0 - 2.4, -450, 450, -0.16);
  ground(world, S.countryside, rx1 + 2.4, 450, -450, 450, -0.16);
  // Roads as strips, so a pattern with a grain (ruts, setts, planks) runs along each one; avenues sit a hair higher where they cross.
  for (const k of lines) {
    ground(world, S.road, b.minX, b.maxX, k - ROAD_HALF, k + ROAD_HALF, -0.12);
    ground(world, S.road, k - ROAD_HALF, k + ROAD_HALF, b.minZ, b.maxZ, -0.118, true);
  }
  const kerbs: THREE.Matrix4[] = [];
  const raised = !!pavement && bible.rules?.kerbs !== false;
  /** Lots and the square sit here; builds and people stand on 0. */
  const LOT_Y = -0.02;
  for (let bx = -R; bx <= R; bx++)
    for (let bz = -R; bz <= R; bz++) {
      const cx = bx * PITCH,
        cz = bz * PITCH;
      if (bx === 0 && bz === 0) {
        ground(world, S.square, cx - BLOCK_HALF, cx + BLOCK_HALF, cz - BLOCK_HALF, cz + BLOCK_HALF, LOT_Y);
        continue;
      }
      // The walking edge: a 2 m ring round the block. A pavement (raised behind a kerb when the age
      // has kerbs), or, before pavements, the trampled ground of the lots running down to the road.
      // The lots inside it are drawn per claim (town()).
      const edge = pavement ?? S.lotRough;
      const y = raised ? 0.02 : -0.08;
      const inner = BLOCK_HALF - CITY.sidewalk;
      ground(world, edge, cx - BLOCK_HALF, cx + BLOCK_HALF, cz + inner, cz + BLOCK_HALF, y);
      ground(world, edge, cx - BLOCK_HALF, cx + BLOCK_HALF, cz - BLOCK_HALF, cz - inner, y);
      ground(world, edge, cx - BLOCK_HALF, cx - inner, cz - inner, cz + inner, y, true);
      ground(world, edge, cx + inner, cx + BLOCK_HALF, cz - inner, cz + inner, y, true);
      if (raised)
        for (const [w, d, ox, oz] of [
          [BLOCK_HALF * 2 + 0.3, 0.3, 0, BLOCK_HALF],
          [BLOCK_HALF * 2 + 0.3, 0.3, 0, -BLOCK_HALF],
          [0.3, BLOCK_HALF * 2, BLOCK_HALF, 0],
          [0.3, BLOCK_HALF * 2, -BLOCK_HALF, 0],
        ])
          kerbs.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + ox, -0.04, cz + oz), new THREE.Quaternion(), new THREE.Vector3(w, 0.16, d)));
    }
  if (kerbs.length && pavement) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: colour(vary(pavement.accent ?? pavement.base, -0.05), '#9a958a'), roughness: 0.9 }), kerbs.length);
    kerbs.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.receiveShadow = true;
    world.add(inst);
  }

  // --- every home block's courtyard: the middle cell, left green, with a tree or two ---
  const yard: Placement[] = [];
  const YARD = CITY.plot / 2 - 0.4;
  for (const c of courtyards()) {
    ground(world, S.countryside, c.x - YARD, c.x + YARD, c.z - YARD, c.z + YARD, LOT_Y);
    // One tree, now and then two: the town reads clearer with less in it (Sami 2026-10-23).
    const n = r() < 0.7 ? 1 : 2;
    for (let i = 0; i < n; i++) yard.push({ x: c.x + (r() - 0.5) * YARD * 1.2, z: c.z + (r() - 0.5) * YARD * 1.2, turn: r() * Math.PI * 2, scale: 0.7 + r() * 0.4, mirror: r() < 0.5 });
  }
  // --- the corner blocks: little parks, green inside their pavement, a few trees ---
  const PARK = BLOCK_HALF - CITY.sidewalk;
  for (const c of parks()) {
    ground(world, S.countryside, c.x - PARK, c.x + PARK, c.z - PARK, c.z + PARK, LOT_Y);
    const placed: { x: number; z: number }[] = [];
    for (let i = 0; i < 40 && placed.length < 4; i++) {
      const x = c.x + (r() - 0.5) * PARK * 1.7,
        z = c.z + (r() - 0.5) * PARK * 1.7;
      if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > 4.5)) placed.push({ x, z });
    }
    for (const p of placed) yard.push({ ...p, turn: r() * Math.PI * 2, scale: 0.75 + r() * 0.45, mirror: r() < 0.5 });
  }
  // hook FK-023: park trees on the Folly's plot (a little round it) go in a group of their own, hidden while Story is on.
  const follyRect = STORY_SITES.folly.rect; // hook FK-023
  const follyTrees = yard.filter((p) => p.x > follyRect.minX - 2 && p.x < follyRect.maxX + 2 && p.z > follyRect.minZ - 2 && p.z < follyRect.maxZ + 2); // hook FK-023
  for (const p of follyTrees) yard.splice(yard.indexOf(p), 1); // hook FK-023

  // --- the river east of the ring road, its banks, and the path out to the camp across it ---
  ground(world, S.water, rx0, rx1, -450, 450, -0.38);
  ground(world, S.bank, rx0 - 2.4, rx0, -450, 450, -0.13);
  ground(world, S.bank, rx1, rx1 + 2.4, -450, 450, -0.13);
  for (const x of [rx0, rx1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 900), new THREE.MeshStandardMaterial({ color: colour(S.bank.accent ?? S.bank.base, '#8a7a58'), roughness: 1 }));
    wall.position.set(x, -0.265, 0);
    world.add(wall);
  }
  ground(world, S.lotRough, b.maxX, rx0 - 2.4, -2.2, 2.2, -0.11);
  ground(world, S.lotRough, rx1 + 2.4, CAMP.x - 6, -2.2, 2.2, -0.11);

  // No street details, street trees or lamp posts: a detail every 12 m down every road, a tree at
  // every lot and a light per block read as clutter on a phone (Sami 2026-10-23). The parks and
  // courtyards carry the green.

  // --- the countryside: wild trees and the ground's own bits, clear of the river, the path and the camp ---
  const wild: Placement[] = [],
    bits: Placement[] = [];
  const clear = (x: number, z: number, pad: number) =>
    Math.max(Math.abs(x), Math.abs(z)) > b.maxX + pad && !(x > rx0 - pad - 3 && x < rx1 + pad + 3) && !(Math.hypot(x - CAMP.x, z - CAMP.z) < 16 + pad) && !(x > b.maxX && Math.abs(z) < 3 + pad);
  for (let i = 0; i < 520 && wild.length < 60; i++) {
    const a = r() * Math.PI * 2,
      d = b.maxX + 14 + Math.pow(r(), 0.7) * 110;
    const x = Math.cos(a) * d * (1 + r() * 0.1),
      z = Math.sin(a) * d;
    if (clear(x, z, 7) && wild.every((w) => Math.hypot(w.x - x, w.z - z) > 14)) wild.push({ x, z, turn: r() * Math.PI * 2, scale: 0.75 + r() * 0.55, mirror: r() < 0.5 });
  }
  for (let i = 0; i < 400 && bits.length < 40; i++) {
    const a = r() * Math.PI * 2,
      d = b.maxX + 6 + r() * 120;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    if (clear(x, z, 4)) bits.push({ x, z, turn: r() * Math.PI * 2, scale: 0.9 + r() * 0.3 });
  }
  // hook FK-078: the River Bank (TOWN_GROUND, the ring road out to the water) is walked on now: no wild trees or bits on it.
  for (const list of [wild, bits]) for (const p of list.filter((q) => q.x > 0 && q.x < rx0 && Math.abs(q.z) < b.maxZ + 4)) list.splice(list.indexOf(p), 1); // hook FK-078
  instancePiece(piece('wild-tree'), [...wild, ...yard], world);
  const follyGroup = new THREE.Group(); // hook FK-023
  const follyDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === 'folly'; // hook FK-024
  world.add(follyGroup); // hook FK-023
  if (follyTrees.length) instancePiece(piece('wild-tree'), follyTrees, follyGroup); // hook FK-023
  // The ground's bits blended most of the way into the grass, so people and builds stand out.
  const into = (base: string, k: number) => (hex: string) => `#${new THREE.Color(hex).lerp(new THREE.Color(base), k).getHexString()}`;
  instancePiece(piece('ground', into(S.countryside.base, 0.4)), bits, world, false);

  // --- the square: the centrepiece, seating, the stall, and where newcomers arrive ---
  const square = new THREE.Group();
  world.add(square);
  // It makes way for the age's Wonder, which goes up on the same spot (town.wonder).
  const centrepiece = placePiece(piece('centrepiece'), { x: SQUARE.fountain.x, z: SQUARE.fountain.z }, square);
  for (const [x, z, turn] of [
    [3.8, 0, -Math.PI / 2],
    [-3.8, 0, Math.PI / 2],
    [0, -3.8, 0],
  ] as const)
    placePiece(piece('bench'), { x, z, turn }, square);
  placePiece(piece('market'), { x: SQUARE.market.x, z: SQUARE.market.z }, square);
  // The arrival point: its stop on the square's walking edge, what brings newcomers on the road.
  placePiece(piece('arrival'), { x: BUS_STOP.x, z: PITCH / 2, turn: Math.PI }, square);
  // The crossing over the river and the camp beyond it.
  // The bridge is its own group: while the travellers are stuck (town.bridge), its deck is gone, a log
  // or two floats in the water, and the deck comes back part by part as people mend it, town side first.
  const bridgeGroup = new THREE.Group();
  world.add(bridgeGroup);
  let bridgeKey = '';
  function drawBridge(progress: number | undefined): void {
    const parts = pieces['river']?.parts ?? [];
    const span = Math.max(1, ...parts.map((p) => Math.abs(p.position[2])));
    // The deck: what stands above the water out over the river, not the landings on either bank.
    const deck = parts.filter((p) => Math.abs(p.position[2]) < span * 0.62 && p.position[1] > 0.55).sort((a, b) => a.position[2] - b.position[2]);
    const back = progress === undefined ? deck.length : Math.floor(Math.min(1, progress) * deck.length + 1e-6);
    const key = `${back}/${deck.length}`;
    if (key === bridgeKey) return;
    bridgeKey = key;
    bridgeGroup.clear();
    const gone = new Set(deck.slice(back));
    const debris = progress !== undefined && progress < 1 ? [...gone].slice(0, 2).map((p, i) => ({ ...p, position: [p.position[0] + (i ? -3.4 : 3.1), -0.16, p.position[2] * 0.6 + (i ? 1.4 : -0.8)] as [number, number, number], rotation: [p.rotation[0] + (i ? 0.12 : -0.1), p.rotation[1] + (i ? 0.7 : -0.5), p.rotation[2] + 0.2] as [number, number, number] })) : [];
    const id = `river:${key}`;
    let m = merged.get(id);
    if (!m) merged.set(id, (m = mergePiece({ ...pieces['river']!, parts: [...parts.filter((p) => !gone.has(p)), ...debris] })));
    placePiece(m, { x: RIVER.x, z: 0, turn: Math.PI / 2 }, bridgeGroup);
  }
  drawBridge(undefined);
  placePiece(piece('camp'), { x: CAMP.x, z: CAMP.z, turn: -Math.PI / 2 }, world);

  // Street names floating over the junctions near the square, so "7 Maple Street" means something.
  const names = new THREE.Group();
  world.add(names);
  lines.forEach((k, i) => {
    const kk = i - CITY.rings - 1;
    const st = label(streetName(kk).toUpperCase(), '#efe6c8', 1.4);
    st.position.set(b.minX + 6, 1.6, k);
    names.add(st);
    const av = label(avenueName(kk).toUpperCase(), '#efe6c8', 1.4);
    av.position.set(k, 1.6, b.maxZ - 3);
    names.add(av);
  });

  // --- lots: free ground with the age's free-lot marker, or a claimed lot's boundary and the owner's name ---
  const lotGroup = new THREE.Group();
  world.add(lotGroup);
  const lots = new Map<string, { key: string; group: THREE.Group }>();
  const plateBg = bible.palette?.find((p) => new THREE.Color(p).getHSL({ h: 0, s: 0, l: 0 }).l > 0.75) ?? '#f3eedc';
  const plateFg = bible.palette?.find((p) => new THREE.Color(p).getHSL({ h: 0, s: 0, l: 0 }).l < 0.25) ?? '#2b3a2f';
  // Where the claimed-lot piece's owner marker stood (its parts in OWNER_COLOUR), and the piece without
  // that marker and anything standing within a metre of it.
  const claimedFull = pieces['lot-claimed'];
  const ownerParts = claimedFull?.parts.filter((p) => p.color.toLowerCase() === OWNER_COLOUR) ?? [];
  const claimedMarker = ownerParts.length
    ? new THREE.Vector3(
        ownerParts.reduce((a, p) => a + p.position[0], 0) / ownerParts.length,
        Math.max(...ownerParts.map((p) => p.position[1] + p.size[1] / 2)),
        ownerParts.reduce((a, p) => a + p.position[2], 0) / ownerParts.length,
      )
    : undefined;
  /** A home lot is CITY.plot m; the board designed lot pieces in a 13 m room with the street at +z and the block's middle at −x. */
  function lotPlacement(plot: PlotInfo, room: number): Placement {
    const half = (plot.rect.maxX - plot.rect.minX) / 2;
    // The piece's +z to the road the lot fronts.
    const turn = facing(plot.front.x, plot.front.z);
    // Turned, the piece's −x points (−cos, sin): mirror it whenever that is away from the block's middle.
    const toMiddle = -Math.cos(turn) * -plot.sx + Math.sin(turn) * -plot.sz;
    return { x: plot.centre.x, z: plot.centre.z, turn, scale: half / room, scaleY: 1, mirror: toMiddle < -0.1 };
  }
  function drawLot(plot: PlotInfo, claim: TownView['lots'][number] | undefined, project: boolean): THREE.Group {
    const g = new THREE.Group();
    const { minX, maxX, minZ, maxZ } = plot.rect;
    ground(g, plot.civic ? S.lotRough : claim ? S.lotClaimed : S.lotRough, minX, maxX, minZ, maxZ, LOT_Y + 0.002);
    if (plot.civic) {
      // Facing the square's middle; mirrored like a home lot so all four markers sit the same way round.
      // An empty community lot is just its ground: no marker (Sami 2026-10-23, fewer signs about).
      void project;
      return g;
    }
    // A free lot is just its rough ground: no for-sale marker on every empty one (Sami 2026-10-23).
    if (!claim) return g;
    // The boundary without its owner's marker (a post with a sign on it read as a letterbox on every lot,
    // Sami 2026-10-23): the floating name plate says whose lot it is.
    // Nor its boundary posts: the lot's own ground colour and the plate say whose it is (Sami 2026-10-23).
    const place = lotPlacement(plot, 6.6);
    // The owner's name on a plate over their marker, nudged into their own lot along the street (the
    // neighbour's marker stands at the same corner) and turned to the stream's camera so it reads.
    const top = (claimedMarker ?? new THREE.Vector3(-5.5, 1.2, 5.7)).clone().applyMatrix4(placementMatrix(place));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.45), new THREE.MeshBasicMaterial({ map: signTexture([claim.owner, plot.address], plateBg, plateFg, 384, 146), side: THREE.DoubleSide }));
    plate.position.set(top.x + (plot.front.z ? plot.sx * 1.6 : 0), Math.max(2.2, top.y + 1.0), top.z + (plot.front.x ? plot.sz * 1.6 : 0));
    plate.rotation.y = CAMERA_YAW;
    g.add(plate);
    return g;
  }
  let townKey = '';
  let party: TownView['party'];
  const confettiGeo = new THREE.BoxGeometry(1, 1, 1);
  const confetti = new THREE.InstancedMesh(confettiGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 160);
  confetti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
  confetti.count = 0;
  world.add(confetti);

  function dropLot(id: string): void {
    const cur = lots.get(id);
    if (!cur) return;
    lotGroup.remove(cur.group);
    // Pieces are shared between lots (and freed with the scenery); the ground plane and the name plate are this lot's own.
    cur.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || PIECE_MATERIALS.includes(o.material as never)) return;
      o.geometry.dispose();
      if (isShared(o.material)) return;
      const mat = o.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    lots.delete(id);
  }
  function town(view: TownView | undefined): void {
    if (!view) return;
    const byId = new Map(view.lots.map((l) => [l.id, l]));
    const key = `${JSON.stringify(view.lots)}|${view.project?.plot ?? ''}`;
    if (key !== townKey) {
      townKey = key;
      for (const plot of allPlots()) {
        const claim = byId.get(plot.id);
        const k = `${claim ? `${claim.owner}|${claim.shirt}|${claim.away}` : ''}|${view.project?.plot === plot.id}`;
        if (lots.get(plot.id)?.key === k) continue;
        dropLot(plot.id);
        const group = drawLot(plot, claim, view.project?.plot === plot.id);
        lotGroup.add(group);
        lots.set(plot.id, { key: k, group });
      }
    }
    // District names used to float over their streets here; dropped (Sami 2026-10-22: not needed).
    drawBridge(view.bridge);
    centrepiece.visible = !view.wonder;
    follyGroup.visible = !view.story; // hook FK-023
    if (follyDemo) follyGroup.visible = false; // hook FK-024: `?demo=folly`'s fake Folly stands on the plot
    party = view.party;
  }

  // --- the age's light: its sky and fog, a hemisphere, and a sun with shadows that follow the framing ---
  const L = bible.light ?? {};
  const sky = colour(L.sky, '#bfd2dd');
  scene.background = sky;
  scene.fog = new THREE.Fog(colour(L.fog, `#${sky.getHexString()}`), 170 + FOG_SHIFT, 420 + FOG_SHIFT);
  const hemi = new THREE.HemisphereLight(colour(L.hemiSky, '#e3ecf2'), colour(L.hemiGround, '#6b7a4f'), Math.max(0.8, Math.min(3.2, L.hemiIntensity ?? 2.2)));
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(colour(L.sun, '#fff0d8'), Math.max(0.8, Math.min(3.2, L.sunIntensity ?? 2.4)));
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  scene.add(sun);
  scene.add(sun.target);
  let shadowHalf = 0;

  function frame(x: number, z: number, half: number): void {
    // The box only ever grows or shrinks in steps, and its centre snaps to whole texels, so the
    // shadow edges never crawl while the camera eases.
    const h = Math.max(14, Math.min(80, Math.ceil(half / 4) * 4));
    if (h !== shadowHalf) {
      shadowHalf = h;
      Object.assign(sun.shadow.camera, { left: -h, right: h, top: h, bottom: -h });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texel = (2 * h) / SHADOW_MAP;
    const sx = Math.round(x / texel) * texel,
      sz = Math.round(z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + SUN_DIR.x * 90, SUN_DIR.y * 90, sz + SUN_DIR.z * 90);
  }
  frame(0, 0, 40);

  const confettiColours = [0xe0523f, 0xe9c23c, 0x57d64a, 0x5fb3e8, 0xb07ad9, 0xf2ede0];
  const m4 = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    s = new THREE.Vector3();
  function update(now: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    // A party: confetti drifting down over it.
    if (party && party.until > Date.now()) {
      const c = new THREE.Color();
      confetti.count = 160;
      for (let i = 0; i < 160; i++) {
        const a = i * 2.39996,
          rad = 1 + ((i * 37) % 70) / 10;
        const fall = ((now * (0.6 + (i % 7) * 0.08) + i * 0.37) % 1) * 9;
        m4.compose(p.set(party.at.x + Math.cos(a + now * 0.3) * rad, 9.5 - fall, party.at.z + Math.sin(a + now * 0.3) * rad), q.setFromEuler(e.set(0, now * 3 + i, 0)), s.set(0.14, 0.02, 0.09));
        confetti.setMatrixAt(i, m4);
        confetti.setColorAt(i, c.setHex(confettiColours[i % confettiColours.length]));
      }
      confetti.instanceMatrix.needsUpdate = true;
      if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
      confetti.computeBoundingSphere();
    } else confetti.count = 0;
  }

  function dispose(): void {
    for (const id of [...lots.keys()]) dropLot(id);
    world.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.Sprite) {
        const mats = [o.material].flat() as (THREE.Material & { map?: THREE.Texture | null })[];
        for (const mat of mats) {
          if (isShared(mat) || PIECE_MATERIALS.includes(mat as never)) continue;
          if (mat.map && !isShared(mat.map)) mat.map.dispose();
          mat.dispose();
        }
        if (!(o instanceof THREE.Sprite)) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
    for (const m of merged.values()) disposePiece(m);
    parent.remove(world);
    sun.shadow.map?.dispose();
    scene.remove(hemi, sun, sun.target);
  }

  return { frame, town, update, dispose };
}

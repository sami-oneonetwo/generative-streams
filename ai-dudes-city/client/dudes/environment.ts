// The town. The layout comes from src/shared/city.ts, the same functions the server hands lots out
// with, so the lot drawn here is the lot a character owns and builds on. Roads with dashed centre
// lines run between the blocks; every block has a pavement round it, street trees and lamps at its
// corners, and four lots: rough grass with a FOR SALE sign until someone moves in, then a mown lawn
// with a low hedge and a sign with their name. The middle block is the town square: a paved cross,
// the fountain, the market stall and four community lots. Beyond the ring road is countryside.
// Static geometry is instanced and built once; only the lots and their signs change with the snapshot.
// The sun's shadow box follows the camera's framing (`frame`), so shadows stay crisp at any zoom.

import * as THREE from 'three';
import { BLOCK_HALF, CITY, CITY_BOUNDS, PITCH, SQUARE, BUS_STOP, allPlots, avenueName, roadLines, streetName, type PlotInfo } from '../../src/shared/city';
import type { TownView } from './types';

export interface EnvironmentHandles {
  world: THREE.Group;
  /** Per frame: keep the sun's shadow box on what the camera is framing. */
  frame(x: number, z: number, half: number): void;
  /** Who owns which lot, the districts, the party: from every applied snapshot. */
  town(view: TownView | undefined): void;
  update(now: number, reducedMotion: boolean): void;
}

const GRASS = 0x6f8f4e,
  ROUGH = 0x8b9a5a,
  LAWN = 0x5f9a45,
  ASPHALT = 0x4a4d52,
  KERB = 0xb9b6ac,
  PAVEMENT = 0xa9a69c,
  PAVING = 0xc9bfa6,
  LINE = 0xe8e2c8,
  SKY = 0xbfd2dd,
  WATER = 0x58a6d6,
  STONE = 0xb7b1a2;
const LEAVES = [0x4f7a3f, 0x5e8a4a, 0x6a9550, 0x557f43];
const SUN_DIR = new THREE.Vector3(-15, 28, 10).normalize();
const SHADOW_MAP = 2048;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const GEO = {
  box: unitBox,
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  blob: new THREE.IcosahedronGeometry(1, 1),
  cone: new THREE.ConeGeometry(1, 1, 7),
};
const white = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });

/** Instanced copies of one geometry with a colour each. */
function instanced(geo: THREE.BufferGeometry, count: number, parent: THREE.Object3D, castShadow: boolean, material: THREE.Material = white()) {
  const inst = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  inst.castShadow = castShadow;
  inst.receiveShadow = true;
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
  parent.add(inst);
  const c = new THREE.Color();
  let n = 0;
  return {
    inst,
    place(m: THREE.Matrix4, color: number) {
      if (n >= count) return;
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

/** mulberry32, for scenery that must look the same on every reload. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sign's face: a name (or FOR SALE) painted on a board, as a texture. */
function signTexture(lines: string[], bg: string, fg: string, w = 256, h = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const sizes = lines.length === 1 ? [44] : [34, 24];
  lines.forEach((line, i) => {
    let size = sizes[i] ?? 22;
    g.font = `700 ${size}px 'Trebuchet MS', sans-serif`;
    while (g.measureText(line).width > w - 28 && size > 12) {
      size -= 2;
      g.font = `700 ${size}px 'Trebuchet MS', sans-serif`;
    }
    g.fillText(line, w / 2, lines.length === 1 ? h / 2 : h * (0.36 + i * 0.34));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A floating label (district names, street names), always facing the camera. */
function label(text: string, colour: string, scale: number): THREE.Sprite {
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
  g.fillStyle = colour;
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(scale * 5.33, scale, 1);
  sprite.renderOrder = 5;
  return sprite;
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentHandles {
  const world = new THREE.Group();
  scene.add(world);
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3();
  const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => m4.compose(p.set(x, y, z), q.setFromEuler(e.set(0, ry, 0)), s.set(sx, sy, sz));

  // --- the ground: countryside, then the town's asphalt, then blocks on top ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.16;
  floor.receiveShadow = true;
  world.add(floor);

  const b = CITY_BOUNDS;
  const flat = instanced(unitBox, 2 + 25 * 3 + 200, world, false);
  // Asphalt under the whole town.
  flat.place(compose((b.minX + b.maxX) / 2, -0.12, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, 0.06, b.maxZ - b.minZ), ASPHALT);
  const R = CITY.rings;
  for (let bx = -R; bx <= R; bx++)
    for (let bz = -R; bz <= R; bz++) {
      const cx = bx * PITCH,
        cz = bz * PITCH;
      // Kerb, then pavement, a touch higher than the road.
      flat.place(compose(cx, -0.07, cz, BLOCK_HALF * 2 + 0.3, 0.1, BLOCK_HALF * 2 + 0.3), KERB);
      flat.place(compose(cx, -0.05, cz, BLOCK_HALF * 2, 0.1, BLOCK_HALF * 2), bx === 0 && bz === 0 ? PAVING : PAVEMENT);
    }
  // The square's paved cross is the pavement; its community lots are gravel until something goes up.
  flat.finish();

  // Dashed centre lines and zebra crossings by the square.
  const marks = instanced(unitBox, 1400, world, false);
  for (const k of roadLines()) {
    for (let t = b.minZ + 2; t < b.maxZ - 2; t += 4) {
      // Not across the junctions.
      if (roadLines().some((r) => Math.abs(t - r) < CITY.road / 2 + 1)) continue;
      marks.place(compose(k, -0.085, t, 0.18, 0.02, 1.8), LINE);
      marks.place(compose(t, -0.085, k, 1.8, 0.02, 0.18), LINE);
    }
  }
  for (const side of [-1, 1])
    for (let i = -3; i <= 3; i++) {
      // Zebra crossings on the roads round the square, in line with its paths.
      const r = (side * PITCH) / 2;
      marks.place(compose(i * 0.9, -0.08, r, 0.5, 0.02, CITY.road - 1.4), LINE);
      marks.place(compose(r, -0.08, i * 0.9, CITY.road - 1.4, 0.02, 0.5), LINE);
    }
  marks.finish();

  // --- street furniture: trees along the pavements, lamps at the corners ---
  const r = seeded(20261017);
  const trunks = instanced(GEO.cyl, 400, world, true),
    crowns = instanced(GEO.blob, 800, world, true),
    poles = instanced(GEO.cyl, 200, world, true),
    lamps = instanced(GEO.box, 200, world, false, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffe2a0, emissiveIntensity: 0.35 }));
  const tree = (x: number, z: number, k: number) => {
    compose(x, 1.1 * k, z, 0.22 * k, 2.2 * k, 0.22 * k);
    trunks.place(m4, 0x6b5640);
    for (let j = 0; j < 2; j++) {
      const rad = (1.05 - j * 0.25) * k;
      compose(x + (j ? 0.25 : 0) * k, (2.5 + j * 0.6) * k, z, rad, rad * 0.9, rad, r() * 3);
      crowns.place(m4, LEAVES[Math.floor(r() * LEAVES.length)]);
    }
  };
  for (let bx = -R; bx <= R; bx++)
    for (let bz = -R; bz <= R; bz++) {
      const cx = bx * PITCH,
        cz = bz * PITCH,
        edge = BLOCK_HALF - 1;
      if (bx === 0 && bz === 0) continue;
      // Two trees along each side of the block, clear of the lot signs at the corners.
      for (const t of [-6, 6]) {
        tree(cx + t, cz - edge, 0.85 + r() * 0.2);
        tree(cx + t, cz + edge, 0.85 + r() * 0.2);
        tree(cx - edge, cz + t, 0.85 + r() * 0.2);
        tree(cx + edge, cz + t, 0.85 + r() * 0.2);
      }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          compose(cx + sx * (BLOCK_HALF - 0.5), 1.8, cz + sz * (BLOCK_HALF - 0.5), 0.12, 3.6, 0.12);
          poles.place(m4, 0x3b3f44);
          compose(cx + sx * (BLOCK_HALF - 0.5), 3.65, cz + sz * (BLOCK_HALF - 0.5), 0.45, 0.22, 0.45);
          lamps.place(m4, 0xfff1c9);
        }
    }
  // The countryside: scattered trees beyond the ring road.
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2,
      d = b.maxX + 8 + Math.pow(r(), 0.7) * 90;
    tree(Math.cos(a) * d * (1 + r() * 0.1), Math.sin(a) * d, 1 + r() * 0.7);
  }
  for (const x of [trunks, crowns, poles, lamps]) x.finish();

  // --- the town square: fountain, market stall, bus stop ---
  const square = new THREE.Group();
  world.add(square);
  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  const put = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent: THREE.Object3D = square) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const f = SQUARE.fountain;
  put(GEO.cyl, mat(STONE), f.x, 0.25, f.z, f.r * 2, 0.5, f.r * 2);
  const water = put(GEO.cyl, mat(WATER, { roughness: 0.2, metalness: 0.1 }), f.x, 0.48, f.z, f.r * 1.8, 0.06, f.r * 1.8);
  water.castShadow = false;
  put(GEO.cyl, mat(STONE), f.x, 1.0, f.z, 0.5, 1.6, 0.5);
  put(GEO.cyl, mat(STONE), f.x, 1.8, f.z, 1.3, 0.18, 1.3);
  const spout = put(GEO.blob, mat(0xdff1fb, { roughness: 0.1, transparent: true, opacity: 0.75 }), f.x, 2.15, f.z, 0.28, 0.4, 0.28);
  spout.castShadow = false;
  const mk = SQUARE.market;
  put(GEO.box, mat(0x8a6440), mk.x, 0.5, mk.z, mk.w, 1, mk.d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(GEO.box, mat(0x6b4b30), mk.x + sx * (mk.w / 2 - 0.1), 1.2, mk.z + sz * (mk.d / 2 - 0.1), 0.1, 2.4, 0.1);
  for (let i = 0; i < 6; i++) put(GEO.box, mat(i % 2 ? 0xf2ede0 : 0xc94a3a), mk.x - mk.w / 2 + (i + 0.5) * (mk.w / 6), 2.45, mk.z, mk.w / 6, 0.12, mk.d + 0.5);
  for (let i = 0; i < 5; i++) put(GEO.blob, mat([0xd9a23a, 0xc4402f, 0x4f8a4b, 0xe07a4a, 0x9a5fb0][i]), mk.x - 1 + i * 0.5, 1.12, mk.z + 0.3, 0.16, 0.14, 0.16);
  // The bus stop where everyone arrives.
  put(GEO.box, mat(0x3f6fb0), BUS_STOP.x + 1.6, 1.1, BUS_STOP.z + 0.3, 0.1, 2.2, 0.1);
  const busSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: signTexture(['BUS'], '#3f6fb0', '#f3eedc', 128, 64) }));
  busSign.position.set(BUS_STOP.x + 1.6, 2.2, BUS_STOP.z + 0.36);
  square.add(busSign);
  // Benches round the fountain.
  for (const [x, z, ry] of [[3.6, 0, Math.PI / 2], [-3.6, 0, Math.PI / 2], [0, -3.6, 0]] as const) {
    const bench = new THREE.Group();
    put(GEO.box, mat(0x8a6440), 0, 0.42, 0, 1.6, 0.08, 0.45, bench);
    put(GEO.box, mat(0x8a6440), 0, 0.72, -0.2, 1.6, 0.4, 0.06, bench);
    for (const sx of [-0.65, 0.65]) put(GEO.box, mat(0x3b3f44), sx, 0.2, 0, 0.08, 0.4, 0.4, bench);
    bench.position.set(x, 0, z);
    bench.rotation.y = ry;
    square.add(bench);
  }

  // Street names floating over the junctions near the square, so "7 Maple Street" means something.
  const names = new THREE.Group();
  world.add(names);
  roadLines().forEach((k, i) => {
    const kk = i - CITY.rings - 1;
    const st = label(streetName(kk).toUpperCase(), '#efe6c8', 1.4);
    st.position.set(b.minX + 6, 1.6, k);
    names.add(st);
    const av = label(avenueName(kk).toUpperCase(), '#efe6c8', 1.4);
    av.position.set(k, 1.6, b.maxZ - 3);
    names.add(av);
  });

  // --- lots: rough grass and a FOR SALE sign, or a lawn, a hedge and the owner's sign ---
  const lotGroup = new THREE.Group();
  world.add(lotGroup);
  const lots = new Map<string, { key: string; group: THREE.Group }>();
  const signMats = new Map<string, THREE.MeshBasicMaterial>();
  const signMat = (lines: string[], bg: string, fg: string) => {
    const k = `${lines.join('|')}|${bg}|${fg}`;
    let m = signMats.get(k);
    if (!m) signMats.set(k, (m = new THREE.MeshBasicMaterial({ map: signTexture(lines, bg, fg) })));
    return m;
  };
  const LOT_GRASS = mat(ROUGH),
    LOT_LAWN = mat(LAWN),
    GRAVEL = mat(0xb5a88a),
    POST = mat(0x6b4b30);
  function drawLot(plot: PlotInfo, claim: TownView['lots'][number] | undefined, project: boolean): THREE.Group {
    const g = new THREE.Group();
    const w = plot.rect.maxX - plot.rect.minX,
      d = plot.rect.maxZ - plot.rect.minZ;
    const ground = put(unitBox, plot.civic ? GRAVEL : claim ? LOT_LAWN : LOT_GRASS, plot.centre.x, -0.02, plot.centre.z, w, 0.06, d, g);
    ground.castShadow = false;
    if (claim) {
      // A low hedge round three sides, open to the street; dimmed while its owner is away.
      const hedge = mat(claim.away ? 0x4f6a40 : 0x3f7a35);
      const t = 0.35,
        hh = 0.45;
      put(unitBox, hedge, plot.centre.x, hh / 2, plot.centre.z - plot.sz * (d / 2 - t / 2), w, hh, t, g); // the back, by the block's middle
      put(unitBox, hedge, plot.centre.x - plot.sx * (w / 2 - t / 2), hh / 2, plot.centre.z, t, hh, d, g); // the inner side
      // The front path and gate post in the owner's colour.
      put(unitBox, mat(new THREE.Color(claim.shirt).getHex()), plot.centre.x + plot.sx * (w / 2 - 0.2), 0.5, plot.centre.z + plot.sz * (d / 2 - 0.2), 0.25, 1, 0.25, g);
    }
    // The sign by the pavement.
    const [line1, line2, bg, fg] = plot.civic
      ? project
        ? ['COMMUNITY', 'PROJECT', '#2f5d3a', '#f3eedc']
        : ['TOWN LOT', 'propose something', '#2f5d3a', '#f3eedc']
      : claim
        ? [claim.owner, plot.address, '#f3eedc', '#2b3a2f']
        : ['FOR SALE', plot.address, '#c4402f', '#f3eedc'];
    const sx = plot.sign.x,
      sz = plot.sign.z;
    put(GEO.cyl, POST, sx, 0.6, sz, 0.09, 1.2, 0.09, g);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), signMat([line1, line2], bg, fg));
    board.position.set(sx, 1.35, sz);
    // Facing the street (the sign stands on the lot's street side).
    board.rotation.y = plot.civic ? (plot.sz > 0 ? Math.PI : 0) : plot.sz > 0 ? 0 : Math.PI;
    const back = board.clone();
    back.rotation.y += Math.PI;
    back.position.z += plot.sz > 0 ? -0.01 : 0.01;
    g.add(board, back);
    return g;
  }
  let townKey = '';
  const districtGroup = new THREE.Group();
  world.add(districtGroup);
  let districtKey = '';
  let party: TownView['party'];
  const confetti = instanced(unitBox, 160, world, false, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  confetti.inst.count = 0;

  function town(view: TownView | undefined): void {
    if (!view) return;
    const byId = new Map(view.lots.map((l) => [l.id, l]));
    const key = `${JSON.stringify(view.lots)}|${view.project?.plot ?? ''}`;
    if (key !== townKey) {
      townKey = key;
      for (const plot of allPlots()) {
        const claim = byId.get(plot.id);
        const k = `${claim ? `${claim.owner}|${claim.shirt}|${claim.away}` : ''}|${view.project?.plot === plot.id}`;
        const cur = lots.get(plot.id);
        if (cur?.key === k) continue;
        if (cur) {
          lotGroup.remove(cur.group);
          cur.group.traverse((o) => o instanceof THREE.Mesh && o.geometry !== unitBox && o.geometry !== GEO.cyl && o.geometry.dispose());
        }
        const group = drawLot(plot, claim, view.project?.plot === plot.id);
        lotGroup.add(group);
        lots.set(plot.id, { key: k, group });
      }
    }
    const dk = JSON.stringify(view.districts);
    if (dk !== districtKey) {
      districtKey = dk;
      for (const c of [...districtGroup.children]) {
        districtGroup.remove(c);
        ((c as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose();
      }
      for (const d of view.districts) {
        const sprite = label(d.name.toUpperCase(), '#ffd98a', 2.2);
        sprite.position.set(d.at.x, 9, d.at.z);
        districtGroup.add(sprite);
      }
    }
    party = view.party;
  }

  // --- daylight: a bright sky, a warm sun with shadows that follow the framing ---
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 160, 380);
  const hemi = new THREE.HemisphereLight(0xe3ecf2, 0x6b7a4f, 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
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
  function update(now: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    // The fountain plays.
    spout.scale.y = 0.4 + Math.sin(now * 3.1) * 0.06;
    spout.position.y = 2.15 + Math.sin(now * 3.1) * 0.03;
    water.rotation.y = now * 0.2;
    // A party: confetti drifting down over it.
    if (party && party.until > Date.now()) {
      const c = new THREE.Color();
      confetti.inst.count = 160;
      for (let i = 0; i < 160; i++) {
        const a = i * 2.39996,
          rad = 1 + ((i * 37) % 70) / 10;
        const fall = ((now * (0.6 + (i % 7) * 0.08) + i * 0.37) % 1) * 9;
        compose(party.at.x + Math.cos(a + now * 0.3) * rad, 9.5 - fall, party.at.z + Math.sin(a + now * 0.3) * rad, 0.14, 0.02, 0.09, now * 3 + i);
        confetti.inst.setMatrixAt(i, m4);
        confetti.inst.setColorAt(i, c.setHex(confettiColours[i % confettiColours.length]));
      }
      confetti.inst.instanceMatrix.needsUpdate = true;
      if (confetti.inst.instanceColor) confetti.inst.instanceColor.needsUpdate = true;
      confetti.inst.computeBoundingSphere();
    } else confetti.inst.count = 0;
  }

  return { world, frame, town, update };
}

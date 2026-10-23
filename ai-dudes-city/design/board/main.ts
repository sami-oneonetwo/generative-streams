// The design board's renderer: every piece of the town in every age, drawn with the game's own part
// builder (client/dudes/primitives.ts) and camera angle, on ground laid from the age's surfaces.
// design/render.mjs hands it the specs (window.renderBoard) and saves what comes back: a sheet per age,
// a street-corner scene per age, every cell on its own, and the three boards with the ages in rows.
import * as THREE from 'three';
import { PATCH, col, ground, isShared, paint, type Surface } from '../../client/dudes/surfaces';
import { PIECE_MATERIALS, mergePiece, placePiece } from '../../client/dudes/pieces';
import { figureGroup } from '../../client/dudes/dudes';
import { AGES as AGE_STYLES, dressFor } from '../../src/shared/ages';
import type { Outfit } from '../../src/shared/outfits';
import type { DudeLook } from '../../src/shared/dudesTypes';
import type { Primitive } from '../../src/shared/objectTypes';

interface Bible {
  id: string;
  name: string;
  summary?: string;
  rules?: { sidewalks?: boolean; kerbs?: boolean; roadMarkings?: boolean };
  surfaces: Record<'countryside' | 'road' | 'lotRough' | 'lotClaimed' | 'square' | 'bank' | 'water', Surface> & { pavement?: Surface | null };
  light?: { sky?: string; fog?: string; sun?: string; sunIntensity?: number; hemiSky?: string; hemiGround?: string; hemiIntensity?: number };
  palette?: string[];
}
interface Part extends Primitive {
  glow?: boolean;
}
interface Spec {
  name: string;
  description?: string;
  parts: Part[];
}
interface ElementInfo {
  id: string;
  label: string;
  board: 'fabric' | 'life';
  tile: 'land' | 'street' | 'lot-rough' | 'lot-claimed' | 'square' | 'river' | 'none';
  half: number;
}
interface AgeData {
  id: string;
  name: string;
  bible: Bible;
  elements: Record<string, Spec | undefined>;
}
interface BoardData {
  title: string;
  ages: AgeData[];
  elements: ElementInfo[];
}

const CAM_BACK = 43,
  CAM_UP = 36,
  YAW = 0.65;
const FONT = "'Trebuchet MS', 'Helvetica Neue', sans-serif";

// ---- tiles: the ground under one cell --------------------------------------------------------------
/** The street across x at z = zc: road ±4, the walking edge 4..6 when the age has pavements. */
function street(parent: THREE.Object3D, b: Bible, x0: number, x1: number, zc: number): void {
  const pave = b.rules?.sidewalks === false ? null : b.surfaces.pavement;
  ground(parent, b.surfaces.road, x0, x1, zc - 4, zc + 4, 0.004);
  if (pave) {
    ground(parent, pave, x0, x1, zc - 6, zc - 4, 0.012);
    ground(parent, pave, x0, x1, zc + 4, zc + 6, 0.012);
  }
}
function tile(parent: THREE.Object3D, b: Bible, kind: ElementInfo['tile'], half: number): void {
  const E = half + 1;
  const S = b.surfaces;
  ground(parent, S.countryside, -E - 6, E + 6, -E - 6, E + 6, -0.01);
  switch (kind) {
    case 'street':
      ground(parent, S.lotRough, -E, E, -E, E, 0);
      street(parent, b, -E, E, 0);
      break;
    case 'lot-rough':
    case 'lot-claimed':
      ground(parent, kind === 'lot-rough' ? S.lotRough : S.lotClaimed, -E, E, -E, 6.5, 0.002);
      street(parent, b, -E, E, 6.5 + 4 + (b.rules?.sidewalks === false || !S.pavement ? 0 : 2));
      break;
    case 'square':
      ground(parent, S.square, -E, E, -E, E, 0.002);
      break;
    case 'river': {
      ground(parent, S.water, -E - 6, E + 6, -7, 7, -0.35);
      ground(parent, S.bank, -E - 6, E + 6, -E - 6, -7, 0.003);
      ground(parent, S.bank, -E - 6, E + 6, 7, E + 6, 0.003);
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(2 * E + 12, 0.36, 0.2), new THREE.MeshStandardMaterial({ color: col(S.bank.accent ?? S.bank.base), roughness: 1 }));
        wall.position.set(0, -0.17, side * 7.05);
        parent.add(wall);
      }
      break;
    }
    default:
      break;
  }
}

// ---- parts ----------------------------------------------------------------------------------------
function partsGroup(spec: Spec | undefined): THREE.Group {
  const g = new THREE.Group();
  if (spec?.parts?.length) placePiece(mergePiece(spec), { x: 0, z: 0 }, g);
  return g;
}

// ---- rendering --------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.append(renderer.domElement);

function lit(scene: THREE.Scene, b: Bible, reach: number): void {
  const L = b.light ?? {};
  scene.background = col(L.sky, '#bfd2dd');
  scene.add(new THREE.HemisphereLight(col(L.hemiSky, '#e3ecf2'), col(L.hemiGround, '#6b7a4f'), Math.max(0.6, Math.min(3.5, L.hemiIntensity ?? 2.2))));
  const sun = new THREE.DirectionalLight(col(L.sun, '#fff0d8'), Math.max(0.6, Math.min(3.5, L.sunIntensity ?? 2.4)));
  sun.position.set(-15, 28, 10).normalize().multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 260 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
}

/** An orthographic camera at the game's angle, fitted round a box with a margin, for a w×h picture. */
function camera(box: THREE.Box3, w: number, h: number, margin = 1.08, yaw = YAW): THREE.OrthographicCamera {
  const centre = box.getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  cam.position.set(centre.x + Math.sin(yaw) * CAM_BACK * 3, centre.y + CAM_UP * 3, centre.z + Math.cos(yaw) * CAM_BACK * 3);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  let hw = ((maxX - minX) / 2) * margin,
    hh = ((maxY - minY) / 2) * margin;
  if (hw / hh > w / h) hh = (hw * h) / w;
  else hw = (hh * w) / h;
  Object.assign(cam, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh });
  cam.updateProjectionMatrix();
  return cam;
}

function snapshot(scene: THREE.Scene, cam: THREE.Camera, w: number, h: number): HTMLCanvasElement {
  renderer.setSize(w, h);
  renderer.render(scene, cam);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  return c;
}
function dispose(scene: THREE.Scene): void {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of [o.material].flat()) {
        if (isShared(m) || PIECE_MATERIALS.includes(m as never)) continue;
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.map && !isShared(sm.map)) sm.map.dispose();
        sm.dispose();
      }
    }
  });
}

const CELL_W = 420,
  CELL_H = 320;
function renderCell(age: AgeData, e: ElementInfo, w = CELL_W, h = CELL_H): HTMLCanvasElement {
  const scene = new THREE.Scene();
  const spec = age.elements[e.id];
  const parts = partsGroup(spec);
  // Builds and people are framed to themselves; tiles to their room.
  let box: THREE.Box3;
  if (e.tile === 'none') {
    const pb = new THREE.Box3().setFromObject(parts);
    if (pb.isEmpty()) pb.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const r = Math.max(pb.max.x - pb.min.x, pb.max.z - pb.min.z) / 2 + 0.8;
    const c = pb.getCenter(new THREE.Vector3());
    tileDisc(scene, age.bible, c.x, c.z, r);
    box = pb.expandByVector(new THREE.Vector3(0.6, 0, 0.6));
    lit(scene, age.bible, r + 10);
  } else {
    tile(scene, age.bible, e.tile, e.half);
    const E = e.half + 0.6;
    const pb = new THREE.Box3().setFromObject(parts);
    box = new THREE.Box3(new THREE.Vector3(-E, 0, -E), new THREE.Vector3(E, pb.isEmpty() ? 1 : Math.max(1, pb.max.y), E));
    lit(scene, age.bible, E + 12);
  }
  scene.add(parts);
  const out = snapshot(scene, camera(box, w, h, e.tile === 'none' ? 1.12 : 1.0), w, h);
  dispose(scene);
  return out;
}
/** A round patch of the age's ground under a figure or a build. */
function tileDisc(scene: THREE.Scene, b: Bible, x: number, z: number, r: number): void {
  const s = b.surfaces.lotClaimed ?? b.surfaces.countryside;
  const { map } = paint(s);
  const m = map.clone();
  m.needsUpdate = true;
  m.repeat.set((2 * r) / PATCH, (2 * r) / PATCH);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 40), new THREE.MeshStandardMaterial({ map: m, roughness: 1 }));
  disc.position.set(x, -0.06, z);
  disc.receiveShadow = true;
  scene.add(disc);
}

// ---- the street corner: the age's pieces put together --------------------------------------------------
function place(scene: THREE.Scene, spec: Spec | undefined, x: number, z: number, ry = 0, fit?: number): void {
  if (!spec) return;
  const g = partsGroup(spec);
  if (fit) {
    const b = new THREE.Box3().setFromObject(g);
    const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (size > fit) g.scale.setScalar(fit / size);
  }
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
}
function renderVignette(age: AgeData, w = 1280, h = 760): HTMLCanvasElement {
  const scene = new THREE.Scene();
  const b = age.bible,
    S = b.surfaces,
    el = age.elements;
  const pave = b.rules?.sidewalks === false ? null : S.pavement;
  ground(scene, S.countryside, -60, 60, -60, 60, -0.01);
  // North of the street: a claimed lot and a free one. South: the square.
  ground(scene, S.lotClaimed, -19, -1, -24, -6, 0.002);
  ground(scene, S.lotRough, 1, 19, -24, -6, 0.002);
  ground(scene, S.square, -24, 24, 6, 26, 0.002);
  ground(scene, pave ?? S.lotRough, -24, 24, -6, -4, 0.006);
  if (!pave) ground(scene, S.lotRough, -24, 24, 4, 6, 0.006);
  street(scene, b, -24, 24, 0);
  // The street's own details, along it.
  for (const x of [-12, 0, 12]) place(scene, el.street, x, 0);
  // The lots (pieces designed with the street at their +z).
  place(scene, el['lot-claimed'], -10, -14.5);
  place(scene, el.home, -10, -15.5, 0, 11);
  place(scene, el['lot-sale'], 10, -14.5);
  // Street furniture on the walking edge.
  place(scene, el['street-tree'], -16, -10);
  place(scene, el['street-light'], 2, -10);
  place(scene, el['street-light'], -20, 0);
  // The square.
  place(scene, el.centrepiece, 0, 16);
  place(scene, el.bench, -6, 13, 0.3);
  place(scene, el.bench, 6, 19.5, Math.PI + 0.2);
  place(scene, el.market, 8, 11, -0.2);
  place(scene, el.arrival, 14, 0);
  place(scene, el.cafe, -16, 18, 0, 9);
  // People about.
  place(scene, el.resident, -4, 2.5, 0.4);
  place(scene, el.head, -2, 10, 0.6);
  place(scene, el.leader, 3, 9, -0.5);
  place(scene, el.dog, -7, 1.8, 1.2, 1.6);
  lit(scene, b, 40);
  const box = new THREE.Box3(new THREE.Vector3(-22, 0, -22), new THREE.Vector3(22, 6, 24));
  const out = snapshot(scene, camera(box, w, h, 0.92), w, h);
  dispose(scene);
  return out;
}

// ---- sheets and boards ----------------------------------------------------------------------------
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, weight = 700, max?: number): void {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = colour;
  g.textBaseline = 'top';
  let t = s;
  if (max) while (g.measureText(t).width > max && t.length > 4) t = t.slice(0, -2);
  g.fillText(t === s ? s : `${t}…`, x, y);
}
function wrap(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, max: number, lines = 4): void {
  g.font = `400 ${size}px ${FONT}`;
  g.fillStyle = colour;
  g.textBaseline = 'top';
  const words = s.split(/\s+/);
  let line = '',
    n = 0;
  for (const w of words) {
    if (g.measureText(`${line} ${w}`).width > max && line) {
      g.fillText(line, x, y + n * size * 1.25);
      if (++n >= lines) return;
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) g.fillText(line, x, y + n * size * 1.25);
}
const INK = '#1d2421',
  PAPER = '#f4efe2',
  MUTED = '#6b6a60';

function sheet(age: AgeData, cells: Map<string, HTMLCanvasElement>, elements: ElementInfo[]): HTMLCanvasElement {
  const cols = 6,
    labelH = 46,
    headH = 110,
    rows = Math.ceil((elements.length + 1) / cols);
  const c = document.createElement('canvas');
  c.width = cols * CELL_W + (cols + 1) * 12;
  c.height = headH + rows * (CELL_H + labelH + 12) + 12;
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  text(g, age.name.toUpperCase(), 16, 18, 40, INK, 800);
  wrap(g, age.bible.summary ?? '', 16, 66, 22, MUTED, c.width - 32, 1);
  elements.forEach((e, i) => {
    const x = 12 + (i % cols) * (CELL_W + 12),
      y = headH + Math.floor(i / cols) * (CELL_H + labelH + 12);
    g.drawImage(cells.get(e.id)!, x, y);
    text(g, `${e.label}`, x + 2, y + CELL_H + 4, 19, INK, 800, CELL_W - 4);
    text(g, age.elements[e.id]?.name ?? '(missing)', x + 2, y + CELL_H + 25, 16, MUTED, 400, CELL_W - 4);
  });
  // The last slot: the age's palette.
  const i = elements.length,
    x = 12 + (i % cols) * (CELL_W + 12),
    y = headH + Math.floor(i / cols) * (CELL_H + labelH + 12);
  text(g, 'Palette', x, y, 19, INK, 800);
  (age.bible.palette ?? []).slice(0, 14).forEach((hex, k) => {
    g.fillStyle = hex;
    g.fillRect(x + (k % 7) * 58, y + 34 + Math.floor(k / 7) * 64, 52, 56);
  });
  return c;
}

function board(title: string, ages: AgeData[], elements: ElementInfo[], cellsOf: (age: string, id: string) => HTMLCanvasElement, cw: number, ch: number): HTMLCanvasElement {
  const labelW = 300,
    headH = 120,
    gap = 8,
    capH = 40;
  const c = document.createElement('canvas');
  c.width = labelW + elements.length * (cw + gap) + gap;
  c.height = headH + ages.length * (ch + capH + gap) + gap;
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  text(g, title, 16, 14, 40, INK, 800);
  elements.forEach((e, k) => text(g, e.label, labelW + k * (cw + gap) + 4, headH - 34, 20, INK, 800, cw - 6));
  ages.forEach((a, r) => {
    const y = headH + r * (ch + capH + gap);
    text(g, a.name.replace(/^the /, '').toUpperCase(), 14, y + 6, 26, INK, 800, labelW - 24);
    wrap(g, a.bible.summary ?? '', 14, y + 44, 17, MUTED, labelW - 28, 7);
    elements.forEach((e, k) => {
      const x = labelW + k * (cw + gap);
      g.drawImage(cellsOf(a.id, e.id), x, y, cw, ch);
      text(g, a.elements[e.id]?.name ?? '(missing)', x + 2, y + ch + 6, 15, MUTED, 400, cw - 4);
    });
  });
  return c;
}

function vignetteBoard(ages: AgeData[], vignettes: Map<string, HTMLCanvasElement>): HTMLCanvasElement {
  const w = 960,
    h = 570,
    capH = 60,
    gap = 14;
  const c = document.createElement('canvas');
  c.width = 2 * w + 3 * gap;
  c.height = 90 + 3 * (h + capH + gap);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  text(g, 'A street corner in every age', 16, 18, 40, INK, 800);
  ages.forEach((a, i) => {
    const x = gap + (i % 2) * (w + gap),
      y = 90 + Math.floor(i / 2) * (h + capH + gap);
    g.drawImage(vignettes.get(a.id)!, x, y, w, h);
    text(g, a.name.toUpperCase(), x, y + h + 6, 24, INK, 800);
    wrap(g, a.bible.summary ?? '', x, y + h + 34, 16, MUTED, w, 1);
  });
  return c;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

async function renderBoard(data: BoardData): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const cells = new Map<string, HTMLCanvasElement>();
  const vignettes = new Map<string, HTMLCanvasElement>();
  for (const age of data.ages) {
    const mine = new Map<string, HTMLCanvasElement>();
    for (const e of data.elements) {
      const c = renderCell(age, e);
      mine.set(e.id, c);
      cells.set(`${age.id}-${e.id}`, c);
      out[`cells/${age.id}-${e.id}.png`] = c.toDataURL('image/png');
      await frame();
    }
    out[`sheet-${age.id}.png`] = sheet(age, mine, data.elements).toDataURL('image/png');
    const v = renderVignette(age);
    vignettes.set(age.id, v);
    out[`vignette-${age.id}.png`] = v.toDataURL('image/png');
    await frame();
  }
  const get = (a: string, id: string) => cells.get(`${a}-${id}`)!;
  const fabric = data.elements.filter((e) => e.board === 'fabric'),
    life = data.elements.filter((e) => e.board === 'life');
  out['board-fabric.png'] = board(`${data.title}: the town's fabric through the ages`, data.ages, fabric, get, 280, 213).toDataURL('image/png');
  out['board-life.png'] = board(`${data.title}: people and example builds through the ages`, data.ages, life, get, 300, 228).toDataURL('image/png');
  out['board-vignettes.png'] = vignetteBoard(data.ages, vignettes).toDataURL('image/png');
  return out;
}

// ---- outfits: the age's garment kits on real rigged figures ------------------------------------------
interface OutfitData {
  ages: { id: string; name: string; index: number; bible: Bible; outfits?: { kits?: Outfit[]; head?: Outfit; leader?: Outfit } }[];
}
/** Two people who look nothing alike, so a kit shows how it takes each wearer's own colours. */
const SAMPLES: DudeLook[] = [
  { skin: '#e0b08a', shirt: '#c4402f', pants: '#3f5f8a', hair: '#3a2a1e', hat: 'cap', hatColor: '#e0c040', accessory: 'none', accessoryColor: '#5d6f7a', height: 1.05, build: 1.05 },
  { skin: '#8a5a3c', shirt: '#4f9a5a', pants: '#d9c49a', hair: '#1a1410', hat: 'none', hatColor: '#8a5a44', accessory: 'scarf', accessoryColor: '#7a3fa0', height: 0.92, build: 0.9 },
];
function renderOutfitRow(a: OutfitData['ages'][number], w = 1800, h = 560): HTMLCanvasElement {
  const scene = new THREE.Scene();
  const o = a.outfits ?? {};
  const people: { look: DudeLook; outfit?: Outfit; label: string }[] = [];
  (o.kits ?? []).forEach((k) => SAMPLES.forEach((look, i) => people.push({ look: dressFor(look, a.index), outfit: k, label: i ? '' : k.name })));
  people.push({ look: AGE_STYLES[a.index].head.look, outfit: o.head, label: o.head?.name ?? 'head' });
  people.push({ look: dressFor(SAMPLES[0], a.index), outfit: o.leader, label: o.leader?.name ?? 'leader' });
  // A line-up seen head-on from the stream camera's height (turning doesn't matter for people facing it).
  const row = new THREE.Group();
  scene.add(row);
  const gap = 0.95;
  const x0 = -((people.length - 1) * gap + Math.floor((people.length - 1) / 2) * 0.3) / 2;
  people.forEach((p, i) => {
    const g = figureGroup(p.look, p.outfit);
    g.position.set(x0 + i * gap + Math.floor(i / 2) * 0.3, 0, 0);
    row.add(g);
  });
  ground(row, a.bible.surfaces.lotClaimed ?? a.bible.surfaces.countryside, -9, 9, -1.6, 1.6, 0);
  lit(scene, a.bible, 12);
  row.updateMatrixWorld(true);
  const figs = new THREE.Box3();
  row.children.forEach((c) => c instanceof THREE.Group && figs.expandByObject(c));
  const box = figs.expandByVector(new THREE.Vector3(0.2, 0.1, 0.2));
  const out = snapshot(scene, camera(box, w, h, 1.04, 0), w, h);
  dispose(scene);
  // Kit names under each pair.
  const g2 = out.getContext('2d')!;
  g2.fillStyle = 'rgba(244,239,226,0.9)';
  g2.fillRect(0, h - 40, w, 40);
  const labels = people.map((p) => p.label).filter(Boolean);
  labels.forEach((l, i) => text(g2, l, 10 + (i * (w - 20)) / labels.length, h - 32, 17, INK, 700, (w - 20) / labels.length - 8));
  return out;
}
async function renderOutfits(data: OutfitData): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const rows: HTMLCanvasElement[] = [];
  for (const a of data.ages) {
    const c = renderOutfitRow(a);
    rows.push(c);
    out[`outfits-${a.id}.png`] = c.toDataURL('image/png');
    await frame();
  }
  const capH = 52;
  const c = document.createElement('canvas');
  c.width = rows[0].width / 2 + 24;
  c.height = 90 + rows.length * (rows[0].height / 2 + capH);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  text(g, 'What people wear in every age', 16, 18, 40, INK, 800);
  data.ages.forEach((a, i) => {
    const y = 90 + i * (rows[0].height / 2 + capH);
    text(g, a.name.toUpperCase(), 12, y + 8, 24, INK, 800);
    g.drawImage(rows[i], 12, y + capH - 8, rows[i].width / 2, rows[i].height / 2);
  });
  out['outfits-board.png'] = c.toDataURL('image/png');
  return out;
}

(window as unknown as { renderBoard: typeof renderBoard }).renderBoard = renderBoard;
(window as unknown as { renderOutfits: typeof renderOutfits }).renderOutfits = renderOutfits;

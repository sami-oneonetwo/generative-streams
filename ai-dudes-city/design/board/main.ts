// The design board's renderer: every piece of the town in every age, drawn with the game's own part
// builder (client/dudes/primitives.ts) and camera angle, on ground laid from the age's surfaces.
// design/render.mjs hands it the specs (window.renderBoard) and saves what comes back: a sheet per age,
// a street-corner scene per age, every cell on its own, and the three boards with the ages in rows.
// With --shipped the specs are the game's own (design/shipped.ts) and the people columns are the
// town's figures in the shipped kits (./people.ts). Every board carries its round and date, and the
// audit note beside it (note-<board>.txt in the round's folder) is printed underneath (FK-004).
// design/render-cast.mjs hands it a cast spec (window.renderCast): the story's cast at the stream
// camera, from behind, and at phone size in greyscale, with what their pixels measure (FK-006).
import * as THREE from 'three';
import { PATCH, col, ground, isShared, paint, type Surface } from '../../client/dudes/surfaces';
import { PIECE_MATERIALS, mergePiece, placePiece } from '../../client/dudes/pieces';
import { figureGroup } from '../../client/dudes/dudes';
import type { AgeOutfits, Outfit } from '../../src/shared/outfits';
import type { DudeLook } from '../../src/shared/dudesTypes';
import type { Primitive } from '../../src/shared/objectTypes';
import type { Seat } from '../story';
import { boardPeople, lineUp, type Figure, type Slot } from './people';
import { PHONE, PHONE_FREE_HALF, PHONE_HALF, colourShares, lineUpSlots, mainColours, ownArea, redShare, toGrey, topThirdRed, type Shares } from './cast';

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
  /** The shipped garment kits and the age's index: the people columns are drawn as the town's figures. */
  index?: number;
  people?: AgeOutfits;
}
interface BoardData {
  title: string;
  /** The round and the date, for the label under each board's title. */
  label?: string;
  /** The specs are the game's own (design/shipped.ts): the label says so, board by board. */
  shipped?: boolean;
  /** Audit notes by board file ("board-life.png"), printed under that board. */
  notes?: Record<string, string>;
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
/** People in a row along x, drawn with the town's own figure builder. */
function figuresGroup(figures: Figure[]): THREE.Group {
  const g = new THREE.Group();
  for (const f of figures) {
    const p = figureGroup(f.look, f.outfit);
    p.position.x = f.x;
    g.add(p);
  }
  return g;
}
/** A people column on a board drawn from the shipped kits: the town's figures and their caption; undefined otherwise. */
const peopleOf = (age: AgeData, id: string) => (age.people && age.index !== undefined ? boardPeople(id, age.index, age.people) : undefined);
/** A column's piece in an age: the town's figures for a people column of a shipped board, else the spec's parts. */
function pieceGroup(age: AgeData, id: string): THREE.Group {
  const people = peopleOf(age, id);
  return people ? figuresGroup(people.figures) : partsGroup(age.elements[id]);
}
/** The name under a cell. */
const caption = (age: AgeData, id: string): string => peopleOf(age, id)?.caption ?? age.elements[id]?.name ?? '(missing)';

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

/**
 * An orthographic camera at the game's angle, fitted round a box with a margin, for a w×h picture. A
 * list of boxes is fitted round them all, not round the box that holds them (a line-up across the view
 * is diagonal in the world, and its world box would leave it small in the middle).
 */
function camera(boxes: THREE.Box3 | THREE.Box3[], w: number, h: number, margin = 1.08, yaw = YAW): THREE.OrthographicCamera {
  const list = [boxes].flat();
  const centre = list.reduce((b, x) => b.union(x), new THREE.Box3()).getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  cam.position.set(centre.x + Math.sin(yaw) * CAM_BACK * 3, centre.y + CAM_UP * 3, centre.z + Math.cos(yaw) * CAM_BACK * 3);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const box of list)
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
  const parts = pieceGroup(age, e.id);
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
function place(scene: THREE.Scene, age: AgeData, id: string, x: number, z: number, ry = 0, fit?: number): void {
  if (!age.elements[id] && !peopleOf(age, id)) return;
  const g = pieceGroup(age, id);
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
    S = b.surfaces;
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
  for (const x of [-12, 0, 12]) place(scene, age, 'street', x, 0);
  // The lots (pieces designed with the street at their +z).
  place(scene, age, 'lot-claimed', -10, -14.5);
  place(scene, age, 'home', -10, -15.5, 0, 11);
  place(scene, age, 'lot-sale', 10, -14.5);
  // Street furniture on the walking edge.
  place(scene, age, 'street-tree', -16, -10);
  place(scene, age, 'street-light', 2, -10);
  place(scene, age, 'street-light', -20, 0);
  // The square.
  place(scene, age, 'centrepiece', 0, 16);
  place(scene, age, 'bench', -6, 13, 0.3);
  place(scene, age, 'bench', 6, 19.5, Math.PI + 0.2);
  place(scene, age, 'market', 8, 11, -0.2);
  place(scene, age, 'arrival', 14, 0);
  place(scene, age, 'cafe', -16, 18, 0, 9);
  // People about.
  place(scene, age, 'resident', -4, 2.5, 0.4);
  place(scene, age, 'head', -2, 10, 0.6);
  place(scene, age, 'leader', 3, 9, -0.5);
  place(scene, age, 'dog', -7, 1.8, 1.2, 1.6);
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

/** Wrapped lines of text at a size and weight, so a block can be measured before it is drawn. */
function lines(g: CanvasRenderingContext2D, s: string, size: number, weight: number, max: number): string[] {
  g.font = `${weight} ${size}px ${FONT}`;
  const out: string[] = [];
  let line = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (line && g.measureText(`${line} ${w}`).width > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}
const MEASURE = document.createElement('canvas').getContext('2d')!;
const NOTE_HEAD = 26,
  NOTE_SIZE = 21,
  NOTE_GAP = 48;
/**
 * The audit note under a board (note-<board>.txt beside it): the first line is its heading, a short
 * line ending in a colon ("Top 3 fixes:") is bold, the rest wraps, a blank line is a small gap. A board
 * wide enough for two 900 px columns sets what follows the first blank line (the fixes) in the right-hand
 * one, so the note fills the board; a column is never wider than 1500 px, so it reads. Draws it at y when
 * given a context; returns the height it takes either way.
 */
function noteBlock(note: string | undefined, width: number, g?: CanvasRenderingContext2D, y = 0): number {
  if (!note?.trim()) return 0;
  const [head, ...rows] = note.trim().split('\n');
  const split = rows.findIndex((r) => !r.trim()),
    two = split > 0 && (width - 32 - NOTE_GAP) / 2 >= 900;
  const max = Math.min(two ? (width - 32 - NOTE_GAP) / 2 : width - 32, 1500);
  if (g) {
    g.fillStyle = INK;
    g.fillRect(16, y + 4, width - 32, 3);
  }
  let h = 22;
  for (const l of lines(g ?? MEASURE, head.trim(), NOTE_HEAD, 800, max)) {
    if (g) text(g, l, 16, y + h, NOTE_HEAD, INK, 800);
    h += NOTE_HEAD * 1.32;
  }
  // One column's rows from its top; returns its height.
  const column = (rows: string[], x: number, top: number): number => {
    let ch = 0;
    for (const row of rows) {
      if (!row.trim()) {
        ch += NOTE_SIZE * 0.6;
        continue;
      }
      const weight = /^[^.]{1,40}:$/.test(row.trim()) ? 700 : 400;
      for (const l of lines(g ?? MEASURE, row.trim(), NOTE_SIZE, weight, max)) {
        if (g) text(g, l, x, top + ch, NOTE_SIZE, INK, weight);
        ch += NOTE_SIZE * 1.32;
      }
    }
    return ch;
  };
  const cols = two ? [rows.slice(0, split), rows.slice(split + 1)] : [rows];
  return h + Math.max(...cols.map((r, i) => column(r, 16 + i * (max + NOTE_GAP), y + h))) + 18;
}
/** The board's title and the label under it; returns where the board's own content starts. */
function heading(g: CanvasRenderingContext2D, title: string, subtitle: string | undefined, width: number): number {
  text(g, title, 16, 14, 40, INK, 800, width - 32);
  if (!subtitle) return 70;
  text(g, subtitle, 16, 64, 20, MUTED, 400, width - 32);
  return 100;
}

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
    text(g, caption(age, e.id), x + 2, y + CELL_H + 25, 16, MUTED, 400, CELL_W - 4);
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

interface BoardText {
  title: string;
  subtitle?: string;
  note?: string;
}
function board(t: BoardText, ages: AgeData[], elements: ElementInfo[], cellsOf: (age: string, id: string) => HTMLCanvasElement, cw: number, ch: number): HTMLCanvasElement {
  const labelW = 300,
    gap = 8,
    capH = 48; // two lines of caption
  const width = labelW + elements.length * (cw + gap) + gap;
  const headH = (t.subtitle ? 100 : 70) + 50;
  const rowsH = headH + ages.length * (ch + capH + gap) + gap;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = rowsH + noteBlock(t.note, width);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  heading(g, t.title, t.subtitle, width);
  elements.forEach((e, k) => text(g, e.label, labelW + k * (cw + gap) + 4, headH - 34, 20, INK, 800, cw - 6));
  ages.forEach((a, r) => {
    const y = headH + r * (ch + capH + gap);
    text(g, a.name.replace(/^the /, '').toUpperCase(), 14, y + 6, 26, INK, 800, labelW - 24);
    wrap(g, a.bible.summary ?? '', 14, y + 44, 17, MUTED, labelW - 28, 7);
    elements.forEach((e, k) => {
      const x = labelW + k * (cw + gap);
      g.drawImage(cellsOf(a.id, e.id), x, y, cw, ch);
      wrap(g, caption(a, e.id), x + 2, y + ch + 6, 15, MUTED, cw - 4, 2);
    });
  });
  noteBlock(t.note, width, g, rowsH);
  return c;
}

function vignetteBoard(t: BoardText, ages: AgeData[], vignettes: Map<string, HTMLCanvasElement>): HTMLCanvasElement {
  const w = 960,
    h = 570,
    capH = 60,
    gap = 14;
  const width = 2 * w + 3 * gap;
  const top = (t.subtitle ? 100 : 70) + 20;
  const rowsH = top + 3 * (h + capH + gap);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = rowsH + noteBlock(t.note, width);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  heading(g, t.title, t.subtitle, width);
  ages.forEach((a, i) => {
    const x = gap + (i % 2) * (w + gap),
      y = top + Math.floor(i / 2) * (h + capH + gap);
    g.drawImage(vignettes.get(a.id)!, x, y, w, h);
    text(g, a.name.toUpperCase(), x, y + h + 6, 24, INK, 800);
    wrap(g, a.bible.summary ?? '', x, y + h + 34, 16, MUTED, w, 1);
  });
  noteBlock(t.note, width, g, rowsH);
  return c;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
/** What each board shows when it is drawn from the shipped kits, for its label. */
const SHIPPED = {
  'board-fabric.png': "the town's pieces and ground as the game draws them today",
  'board-life.png': "people in the game's garment kits, drawn as the town draws them; the example builds are samples from the game's design prompt",
  'board-vignettes.png': "the town's pieces and people as the game has them today; the home, café and dog are samples from the game's design prompt",
};

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
  const t = (name: keyof typeof SHIPPED, title: string): BoardText => ({ title, subtitle: data.label && `${data.label} · ${data.shipped ? `as shipped: ${SHIPPED[name]}` : 'from design/spec'}`, note: data.notes?.[name] });
  out['board-fabric.png'] = board(t('board-fabric.png', `${data.title}: the town's fabric through the ages`), data.ages, fabric, get, 280, 213).toDataURL('image/png');
  out['board-life.png'] = board(t('board-life.png', `${data.title}: people and example builds through the ages`), data.ages, life, get, 300, 228).toDataURL('image/png');
  out['board-vignettes.png'] = vignetteBoard(t('board-vignettes.png', 'A street corner in every age'), data.ages, vignettes).toDataURL('image/png');
  return out;
}

// ---- outfits: the age's garment kits on real rigged figures ------------------------------------------
interface OutfitData {
  subtitle?: string;
  /** The audit note printed under outfits-board.png. */
  note?: string;
  ages: { id: string; name: string; index: number; bible: Bible; outfits?: AgeOutfits }[];
}
/** A slot of the line-up in the row picture's pixels: where its label goes. */
interface SlotPx extends Slot {
  px: number;
  pw: number;
}
/** The line-up (./people.ts lineUp) seen head-on from the stream camera's height, and where each slot's label goes. */
function renderOutfitRow(a: OutfitData['ages'][number], w = 1800, h = 480): { picture: HTMLCanvasElement; slots: SlotPx[] } {
  const scene = new THREE.Scene();
  const { figures, slots, width } = lineUp(a.outfits ?? { kits: [] }, a.index);
  const row = figuresGroup(figures);
  scene.add(row);
  // Deep enough that no row shows sky, whatever its tallest hat: every row reads the same.
  ground(row, a.bible.surfaces.lotClaimed ?? a.bible.surfaces.countryside, -width / 2 - 3, width / 2 + 3, -16, 4, 0);
  lit(scene, a.bible, width / 2 + 6);
  row.updateMatrixWorld(true);
  const figs = new THREE.Box3();
  row.children.forEach((c) => c instanceof THREE.Group && figs.expandByObject(c));
  // Framed to the slots across, so every label has its room, and to the tallest hat up.
  const box = new THREE.Box3(new THREE.Vector3(-width / 2, figs.min.y, figs.min.z - 0.2), new THREE.Vector3(width / 2, figs.max.y + 0.1, figs.max.z + 0.2));
  const cam = camera(box, w, h, 1.02, 0);
  const picture = snapshot(scene, cam, w, h);
  dispose(scene);
  const px = (x: number) => ((new THREE.Vector3(x, 0, 0).project(cam).x + 1) / 2) * w;
  return { picture, slots: slots.map((s) => ({ ...s, px: px(s.x), pw: px(s.x + s.width / 2) - px(s.x - s.width / 2) })) };
}
const ROLE: Record<Slot['role'], string> = { kit: 'EVERYDAY', head: 'THE HEAD', leader: 'CARAVAN LEADER' };
/** A row picture at a scale with each slot's role and kit name under it (two lines at most); used alone and on the board. */
function outfitPanel(row: { picture: HTMLCanvasElement; slots: SlotPx[] }, scale: number): HTMLCanvasElement {
  const roleSize = Math.round(18 * scale),
    nameSize = Math.round(22 * scale);
  const bandH = Math.round(roleSize * 1.3 + 2 * nameSize * 1.25 + 14 * scale);
  const c = document.createElement('canvas');
  c.width = Math.round(row.picture.width * scale);
  c.height = Math.round(row.picture.height * scale) + bandH;
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(row.picture, 0, 0, c.width, c.height - bandH);
  const top = c.height - bandH + 6 * scale;
  // 14 a side, so two neighbouring names keep a clear gap and never read as one.
  for (const s of row.slots) {
    const x = (s.px - s.pw / 2) * scale + 14 * scale,
      max = s.pw * scale - 28 * scale;
    text(g, ROLE[s.role], x, top, roleSize, MUTED, 700, max);
    const name = lines(g, s.label, nameSize, 700, max);
    name.slice(0, 2).forEach((l, i) => text(g, i === 1 && name.length > 2 ? `${l}…` : l, x, top + roleSize * 1.3 + i * nameSize * 1.25, nameSize, INK, 700, max));
  }
  return c;
}
async function renderOutfits(data: OutfitData): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const panels: HTMLCanvasElement[] = [];
  for (const a of data.ages) {
    const row = renderOutfitRow(a);
    out[`outfits-${a.id}.png`] = outfitPanel(row, 1).toDataURL('image/png');
    panels.push(outfitPanel(row, 2 / 3));
    await frame();
  }
  // The board: the ages in rows at two-thirds size, each named, every kit labelled under its wearers.
  const capH = 44,
    gap = 16,
    width = panels[0].width + 24;
  const top = (data.subtitle ? 100 : 70) + 10;
  const rowsH = top + panels.reduce((h, p) => h + capH + p.height + gap, 0);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = rowsH + noteBlock(data.note, width);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  heading(g, 'What people wear in every age', data.subtitle, width);
  let y = top;
  data.ages.forEach((a, i) => {
    text(g, a.name.replace(/^the /, '').toUpperCase(), 12, y + 8, 26, INK, 800);
    g.drawImage(panels[i], 12, y + capH);
    y += capH + panels[i].height + gap;
  });
  noteBlock(data.note, width, g, rowsH);
  out['outfits-board.png'] = c.toDataURL('image/png');
  return out;
}

// ---- the cast board: the story's cast at the stream camera (FK-006) ---------------------------------
interface CastMemberData {
  role: string;
  name: string;
  /** Their locked colour (design/story.ts CAST): Wren's red, the head's gold, a band member's own. */
  colour: string;
  scale: number;
  /** Standing height, metres (design/story.ts standingHeight), for the label. */
  height: number;
  look: DudeLook;
  outfit: Outfit;
  prop?: { name: string; parts: Part[] };
  seat?: Seat;
  checks?: string[];
}
interface CastData {
  title: string;
  subtitle?: string;
  /** The design note (note-<board>.txt beside it), printed under the board. */
  note?: string;
  bible: Bible;
  members: CastMemberData[];
}
/** What the board measured on one member, for the board's labels and <age>-measures.json. */
export interface CastMeasure {
  role: string;
  name: string;
  scale: number;
  height: number;
  /** Main colours (skin aside), biggest first, with their share of the silhouette from the stream camera. */
  main: { hex: string; share: number }[];
  /** Share of the silhouette that reads red, and of its top third. */
  red: number;
  topRed: number;
  /**
   * Pixels from the stream camera, every member drawn at the same size: their whole silhouette, and
   * their own locked colour on it (Wren's red, the head's gold). Wren's red must be the biggest.
   */
  px: number;
  ownPx: number;
  /** Their silhouette in the phone strip, pixels: how tall from the ground up, and how wide (staff, antlers and prop-free). */
  phonePx: number;
  phoneW: number;
  /** How tall at a typical free-play framing (PHONE_FREE_HALF), pixels on the same 390 px phone. */
  freePx: number;
}

/** Sits a figureGroup figure as the spec says (design/story.ts seatPose). Its bones: body → hips, leg L, leg R; hips → head, arm L, arm R, cape. */
function sit(fig: THREE.Group, s: Seat): void {
  const body = fig.children[0];
  const [hips, legL, legR] = body.children;
  const [, armL, armR, cape] = hips.children;
  body.position.y = s.rise;
  hips.rotation.x = s.hips;
  legL.rotation.set(s.legs, 0, 0.08);
  legR.rotation.set(s.legs, 0, -0.08);
  armL.rotation.x = armR.rotation.x = s.arms;
  cape.rotation.x = 0.35;
}
/** One member as the town draws them: the figure at its scale (seated if they sit), the prop round their feet unscaled. */
function castFigure(m: CastMemberData): THREE.Group {
  const g = new THREE.Group();
  const fig = figureGroup(m.look, m.outfit);
  fig.scale.setScalar(m.scale);
  if (m.seat) sit(fig, m.seat);
  g.add(fig);
  if (m.prop?.parts.length) placePiece(mergePiece({ name: m.prop.name, parts: m.prop.parts }), { x: 0, z: 0 }, g).name = 'prop';
  return g;
}
/** Along the line-up: the stream camera's right, so they stand side by side on screen, all facing +z as the town's people do. */
const RIGHT = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
interface CastScene {
  scene: THREE.Scene;
  members: { m: CastMemberData; g: THREE.Group; box: THREE.Box3 }[];
  /** Each member's own box (for fitting a camera) and the box round them all. */
  boxes: THREE.Box3[];
  box: THREE.Box3;
}
function castScene(d: CastData, back = false): CastScene {
  const scene = new THREE.Scene();
  const members = lineUpSlots(d.members.map((m) => m.role)).map((slot) => {
    const m = d.members.find((x) => x.role === slot.role)!;
    const g = castFigure(m);
    g.position.copy(RIGHT).multiplyScalar(slot.x);
    if (back) g.rotation.y = Math.PI;
    scene.add(g);
    g.updateMatrixWorld(true);
    return { m, g, box: new THREE.Box3().setFromObject(g) };
  });
  const boxes = members.map((x) => x.box);
  const box = boxes.reduce((b, x) => b.union(x), new THREE.Box3());
  // They stand on the square's dirt, where the town gathers: brown on brown, the hardest ground they meet.
  const reach = box.getSize(new THREE.Vector3()).length() / 2 + 10;
  // The dirt runs on past the free-play phone strip's frame (16:9 at half-height PHONE_FREE_HALF, seen 40° down); the shadows keep to the line-up.
  const far = reach + PHONE_FREE_HALF * 3;
  ground(scene, d.bible.surfaces.square, -far, far, -far, far, 0);
  lit(scene, d.bible, reach);
  return { scene, members, boxes, box };
}
/** The stream camera at a set zoom (orthographic half-height, metres) round a centre, for a frame of the given aspect. */
function streamCamera(centre: THREE.Vector3, half: number, aspect: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 600);
  cam.position.set(centre.x + Math.sin(YAW) * CAM_BACK * 3, centre.y + CAM_UP * 3, centre.z + Math.cos(YAW) * CAM_BACK * 3);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  return cam;
}
/** Where a world point lands in a w×h picture from a camera, pixels. */
function onPicture(p: THREE.Vector3, cam: THREE.Camera, w: number, h: number): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

const FLAT_BG = '#ff00ff';
/**
 * One member drawn alone and flat (unlit, untoned: every pixel is exactly one part's colour) from the
 * board's camera, and its pixels counted (./cast.ts colourShares). The prop is left out: it isn't them.
 */
function flatShares(cs: CastScene, who: THREE.Group, cam: THREE.Camera, w: number, h: number): Shares {
  const shown = cs.scene.children.map((c) => c.visible);
  cs.scene.children.forEach((c) => (c.visible = c === who));
  const prop = who.getObjectByName('prop');
  if (prop) prop.visible = false;
  const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const palette = new Set<string>();
  who.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const m = o.material as THREE.MeshStandardMaterial;
    swaps.push([o, o.material]);
    o.material = new THREE.MeshBasicMaterial({ color: m.color, toneMapped: false });
    palette.add(`#${m.color.getHexString()}`);
  });
  const background = cs.scene.background;
  cs.scene.background = new THREE.Color(FLAT_BG);
  const shadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  const c = snapshot(cs.scene, cam, w, h);
  renderer.shadowMap.enabled = shadows;
  cs.scene.background = background;
  for (const [mesh, mat] of swaps) {
    (mesh.material as THREE.Material).dispose();
    mesh.material = mat;
  }
  if (prop) prop.visible = true;
  cs.scene.children.forEach((c, i) => (c.visible = shown[i]));
  return colourShares(c.getContext('2d')!.getImageData(0, 0, w, h).data, w, h, [...palette], FLAT_BG);
}
/** A look's skin as the page draws it (dudes.ts compose): bare skin, bare feet (×0.82), and the kit's "skin:dark" and "skin:light". */
function skinTones(look: DudeLook): string[] {
  const skin = new THREE.Color(look.skin);
  return [skin, skin.clone().multiplyScalar(0.82), skin.clone().multiplyScalar(0.72), skin.clone().lerp(new THREE.Color(1, 1, 1), 0.4)].map((c) => `#${c.getHexString()}`);
}

/** Centred text, clipped to `max`. */
function centred(g: CanvasRenderingContext2D, s: string, cx: number, y: number, size: number, colour: string, weight = 700, max = 360): void {
  g.font = `${weight} ${size}px ${FONT}`;
  text(g, s, cx - Math.min(max, g.measureText(s).width) / 2, y, size, colour, weight, max);
}
/** A member's main colours as swatches with their share, centred under them. */
function swatches(g: CanvasRenderingContext2D, main: CastMeasure['main'], cx: number, y: number): void {
  const size = 26,
    gap = 12;
  g.font = `700 18px ${FONT}`;
  const items = main.slice(0, 5).map((c) => ({ ...c, label: `${Math.round(c.share * 100)}%`, w: size + 6 + g.measureText(`${Math.round(c.share * 100)}%`).width }));
  let x = cx - (items.reduce((n, i) => n + i.w, 0) + gap * (items.length - 1)) / 2;
  for (const i of items) {
    g.fillStyle = INK;
    g.fillRect(x - 2, y - 2, size + 4, size + 4);
    g.fillStyle = i.hex;
    g.fillRect(x, y, size, size);
    text(g, i.label, x + size + 6, y + 4, 18, INK, 700);
    x += i.w + gap;
  }
}

/** One phone strip: the stream's 1920×1080 frame at an orthographic half-height, shrunk to 390 px, greyed, cropped to the band the cast stand in; and each member's rows in it. */
function phoneStrip(cs: CastScene, centre: THREE.Vector3, half: number): { strip: HTMLCanvasElement; ph: number; rows: { min: number; max: number; tall: number }[] } {
  const pcam = streamCamera(centre, half, PHONE.frame / PHONE.height);
  const full = snapshot(cs.scene, pcam, PHONE.frame, PHONE.height);
  const pw = PHONE.width,
    ph = Math.round((PHONE.height * pw) / PHONE.frame);
  const phone = document.createElement('canvas');
  phone.width = pw;
  phone.height = ph;
  const pg = phone.getContext('2d')!;
  pg.imageSmoothingQuality = 'high';
  pg.drawImage(full, 0, 0, pw, ph);
  const px = pg.getImageData(0, 0, pw, ph);
  toGrey(px.data);
  pg.putImageData(px, 0, 0);
  // Cropped to the band they stand in, with a margin.
  const rows = cs.members.map((x) => {
    const b = x.box;
    const ys = [b.min.y, b.max.y].flatMap((y) => [b.min.x, b.max.x].flatMap((bx) => [b.min.z, b.max.z].map((bz) => onPicture(new THREE.Vector3(bx, y, bz), pcam, pw, ph).y)));
    const top = onPicture(new THREE.Vector3(x.g.position.x, b.max.y, x.g.position.z), pcam, pw, ph).y,
      foot = onPicture(x.g.position, pcam, pw, ph).y;
    return { min: Math.min(...ys), max: Math.max(...ys), tall: foot - top };
  });
  const y0 = Math.max(0, Math.floor(Math.min(...rows.map((r) => r.min)) - 6)),
    y1 = Math.min(ph, Math.ceil(Math.max(...rows.map((r) => r.max)) + 6));
  const strip = document.createElement('canvas');
  strip.width = pw;
  strip.height = y1 - y0;
  strip.getContext('2d')!.drawImage(phone, 0, y0, pw, y1 - y0, 0, 0, pw, y1 - y0);
  return { strip, ph, rows };
}

async function renderCast(d: CastData): Promise<{ images: Record<string, string>; measures: CastMeasure[] }> {
  const W = 2400,
    H = 760,
    PAD = 16;
  // The line-up from the front, as the stream sees people facing +z.
  const front = castScene(d);
  const cam = camera(front.boxes, W, H, 1.08);
  const picture = snapshot(front.scene, cam, W, H);
  await frame();
  // Each member's pixels, flat, at half the size (still 150+ px tall each).
  const shares = front.members.map((x) => flatShares(front, x.g, cam, W / 2, H / 2));
  await frame();
  // The phone check: the stream's 1920×1080 frame shrunk to 390 px and greyed, at the auto camera's
  // closest zoom (the scenes' close shots) and at a typical free-play framing.
  const centre = front.box.getCenter(new THREE.Vector3());
  const close = phoneStrip(front, centre, PHONE_HALF);
  await frame();
  const free = phoneStrip(front, centre, PHONE_FREE_HALF);
  const pw = PHONE.width,
    ph = close.ph;
  dispose(front.scene);
  await frame();
  // From behind, smaller.
  const BW = 1180,
    BH = 380;
  const back = castScene(d, true);
  const behind = snapshot(back.scene, camera(back.boxes, BW, BH, 1.08), BW, BH);
  dispose(back.scene);

  const measures: CastMeasure[] = front.members.map((x, i) => ({
    role: x.m.role,
    name: x.m.name,
    scale: x.m.scale,
    height: x.m.height,
    main: mainColours(shares[i], skinTones(x.m.look)).map((c) => ({ hex: c.hex, share: Math.round(c.share * 1000) / 1000 })),
    red: Math.round(redShare(shares[i]) * 1000) / 1000,
    topRed: Math.round(topThirdRed(shares[i]) * 1000) / 1000,
    px: shares[i].total,
    ownPx: ownArea(shares[i], x.m.colour),
    phonePx: Math.round(close.rows[i].tall),
    // The flat silhouette's width, from the board camera's pixels to the phone strip's (both orthographic, same angle).
    phoneW: Math.round(((shares[i].box ? shares[i].box.x1 - shares[i].box.x0 + 1 : 0) * ((cam.right - cam.left) / (W / 2)) * ph) / (2 * PHONE_HALF)),
    freePx: Math.round(free.rows[i].tall),
  }));

  // The board: the line-up with each one's name, size and main colours; then from behind and the phone strip; then the note.
  const width = W + 2 * PAD;
  const top = (d.subtitle ? 100 : 70) + 6;
  const labelH = 150,
    zoom = 3,
    rowTitle = 40;
  const row2 = top + H + labelH + 20;
  // The right column: the close strip ×3 and at real size with its caption, then the free-play strip the same way.
  const capH = (n: number) => Math.ceil(n * 18 * 1.25) + 16;
  const block = (h: number, n: number) => h * zoom + 14 + h + 14 + capH(n);
  const right = rowTitle + block(close.strip.height, 3) + 34 + block(free.strip.height, 2);
  const row2H = Math.max(rowTitle + BH, right) + 24;
  const checks = d.members.filter((m) => m.checks?.length);
  const checksH = checks.length ? 30 + checks.length * 26 : 0;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = row2 + row2H + checksH + noteBlock(d.note, width);
  const g = c.getContext('2d')!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  heading(g, d.title, d.subtitle, width);
  g.drawImage(picture, PAD, top);
  front.members.forEach((x, i) => {
    const cx = PAD + onPicture(x.g.position, cam, W, H).x,
      m = measures[i];
    centred(g, x.m.name, cx, top + H + 10, 30, INK, 800);
    centred(g, `scale ${x.m.scale} · ${x.m.seat ? `seated (${x.m.height.toFixed(2)} m standing)` : `${x.m.height.toFixed(2)} m tall`}`, cx, top + H + 48, 19, MUTED, 400);
    swatches(g, m.main, cx, top + H + 78);
    if (x.m.role === 'wren') centred(g, `top third ${Math.round(m.topRed * 100)}% red · ${Math.round(m.red * 100)}% of her`, cx, top + H + 116, 19, INK, 700);
  });
  // Row 2, left: from behind.
  text(g, 'From behind (the same line-up turned round)', PAD, row2, 24, INK, 800);
  g.drawImage(behind, PAD, row2 + rowTitle);
  // Row 2, right: the phone strips, each enlarged ×3 and at its real size.
  const rx = PAD + BW + 40,
    rw = W - BW - 40;
  const short = (x: { m: CastMemberData }) => x.m.name.replace(/^Old /, '').split(' ')[0];
  const drawStrip = (strip: HTMLCanvasElement, y: number, caption: string, n: number): number => {
    g.imageSmoothingEnabled = false;
    g.drawImage(strip, rx, y, pw * zoom, strip.height * zoom);
    g.imageSmoothingEnabled = true;
    const real = y + strip.height * zoom + 14;
    g.drawImage(strip, rx, real);
    text(g, '← real size', rx + pw + 12, real + strip.height / 2 - 10, 18, MUTED, 700);
    wrap(g, caption, rx, real + strip.height + 14, 18, MUTED, rw, n);
    return real + strip.height + 14 + capH(n);
  };
  text(g, `Phone check: ${pw} px wide, greyscale`, rx, row2, 24, INK, 800);
  const sizes = front.members.map((x, i) => `${short(x)} ${measures[i].phonePx}×${measures[i].phoneW}`).join(' · ');
  const after = drawStrip(
    close.strip,
    row2 + rowTitle,
    `Close shots: the auto camera's closest zoom (orthographic half-height ${PHONE_HALF} m, where the scenes' close shots sit). The stream's 1920×1080 frame shrunk to ${pw} px (20%, a phone), greyed, cropped to the band they stand in; above it ×${zoom} with no smoothing, so the pixels show. Left to right as above. Pixels tall × wide: ${sizes}.`,
    3,
  );
  text(g, `Free play: half-height ${PHONE_FREE_HALF} m`, rx, after + 4, 20, INK, 800);
  drawStrip(
    free.strip,
    after + 34,
    `A typical free-play framing (the auto camera frames the crowd at 6–40 m, 8 on one person). Pixels tall: ${front.members.map((x, i) => `${short(x)} ${measures[i].freePx}`).join(' · ')}. Here they are told apart by size and colour, not by their props.`,
    2,
  );
  // Anything the spec's checks still flag.
  let y = row2 + row2H;
  if (checks.length) {
    text(g, 'Checks still open:', PAD, y, 22, INK, 800);
    checks.forEach((m, i) => text(g, `${m.name}: ${m.checks!.join('; ')}`, PAD, y + 30 + i * 26, 19, INK, 400, W));
    y += checksH;
  }
  noteBlock(d.note, width, g, y);
  return { images: { board: c.toDataURL('image/png') }, measures };
}

(window as unknown as { renderBoard: typeof renderBoard }).renderBoard = renderBoard;
(window as unknown as { renderOutfits: typeof renderOutfits }).renderOutfits = renderOutfits;
(window as unknown as { renderCast: typeof renderCast }).renderCast = renderCast;

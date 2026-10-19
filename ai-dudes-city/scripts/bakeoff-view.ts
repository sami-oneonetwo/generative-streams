// The bake-off picture (design-bakeoff.ts): a grid with a row per request and a column per model,
// each design drawn the way the page draws builds (client/dudes/primitives.ts) on its own lawn with
// a 1.7 m figure beside it for scale, and under each its time, cost and part count.
import * as THREE from 'three';
import { buildPrimitiveMesh, newMaterialCache } from '../client/dudes/primitives';
import type { Blueprint } from '../src/shared/objectTypes';

interface Result {
  model: string;
  label: string;
  ok: boolean;
  seconds: number;
  cost?: number;
  parts?: number;
  name?: string;
  error?: string;
  blueprint?: Blueprint;
}
const data = (window as unknown as { BAKEOFF: { models: string[]; prompts: string[]; results: Result[] } }).BAKEOFF;
const CELL = 520,
  ROW = 420,
  LEFT = 300,
  TOP = 60;
const W = LEFT + data.models.length * CELL,
  H = TOP + data.prompts.length * ROW;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
renderer.setClearColor(0x1c2724);
document.body.append(renderer.domElement);
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.left = '0';
renderer.domElement.style.top = '0';
renderer.clear();

const label = (text: string, x: number, y: number, css = '') => {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;white-space:pre;${css}`;
  document.body.append(el);
};
data.models.forEach((m, i) => label(m, LEFT + i * CELL + 16, 18, 'font-size:18px;font-weight:700;color:#e5c98c'));
data.prompts.forEach((p, j) => label(p, 20, TOP + j * ROW + ROW / 2 - 10, 'font-size:20px;font-weight:700'));

const cache = newMaterialCache();
function person(): THREE.Group {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, y: number, c: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c }));
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
  };
  add(0.36, 0.8, 0.22, 0.4, 0x3a4a5e);
  add(0.46, 0.6, 0.26, 1.1, 0xc4402f);
  add(0.3, 0.3, 0.3, 1.55, 0xf1c9a5);
  return g;
}

data.prompts.forEach((prompt, j) =>
  data.models.forEach((model, i) => {
    const r = data.results.find((x) => x.model === model && x.label === prompt);
    const x = LEFT + i * CELL,
      y = TOP + j * ROW;
    if (!r?.ok || !r.blueprint) {
      label(`FAILED after ${r?.seconds.toFixed(0) ?? '?'} s\n${(r?.error ?? 'no result').slice(0, 120)}`, x + 16, y + 40, 'color:#ff9a8a;width:480px;white-space:normal');
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfd2dd);
    scene.add(new THREE.HemisphereLight(0xe3ecf2, 0x6b7a4f, 2.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-15, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 80 });
    scene.add(sun);
    const lot = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x5f9a45 }));
    lot.position.y = -0.05;
    lot.receiveShadow = true;
    scene.add(lot);
    const group = new THREE.Group();
    for (const part of r.blueprint.parts) group.add(buildPrimitiveMesh(part, cache));
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const fig = person();
    fig.position.set(box.max.x + 1, 0, box.max.z + 1);
    scene.add(fig);
    // An isometric view framing the design and the figure.
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y * 0.9, 4) * 0.75 + 1.5;
    const cam = new THREE.OrthographicCamera(-size * (CELL / ROW), size * (CELL / ROW), size, -size, 0.1, 200);
    const c = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y * 0.35, (box.min.z + box.max.z) / 2);
    cam.position.set(c.x + 30, c.y + 26, c.z + 30);
    cam.lookAt(c);
    const gy = H - (y + ROW); // WebGL viewports count from the bottom
    renderer.setViewport(x + 4, gy + 34, CELL - 8, ROW - 38);
    renderer.setScissor(x + 4, gy + 34, CELL - 8, ROW - 38);
    renderer.render(scene, cam);
    label(`${r.name}\n${r.seconds.toFixed(0)} s · ${r.cost !== undefined ? `$${r.cost.toFixed(3)}` : '?'} · ${r.parts} parts`, x + 12, y + ROW - 34, 'font-size:12px;color:#e4e2cf');
  }),
);
(window as unknown as { BAKEOFF_DONE: boolean }).BAKEOFF_DONE = true;

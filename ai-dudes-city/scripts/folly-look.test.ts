// The Folly's look (client/dudes/folly.ts and storyProps.ts, FK-024): the cream canvas over the
// build's box, cinched by gold ropes, a gold crown on its front and top, growing with the Folly's
// timer; the cordon (a stake every 2 m, gold rope, gold and ink pennants that sway but hold still in
// a scene); the 4 × 1.6 m gold sign whose frame alone changes with the age; the plaque; the beam
// (0.6 m at 20%, 1.6 m at 45% pulsing 0.4 Hz through the Unveiling's Call); the drop on the `unveil`
// beat (0.4 s, six big puffs, at most 24 big pieces of gold confetti) and never otherwise; the
// objects layer hiding the build under its tarp; nothing drawn with Story OFF; and `?demo=folly`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  BEAM,
  CANVAS,
  CORDON,
  DROP,
  FollyLook,
  GOLD,
  GOLD_DEEP,
  SIGN,
  SIGN_FRAME,
  TARP,
  beamLook,
  cordonHalf,
  cordonStakes,
  dropPose,
  grownBox,
  kitGeometry,
  pennantPlaces,
  signFrame,
  tarpBox,
  tarpCrowns,
  tarpGeometry,
  type FollyBox,
} from '../client/dudes/folly';
import { createObjectsLayer, partsBounds } from '../client/dudes/objects';
import { DEMO, DEMO_HUT, createStoryProps, demoFolly, follyDemoOn } from '../client/dudes/storyProps';
import { INK } from '../client/dudes/sideMarks';
import { AGE_IDS } from '../src/shared/ages';
import { STORY_SITES } from '../src/shared/storyMap';
import type { DudesScene, TownView } from '../src/shared/dudesTypes';
import { partsKey, type Primitive, type SafehouseObjectView } from '../src/shared/objectTypes';

const PLOT = STORY_SITES.folly.size;
const HUT = partsBounds(DEMO_HUT);
const BOX = tarpBox(HUT, PLOT);
/** A box the size FK-023 fits every Folly to (14 × 14 × 11), the biggest the tarp has to cover. */
const BIGGEST = tarpBox({ minX: -7, maxX: 7, minY: 0, maxY: 11, minZ: -7, maxZ: 7 }, PLOT);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const linear = (hex: string) => new THREE.Color(hex);
/** Every distinct vertex colour of a geometry, as hex. */
const colours = (g: THREE.BufferGeometry): Set<string> => {
  const c = g.getAttribute('color');
  const out = new Set<string>();
  for (let i = 0; i < c.count; i++) out.add(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
  return out;
};
const hexOf = (hex: string) => linear(hex).getHexString();
/** The world box of what is drawn under `o`. */
const worldBox = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(o);
};
/** A look at the Folly's spot, set and run for `ms`. */
function lookAt(state: { pct: number; wrapped: boolean; age?: number; box?: FollyBox }, build?: THREE.Object3D) {
  const parent = new THREE.Group();
  const look = new FollyLook(parent, STORY_SITES.folly.at, PLOT, build);
  look.set({ box: state.box ?? BOX, pct: state.pct, wrapped: state.wrapped, age: state.age ?? 0 }, 0);
  look.update(0, false, false, false);
  return { parent, look };
}
const run = (look: FollyLook, from: number, to: number, opts: { call?: boolean; still?: boolean; reduced?: boolean } = {}) => {
  for (let t = from; t <= to; t += 16) look.update(t, !!opts.call, !!opts.still, !!opts.reduced);
};
const drawn = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverseVisible((x) => {
    if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh);
  });
  return out;
};

test('partsBounds boxes every part as it is turned', () => {
  const parts: Primitive[] = [
    { shape: 'box', position: [0, 1, 0], size: [4, 2, 1], rotation: [0, 0, 0], color: '#888888' },
    { shape: 'box', position: [5, 0.5, 0], size: [4, 1, 1], rotation: [0, Math.PI / 2, 0], color: '#888888' },
  ];
  const b = partsBounds(parts);
  assert.ok(near(b.minX, -2) && near(b.maxX, 5.5, 1e-9), `x ${b.minX}..${b.maxX}: the turned box is 1 m across in x`);
  assert.ok(near(b.minZ, -2, 1e-9) && near(b.maxZ, 2, 1e-9), `z ${b.minZ}..${b.maxZ}: and 4 m deep in z`);
  assert.ok(near(b.minY, 0) && near(b.maxY, 2));
});

test('the canvas: cream #EFE3C2 draped over the whole build, clear of it, from the ground up, and it casts the shadow', () => {
  assert.equal(CANVAS, '#EFE3C2');
  const { parent, look } = lookAt({ pct: 100, wrapped: true });
  const canvas = look.tarp.children[0] as THREE.Mesh;
  assert.equal((canvas.material as THREE.MeshStandardMaterial).color.getHexString(), hexOf(CANVAS));
  assert.ok(canvas.castShadow, 'the tarp casts the big shadow');
  const box = worldBox(canvas);
  const at = STORY_SITES.folly.at;
  assert.ok(near(box.min.y, 0, 1e-5), `standing on the ground (${box.min.y}; float32)`);
  assert.ok(box.min.x < at.x + HUT.minX && box.max.x > at.x + HUT.maxX && box.min.z < at.z + HUT.minZ && box.max.z > at.z + HUT.maxZ && box.max.y > HUT.maxY, 'over all of it');
  // No point of the canvas is inside the build's box: it is draped over it, not through it.
  const pos = canvas.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    if (y < 0.05) continue; // the hem on the ground (and the unused bottom)
    const inside = x > HUT.minX && x < HUT.maxX && z > HUT.minZ && z < HUT.maxZ && y < HUT.maxY;
    assert.ok(!inside, `canvas vertex ${i} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) is inside the build`);
  }
  // The biggest Folly's canvas still keeps its hem inside the cordon's stakes.
  const big = tarpGeometry(BIGGEST);
  big.computeBoundingBox();
  const reach = Math.max(-big.boundingBox!.min.x, big.boundingBox!.max.x, -big.boundingBox!.min.z, big.boundingBox!.max.z);
  assert.ok(reach < cordonHalf(PLOT) - CORDON.stake.w / 2, `the hem reaches ${reach.toFixed(2)} m, the stakes stand at ${cordonHalf(PLOT)}`);
  look.dispose();
  assert.equal(parent.children.length, 0);
});

test("the tarp grows with the Folly's timer: 72% across and 40% tall at 0%, the whole box at 100%, eased", () => {
  const g0 = grownBox(BOX, 0),
    g1 = grownBox(BOX, 1);
  assert.ok(near(g0.a, BOX.a * TARP.grow.xz[0]) && near(g0.c, BOX.c * 0.72) && near(g0.h, BOX.h * 0.4));
  assert.deepEqual(g1, BOX);
  const { look } = lookAt({ pct: 0, wrapped: true });
  const tall = () => worldBox(look.tarp).max.y;
  const low = tall();
  assert.ok(low > BOX.h * 0.4 && low < BOX.h * 0.4 + TARP.dome + 0.2, `at 0% about 40% tall (${low.toFixed(2)} of ${BOX.h.toFixed(2)})`);
  // Story (dev)'s Folly → 100: it grows over a second or two rather than popping.
  look.set({ box: BOX, pct: 100, wrapped: true, age: 0 }, 1000);
  look.update(1016, false, false, false);
  const soon = tall();
  assert.ok(soon > low && soon < BOX.h * 0.75, `grows, eased (${soon.toFixed(2)})`);
  run(look, 1032, 5000);
  assert.ok(Math.abs(tall() - (BOX.h + TARP.dome)) < 0.25, `full: ${tall().toFixed(2)}`);
  look.dispose();
});

test('gold ropes round it at 20% and 82% of its height, edged in ink; the giant gold crown, edged in ink, on its front and its top', () => {
  const { look } = lookAt({ pct: 100, wrapped: true });
  const [, crowns, bands, rim] = look.tarp.children as THREE.Mesh[];
  assert.equal((bands.material as THREE.MeshStandardMaterial).color.getHexString(), hexOf(GOLD));
  assert.equal((rim.material as THREE.MeshBasicMaterial).color.getHexString(), hexOf(INK));
  assert.equal((rim.material as THREE.MeshBasicMaterial).side, THREE.BackSide, 'the rim drawn from inside: only its edge shows');
  const y = bands.geometry.getAttribute('position');
  const heights = new Set<number>();
  for (let i = 0; i < y.count; i++) heights.add(Math.abs(y.getY(i) - BOX.h * 0.2) < 0.2 ? 0 : Math.abs(y.getY(i) - BOX.h * 0.82) < 0.2 ? 1 : 2);
  assert.deepEqual([...heights].sort(), [0, 1], 'every rope vertex is at one of the two heights');
  const cg = tarpCrowns(BOX);
  assert.deepEqual([...colours(cg)].sort(), [hexOf(GOLD), hexOf(INK)].sort(), 'gold, edged in ink');
  const p = cg.getAttribute('position');
  let front = 0,
    top = 0,
    wide = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > BOX.c) front++;
    if (p.getY(i) > BOX.h) top++;
    if (p.getY(i) > BOX.h) wide = Math.max(wide, Math.abs(p.getX(i)) * 2);
  }
  assert.ok(front > 50 && top > 50, `on the front (${front}) and on the top (${top})`);
  assert.ok(wide > BOX.a, `the top crown is giant: ${wide.toFixed(1)} m across a ${(2 * BOX.a).toFixed(1)} m top`);
  assert.equal(crowns.geometry.getAttribute('position').count, p.count);
  look.dispose();
});

test('the cordon: a stake at each corner and never more than 2 m apart, round the plot; pennants gold and ink by turns', () => {
  const half = cordonHalf(PLOT);
  const stakes = cordonStakes(half);
  for (const c of [
    [-half, half],
    [half, half],
    [half, -half],
    [-half, -half],
  ])
    assert.ok(stakes.some((s) => near(s.x, c[0]) && near(s.z, c[1])), `a stake at the corner ${c}`);
  for (let i = 0; i < stakes.length; i++) {
    const a = stakes[i],
      b = stakes[(i + 1) % stakes.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(d <= CORDON.every + 1e-9 && d > 1.5, `stakes ${i} and ${i + 1} are ${d.toFixed(2)} m apart`);
    assert.ok(near(Math.max(Math.abs(a.x), Math.abs(a.z)), half), 'on the square');
  }
  // Inside the plot (its own ground), and clear of the crowd's ring in front.
  assert.ok(half < PLOT / 2 && STORY_SITES.folly.at.z + half < STORY_SITES.crowd.rect.minZ);
  const flags = pennantPlaces(stakes);
  assert.equal(flags.length, stakes.length * CORDON.pennant.per);
  assert.ok(flags.every((f, i) => f.gold === (i % 2 === 0)), 'gold and ink by turns');
  assert.ok(flags.every((f) => f.y < CORDON.ropeY && f.y > CORDON.ropeY - CORDON.sag - 0.05), 'hung from the rope');
});

test('the pennants sway about the rope, and hang still in a scene and under reduced motion', () => {
  const { look } = lookAt({ pct: 50, wrapped: true });
  const m = new THREE.Matrix4();
  const tilt = (i: number) => {
    look.pennants.getMatrixAt(i, m);
    const e = new THREE.Euler().setFromRotationMatrix(m, 'YXZ');
    return e.x;
  };
  const seen = new Set<string>();
  for (let t = 100; t < 2000; t += 150) {
    look.update(t, false, false, false);
    seen.add(tilt(5).toFixed(3));
  }
  assert.ok(seen.size > 5, 'it swings');
  assert.ok(Math.max(...[...seen].map((s) => Math.abs(Number(s)))) <= CORDON.sway.amp + 1e-6, 'gently');
  look.update(2100, false, true, false);
  assert.ok(near(tilt(5), 0) && near(tilt(40), 0), 'a scene: hanging straight down');
  look.update(2200, false, false, true);
  assert.ok(near(tilt(5), 0), 'reduced motion: still');
  const pennantColours = new Set<string>();
  const c = new THREE.Color();
  for (let i = 0; i < look.pennants.count; i++) pennantColours.add((look.pennants.getColorAt(i, c), c.getHexString()));
  assert.deepEqual([...pennantColours].sort(), [hexOf(GOLD), hexOf(INK)].sort());
  look.dispose();
});

test('the sign: 4 × 1.6 m, a gold face 1 m up, in front of the cordon and clear of the head and the crowd; only its frame changes with the age', () => {
  assert.equal(SIGN.w, 4);
  assert.equal(SIGN.h, 1.6);
  assert.deepEqual(SIGN.lines, ['KEEP OUT.', 'SOMETHING AMAZING.']);
  const { look } = lookAt({ pct: 50, wrapped: true });
  const face = look.face.geometry as THREE.PlaneGeometry;
  assert.equal(face.parameters.width, 4);
  assert.equal(face.parameters.height, 1.6);
  // Without a page (this test) the face is plain gold; on the page its canvas is gold too, the words in ink.
  assert.equal((look.face.material as THREE.MeshBasicMaterial).color.getHexString(), hexOf(GOLD));
  assert.ok(near(look.face.position.y, SIGN.lift + SIGN.h / 2));
  const kit = worldBox(look.kit);
  assert.ok(kit.max.z < STORY_SITES.crowd.rect.minZ, `the kit stops at z ${kit.max.z.toFixed(2)}, the ring starts at ${STORY_SITES.crowd.rect.minZ}`);
  const sign = worldBox(look.face);
  const mark = STORY_SITES.headMark.at;
  assert.ok(sign.max.x < mark.x - 1.5, 'the head stands clear of the sign, in the middle');
  // Six ages, six frames; everything else of the kit is the same in every age.
  const frames = AGE_IDS.map((id) => SIGN_FRAME[id]);
  assert.equal(new Set(frames).size, 6);
  assert.equal(signFrame(0), SIGN_FRAME.stone);
  assert.equal(signFrame(99), SIGN_FRAME.future);
  const stakes = cordonStakes(cordonHalf(PLOT));
  const stone = colours(kitGeometry(stakes, 0)),
    modern = colours(kitGeometry(stakes, 4));
  const common = [hexOf(INK), hexOf(GOLD), hexOf(GOLD_DEEP)];
  assert.deepEqual([...stone].sort(), [...common, hexOf(SIGN_FRAME.stone)].sort());
  assert.deepEqual([...modern].sort(), [...common, hexOf(SIGN_FRAME.modern)].sort());
  // A new age redraws the frame.
  look.set({ box: BOX, pct: 50, wrapped: true, age: 3 }, 100);
  assert.ok(colours(look.kit.geometry).has(hexOf(SIGN_FRAME.industrial)));
  look.dispose();
});

test('the beam: 0.6 m at 20% while the cordon is up; 1.6 m at 45% pulsing at 0.4 Hz through the Call', () => {
  assert.deepEqual(beamLook(0, 0), { r: 0.6, a: 0.2 });
  assert.deepEqual(beamLook(0, 1.3), { r: 0.6, a: 0.2 }, 'no pulse without a Call');
  const peak = beamLook(1, 0);
  assert.ok(near(peak.r, 1.6) && near(peak.a, 0.45));
  const trough = beamLook(1, 1 / (2 * BEAM.call.hz));
  assert.ok(trough.a < 0.35 && trough.r < 1.6, 'half a period on: low');
  const again = beamLook(1, 1 / BEAM.call.hz);
  assert.ok(near(again.a, 0.45) && near(again.r, 1.6), 'a whole period (2.5 s) on: back at the top');
  assert.deepEqual(beamLook(1, 1.25, true), { r: 1.6, a: 0.45 }, 'held at its peak when still');

  const { look } = lookAt({ pct: 30, wrapped: true });
  const mat = look.beam.material as THREE.MeshBasicMaterial;
  assert.ok(look.beam.visible && near(look.beam.scale.x, 0.6) && near(mat.opacity, 0.2));
  assert.ok(mat.transparent && !mat.depthWrite && !look.beam.castShadow, 'light: no depth, no shadow');
  run(look, 16, 4000, { call: true });
  look.update(5000, true, false, false); // 5 s = two whole periods: the top of the pulse
  assert.ok(Math.abs(look.beam.scale.x - 1.6) < 0.02 && Math.abs(mat.opacity - 0.45) < 0.01, `in the Call: ${look.beam.scale.x.toFixed(2)} m at ${mat.opacity.toFixed(2)}`);
  run(look, 5016, 9000);
  assert.ok(Math.abs(look.beam.scale.x - 0.6) < 0.02, 'back to the thin beam after the Call');
  look.dispose();
});

test('the drop on the unveil beat: the tarp falls in 0.4 s, six big puffs, at most 24 big pieces of gold confetti, and the build shows', () => {
  const build = new THREE.Group();
  const { parent, look } = lookAt({ pct: 100, wrapped: true }, build);
  run(look, 16, 500);
  assert.equal(build.visible, false, 'the build is hidden under its tarp');
  const tall = () => worldBox(look.tarp.children[0]).max.y;
  const standing = tall();
  look.set({ box: BOX, pct: 100, wrapped: false, age: 0 }, 1000);
  assert.ok(build.visible && look.dropping, 'the beat: the build shows, the tarp starts to fall');
  look.update(1000, false, false, false);
  assert.ok(Math.abs(tall() - standing) < 0.05, 'from standing');
  look.update(1200, false, false, false);
  const half = tall();
  assert.ok(half < standing && half > standing * 0.6, `half way through it has fallen a quarter (gravity): ${half.toFixed(2)} of ${standing.toFixed(2)}`);
  look.update(1400, false, false, false);
  assert.ok(tall() < 0.1 * standing, `down in 0.4 s: ${tall().toFixed(2)}`);
  assert.ok(dropPose(DROP.ms).y < 0.07 && dropPose(DROP.ms / 2).y > 0.7);
  // The dust: six big puffs round the foot.
  run(look, 1416, 1800);
  assert.equal(look.dust.count, 6);
  assert.ok(look.dust.visible);
  const m = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    look.dust.getMatrixAt(i, m);
    m.decompose(p, q, s);
    assert.ok(s.x >= DROP.puffSize[0] && p.y < 3, `puff ${i}: ${s.x.toFixed(2)} m, low`);
    assert.ok(Math.max(Math.abs(p.x) - BOX.a, Math.abs(p.z) - BOX.c) > -0.5, `puff ${i} round the foot, not in the middle`);
  }
  // The confetti: big gold pieces, no more than 24, up off the top and down again.
  assert.ok(look.confetti.count <= 24 && DROP.confetti <= 24);
  const piece = look.confetti.geometry as THREE.PlaneGeometry;
  assert.ok(piece.parameters.width >= 0.3 && piece.parameters.height >= 0.3, 'big pieces: the stream compresses small ones away');
  const c = new THREE.Color();
  const golds = new Set<string>();
  for (let i = 0; i < look.confetti.count; i++) golds.add((look.confetti.getColorAt(i, c), c.getHexString()));
  assert.deepEqual([...golds].sort(), [hexOf(GOLD), hexOf(GOLD_DEEP)].sort(), 'gold');
  assert.ok(look.confetti.visible);
  look.confetti.getMatrixAt(0, m);
  m.decompose(p, q, s);
  assert.ok(p.y > BOX.h, `up off the top: ${p.y.toFixed(1)} m`);
  // The beam goes with the tarp.
  assert.equal(look.beam.visible, false);
  // A few seconds on: the heap has sunk, the dust has gone, the confetti has come down, lain a moment and gone.
  run(look, 1816, 1000 + DROP.life - 100);
  assert.ok(!look.tarp.visible && !look.dust.visible && !look.confetti.visible, 'all down and gone before the drop is over');
  run(look, 1000 + DROP.life - 84, 1000 + DROP.life + 100);
  assert.ok(!look.dropping && build.visible);
  // The pennants never caught the confetti's size (they share a scratch object).
  look.pennants.getMatrixAt(0, m);
  m.decompose(p, q, s);
  assert.ok(near(s.x, 1, 1e-6) && near(s.y, 1, 1e-6), `pennant at its size: ${s.x}`);
  // While it played, nothing touched the camera: the look only ever adds to its own group.
  assert.equal(parent.children.length, 1);
  look.dispose();
});

test('no drop for a Folly already unveiled when the page opens, nor when it goes back under wraps; under reduced motion the tarp just goes', () => {
  const opened = lookAt({ pct: 100, wrapped: false });
  run(opened.look, 16, 500);
  assert.ok(!opened.look.dropping && !opened.look.tarp.visible && !opened.look.beam.visible, 'unveiled when the page opened: no tarp, no beam, no drop');
  // Re-tarp (Story (dev)): back under wraps at once, beam and all.
  opened.look.set({ box: BOX, pct: 100, wrapped: true, age: 0 }, 600);
  run(opened.look, 600, 700);
  assert.ok(opened.look.tarp.visible && opened.look.beam.visible && !opened.look.dropping);
  opened.look.dispose();

  const calm = lookAt({ pct: 100, wrapped: true });
  calm.look.set({ box: BOX, pct: 100, wrapped: false, age: 0 }, 1000);
  calm.look.update(1000, false, false, true);
  assert.ok(!calm.look.tarp.visible && !calm.look.beam.visible && !calm.look.dust.visible && !calm.look.confetti.visible && !calm.look.dropping, 'reduced motion: gone, nothing flying');
  calm.look.dispose();
});

test("the objects layer: the Folly's own parts hidden under the tarp and shown on the beat; any other silhouette stays a dark shape; its box for the tarp", async () => {
  const view = (id: string, extra: Partial<SafehouseObjectView>): SafehouseObjectView =>
    ({ id, revision: 1, position: { x: 54, z: 40 }, footprint: { width: 13, depth: 12 }, createdBy: 'The Chief', editedBy: 'The Chief', createdAt: 0, blueprint: { name: 'The Big Hut', description: '', partCount: DEMO_HUT.length, color: '#8B6A45' }, ...extra }) as SafehouseObjectView;
  const folly = view('b1', { folly: 'stone', silhouette: true, civic: true, age: 0 });
  const landmark = view('b2', { silhouette: true, position: { x: 0, z: 0 }, age: 0 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ parts: { [partsKey('b1', 1)]: DEMO_HUT, [partsKey('b2', 1)]: DEMO_HUT } }))) as typeof fetch;
  try {
    const layer = createObjectsLayer(new THREE.Group());
    layer.setAge(0);
    layer.syncCommitted([folly, landmark]);
    assert.equal(layer.boundsOf('b1'), undefined, 'no box before the parts land');
    await new Promise((r) => setTimeout(r, 20));
    const [fg, lg] = layer.root.children as THREE.Group[];
    assert.equal(fg.visible, false, 'under its tarp: not drawn');
    assert.equal(lg.visible, true, 'another silhouette: drawn');
    const colourOf = (g: THREE.Group) => ((g.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString();
    assert.equal(colourOf(lg), new THREE.Color(DEMO_HUT[1].color).multiplyScalar(0.1).getHexString(), 'a dark shape in the mist, as today');
    assert.equal(colourOf(fg), new THREE.Color(DEMO_HUT[1].color).getHexString(), 'the Folly keeps its own colours for the reveal');
    assert.deepEqual(layer.boundsOf('b1'), partsBounds(DEMO_HUT));
    // The unveil beat: drawn at once, in its colours.
    layer.syncCommitted([{ ...folly, silhouette: undefined }, landmark]);
    assert.equal(fg.visible, true);
    assert.equal(colourOf(fg), new THREE.Color(DEMO_HUT[1].color).getHexString());
    // Re-tarped: hidden again.
    layer.syncCommitted([folly, landmark]);
    assert.equal(fg.visible, false);
    layer.dispose();
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** A snapshot with these objects and this town (Story ON when `town.story`). */
const sceneOf = (objects: SafehouseObjectView[], town: Partial<TownView> = {}): DudesScene =>
  ({ schema: 1, fixture: true, objects, dudes: [], feed: [], ai: {}, counts: { dudes: 0, awake: 0, builds: 0 }, worldRevision: 1, town: { name: 'Town', age: 0, head: 'The Chief', lots: [], districts: [], wants: [], hot: [], ...town } }) as unknown as DudesScene;
const follyView = (extra: Partial<SafehouseObjectView> = {}): SafehouseObjectView =>
  ({ id: 'f1', revision: 1, position: { ...STORY_SITES.folly.at }, footprint: { width: 13, depth: 12 }, createdBy: 'The Chief', editedBy: 'The Chief', createdAt: 0, folly: 'stone', silhouette: true, civic: true, age: 0, blueprint: { name: 'The Big Hut', description: '', partCount: 3, color: '#8a6a48' }, ...extra }) as SafehouseObjectView;

test('Story OFF: no Folly, nothing drawn; a Folly taken off the map takes its cordon and tarp with it', () => {
  const parent = new THREE.Group();
  let now = 0;
  const props = createStoryProps(parent, { boundsOf: () => HUT }, '', () => now);
  props.sync(sceneOf([]));
  props.update(16, 0, false);
  assert.equal(props.looks().size, 0);
  assert.equal(drawn(props.root).length, 0, 'Story OFF: no draw calls at all');
  assert.equal(props.demoShot, undefined);
  // Story ON, the cordon up: one look, at the Folly's spot.
  props.sync(sceneOf([follyView()], { story: true, folly: { pct: 40, plaque: [] } }));
  props.update(32, 0, false);
  const look = props.looks().get('f1')!;
  assert.ok(look.underWraps);
  assert.deepEqual([look.group.position.x, look.group.position.z], [STORY_SITES.folly.at.x, STORY_SITES.folly.at.z]);
  const meshes = drawn(props.root);
  assert.ok(meshes.length >= 8 && meshes.length <= 12, `about ten draw calls a Folly (${meshes.length})`);
  assert.deepEqual(meshes.filter((m) => m.castShadow).length, 2, 'only the canvas and the kit cast shadows');
  // Story OFF again: the server stows the Folly, and its look goes.
  now = 100;
  props.sync(sceneOf([]));
  assert.equal(props.looks().size, 0);
  assert.equal(props.root.children.length, 0);
  props.dispose();
});

test("storyProps: the tarp fits the Folly's parts once they land; the timer is this age's Folly's; the drop on the beat; the beam widens only for the Unveiling's Call", () => {
  const parent = new THREE.Group();
  let now = 0;
  let bounds: ReturnType<typeof partsBounds> | undefined;
  const props = createStoryProps(parent, { boundsOf: () => bounds }, '', () => now);
  const story = (extra: Partial<TownView> = {}) => ({ story: true as const, folly: { pct: 100, plaque: [] }, ...extra });
  props.sync(sceneOf([follyView()], story()));
  props.update(16, 0, false);
  const look = props.looks().get('f1')!;
  const rough = worldBox(look.tarp).max.x - worldBox(look.tarp).min.x;
  // The parts land: the tarp is fitted to them (asked again each frame until then).
  bounds = { minX: -4, maxX: 4, minY: 0, maxY: 5, minZ: -4, maxZ: 4 };
  for (let t = 32; t < 3000; t += 16) props.update(t, 0, false);
  const fitted = worldBox(look.tarp).max.x - worldBox(look.tarp).min.x;
  assert.ok(fitted < rough && Math.abs(fitted - 2 * (4 + TARP.pad) - 2 * TARP.flare) < 0.5, `from the footprint (${rough.toFixed(1)} m) to the parts (${fitted.toFixed(1)} m)`);
  // A Rally's Call is at Wren's fire: the beam stays thin. The Unveiling's: wide.
  props.sync(sceneOf([follyView()], story({ show: { banner: { title: 'GATHER: THE RALLY', until: 99_000 } } })));
  for (let t = 3000; t < 6000; t += 16) props.update(t, 5000, false);
  assert.ok(look.beam.scale.x < 0.65, 'a Rally: thin');
  props.sync(sceneOf([follyView()], story({ show: { banner: { title: 'GATHER: THE UNVEILING', premise: "The Chief's secret build", until: 99_000 } } })));
  for (let t = 6000; t < 9000; t += 16) props.update(t, 8000, false);
  assert.ok(look.beam.scale.x > 1.5, 'the Unveiling: wide');
  for (let t = 9000; t < 12_000; t += 16) props.update(t, 100_000, false);
  assert.ok(look.beam.scale.x < 0.65, 'the Call ran out: thin again');
  // The unveil beat.
  now = 12_000;
  props.sync(sceneOf([follyView({ silhouette: undefined })], story({ scene: { id: 'unveil-stone', at: 0 } })));
  assert.ok(look.dropping);
  // An earlier age's Folly stands at full size whatever this age's timer says.
  const g = createStoryProps(new THREE.Group(), { boundsOf: () => bounds }, '', () => 0);
  g.sync(sceneOf([follyView({ id: 'old', folly: 'bronze' })], story({ folly: { pct: 0, plaque: [] } })));
  g.update(16, 0, false);
  const old = worldBox(g.looks().get('old')!.tarp);
  assert.ok(old.max.y > 5, `full height: ${old.max.y.toFixed(2)}`);
  g.dispose();
  props.dispose();
});

test('?demo=folly: a fake Folly on its spot, its timer climbing, its Call, the drop every 15 s, the camera on it; nothing without it', () => {
  assert.ok(follyDemoOn('?stream=1&demo=folly'));
  assert.ok(!follyDemoOn('?stream=1&demo=board') && !follyDemoOn(''));
  assert.deepEqual(demoFolly(0), { pct: DEMO.from, wrapped: true, call: false });
  assert.ok(demoFolly(4000).pct > 50 && demoFolly(4000).pct < 60, 'climbing');
  assert.equal(demoFolly(DEMO.climbMs).pct, 100);
  assert.ok(!demoFolly(5000).call && demoFolly(7000).call && demoFolly(7000).wrapped, 'the Call before the drop');
  assert.ok(!demoFolly(DEMO.dropAt).wrapped && !demoFolly(DEMO.dropAt).call, 'the drop');
  assert.equal(DEMO.ms, 15_000);
  assert.deepEqual(demoFolly(DEMO.ms + 100), demoFolly(100), 'every 15 s');

  const parent = new THREE.Group();
  const props = createStoryProps(parent, { boundsOf: () => undefined }, '?stream=1&demo=folly', () => 0);
  const look = props.looks().get('demo')!;
  assert.ok(look, 'the fake Folly');
  assert.deepEqual([look.group.position.x, look.group.position.z], [STORY_SITES.folly.at.x, STORY_SITES.folly.at.z]);
  assert.ok(props.demoShot && Math.hypot(props.demoShot.centre.x - STORY_SITES.folly.at.x, props.demoShot.centre.z - STORY_SITES.folly.at.z) < 3, 'the camera holds on it');
  // The server's own Follies are left alone while the demo has the spot.
  props.sync(sceneOf([follyView()], { story: true, folly: { pct: 40, plaque: [] } }));
  assert.deepEqual([...props.looks().keys()], ['demo']);
  let drops = 0,
    was = false;
  for (let t = 1000; t < 1000 + 3 * DEMO.ms; t += 50) {
    props.update(t, 0, false);
    if (look.dropping && !was) drops++;
    was = look.dropping;
  }
  assert.equal(drops, 3, 'a drop at 10 s, 25 s and 40 s');
  props.dispose();
});

// Side marks (client/dudes/sideMarks.ts, FK-013): the ground disc in the side's colour with its
// sticker rim, one draw call per colour and none while nobody is on a side, the crown or flag on
// the tag, red and gold apart in greyscale, and `?demo=board`'s fake sides for chatters only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CREAM, DISC_ORDER, INK, SIDE_DISC, SIDE_HEX, SideDiscs, demoSide, demoSidesOn, discHeight, sideIcon, sideOf, stickerDisc } from '../client/dudes/sideMarks';
import type { DudeView } from '../client/dudes/types';

/** WCAG relative luminance of an sRGB hex: what a greyscale shot keeps of a colour. */
const luminance = (hex: string): number => {
  const c = new THREE.Color(hex); // linear
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
/** Equal to float32 precision (the GPU buffers hold 32-bit floats). */
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const dude = (id: string, extra: Partial<DudeView> = {}): DudeView =>
  ({ id, name: id, position: { x: 0, z: 0 }, facing: 0, activity: 'idle', look: {}, ...extra }) as DudeView;

test('red and gold are the locked story colours, and stay apart in greyscale', () => {
  assert.equal(SIDE_HEX.red, '#B3262E');
  assert.equal(SIDE_HEX.gold, '#FFC633');
  const red = luminance(SIDE_HEX.red),
    gold = luminance(SIDE_HEX.gold);
  assert.ok(Math.abs(red - 0.11) < 0.01, `red ${red.toFixed(3)}`);
  assert.ok(Math.abs(gold - 0.62) < 0.01, `gold ${gold.toFixed(3)}`);
  // As contrast between the two faces: more than 4:1, so they read as dark and light, not two greys.
  assert.ok((gold + 0.05) / (red + 0.05) > 4, 'gold against red');
  // The rim sets both off from the ground: cream bright, ink near black.
  assert.ok(luminance(CREAM) > 0.9 && luminance(INK) < 0.02);
});

test('a disc: the side colour 1.3 m across, then 0.1 m of cream and 0.05 m of ink, lying face-up', () => {
  for (const side of ['red', 'gold'] as const) {
    const g = stickerDisc(SIDE_HEX[side]);
    const pos = g.getAttribute('position'),
      col = g.getAttribute('color');
    const want = (hex: string) => new THREE.Color(hex);
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    let outer = 0;
    const seen = { face: 0, cream: 0, ink: 0 };
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t);
      b.fromBufferAttribute(pos, t + 1);
      c.fromBufferAttribute(pos, t + 2);
      for (const p of [a, b, c]) {
        assert.equal(p.y, 0, 'flat on the ground');
        outer = Math.max(outer, Math.hypot(p.x, p.z));
      }
      // Every face points up, so the disc is seen from the stream's camera above.
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(n.y > 0, `triangle ${t / 3} faces up`);
      const r = Math.hypot((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
      const rgb = new THREE.Color(col.getX(t), col.getY(t), col.getZ(t));
      const band = r < SIDE_DISC.face ? 'face' : r < SIDE_DISC.face + SIDE_DISC.cream ? 'cream' : 'ink';
      const w = want(band === 'face' ? SIDE_HEX[side] : band === 'cream' ? CREAM : INK);
      assert.ok(near(rgb.r, w.r) && near(rgb.g, w.g) && near(rgb.b, w.b), `${side} triangle at r=${r.toFixed(2)} is ${band}`);
      seen[band]++;
    }
    assert.ok(seen.face && seen.cream && seen.ink, 'all three bands are there');
    assert.ok(Math.abs(SIDE_DISC.face * 2 - 1.3) < 1e-9, 'the face is 1.3 m across');
    assert.ok(Math.abs(outer - (0.65 + 0.1 + 0.05)) < 1e-6, `rim out to ${outer}`);
    g.dispose();
  }
});

test('one draw call per colour, none at all while nobody is on a side, no shadows, the exact colours', () => {
  const parent = new THREE.Group();
  const discs = new SideDiscs(parent, 4);
  const meshes = () => parent.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);
  assert.equal(meshes().length, 2, 'one mesh per colour');
  // Story OFF: the server sends no sides, so nothing is added and nothing is drawn.
  discs.begin(10);
  discs.finish();
  for (const m of meshes()) assert.ok(!m.visible && m.count === 0, 'empty and hidden: no draw call');

  discs.begin(10);
  discs.add('gold', 1, 0.03, 2, 1, 1);
  discs.add('gold', 3, 0.03, 2, 1, 0.6);
  discs.add('red', -4, 0.03, 0, 1, 1);
  discs.add('gold', 5, 0.03, 2, 0.5, 1);
  discs.finish();
  assert.equal(discs.meshes.gold.count, 3);
  assert.equal(discs.meshes.red.count, 1);
  assert.ok(discs.meshes.gold.visible && discs.meshes.red.visible);
  // Grown past its first size (4 per colour) without leaving the old meshes behind.
  assert.equal(meshes().length, 2);
  // Where each one is, how big, how dim.
  const m = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    c = new THREE.Color();
  discs.meshes.gold.getMatrixAt(2, m);
  m.decompose(p, q, s);
  [p.x, p.y, p.z, s.x, s.z].forEach((v, i) => assert.ok(near(v, [5, 0.03, 2, 0.5, 0.5][i]), 'shrinking into a build'));
  discs.meshes.gold.getColorAt(1, c);
  assert.ok(near(c.r, 0.6), 'a napping chatter’s disc dims with them');

  for (const mesh of meshes()) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.renderOrder, DISC_ORDER, 'after the opaque world');
    const mat = mesh.material as THREE.MeshBasicMaterial;
    assert.equal(mat.depthWrite, false, 'stacks over the ground and other discs without flicker');
    assert.equal(mat.toneMapped, false, 'the locked hex on screen, whatever the light');
    assert.equal(mat.vertexColors, true);
  }

  // Everyone leaves their side (Story switched OFF): the next frame draws none again.
  discs.begin(10);
  discs.finish();
  for (const mesh of meshes()) assert.ok(!mesh.visible && mesh.count === 0);
  discs.dispose();
  assert.equal(meshes().length, 0, 'dispose takes them away');
});

test('whose side: the server’s always; ?demo=board fakes one for chatters only, steady per id', () => {
  assert.equal(sideOf(dude('a', { side: 'red' }), false), 'red');
  assert.equal(sideOf(dude('a', { side: 'gold' }), true), 'gold', 'a real side beats the demo');
  // Story OFF: no side in the view, no demo: no marks, today's game.
  for (const id of ['kick:1', 'dev:alex', 'dev:kev']) assert.equal(sideOf(dude(id), false), undefined);

  assert.equal(demoSidesOn('?stream=1&demo=board'), true);
  for (const search of ['', '?stream=1', '?demo=show', '?demo=boards', '?stats=1']) assert.equal(demoSidesOn(search), false, search);

  const ids = Array.from({ length: 40 }, (_, i) => `dev:test-${i}`);
  const sides = ids.map((id) => sideOf(dude(id), true));
  assert.ok(sides.includes('gold') && sides.includes('red') && sides.includes(undefined), 'both sides and some neutrals');
  assert.ok(sides.filter((s) => s).length >= 24, 'most chatters in view carry a mark');
  assert.deepEqual(ids.map((id) => sideOf(dude(id), true)), sides, 'the same side every frame');
  // The town's own people never get a fake side: troublemakers, residents, travellers, the head.
  for (const extra of [{ npc: true }, { resident: true }, { traveller: true }, { mayor: true }] as Partial<DudeView>[])
    for (const id of ids) assert.equal(demoSide(dude(id, extra)), undefined, JSON.stringify(extra));
});

test('the disc lies on the ground under a dude on foot, and goes while they are up on or aboard a build', () => {
  assert.equal(discHeight(dude('a'), 0, 'idle'), SIDE_DISC.y);
  assert.equal(discHeight(dude('a'), 0, 'walk'), SIDE_DISC.y);
  assert.equal(discHeight(dude('a'), 0, 'away'), SIDE_DISC.y, 'napping where they stand');
  assert.equal(discHeight(dude('a'), 0, 'ko'), SIDE_DISC.y, 'knocked flat');
  // Going into a build the disc stays, scaled by the shrinking figure (pose() stops at f.vis <= 0).
  assert.equal(discHeight(dude('a', { hidden: true }), 0, 'idle'), SIDE_DISC.y, 'shrinks with them into a build');
  assert.equal(discHeight(dude('a', { riding: 'o1' }), 1.1, 'drive'), undefined, 'aboard');
  assert.equal(discHeight(dude('a'), 2.4, 'idle'), undefined, 'up on a roof');
  assert.equal(discHeight(dude('a'), 0, 'swim'), undefined, 'in the river');
  assert.ok(SIDE_DISC.y > 0.04 && SIDE_DISC.y < 0.05, 'over the pavement and the kerb tops, under the feet');
});

test('the tag icon: a crown for gold, a pennant flag for red, nothing for a neutral', () => {
  const crown = sideIcon('gold'),
    flag = sideIcon('red');
  assert.equal(sideIcon(undefined), '');
  assert.notEqual(crown, flag);
  for (const [icon, hex] of [[crown, SIDE_HEX.gold], [flag, SIDE_HEX.red]] as const) {
    assert.match(icon, /^<svg [^>]*viewBox="[^"]+"[^>]*>.*<\/svg>$/s);
    assert.ok(icon.includes(hex), 'in the side colour');
    assert.ok(icon.includes(CREAM) && icon.includes(INK), 'with the sticker rim');
    assert.ok(!/[^\x00-\x7f]/.test(icon), 'plain SVG, no emoji font involved');
  }
  assert.ok(crown.includes('<circle'), 'the crown has its balls on the points');
  assert.ok(!flag.includes(SIDE_HEX.gold) && !crown.includes(SIDE_HEX.red), 'each icon in its own colour only');
});

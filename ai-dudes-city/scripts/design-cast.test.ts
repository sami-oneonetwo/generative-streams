// The Stone cast (FK-006): the cast spec FK-016 applies, and the board that shows it. The catalogue
// sets each member's body and the real sizes of what they carry, and the brief turns those into metres
// on the standard figure astra designs on; the board's pixel counts (design/board/cast.ts) judge the
// design gate's colours and Wren's red top third. The last tests read what is committed: the spec in
// its locked colours with no checks open, and the measures the board took of it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CAST, CAST_ROLES, STORY, castColours, castIn, castLines, composeCast, editKit, kitNotes, readsGold, readsRed, seatPose, sizeChecks, standardLength, standingHeight, worldLength, type CastLook, type CastRole } from '../design/story';
import { CAST_ORDER, PHONE, PHONE_FREE_HALF, PHONE_HALF, SLOT, colourShares, familyArea, lineUpSlots, mainColours, ownArea, redArea, redShare, toGrey, topThirdRed } from '../design/board/cast';
import OUTFITS from '../src/shared/ageOutfits.json';
import type { AgeOutfits, OutfitPart } from '../src/shared/outfits';

const KITS = OUTFITS as unknown as Record<string, AgeOutfits>;
const part = (bone: OutfitPart['bone'], size: [number, number, number], colour = '#76513b', position: [number, number, number] = [0, 0, 0]): OutfitPart => ({ bone, shape: 'box', position, size, rotation: [0, 0, 0], colour });

test('the catalogue sets the silhouettes: Ash the tallest, Oak the broadest, Kit the smallest, Wren a teen at 0.82', () => {
  const tall = Object.fromEntries(castIn('stone').map((r) => [r, standingHeight(CAST[r].body, CAST[r].scale.stone!)]));
  assert.equal(Math.max(...Object.values(tall)), tall.ash);
  assert.ok(tall.ash > tall.oak + 0.2, `Ash ${tall.ash.toFixed(2)} m, Oak ${tall.oak.toFixed(2)} m`);
  assert.equal(Math.min(...Object.values(tall)), tall.kit);
  assert.ok(Math.abs(tall.wren - 1.43) < 0.01);
  const broad = (r: CastRole) => CAST[r].body.build * CAST[r].scale.stone!;
  for (const r of CAST_ROLES) if (r !== 'oak') assert.ok(broad('oak') > broad(r), r);
  // The head is built as the game builds him (src/shared/ages.ts look(): height 1.12, build 1.1).
  assert.deepEqual(CAST.head.body, { height: 1.12, build: 1.1 });
  assert.ok(CAST.moss.seated && !CAST.wren.seated);
});

test("a hero size goes into the brief in standard-figure metres and comes back out as the world's", () => {
  for (const role of ['ash', 'oak', 'kit'] as const) {
    const m = CAST[role],
      scale = m.scale.stone!;
    const s = m.sizes![0];
    const std = standardLength(s, m.body, scale);
    // A part that long, on that bone, is the size the card asks for in the world.
    const size: [number, number, number] = s.along ? [0.06, std, 0.06] : [std, 0.06, 0.06];
    assert.ok(Math.abs(worldLength(part(s.bone, size), m.body, scale) - s.m) < 1e-9, role);
  }
  assert.ok(Math.abs(standardLength(CAST.ash.sizes![0], CAST.ash.body, 1.15) - 2.1 / 1.15 / 1.15) < 1e-9);
  // The brief carries them.
  const lines = castLines('stone', castIn('stone'));
  assert.match(lines, /the carved staff 1\.59 m long down the armR bone of the standard figure \(2\.1 m in the world\)/);
  assert.match(lines, /the mallet head 0\.28 m across, on the armR bone/);
  assert.match(lines, /the gold badge 0\.24 m across, on the hips bone/);
  assert.match(lines, /Her top third is everything from 1\.16 m up/);
  assert.match(lines, /Always seated on the prop/);
  assert.match(lines, /2\.27 m standing/);
});

test('the size checks find the staff, the mallet head and the badge among their own parts, not the kit', () => {
  const ash = (staff: number): CastLook => composeCast('stone', 'ash', { role: 'ash', base: 1, look: { hair: '#6E7680' }, parts: [part('armR', [0.07, staff, 0.07])] }, KITS.stone);
  assert.deepEqual(sizeChecks(ash(1.59), 'stone'), []);
  assert.match(sizeChecks(ash(1.0), 'stone').join(), /no carved staff near 2\.1 m on armR \(closest 1\.32 m\)/);
  // Kit 3's own 1.95 m spear doesn't count as Ash's staff.
  const onSpear = composeCast('stone', 'ash', { role: 'ash', base: 3, look: { hair: '#6E7680' }, parts: [] }, KITS.stone);
  assert.match(onSpear.checks!.join(), /no carved staff near 2\.1 m on armR$/m);
  // Ash carries no staff check in Bronze (he lies on his bedroll).
  assert.deepEqual(sizeChecks(composeCast('bronze', 'ash', { role: 'ash', parts: [] }, KITS.bronze), 'bronze'), []);
});

test("Moss sits with her hip joint just over her stump's top and her feet on the ground", () => {
  const seat = seatPose(0.42, CAST.moss.body, 1);
  const hipY = 0.8 * CAST.moss.body.height;
  assert.ok(Math.abs(seat.rise + hipY - 0.5) < 0.002, 'hip joint 0.08 m over the seat');
  assert.ok(Math.abs(Math.cos(-seat.legs) * hipY - 0.5) < 0.002, 'the legs reach the ground');
  assert.ok(seat.legs < -0.5 && seat.legs > -1.2, `legs at ${seat.legs} rad`);
  // A scaled member sits the same in the world: the pose is in the figure's own (unscaled) units.
  const big = seatPose(0.42, { height: 1 }, 1.25);
  assert.ok(Math.abs(1.25 * (big.rise + 0.8) - 0.5) < 0.002);
  const moss = composeCast('stone', 'moss', { role: 'moss', base: 2, look: { shirt: '#4E8A3A' }, parts: [part('head', [0.4, 0.3, 0.38], '#4E8A3A')], prop: { name: 'Stump', parts: [{ shape: 'cylinder', position: [0, 0.21, 0], size: [0.55, 0.42, 0.55], rotation: [0, 0, 0], color: '#76513b' }] } }, KITS.stone);
  assert.deepEqual(moss.seat, seat);
  assert.equal(composeCast('stone', 'oak', { role: 'oak' }, KITS.stone).seat, undefined);
});

test("a prop's parts may come back with garment-style \"colour\": the stump keeps its wood, and a colour that is lost is a check", () => {
  const stump = (k: 'color' | 'colour', c: string) => ({ shape: 'cylinder', position: [0, 0.21, 0], size: [0.6, 0.42, 0.6], rotation: [0, 0, 0], [k]: c });
  const moss = (p: object) => composeCast('stone', 'moss', { role: 'moss', base: 2, look: { shirt: '#4E8A3A' }, parts: [part('head', [0.4, 0.3, 0.38], '#4E8A3A')], prop: { name: 'Stump', parts: [p] } }, KITS.stone);
  assert.equal(moss(stump('colour', '#6b4a2e')).prop!.parts[0].color, '#6b4a2e');
  assert.equal(moss(stump('colour', '#6b4a2e')).checks, undefined);
  assert.match(moss(stump('colour', 'bark')).checks!.join(), /1 bad shapes or colours replaced on the prop \(a tree stump\)/);
});

test("a pinned kit's edits take parts off and recolour others by the kit's own index; the rest is the kit as shipped", () => {
  const kit = KITS.stone.kits[1].parts;
  // Kit 1's basket (16–21) off, its olive capes (8, 9) in hide and in the shirt; nonsense ignored.
  const raw = { drop: [21, 16, 17, 18, 19, 20, 16, 99, -1, 'x'], colour: { 8: '#76513b', 9: 'shirt:dark', 16: '#ffffff', 3: 'red', 40: '#000000' } };
  const oak = composeCast('stone', 'oak', { role: 'oak', base: 1, kitEdits: raw, parts: [part('hips', [0.4, 0.5, 0.05], '#E8762B')] }, KITS.stone);
  assert.deepEqual(oak.kitEdits, { drop: [16, 17, 18, 19, 20, 21], colour: { 8: '#76513b', 9: 'shirt:dark' } });
  assert.equal(oak.outfit.parts.length, kit.length - 6 + 1);
  assert.deepEqual(oak.outfit.parts.slice(0, 8), kit.slice(0, 8));
  assert.deepEqual(oak.outfit.parts.slice(8, 10), [
    { ...kit[8], colour: '#76513b' },
    { ...kit[9], colour: 'shirt:dark' },
  ]);
  assert.deepEqual(oak.outfit.parts.slice(10, 16), kit.slice(10, 16));
  assert.equal(oak.outfit.parts.at(-1)!.colour, '#E8762B');
  // No edits: the kit as shipped, and none written.
  assert.deepEqual(editKit(kit, undefined), kit);
  const plain = composeCast('stone', 'oak', { role: 'oak', base: 1, kitEdits: { drop: [40] }, parts: [] }, KITS.stone);
  assert.equal(plain.kitEdits, undefined);
  assert.deepEqual(plain.outfit.parts, kit);
});

test("the brief tells astra what each shipped Stone kit already wears and holds: the head's and leader's gold, the poles", () => {
  const notes = kitNotes(KITS.stone);
  assert.equal(notes.length, 6);
  assert.match(notes[0], /^"0" \(Flintworker of the Sinew Seam\): holds a 1\.2 m pole in the right hand$/);
  assert.match(notes[3], /holds a 1\.9 m pole in the right hand/);
  assert.match(notes[4], /^"head" .*story gold \(#e9b04c\): only the head or Kit may be pinned on it/);
  assert.match(notes[5], /^"leader" .*story gold/);
  assert.ok(readsGold('#e9b04c'));
});

test('the line-up stands them in the card order, side by side, centred', () => {
  const slots = lineUpSlots(['head', 'kit', 'wren', 'oak', 'moss', 'ash']);
  assert.deepEqual(
    slots.map((s) => s.role),
    [...CAST_ORDER],
  );
  assert.equal(slots[0].x, -2.5 * SLOT);
  assert.equal(slots[5].x, 2.5 * SLOT);
  // Someone missing (Ash after Bronze) closes the gap.
  assert.deepEqual(
    lineUpSlots(['wren', 'moss']).map((s) => s.x),
    [-SLOT / 2, SLOT / 2],
  );
});

/** A w×h RGBA picture filled with `bg`, with rectangles painted on it. */
function picture(w: number, h: number, bg: number[], rects: [number, number, number, number, number[]][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4);
  for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([...c, 255], (y * w + x) * 4);
  return px;
}
const MAGENTA = [255, 0, 255],
  RED = [0xb3, 0x26, 0x2e],
  BROWN = [0x98, 0x70, 0x52],
  BROWN2 = [0x76, 0x51, 0x3b],
  SKIN = [0xe0, 0xac, 0x85],
  GREEN = [0x4e, 0x8a, 0x3a];

test("the board counts a flat figure's pixels: its silhouette, its top third, each colour, and not the blurred edges", () => {
  // Rows 3–14 are the figure (12 rows, so the top third is rows 3–6): a red head-and-shoulders block, a brown body, an edge pixel between.
  const px = picture(10, 20, MAGENTA, [
    [2, 3, 8, 7, RED],
    [2, 7, 8, 15, BROWN],
    [8, 9, 9, 10, [170, 120, 90]],
  ]);
  const s = colourShares(px, 10, 20, ['#b3262e', '#987052'], '#ff00ff');
  assert.equal(s.total, 24 + 48 + 1);
  assert.equal(s.top, 24);
  assert.deepEqual(s.by, { '#b3262e': 24, '#987052': 48 });
  assert.deepEqual(s.topBy, { '#b3262e': 24 });
  assert.equal(topThirdRed(s), 1);
  assert.ok(Math.abs(redShare(s) - 24 / 73) < 1e-9);
  assert.deepEqual(colourShares(picture(4, 4, MAGENTA, []), 4, 4, ['#b3262e'], '#ff00ff'), { total: 0, top: 0, by: {}, topBy: {} });
});

test("main colours: skin aside, a hide's two browns counted once, small bits left out, biggest first", () => {
  const px = picture(20, 10, MAGENTA, [
    [0, 0, 8, 10, GREEN],
    [8, 0, 13, 10, BROWN],
    [13, 0, 16, 10, BROWN2],
    [16, 0, 19, 10, SKIN],
    [19, 0, 20, 10, RED],
  ]);
  const s = colourShares(px, 20, 10, ['#4e8a3a', '#987052', '#76513b', '#e0ac85', '#b3262e'], '#ff00ff');
  assert.deepEqual(mainColours(s, ['#e0ac85']), [
    { hex: '#4e8a3a', share: 0.4 },
    { hex: '#987052', share: 0.4 },
  ]);
  // Red is 5%: under the 8% that makes a main colour.
  assert.equal(
    mainColours(s, ['#e0ac85'], 0.05).some((c) => c.hex === '#b3262e'),
    true,
  );
});

test("a colour's area counts its tones as the page shades them, and red and gold as a viewer reads them", () => {
  const ORANGE = [0xe8, 0x76, 0x2b],
    ORANGE_DARK = ORANGE.map((n) => Math.round(n * 0.72)),
    ORANGE_LIGHT = ORANGE.map((n) => Math.round(n + (255 - n) * 0.4)),
    RED_DARK = [0x7a, 0x14, 0x19];
  const hexOf = (c: number[]) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
  const px = picture(20, 10, MAGENTA, [
    [0, 0, 4, 10, ORANGE],
    [4, 0, 6, 10, ORANGE_DARK],
    [6, 0, 7, 10, ORANGE_LIGHT],
    [7, 0, 10, 10, BROWN],
    [10, 0, 13, 10, RED],
    [13, 0, 15, 10, RED_DARK],
    [15, 0, 20, 10, GREEN],
  ]);
  const s = colourShares(px, 20, 10, ['#e8762b', hexOf(ORANGE_DARK), hexOf(ORANGE_LIGHT), '#987052', '#b3262e', '#7a1419', '#4e8a3a'], '#ff00ff');
  // Oak's orange in all three tones, and not the brown beside it.
  assert.equal(familyArea(s, '#E8762B'), 70);
  assert.equal(ownArea(s, '#E8762B'), 70);
  // Wren's red with its deep tone; green as itself.
  assert.equal(redArea(s), 50);
  assert.equal(ownArea(s, STORY.red), 50);
  assert.equal(ownArea(s, '#4E8A3A'), 50);
  assert.equal(ownArea(s, STORY.gold), 0);
});

test('the phone check greys the stream frame at 20%: 390 px of 1920, at the auto camera\'s closest zoom and in free play', () => {
  assert.equal(PHONE.width / PHONE.frame, 390 / 1920);
  assert.equal(PHONE_HALF, 6);
  // Free play frames the crowd between the auto camera's 6 and 40 m (client/dudes/main.ts AUTO_MIN, AUTO_MAX).
  assert.ok(PHONE_FREE_HALF > PHONE_HALF * 2 && PHONE_FREE_HALF < 40);
  const px = new Uint8ClampedArray([0xb3, 0x26, 0x2e, 255, 0xff, 0xc6, 0x33, 255]);
  toGrey(px);
  // Red and gold stay far apart in greyscale (design-system §2: luminance 0.11 against 0.62).
  assert.ok(px[0] === px[1] && px[1] === px[2]);
  assert.ok(px[4] - px[0] > 100, `${px[0]} vs ${px[4]}`);
});

test('the cast board renders through the shared browser and writes the board and its measures', () => {
  const src = readFileSync('design/render-cast.mjs', 'utf8');
  assert.match(src, /import \{ launch \} from '\.\/browser\.mjs'/);
  assert.match(src, /\$\{age\}-board\.png/);
  assert.match(src, /\$\{age\}-measures\.json/);
  assert.match(src, /note-\$\{age\}-board\.txt/);
});

// ---- what is committed ---------------------------------------------------------------------------------
const SPEC_FILE = 'design/spec/cast/stone.json';
const spec = JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as { age: string; cast: Record<CastRole, CastLook> };

test('the Stone cast spec FK-016 applies: all six on the shipped kits, at the catalogue scale and body, in locked colours, no checks open', () => {
  assert.equal(spec.age, 'stone');
  assert.deepEqual(Object.keys(spec.cast), castIn('stone'));
  for (const role of castIn('stone')) {
    const c = spec.cast[role],
      m = CAST[role];
    assert.equal(c.role, role);
    assert.equal(c.scale, m.scale.stone, role);
    assert.deepEqual([c.look.height, c.look.build], [m.body.height, m.body.build], role);
    assert.equal(c.checks, undefined, `${role}: ${c.checks}`);
    // Today's rules still pass (the checks were written by the run that made it).
    assert.deepEqual(composeCast('stone', role, { ...c, base: c.base.split(':')[1], parts: c.outfit.parts.slice(c.outfit.parts.length - c.extras), hide: c.outfit.hide }, KITS.stone).checks, undefined, role);
    // The pinned kit is the one the game ships, part for part (bar the design lead's kit edits), under their own parts.
    const [, which] = c.base.split(':');
    const kit = which === 'head' || which === 'leader' ? KITS.stone[which]! : KITS.stone.kits[Number(which)];
    assert.deepEqual(c.outfit.parts.slice(0, c.outfit.parts.length - c.extras), editKit(kit.parts, c.kitEdits), `${role} on ${c.base}`);
  }
  assert.equal(spec.cast.head.base, 'stone:head');
  assert.equal(spec.cast.head.hatScale, 1);
  assert.equal(spec.cast.head.name, 'Chief');
  assert.ok(!spec.cast.head.outfit.parts.some((p) => p.colour.startsWith('#') && readsRed(p.colour)));
  assert.ok(spec.cast.head.outfit.parts.some((p) => p.colour.toUpperCase() === STORY.gold));
  // Moss sits on her stump, posed from its top.
  const moss = spec.cast.moss;
  assert.ok(moss.prop && moss.prop.parts.length >= 3);
  assert.deepEqual(moss.seat, seatPose(moss.seat!.top, CAST.moss.body, 1));
  assert.ok(moss.seat!.top >= 0.38 && moss.seat!.top <= 0.45, `seat ${moss.seat!.top} m`);
});

test("no two of the six carry the same thing: the kits' basket and gourd are off, and each one's held things are their own", () => {
  // A held thing hangs from a hand: an arm part reaching below the hand (client/dudes/dudes.ts: −0.46 on the standard figure).
  const held = (c: CastLook) => c.outfit.parts.filter((p) => (p.bone === 'armL' || p.bone === 'armR') && p.position[1] - p.size[1] / 2 < -0.46).map((p) => JSON.stringify([p.bone, p.shape, p.position, p.size]));
  const roles = castIn('stone');
  for (let i = 0; i < roles.length; i++)
    for (let j = i + 1; j < roles.length; j++) {
      const a = held(spec.cast[roles[i]]),
        b = held(spec.cast[roles[j]]);
      assert.deepEqual(
        a.filter((x) => b.includes(x)),
        [],
        `${roles[i]} and ${roles[j]} carry the same thing`,
      );
    }
  // Kit 1's basket of greens and kit 2's gourd are on nobody, though Ash, Oak and Kit wear kit 1 and Wren and Moss kit 2.
  const kitHeld = [...held({ outfit: KITS.stone.kits[1] } as CastLook), ...held({ outfit: KITS.stone.kits[2] } as CastLook)];
  assert.equal(kitHeld.length, 9);
  for (const role of roles) assert.deepEqual(held(spec.cast[role]).filter((x) => kitHeld.includes(x)), [], role);
  // Oak's mallet head rides over his shoulder (above the arm's root), clear of his body; Ash's staff and the Chief's reach the ground.
  const mallet = spec.cast.oak.outfit.parts.find((p) => p.bone === 'armR' && p.colour === '#a8a392' && p.size[0] >= 0.28);
  assert.ok(mallet && mallet.position[1] > 0.2, `Oak's mallet head at ${mallet?.position[1]} on his arm`);
});

const chroma = (hex: string) => {
  const n = parseInt(hex.slice(1), 16),
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(...c) - Math.min(...c);
};
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16),
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255],
    max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
/** A Stone hide, bone or stone: a quiet brown, ochre or cream (chroma under 100, hue 15–60°), or a grey or near-black (chroma under 40). */
const stoneHide = (hex: string) => chroma(hex) < 40 || (chroma(hex) < 100 && hue(hex) >= 15 && hue(hex) <= 60);

test("each one wears their own colour, story red and gold where they mean something, and Stone hides: nobody else's colour", () => {
  assert.ok(['#76513b', '#987052', '#c3a575', '#e1d3ae', '#3d2a1e', '#a8a392', '#6E7680'].every(stoneHide));
  // Kit 1's olive capes are Moss's green family, and the head kit's war paint is Oak's orange: neither is a hide.
  assert.ok(!['#7c9254', '#a8ad68', '#f07835', '#4E8A3A', '#E8762B', '#2F6FD0', STORY.red, STORY.gold].some(stoneHide));
  const own: Record<CastRole, string[]> = { wren: [STORY.red], ash: [CAST.ash.colour, STORY.red], moss: [CAST.moss.colour], oak: [CAST.oak.colour], kit: [CAST.kit.colour, STORY.gold], head: [STORY.gold] };
  for (const role of castIn('stone'))
    for (const hex of castColours(spec.cast[role])) {
      const ok = stoneHide(hex) || own[role].some((c) => c.toLowerCase() === hex.toLowerCase()) || (own[role].includes(STORY.gold) && readsGold(hex));
      assert.ok(ok, `${role} wears ${hex}`);
    }
});

const MEASURES = 'design/out/cast/stone-measures.json';
const measured = JSON.parse(readFileSync(MEASURES, 'utf8')) as { age: string; spec: string; measures: { role: string; main: { hex: string; share: number }[]; red: number; topRed: number; px: number; ownPx: number; phonePx: number; phoneW: number; freePx: number }[] };
const by = Object.fromEntries(measured.measures.map((m) => [m.role, m]));

test('the board was drawn from the spec as committed (re-render after any change: node design/render-cast.mjs stone)', async () => {
  const { createHash } = await import('node:crypto');
  assert.equal(measured.spec, createHash('sha256').update(readFileSync(SPEC_FILE)).digest('hex').slice(0, 16));
  assert.ok(existsSync('design/out/cast/stone-board.png'));
  assert.deepEqual(measured.measures.map((m) => m.role), [...CAST_ORDER]);
});

test("the board's pixel counts pass the gate: Wren's top third is red, everyone's locked colour is their biggest, 4 main colours at most", () => {
  assert.ok(by.wren.topRed >= 0.7, `Wren's top third is ${by.wren.topRed} red`);
  for (const role of ['wren', 'ash', 'moss', 'oak', 'kit'] as const) assert.equal(by[role].main[0].hex, CAST[role].colour.toLowerCase(), `${role}'s biggest colour is ${by[role].main[0].hex}`);
  for (const m of measured.measures) assert.ok(m.main.length <= 4, `${m.role}: ${m.main.length} main colours`);
  // The head: gold among his main colours, nothing red on him.
  assert.ok(by.head.main.some((c) => c.hex === STORY.gold.toLowerCase()));
  assert.equal(by.head.red, 0);
  for (const role of ['ash', 'moss', 'oak', 'kit'] as const) assert.ok(by[role].red < 0.03, `${role} is ${by[role].red} red`);
  // On the phone Kit is the smallest of them, in close shots and in free play.
  assert.equal(Math.min(...measured.measures.map((m) => m.phonePx)), by.kit.phonePx);
  assert.equal(Math.min(...measured.measures.map((m) => m.freePx)), by.kit.freePx);
  for (const m of measured.measures) assert.ok(m.freePx > 0 && m.freePx < m.phonePx, `${m.role}: ${m.freePx} px in free play`);
});

test("Wren's red is the biggest colour mass in the line-up: more pixels than Oak's orange, Moss's green, Kit's blue, Ash's grey or the Chief's gold", () => {
  // All six drawn flat from the stream camera at one size, so their pixels compare (design/board/main.ts flatShares).
  assert.ok(by.wren.ownPx > 0.5 * by.wren.px, `Wren is ${by.wren.ownPx} px red of ${by.wren.px}`);
  for (const m of measured.measures) if (m.role !== 'wren') assert.ok(by.wren.ownPx >= m.ownPx, `Wren's red ${by.wren.ownPx} px against ${m.role}'s own colour ${m.ownPx} px`);
  // Everything else on them is a quiet Stone hide (main colours beyond their own), so nothing louder stands beside her red.
  for (const m of measured.measures)
    if (m.role !== 'wren') for (const c of m.main) assert.ok(c.hex === CAST[m.role as CastRole].colour.toLowerCase() || stoneHide(c.hex), `${m.role}'s main colour ${c.hex}`);
});

test('at 390 px in greyscale every pair of the six differs by a quarter in height or width: their silhouettes tell them apart', () => {
  const m = measured.measures;
  for (let i = 0; i < m.length; i++)
    for (let j = i + 1; j < m.length; j++) {
      const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(1, Math.min(a, b));
      assert.ok(Math.max(ratio(m[i].phonePx, m[j].phonePx), ratio(m[i].phoneW, m[j].phoneW)) >= 1.25, `${m[i].role} ${m[i].phonePx}×${m[i].phoneW} against ${m[j].role} ${m[j].phonePx}×${m[j].phoneW}`);
    }
  // The design note under the board says the same, and passes the gate.
  const note = readFileSync('design/out/cast/note-stone-board.txt', 'utf8');
  assert.match(note, /^Design gate .*passed/);
  for (const x of m) assert.ok(note.includes(`${x.phonePx}×${x.phoneW}`), `${x.role} ${x.phonePx}×${x.phoneW}`);
});

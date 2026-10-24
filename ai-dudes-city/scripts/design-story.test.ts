// The design board's pipeline (FK-003): the brief every astra call gets matches the real map, the
// renderers launch the shared headless browser, and the Finders Keepers pieces (design/story.ts) are
// checked the way the design gate needs: the Folly in its room with its hero tags and the story
// colours where they belong, the cast pinned on the shipped kits in their locked colours, the pets to
// the companion spec. Zero AI: these test what runs on astra's answers, not the calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ELEMENTS, WORLD } from '../design/catalogue';
import { CAST, FOLLIES, HAT_LADDER, PET, PET_BRANCH, STORY, castIn, checkFolly, cleanParts, cleanPetKits, composeCast, petChecks, readsGold, readsRed } from '../design/story';
import OUTFITS from '../src/shared/ageOutfits.json';
import { AGE_IDS } from '../src/shared/ages';
import { CITY, RIVER } from '../src/shared/city';
import type { AgeOutfits } from '../src/shared/outfits';
import type { Blueprint, Primitive } from '../src/shared/objectTypes';

const KITS = OUTFITS as unknown as Record<string, AgeOutfits>;
const box = (position: [number, number, number], size: [number, number, number], color = '#8a6a48', tag?: string) => ({ shape: 'box', position, size, rotation: [0, 0, 0], color, ...(tag ? { tag } : {}) });

test("the brief every astra call gets describes today's map: 12 m lots, blocks of eight round a courtyard, corner parks", () => {
  assert.equal(CITY.plot, 12);
  assert.match(WORLD, /a 12 m lot/);
  assert.match(WORLD, /4 home blocks round the town square, each block 8 lots round a green courtyard/);
  assert.match(WORLD, /a little park in each of the 4 corner blocks/);
  assert.match(WORLD, new RegExp(`a ${RIVER.width} m river runs past the east ring road`));
  assert.doesNotMatch(WORLD, /22 m|3×3|16 m/);
  // The free-lot brief was the other stale size.
  assert.match(ELEMENTS.find((e) => e.id === 'lot-sale')!.brief, /An unclaimed 12 m lot/);
  for (const t of ['Chief', 'High Priest', 'King', 'Alderman', 'Mayor', 'Overseer']) assert.ok(WORLD.includes(`the head is the ${t}`), t);
});

test('both renderers launch the shared playwright-core + SwiftShader browser, not the missing noodle-shop one', () => {
  for (const f of ['design/render.mjs', 'design/render-outfits.mjs']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /import \{ launch \} from '\.\/browser\.mjs'/, f);
    assert.doesNotMatch(src, /noodle-shop|channel: 'chrome'/, f);
  }
  const browser = readFileSync('design/browser.mjs', 'utf8');
  assert.match(browser, /gs-tools/);
  assert.match(browser, /--use-angle=swiftshader/);
});

test('cleanParts repairs shapes, vectors and colours, keeps glow and known tags, and caps the count', () => {
  const r = cleanParts([{ shape: 'pyramid', position: [1, 2], size: [-2, 0, 1], rotation: [0, 0, 0], color: 'red', tag: 'door', glow: true }, box([0, 1, 0], [1, 1, 1], '#112233', 'hat'), 'junk', ...Array.from({ length: 5 }, () => box([0, 0.5, 0], [1, 1, 1]))], 4, ['door']);
  assert.equal(r.parts.length, 4);
  assert.equal(r.dropped, 3);
  assert.equal(r.fixed, 2); // the shape and the colour of the first
  assert.equal(r.untagged, 1); // "hat" is not one of the tags
  assert.deepEqual(r.parts[0], { shape: 'box', position: [0, 0, 0], size: [2, 0.02, 1], rotation: [0, 0, 0], color: '#8f8a82', glow: true, tag: 'door' });
  assert.equal(r.parts[1].tag, undefined);
});

test('every age has a Folly that fits the 16 m plot, with its hero tags and story colours on tagged parts only', () => {
  for (const age of AGE_IDS) {
    const f = FOLLIES[age];
    assert.ok(f.name && f.brief.length > 80, age);
    assert.ok(f.half <= 8 && f.height > 0, `${age} fits the 16×16 m Folly plot`);
    for (const t of [...f.required, ...f.gold, ...(f.red ?? [])]) assert.ok(f.tags[t], `${age} describes its ${t} tag`);
  }
  assert.deepEqual(FOLLIES.stone.required, ['door', 'plaque', 'flag']);
  assert.deepEqual(FOLLIES.stone.gold, ['flag', 'crown']);
  assert.equal(FOLLIES.stone.half * 2, 14);
  assert.equal(FOLLIES.stone.height, 11);
});

test('a Big Hut that keeps the rules passes clean, with its hero parts indexed by tag', () => {
  const hut = {
    name: 'The Big Hut',
    description: 'A huge hut with a tiny door.',
    parts: [
      box([0, 4, 0], [12, 8, 12]),
      box([0, 0.5, 6.05], [0.6, 1, 0.1], '#3a2a1e', 'door'),
      box([1, 1.2, 6.05], [1, 0.6, 0.1], '#9a8a70', 'plaque'),
      { shape: 'cylinder', position: [0, 9.5, 0], size: [0.1, 3, 0.1], rotation: [0, 0, 0], color: '#6b5236' },
      box([0.4, 10.5, 0], [0.8, 0.5, 0.05], STORY.gold, 'flag'),
      box([-0.6, 1, 6.1], [0.3, 2, 0.3], '#6b5236'),
      box([-0.6, 1.6, 6.26], [0.2, 0.2, 0.02], STORY.red, 'handprint'),
    ],
  };
  const f = checkFolly('stone', hut);
  assert.equal(f.checks, undefined, String(f.checks));
  assert.deepEqual(f.heroes, { door: [1], plaque: [2], flag: [4], handprint: [6] });
});

test('the Folly checks catch a missing hero tag, gold or red off their tags, and a design too big for its room', () => {
  const f = checkFolly('stone', {
    name: 'Too much',
    parts: [box([0, 6, 0], [16, 12, 10]), box([0, 0.5, 5], [0.6, 1, 0.1], STORY.gold, 'door'), box([2, 1, 5], [1, 1, 0.1], STORY.red), box([0, 1, 5], [1, 1, 0.1], '#777777', 'chimney')],
  });
  const checks = f.checks!.join(' | ');
  assert.match(checks, /no part tagged plaque, flag/);
  assert.match(checks, /1 parts story gold outside flag\/crown/);
  assert.match(checks, /1 parts read as story red outside handprint/);
  assert.match(checks, /reaches 16\.0 × 10\.1 m \(room 14 × 14\)/);
  assert.match(checks, /12\.0 m tall \(room 11 m\)/);
  assert.match(checks, /1 unknown tags removed/);
  assert.match(checkFolly('bronze', { parts: [] }).checks!.join(), /no parts/);
});

test('the cast: Ash only while he lives, scales and the hat ladder from the catalogue, never from the model', () => {
  assert.deepEqual(castIn('stone'), ['wren', 'ash', 'moss', 'oak', 'kit', 'head']);
  assert.deepEqual(castIn('bronze'), ['wren', 'ash', 'moss', 'oak', 'kit', 'head']);
  assert.deepEqual(castIn('medieval'), ['wren', 'moss', 'oak', 'kit', 'head']);
  assert.deepEqual(
    AGE_IDS.map((a) => HAT_LADDER[a]),
    [1, 1.2, 1.4, 1.6, 1.8, 2],
  );
  assert.equal(CAST.wren.scale.stone, 0.82);
  assert.equal(CAST.wren.scale.medieval, 1);
  assert.equal(CAST.oak.scale.stone, 1.25);
  assert.equal(CAST.kit.scale.future, 0.7);
  assert.equal(CAST.ash.scale.stone, 1.15);
});

const wren = {
  role: 'wren',
  name: 'Ochre Hide and Cord',
  base: 2,
  scale: 3,
  look: { skin: '#c68a5e', hair: '#2b2018', shirt: '#8a6a48', pants: '#5a4532', hat: 'none', hatColor: '#000000', accessory: 'none', accessoryColor: '#000000', build: 0.9 },
  hide: ['hair', 'nonsense'],
  parts: [
    { bone: 'head', shape: 'box', position: [0, 0.3, -0.05], size: [0.34, 0.08, 0.3], rotation: [0, 0, 0], colour: STORY.red },
    { bone: 'hips', shape: 'box', position: [0, 0.55, 0], size: [0.5, 0.12, 0.3], rotation: [0, 0, 0], colour: STORY.red },
    { bone: 'tail', shape: 'box', position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0], colour: STORY.red },
  ],
};

test('a cast look is the pinned shipped kit with their own parts after it, in fixed colours, at the catalogue scale', () => {
  const c = composeCast('stone', 'wren', wren, KITS.stone);
  assert.equal(c.base, 'stone:2');
  assert.equal(c.scale, 0.82); // the model said 3
  assert.equal(c.name, 'Wren');
  const pinned = KITS.stone.kits[2];
  assert.equal(c.extras, 2); // the part on an unknown bone is dropped
  assert.equal(c.outfit.parts.length, pinned.parts.length + 2);
  assert.deepEqual(c.outfit.parts.slice(0, pinned.parts.length), pinned.parts);
  assert.ok(c.outfit.hide!.includes('hair') && !c.outfit.hide!.includes('nonsense' as never));
  assert.equal(c.look.height, 1);
  assert.equal(c.look.build, 0.9);
  assert.equal(c.checks, undefined, String(c.checks));
});

test('the cast checks hold the locked colours: no red on the head, red on top of Wren, each one wearing their own colour', () => {
  const head = composeCast('stone', 'head', { role: 'head', base: 'head', look: { shirt: STORY.red, pants: '#5a4532', hair: '#2b2018', hat: 'crown', hatColor: STORY.gold }, parts: [] }, KITS.stone);
  assert.equal(head.base, 'stone:head');
  assert.equal(head.name, 'Chief');
  assert.equal(head.hatScale, 1);
  assert.match(head.checks!.join(), /the head wears red \(#B3262E\): red is Wren's/);

  const plainWren = composeCast('stone', 'wren', { ...wren, parts: [] }, KITS.stone);
  assert.match(plainWren.checks!.join(), /no #B3262E on Wren/);
  assert.match(plainWren.checks!.join(), /no red on her head or shoulders/);

  const brown = { shirt: '#5a4532', pants: '#5a4532', hair: '#2b2018', hatColor: '#5a4532', accessoryColor: '#5a4532' };
  const goldOak = composeCast('stone', 'oak', { role: 'oak', base: 0, look: brown, parts: [{ bone: 'hips', shape: 'box', position: [0, 0.2, 0.14], size: [0.4, 0.5, 0.04], rotation: [0, 0, 0], colour: STORY.gold }] }, KITS.stone);
  assert.match(goldOak.checks!.join(), /no #E8762B on Oak the builder/);
  assert.match(goldOak.checks!.join(), /Oak the builder wears gold/);

  const kit = composeCast('stone', 'kit', { role: 'kit', base: 3, look: { shirt: '#2F6FD0', pants: '#2F6FD0', hair: '#2b2018' }, parts: [{ bone: 'hips', shape: 'cylinder', position: [0.1, 0.4, 0.15], size: [0.16, 0.16, 0.03], rotation: [Math.PI / 2, 0, 0], colour: STORY.gold }] }, KITS.stone);
  assert.equal(kit.checks, undefined, String(kit.checks));
});

test('Moss needs her seat, and a kit that is not shipped is reported, not invented', () => {
  const moss = composeCast('stone', 'moss', { role: 'moss', base: 9, look: { shirt: '#4E8A3A' }, parts: [] }, KITS.stone);
  assert.equal(moss.base, 'stone:0'); // no kit 9: pinned on the first
  assert.match(moss.checks!.join(), /no a tree stump/);
  const seated = composeCast('stone', 'moss', { role: 'moss', base: 1, look: { shirt: '#4E8A3A' }, parts: [], prop: { name: 'Stump', parts: [box([0, 0.22, 0], [0.5, 0.45, 0.5])] } }, KITS.stone);
  assert.equal(seated.prop!.parts.length, 1);
  assert.equal(seated.checks, undefined, String(seated.checks));
  // Ash has no prop in Stone, so one sent anyway is dropped.
  assert.equal(composeCast('stone', 'ash', { role: 'ash', prop: { parts: [box([0, 0.1, 0], [2, 0.2, 0.8])] } }, KITS.stone).prop, undefined);
  assert.match(composeCast('stone', 'kit', { role: 'kit' }, undefined).checks!.join(), /no shipped stone kit/);
});

test('red and gold are read the way a viewer reads them: the cast colours are neither', () => {
  assert.ok(readsRed(STORY.red) && readsRed(STORY.redDeep));
  assert.ok(readsGold(STORY.gold));
  for (const c of [CAST.moss.colour, CAST.oak.colour, CAST.kit.colour, CAST.ash.colour, '#9a4a3f', '#a0412d', '#8a6a48']) assert.ok(!readsRed(c), c);
  for (const c of [CAST.oak.colour, '#d9a23a', '#c9b48a', '#b89752', STORY.goldDeep]) assert.ok(!readsGold(c), c);
});

const pet = (parts: Primitive[], moves: Blueprint['moves'] = 'roam'): Blueprint => ({ name: 'Wolf Pup', description: '', parts, moves });
const pup = () => Array.from({ length: 12 }, (_, i) => box([0, 0.2 + i * 0.02, -0.3 + i * 0.05], [0.3, 0.2, 0.2]) as Primitive);

test('pets are checked against the companion spec: size, part count, roaming, no story colours', () => {
  assert.deepEqual(petChecks(pet(pup())), []);
  const big = petChecks(pet([...pup(), box([0, 0.75, 0], [0.3, 1.5, 1.6]) as Primitive], 'drive'));
  assert.match(big.join(), /1\.50 m tall/);
  assert.match(big.join(), /1\.60 m long/);
  assert.match(big.join(), /moves is drive, not roam/);
  assert.match(petChecks(pet(pup().slice(0, 4))).join(), /4 parts \(10–24\)/);
  assert.match(petChecks(pet([...pup().slice(0, 11), box([0, 0.3, 0], [0.2, 0.2, 0.2], STORY.gold) as Primitive])).join(), /a story colour on the pet/);
  assert.ok(PET_BRANCH.includes(`${PET.minHeight}–${PET.maxHeight} m tall`) && PET_BRANCH.includes('"isFor" is "pet"'));
});

test('the pet age kits: one per age, anchored, small', () => {
  const r = cleanPetKits({ kits: { stone: { name: 'Beads', parts: [{ at: 'neck', ...box([0, 0, 0.05], [0.9, 0.05, 0.05], '#c9b48a') }, { at: 'tail', ...box([0, 0, 0], [0.1, 0.1, 0.1]) }] }, future: { name: 'Goggles', parts: [{ at: 'face', ...box([0, 0, 0.02], [0.2, 0.08, 0.06], '#4a4238') }] } } });
  assert.deepEqual(Object.keys(r.kits).sort(), ['future', 'stone']);
  assert.equal(r.kits.stone!.parts[0].size[0], 0.4); // clamped
  assert.equal(r.kits.stone!.parts[1].at, 'neck'); // an unknown anchor falls back to the collar
  assert.equal(r.kits.future!.parts[0].at, 'face');
  assert.deepEqual(r.checks, ['no bronze kit', 'no medieval kit', 'no industrial kit', 'no modern kit']);
  // A junk entry in astra's list is dropped without shifting the anchors of the parts after it.
  const j = cleanPetKits({ stone: { name: 'Beads', parts: [null, 'bead', { at: 'face', ...box([0, 0, 0], [0.1, 0.1, 0.1]) }, { at: 'neck', ...box([0, 0, 0], [0.1, 0.1, 0.1]) }] } });
  assert.deepEqual(j.kits.stone!.parts.map((p) => p.at), ['face', 'neck']);
});

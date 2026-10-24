// The boards Sami reviews (FK-004): with --shipped the design board draws what the game ships
// (design/shipped.ts), its people columns and the outfits line-up are the town's own figures in the
// shipped kits, dressed the way the town dresses them (design/board/people.ts), every kit is labelled
// in its own slot, and each board for Sami carries an audit note with three fixes, each on an FK card.
// Zero AI and no browser: these test the data the renderers draw, not the pixels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ELEMENTS } from '../design/catalogue';
import { shippedAges } from '../design/shipped';
import { APART, ONE, PAIR, SAMPLES, boardPeople, kitLabel, lineUp } from '../design/board/people';
import BIBLES from '../src/shared/ageBibles.json';
import PIECES from '../client/dudes/agePieces.json';
import OUTFITS from '../src/shared/ageOutfits.json';
import { AGES, AGE_IDS, dressFor } from '../src/shared/ages';
import type { AgeOutfits } from '../src/shared/outfits';

const KITS = OUTFITS as unknown as Record<string, AgeOutfits>;

test('the shipped board reads the game: world rules, town pieces and kits for all six ages, the last one the Wasteland', () => {
  const ages = shippedAges();
  assert.deepEqual(
    ages.map((a) => a.id),
    [...AGE_IDS],
  );
  assert.equal(ages[5].bible.name, 'the Wasteland');
  assert.ok(ages.every((a) => !/future/i.test(a.bible.name)));
  const fabric = ELEMENTS.filter((e) => e.board === 'fabric').map((e) => e.id);
  for (const a of ages) {
    assert.equal(a.index, AGE_IDS.indexOf(a.id));
    assert.deepEqual(a.bible, (BIBLES as { id: string }[]).find((b) => b.id === a.id));
    // Every piece of the town's fabric on the board is the one the town draws (ground slabs left to the town).
    for (const id of fabric) {
      assert.ok(a.pieces[id]?.parts.length, `${a.id}/${id}`);
      assert.deepEqual(a.pieces[id], (PIECES as Record<string, Record<string, unknown>>)[a.id][id]);
    }
    assert.deepEqual(a.outfits, KITS[a.id]);
    assert.ok(a.outfits.kits.length >= 2 && a.outfits.head && a.outfits.leader, a.id);
  }
});

test("a kit's label is its role, without the garment list the export cut mid-word", () => {
  assert.equal(kitLabel('Water Carrier — Jar Pad, Shoulder Wool and Overlapping Linen'), 'Water Carrier');
  assert.equal(kitLabel('Village Elder — Broad Fringed Shawl and Crooked Walking Stic'), 'Village Elder');
  assert.equal(kitLabel('Scarf-and-Braid Water Keeper'), 'Scarf-and-Braid Water Keeper');
  assert.equal(kitLabel('Far-Roving Shell-Cowl Mammoth Herder'), 'Far-Roving Shell-Cowl Mammoth Herder');
  assert.equal(kitLabel(undefined), '');
  // Every shipped label is whole: no kit name is left cut.
  for (const [age, o] of Object.entries(KITS)) for (const k of [...o.kits, o.head!, o.leader!]) assert.ok(kitLabel(k.name).length <= 40, `${age}: ${kitLabel(k.name)}`);
});

test("the people columns are the town's figures: townsfolk in two kits, the head as headLook draws him, the leader in his kit", () => {
  for (const [age, id] of AGE_IDS.entries()) {
    const o = KITS[id];
    const folk = boardPeople('resident', age, o)!;
    assert.equal(folk.figures.length, 2);
    assert.deepEqual(
      folk.figures.map((f) => f.outfit),
      [o.kits[0], o.kits[1]],
    );
    assert.deepEqual(
      folk.figures.map((f) => f.look),
      SAMPLES.map((l) => dressFor(l, age)),
    );
    assert.equal(folk.caption, `${kitLabel(o.kits[0].name)} · ${kitLabel(o.kits[1].name)}`);
    // The head: the age's own look (not dressed like a townie) in the head kit, as mayor.ts headLook.
    const head = boardPeople('head', age, o)!;
    assert.deepEqual(head.figures, [{ look: AGES[age].head.look, outfit: o.head, x: 0 }]);
    assert.equal(head.caption, kitLabel(o.head!.name));
    const leader = boardPeople('leader', age, o)!;
    assert.equal(leader.figures[0].outfit, o.leader);
    assert.deepEqual(leader.figures[0].look, dressFor(SAMPLES[0], age));
    for (const other of ['home', 'dog', 'street']) assert.equal(boardPeople(other, age, o), undefined, other);
  }
  assert.equal(boardPeople('head', 5, KITS.future)!.caption, 'Overseer of the Four Lots');
});

test('the outfits line-up gives every kit, the head and the leader a slot of their own, side by side, with its wearers inside', () => {
  for (const [age, id] of AGE_IDS.entries()) {
    const o = KITS[id];
    const { figures, slots, width } = lineUp(o, age);
    assert.equal(figures.length, o.kits.length * 2 + 2);
    assert.deepEqual(
      slots.map((s) => s.role),
      [...o.kits.map(() => 'kit'), 'head', 'leader'],
    );
    assert.deepEqual(
      slots.map((s) => s.label),
      [...o.kits.map((k) => kitLabel(k.name)), kitLabel(o.head!.name), kitLabel(o.leader!.name)],
    );
    assert.equal(width, o.kits.length * PAIR + 2 * ONE);
    // The slots tile the row from -width/2 to width/2 with no gap and no overlap.
    let left = -width / 2;
    for (const s of slots) {
      assert.ok(Math.abs(s.x - s.width / 2 - left) < 1e-9, `${id}: ${s.label}`);
      left += s.width;
    }
    assert.ok(Math.abs(left - width / 2) < 1e-9);
    // Each kit's two wearers stand APART inside its slot; the head and the leader stand in the middle of theirs.
    o.kits.forEach((k, i) => {
      const [a, b] = figures.slice(2 * i, 2 * i + 2);
      assert.ok(a.outfit === k && b.outfit === k);
      assert.ok(Math.abs(b.x - a.x - APART) < 1e-9);
      assert.ok(Math.abs((a.x + b.x) / 2 - slots[i].x) < 1e-9);
      assert.ok(slots[i].width - APART >= 1, 'room for each figure');
    });
    const [head, leader] = figures.slice(-2);
    assert.deepEqual(head.look, AGES[age].head.look);
    assert.equal(head.outfit, o.head);
    assert.equal(head.x, slots.at(-2)!.x);
    assert.equal(leader.outfit, o.leader);
    assert.equal(leader.x, slots.at(-1)!.x);
  }
});

test('both renderers can draw from the shipped kits and print each board with its round, date and audit note', () => {
  const render = readFileSync('design/render.mjs', 'utf8');
  assert.match(render, /--shipped/);
  assert.match(render, /import \{shippedAges\} from '\.\/design\/shipped'/);
  assert.match(render, /note-\$\{b\}\.txt/);
  assert.match(render, /Round r\$\{round\}, \$\{date\}/);
  const outfits = readFileSync('design/render-outfits.mjs', 'utf8');
  assert.match(outfits, /--shipped/);
  assert.match(outfits, /import \{shippedAges\} from '\.\/design\/shipped'/);
  assert.match(outfits, /note-outfits-board\.txt/);
  assert.match(outfits, /Round o\$\{round\}, \$\{date\}/);
});

test("Sami's FK-004 boards are in the repo, each with an audit note naming three fixes on FK cards", () => {
  for (const [png, note] of [
    ['design/out/rfinal3/board-life.png', 'design/out/rfinal3/note-board-life.txt'],
    ['design/out/o4/outfits-board.png', 'design/out/o4/note-outfits-board.txt'],
  ]) {
    assert.deepEqual([...readFileSync(png).subarray(1, 4)], [...Buffer.from('PNG')], png);
    const text = readFileSync(note, 'utf8');
    for (const word of ['Crisp', 'Playful', 'Consistent']) assert.match(text, new RegExp(`${word}:`), `${note}: ${word}`);
    const fixes = text.split('\n').filter((l) => /^\d\. /.test(l));
    assert.equal(fixes.length, 3, note);
    for (const f of fixes) assert.match(f, /→ FK-\d{3}$/, f);
  }
});

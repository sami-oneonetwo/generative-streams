// Finders Keepers' line data (FK-073): every Stone Mayor slot has three short cue lines in the head's
// voice, the lines other cards quote stay put, and the plaque reads out in lines that fit a subtitle.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGES } from '../src/shared/ages';
import { CUE_CARDS, CUE_MAX, CUE_SLOTS, cueCard, plaqueReadout } from '../src/worlds/ai-dudes/story/lines';

test('every Stone slot has three different lines of at most 42 characters', () => {
  assert.equal(CUE_MAX, 42);
  assert.deepEqual(Object.keys(CUE_CARDS.stone ?? {}), ['intro-I8', 'crossing', 'unveil-U2', 'unveil-U4', 'ribbon'], 'Intro I8, Crossing, Unveiling U2 and U4, age turn, in stream order');
  for (const [age, cards] of Object.entries(CUE_CARDS)) {
    for (const [slot, card] of Object.entries(cards ?? {})) {
      assert.ok(CUE_SLOTS.includes(slot as never), `${age} ${slot} is a known slot`);
      assert.equal(card.lines.length, 3, `${age} ${slot}: three lines`);
      assert.equal(new Set(card.lines).size, 3, `${age} ${slot}: three different lines`);
      for (const l of card.lines) {
        assert.ok(l.length > 0 && l.length <= CUE_MAX, `${age} ${slot}: "${l}" is ${l.length} characters`);
        assert.equal(l, l.trim(), `${age} ${slot}: "${l}" has no stray spaces`);
        assert.match(l, /[.!?]$/, `${age} ${slot}: "${l}" ends like a sentence`);
        assert.doesNotMatch(l, /[{}@#\n]/, `${age} ${slot}: "${l}" is said as written, no template or mention`);
      }
    }
  }
});

test('the head is vain, never cruel: no insults on any card', () => {
  const cruel = /\b(stupid|idiots?|losers?|ugly|dumb|pathetic|useless|shut up|hate|die|dead|cripple|limp|beggars?|thie(f|ves))\b/i;
  for (const [age, cards] of Object.entries(CUE_CARDS))
    for (const [slot, card] of Object.entries(cards ?? {})) for (const l of card.lines) assert.doesNotMatch(l, cruel, `${age} ${slot}: "${l}"`);
});

test('line 1 of each Stone slot is the line the scene cards quote; only U4 reads the plaque', () => {
  assert.equal(cueCard('stone', 'intro-I8')?.lines[0], 'Hello! Welcome to my town!'); // FK-044
  assert.equal(cueCard('stone', 'crossing')?.lines[0], "Mind the floor. It's new."); // FK-045
  assert.match(cueCard('stone', 'unveil-U2')!.lines[0], /^Behold!/); // FK-042
  assert.equal(cueCard('stone', 'ribbon')?.lines[0], 'My idea!'); // FK-048
  assert.ok(cueCard('stone', 'unveil-U4')?.plaque, 'U4 shows the plaque names');
  assert.deepEqual(CUE_SLOTS.filter((s) => cueCard('stone', s)?.plaque), ['unveil-U4'], 'only the hero shot reads the plaque');
  assert.equal(cueCard('bronze', 'intro-I8'), undefined, 'an age without cards yet has none (FK-145 writes Bronze)');
});

test('the plaque reads out its friends: capitalised, once each, in pledge order', () => {
  assert.deepEqual(plaqueReadout(['kev', 'dana', 'bo']), ['Built by friends of the Chief:', 'Kev, Dana, Bo!']);
  assert.deepEqual(plaqueReadout(['@kev', ' Dana ', 'KEV', '', 'test-bo', 'xX_bo_Xx']), ['Built by friends of the Chief:', 'Kev, Dana, Test-bo, xX_bo_Xx!']);
  assert.deepEqual(plaqueReadout(['nia']), ['Built by friends of the Chief:', 'Nia!']);
  assert.deepEqual(plaqueReadout([]), ['Built by the Chief, all by himself!'], 'an empty plaque is still a boast');
  assert.deepEqual(plaqueReadout(['', '@']), ['Built by the Chief, all by himself!']);
  const long = plaqueReadout(['abcdefghijklmnopqrstuvwxyz0123456789abcd', 'bo']);
  assert.equal(long[1], 'Abcdefghijklmnopqrstuvwx…, Bo!', 'a 40-character name is cut so the rest still fit');
  assert.deepEqual(plaqueReadout(['xXx_SuperLongGamerName_xX']), ['Built by friends of the Chief:', 'xXx_SuperLongGamerName_xX!'], 'a 25-character Kick name is read out whole');
});

test('a full plaque fits its rows and says how many more', () => {
  const names = Array.from({ length: 40 }, (_, i) => `chatter${String(i).padStart(2, '0')}`);
  for (const rows of [1, 2, 3]) {
    const out = plaqueReadout(names, { rows });
    assert.equal(out[0], 'Built by friends of the Chief:');
    assert.equal(out.length, 1 + rows, `${rows} row(s) of names`);
    for (const l of out) assert.ok(l.length <= CUE_MAX, `"${l}" is ${l.length} characters`);
    const more = Number(/ and (\d+) more!$/.exec(out.at(-1)!)?.[1]);
    const shown = out.slice(1).join(' ').split(/, | and /).length - 1;
    assert.equal(shown + more, 40, `${shown} shown and ${more} more add up to everyone`);
    assert.ok(out.slice(1).join(' ').startsWith('Chatter00, Chatter01'), 'first pledged, first read');
  }
  // As many as fit: a sixth name and its "and 34 more!" would need a third row.
  assert.deepEqual(plaqueReadout(names), ['Built by friends of the Chief:', 'Chatter00, Chatter01, Chatter02,', 'Chatter03, Chatter04 and 35 more!']);
  // Exactly enough room: everyone, no "more".
  assert.deepEqual(plaqueReadout(names.slice(0, 3), { rows: 1 }), ['Built by friends of the Chief:', 'Chatter00, Chatter01, Chatter02!']);
});

test("every age's head title fits the plaque header and the empty boast", () => {
  for (const a of AGES) {
    for (const l of [...plaqueReadout([], { title: a.head.title }), ...plaqueReadout(['kev'], { title: a.head.title })])
      assert.ok(l.length <= CUE_MAX, `${a.id}: "${l}" is ${l.length} characters`);
  }
  assert.equal(plaqueReadout(['kev'], { title: 'High Priest' })[0], 'Built by friends of the High Priest:');
});

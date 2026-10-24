// The feed in the corner (client/dudes/feed.ts, FK-072): each line once, at its newest; none of the
// operator's own lines, whatever age he was named in; a long line cut at a word, never mid-word.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedLines, fitWords, operatorLine } from '../client/dudes/feed';
import { setAge, headName } from '../src/worlds/ai-dudes/city';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import type { FeedItem } from '../src/shared/dudesTypes';
import { harness } from './harness';

const items = (...texts: string[]): FeedItem[] => texts.map((text, i) => ({ at: 1000 + i, text }));

test('a repeated line shows once, where it last happened; spacing and case do not make it new', () => {
  const feed = items(
    'Sami moved into 9 Elm Street',
    'Sticky Ug is stealing hats. Find the pile to get yours back.',
    'kim built a cafe',
    'Sticky Ug is stealing hats.  Find the pile to get yours back.',
    'the Scrap Convoy have made camp across the river',
    'sticky ug is stealing hats. find the pile to get yours back.',
  );
  const lines = feedLines(feed, 'The Chief', 5);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Sami moved into 9 Elm Street', 'kim built a cafe', 'the Scrap Convoy have made camp across the river', 'sticky ug is stealing hats. find the pile to get yours back.'],
  );
  assert.equal(lines.at(-1)!.at, 1005, 'the newest of the repeats, so it reads as news');
  // Three on stream: three different lines, not the same one three times.
  assert.deepEqual(
    feedLines(items('a', 'b', 'a', 'a', 'a'), undefined, 3).map((l) => l.text),
    ['b', 'a'],
  );
  assert.equal(feedLines(items('x', 'y', 'z', 'w'), undefined, 3).length, 3, 'the last n, oldest first');
  assert.deepEqual(feedLines(items('x', 'y', 'z', 'w'), undefined, 3).map((l) => l.text), ['y', 'z', 'w']);
  assert.deepEqual(feedLines([], 'The Mayor', 3), []);
});

test("the operator's typed lines stay out, under this age's name, a custom title or an older age's", () => {
  const feed = items('The Chief: Hi', 'Sami moved into 9 Elm Street', 'The Chief: fuck', 'The Overseer: cool', 'Big Boss: hello there', 'Road Boss Mara of the Scrap Convoy: Feed us.');
  assert.deepEqual(
    feedLines(feed, 'Big Boss', 5).map((l) => l.text),
    ['Sami moved into 9 Elm Street', 'Road Boss Mara of the Scrap Convoy: Feed us.'],
  );
  // Not his: someone's line about him, a caravan leader speaking, the head's deeds.
  assert.ok(!operatorLine('the Mayor\'s castle was turned down: too big', 'The Mayor'));
  assert.ok(!operatorLine('The Chief took down the hut', 'The Chief'));
  assert.ok(!operatorLine('Toma of the Mammoth Herders: Hello.', 'The Chief'));
  assert.ok(!operatorLine('kim: The Chief: says hi', 'The Chief'));
  assert.ok(operatorLine('The King: long live me', undefined), 'every age\'s name, even with no town view');
});

test('what the server pushes when the operator talks is what the page leaves out, in any age', () => {
  const { h } = harness();
  mayorInput(h.state, { t: 'move', x: 5, z: 5, facing: 0, moving: false }, h.now);
  mayorInput(h.state, { t: 'say', text: 'Welcome to my town!' }, h.now);
  const said = h.state.feed.at(-1)!;
  assert.equal(said.text, `${headName(h.state)}: Welcome to my town!`);
  assert.ok(operatorLine(said.text, headName(h.state)));
  // The age turns and he is called something else: his old line still stays out, and so does his new one.
  setAge(h.state, 2, h.now);
  mayorInput(h.state, { t: 'say', text: 'Long live the town' }, h.now + 1);
  const shown = feedLines(h.state.feed, headName(h.state), 5).map((l) => l.text);
  assert.ok(!shown.some((t) => /Welcome to my town|Long live the town/.test(t)), shown.join(' | '));
  assert.ok(shown.some((t) => /Middle Ages now/.test(t)), 'the rest of the feed is still there');
});

test('a long line is cut after a whole word, with an ellipsis; a short one is left alone', () => {
  const chars = (n: number) => (t: string) => t.length <= n;
  const hats = 'Sticky Ug is stealing hats. Find the pile to get yours back.';
  assert.equal(fitWords(hats, chars(80)), hats);
  assert.equal(fitWords(hats, chars(hats.length)), hats, 'exactly the room: untouched');
  assert.equal(fitWords(hats, chars(37)), 'Sticky Ug is stealing hats. Find the…');
  assert.equal(fitWords(hats, chars(36)), 'Sticky Ug is stealing hats. Find…', 'never "Find the p…"');
  assert.equal(fitWords(hats, chars(30)), 'Sticky Ug is stealing hats…', 'no full stop left before the ellipsis');
  assert.equal(fitWords('Road Boss Mara: The convoy has run dry.', chars(18)), 'Road Boss Mara…', 'nor a colon');
  assert.equal(fitWords('Kesa — the potter has arrived', chars(8)), 'Kesa…', 'nor a dash');
  // Every cut, at every width: whole words of the original, then the ellipsis, and it fits.
  const words = hats.split(' ');
  for (let n = 'Sticky…'.length; n < hats.length; n++) {
    const cut = fitWords(hats, chars(n));
    assert.ok(cut.length <= n, `${n}: ${cut}`);
    assert.ok(cut.endsWith('…'));
    const kept = cut.slice(0, -1).split(' ');
    kept.forEach((w, i) => assert.equal(w, i < kept.length - 1 ? words[i] : words[i].replace(/[.,:;]+$/, ''), `${n}: ${cut}`));
  }
  // Too narrow for even the first word: that word is kept (CSS clips it), never an empty line.
  assert.equal(fitWords(hats, chars(3)), 'Sticky…');
  assert.equal(fitWords('Supercalifragilistic', chars(5)), 'Supercalifragilistic', 'one word: nothing to cut at');
  // Any width test works, not just a count (wide letters take more room).
  const wide = (t: string) => [...t].reduce((w, c) => w + (c === 'W' ? 2 : 1), 0) <= 12;
  assert.equal(fitWords('WWW WWW and more', wide), 'WWW…');
});

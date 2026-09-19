import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSpokenLine, MAX_SPOKEN_CHARS } from '../src/llm/dialogue';

// Regression: this exact completion reached the speech bubble on stream.
test('strips a planning preamble glued to the spoken line', () => {
  const raw =
    'thShort, warm-ish reply to Sami about the fish. Mention water cool, ping and pong cruising.' +
    " Sami is a regular good spotter.SAY: that's ping and pong. water's still cool at 26, so they're just cruising.";
  assert.equal(
    extractSpokenLine(raw),
    "that's ping and pong. water's still cool at 26, so they're just cruising.",
  );
});

test('honours the SAY marker wherever it lands', () => {
  assert.equal(extractSpokenLine('SAY: rack two is fine.'), 'rack two is fine.');
  assert.equal(extractSpokenLine('say:rack two is fine.'), 'rack two is fine.');
  assert.equal(extractSpokenLine('Plan: be brief.\nSAY: rack two is fine.'), 'rack two is fine.');
  // A later marker wins, so a plan that quotes the format cannot survive.
  assert.equal(
    extractSpokenLine('SAY: think about it\nSAY: the breaker held.'),
    'the breaker held.',
  );
});

test('drops tagged reasoning blocks, closed or half-open', () => {
  assert.equal(
    extractSpokenLine('<thinking>plan the line</thinking>the ac is dying.'),
    'the ac is dying.',
  );
  assert.equal(
    extractSpokenLine('<think>\nplan\n</think>\n\nthe ac is dying.'),
    'the ac is dying.',
  );
  // Unclosed opener at the start: everything to the closer goes.
  assert.equal(extractSpokenLine('plan the line</thinking>the ac is dying.'), 'the ac is dying.');
  // Truncated plan at the end: everything from the opener goes.
  assert.equal(extractSpokenLine('the ac is dying.<thinking>now for'), 'the ac is dying.');
});

test('falls back to the last paragraph when no marker is present', () => {
  assert.equal(
    extractSpokenLine('Short reply about the fish, keep it dry.\n\nthat\'s ping and pong.'),
    "that's ping and pong.",
  );
});

test('leaves legitimate in-character lines untouched', () => {
  // Every one of these is a real logged Ray line or a near miss for the
  // heuristics a word-based filter would have used.
  for (const line of [
    'nobody was going to mention the AC? fine. i heard it. i always hear it.',
    "that's ping and pong. water's still cool, so they're just cruising.",
    'LEGACY-01 stays. we do not touch it.',
    'no. reply to that yourself.',
    'i said keep it closed, dave.',
    'Short is fine. i am not explaining the plan to you.',
  ]) {
    assert.equal(extractSpokenLine(line), line);
  }
});

test('unwraps quotes and stray markdown without eating apostrophes', () => {
  assert.equal(extractSpokenLine('"the breaker held."'), 'the breaker held.');
  assert.equal(extractSpokenLine('*shrugs* the breaker held.'), 'the breaker held.');
  assert.equal(extractSpokenLine("that's dave's box."), "that's dave's box.");
});

test('caps length on a word boundary and reports nothing usable as empty', () => {
  const long = extractSpokenLine('ray says ' + 'server '.repeat(80));
  assert.ok(long.length <= MAX_SPOKEN_CHARS);
  assert.ok(!long.endsWith('serv'));
  assert.equal(extractSpokenLine('   '), '');
  assert.equal(extractSpokenLine('<thinking>only a plan</thinking>'), '');
});

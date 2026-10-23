// Chat text on its way in and out: Kick emotes, commands for other bots, the crier's !help and
// !play and its batched answers, and the plain-voice filter on what the agents write.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { emoteNames, emoteOnly, emoteParts } from '../src/shared/emotes';
import { plainVoice, cleanVoiceOf } from '../src/worlds/ai-dudes/voice';
import { normalizeAgentReply } from '../src/worlds/ai-dudes/agent';

test('emotes: names for the agent, pictures for the bubble, emote-only spotted', () => {
  assert.equal(emoteNames('lol [emote:37226:KEKW] ok'), 'lol KEKW ok');
  assert.ok(emoteOnly('[emote:37226:KEKW] [emote:1:PogU]!'));
  assert.ok(!emoteOnly('build a cafe [emote:37226:KEKW]'));
  assert.ok(!emoteOnly('hello'));
  assert.deepEqual(emoteParts('hi [emote:5:wave]'), [{ text: 'hi ' }, { id: '5', name: 'wave' }]);
});

test('an emote alone shows in the bubble but costs no agent turn, and moves nobody in', async () => {
  const { h, say, tick } = harness();
  await say('kim', '[emote:37226:KEKW]');
  await tick(1000);
  assert.equal(h.state.dudes.length, 0, 'a stranger posting only an emote gets no character');
  await say('kim', 'hello [emote:37226:KEKW]');
  await tick(1000);
  const kim = h.state.dudes.find((d) => d.name === 'kim')!;
  assert.equal(h.turns.length, 1);
  assert.deepEqual(h.turns[0].messages, ['hello KEKW'], 'the agent reads the emote by name');
  await say('kim', '[emote:37226:KEKW]');
  await tick(1000);
  assert.equal(h.turns.length, 1, 'no turn for an emote on its own');
  assert.equal(kim.say?.text, '[emote:37226:KEKW]', 'the bubble keeps it');
});

test("other bots' commands are not speech; the crier answers !help and !play, batching inside its gap", async () => {
  const { h, say, tick } = harness();
  await say('kim', '!discord');
  await tick(500);
  assert.equal(h.state.dudes.length, 0, 'no character for a bot command');
  await say('kim', 'hi');
  await tick(1000);
  const kim = h.state.dudes.find((d) => d.name === 'kim')!;
  const turns = h.turns.length;
  kim.say = undefined;
  await say('kim', '!points');
  await tick(1000);
  assert.equal(kim.say, undefined, 'not said');
  assert.equal(h.turns.length, turns, 'and no agent turn');

  h.announced.length = 0;
  await say('kim', '!help');
  await say('ash', '!play');
  await say('bo', '!top');
  assert.equal(h.announced.length, 1, 'the first answer goes straight out');
  assert.match(h.announced[0], /!town .*!play/);
  await tick(9000);
  assert.equal(h.announced.length, 2, `the rest wait out the gap and go together: ${h.announced.join(' | ')}`);
  assert.match(h.announced[1], /stream-play\.kick-product\.com/);
  assert.match(h.announced[1], / · /);
});

test('plain voice: slang rewritten, shouting lowercased, old personas cleaned', () => {
  assert.equal(plainVoice('Bro, this cafe has such good vibes'), 'This cafe has such a good mood');
  assert.equal(plainVoice('LET\'S GO we built it'), "Here we go we built it");
  assert.equal(plainVoice('I love the AI Dudes town'), 'I love the AI Dudes town');
  assert.equal(plainVoice('THIS IS AMAZING'), 'This is amazing');
  assert.equal(plainVoice('A BBQ by the DJ booth'), 'A BBQ by the DJ booth');
  const r = normalizeAgentReply({ say: 'yo that is lowkey cool', persona: 'Loves chill vibes', title: 'VIBE LORD', remember: ['likes vibing'], actions: [] });
  assert.equal(r.say, 'that is quietly cool');
  assert.equal(r.persona, 'Loves chill mood');
  assert.equal(r.title, 'Mood lord');
  assert.deepEqual(r.remember, ['likes relaxing']);
  const cam = { persona: 'Cam is easygoing, no overthinking, just vibes and movement.', title: 'the bro', memory: ['good vibes at the bakery'] };
  assert.ok(cleanVoiceOf(cam));
  assert.equal(cam.persona, 'Cam is easygoing, no overthinking, just fun and movement.');
  assert.equal(cam.title, 'the friend');
  assert.deepEqual(cam.memory, ['a good mood at the bakery']);
});

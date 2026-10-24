// The cues' fingerprints (FK-160). Agents can't hear, so Sami's Approve on /sounds is the review, and
// this holds every cue to what he heard. Each cue in CUES (client/dudes/audio.ts) plays on the fake Web
// Audio (client/sounds/fake.ts) from a seeded random with the clock still; the record of everything it
// asks for, with the chain it sounds through, is hashed (client/sounds/prints.ts, the very code the
// board runs to show and send the hash). A cue approved in client/dudes/audio-approved.json must still
// hash to its approval; one with no approval yet is listed, not failed, until he approves it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CUES, type Cue } from '../client/dudes/audio';
import { ITEMS, cueRecord, lined, printOf, printOfItem, sha256 } from '../client/sounds/prints';
import { NAME, VOICE, entryOf, type Approved } from '../src/shared/audioApproved';

const RULE =
  "Sound cards are reviewed by ear (board/BOARD.md → Lanes, Lane S): a change to a cue Sami approved needs a sound-board link and his Approve on /sounds. " +
  "Agents never edit client/dudes/audio-approved.json, and don't change this test to match: put it on /sounds and get Sami's Approve.";

const APPROVED = path.join(import.meta.dirname, '..', 'client', 'dudes', 'audio-approved.json');
const approved = JSON.parse(fs.readFileSync(APPROVED, 'utf8')) as Approved;
const fileName = (cue: Cue) => cue.name.replace(/[^\w-]/g, '-');

// Each record once (the music's is half a megabyte): the tests below share them.
const records = new Map<string, unknown>();
const recordOf = (cue: Cue) => {
  if (!records.has(cue.name)) records.set(cue.name, cueRecord(cue));
  return records.get(cue.name)!;
};

// Every record written down, a row a line, so a change can be diffed: AUDIO_CUE_RECORDS=<dir> (run it
// so in a checkout of main for the approved ones).
if (process.env.AUDIO_CUE_RECORDS) {
  const dir = process.env.AUDIO_CUE_RECORDS;
  fs.mkdirSync(dir, { recursive: true });
  for (const cue of CUES) fs.writeFileSync(path.join(dir, `${fileName(cue)}.json`), `${lined(recordOf(cue))}\n`);
}

// --- what Sami approved ---

for (const cue of CUES) {
  const entry = entryOf(approved, { kind: 'cue', name: cue.name });
  if (!entry) continue;
  test(`${cue.name}: the cue Sami approved on ${entry.date}`, () => {
    const record = recordOf(cue),
      hash = printOf(record);
    if (hash === entry.hash) return;
    const out = path.join(os.tmpdir(), `audio-cue-${fileName(cue)}-${hash.slice(0, 12)}.json`);
    fs.writeFileSync(out, `${lined(record)}\n`);
    assert.fail(
      `The cue "${cue.name}" changed: it hashes to ${hash}, and Sami approved ${entry.hash} (${entry.by}, ${entry.date}). ` +
        `This record is in ${out}: write the approved ones with AUDIO_CUE_RECORDS=/tmp/audio-cues-approved npx tsx --test scripts/audio-cues.test.ts ` +
        `in a checkout of main, and diff the two.\n\n${RULE}`,
    );
  });
}

test('cues with no approval yet are listed, not failed, until Sami approves them on /sounds', (t) => {
  const waiting = CUES.filter((c) => !entryOf(approved, { kind: 'cue', name: c.name })).map((c) => c.name);
  if (waiting.length) t.diagnostic(`not approved yet (${waiting.length} of ${CUES.length}): ${waiting.join(', ')}`);
  // An approval for a name that is no longer a cue (renamed or gone) is listed too: the cue it stood for isn't checked.
  const gone = Object.keys(approved.cues ?? {}).filter((n) => !CUES.some((c) => c.name === n));
  if (gone.length) t.diagnostic(`approved, but no longer a cue in CUES: ${gone.join(', ')}`);
  for (const [name, e] of Object.entries(approved.cues ?? {})) assert.match(e.hash, /^[0-9a-f]{64}$/, `${name}: its approval holds a sha-256`);
});

// --- the fingerprint ---

test('a fingerprint comes out the same every time, and no two cues share one', () => {
  const prints = CUES.map((c) => printOf(recordOf(c)));
  assert.equal(new Set(prints).size, CUES.length, 'each cue its own');
  // Again, from scratch: the tune (the most chance in it), noise, a chord, a bed, a placed cue.
  for (const name of ['music', 'fanfare', 'play:strum', 'beds:fountain', 'bray']) {
    const cue = CUES.find((c) => c.name === name)!;
    assert.equal(printOf(cueRecord(cue)), prints[CUES.indexOf(cue)], `${name}, a second time`);
  }
  // Every name is one Approve can send (src/shared/audioApproved.ts).
  for (const c of CUES) assert.match(c.name, NAME, `${c.name}: a name the approval file takes`);
});

type Row = (string | number | boolean)[];
interface Play {
  where: string;
  chain: Record<string, Row[]>;
  events: Row[];
}
const playsOf = (name: string) => (recordOf(CUES.find((c) => c.name === name)!) as { cue: string; plays: Play[] }).plays;

test("a cue's fingerprint is its sound: what it asks for, the chain it sounds through, what its buffers hold, where it plays", () => {
  // The doorbell: two sines, E5 then C5, each with a send to the reverb, on the effects bus.
  const [door] = playsOf('doorbell');
  assert.equal(door.where, 'anywhere', 'heard everywhere, so played once');
  assert.deepEqual(
    door.events.filter((r) => r[1] === 'frequency.setValueAtTime').map((r) => r[2]),
    [659.255, 523.251],
  );
  assert.ok(door.events.some((r) => r[1] === 'connect' && r[2] === 'sfx') && door.events.some((r) => r[1] === 'connect' && r[2] === 'reverb'));
  // The chain it sounds through, as createAudio() set it up: the effects bus at the stream's 0.8 × 0.7,
  // the reverb (its tail, by what it holds) and its way back in at 0.22, the master, the compressor.
  assert.deepEqual(Object.keys(door.chain), ['compressor', 'gain>master', 'master', 'out', 'reverb', 'sfx']);
  assert.deepEqual(door.chain.sfx, [
    ['create', 'gain'],
    ['connect', 'master'],
    ['gain.setTargetAtTime', 0.56, 0, 0.1],
  ]);
  assert.deepEqual(door.chain.master.slice(1), [
    ['gain.value', 0.9],
    ['connect', 'compressor'],
  ]);
  assert.deepEqual(door.chain.compressor.slice(1, 3), [
    ['threshold.value', -14],
    ['ratio.value', 6],
  ]);
  assert.deepEqual(door.chain['gain>master'].slice(1), [
    ['gain.value', 0.22],
    ['connect', 'master'],
  ]);
  assert.match(String(door.chain.reverb[1][1]), /^2×76800:[0-9a-f]{8}$/, "the reverb's 1.6 s tail, by what it holds");
  // A hiss plays the town's noise: what it holds is in its row too.
  assert.ok(
    playsOf('fanfare')[0].events.some((r) => r[1] === 'buffer' && /^1×96000:[0-9a-f]{8}$/.test(String(r[2]))),
    "the fanfare's cheer: 2 s of the noise, by what it holds",
  );
  // A bed: what it sets, on its way out, and back up to its source (the fountain's noise through 1800 Hz).
  const [fountain] = playsOf('beds:fountain');
  const bedFilter = fountain.chain['biquad>gain>ambience#2'];
  assert.ok(bedFilter?.some((r) => r[0] === 'frequency.value' && r[1] === 1800), "the fountain's filter is in its chain");
  assert.ok(fountain.chain['buffer-source>biquad>gain>ambience#2'], "and its noise source");
  assert.deepEqual(fountain.chain.ambience.at(-1), ['gain.setTargetAtTime', 0.3, 0, 0.3], 'on the ambience bus at the stream’s 0.6 × 0.5');
  // A placed cue plays at the camera and 15 m out: the fade is part of it.
  const [near, mid] = playsOf('boom');
  assert.deepEqual([near.where, mid.where], ['near', 'mid']);
  const peak = (p: Play) => p.events.find((r) => r[1] === 'gain.exponentialRampToValueAtTime')![2] as number;
  assert.ok(peak(near) === 0.35 && peak(mid) < peak(near) && peak(mid) > 0, `the boom at full by the camera, quieter 15 m out (${peak(near)}, ${peak(mid)})`);
  // The tune: its bars on the music bus, at the stream's 0.5 × 0.32.
  const [tune] = playsOf('music');
  assert.deepEqual(tune.chain.music.at(-1), ['gain.setTargetAtTime', 0.16, 0, 0.3]);
  assert.equal(tune.events.filter((r) => r[1] === 'frequency.exponentialRampToValueAtTime' && r[2] === 45).length, 64, 'a kick on one and three of 32 bars');
});

test("the board's sha-256 is node's (a browser keeps crypto.subtle for secure pages, and 4600 is plain http)", () => {
  const node = (t: string) => createHash('sha256').update(t).digest('hex');
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // Every length round a block's edge (55 and 56 bytes leave no room for the length), past a few blocks, and not ASCII.
  for (let n = 0; n <= 200; n++) assert.equal(sha256('x'.repeat(n)), node('x'.repeat(n)), `${n} bytes`);
  for (const t of ['Wren’s whistle', 'é'.repeat(40), '🔔 the Call', JSON.stringify(recordOf(CUES[0]))]) assert.equal(sha256(t), node(t), t.slice(0, 20));
  assert.equal(printOf({ a: [1, 'b'] }), node('{"a":[1,"b"]}'), "a record's print is the sha-256 of its JSON");
});

test('everything on the board with an Approve: the voices, then every cue, each a name the file takes', () => {
  assert.deepEqual(ITEMS[0], { kind: 'voice', name: VOICE });
  assert.deepEqual(
    ITEMS.slice(1).map((i) => [i.kind, i.name]),
    CUES.map((c) => ['cue', c.name]),
  );
  // The voices' print on the board is the guard's (scripts/audio-voice.test.ts checks it against the record made the stream's way).
  assert.equal(printOfItem(ITEMS[0]), approved.voice?.hash, 'the blips as approved by FK-157');
  assert.equal(printOfItem({ kind: 'cue', name: 'doorbell' }), printOf(recordOf(CUES.find((c) => c.name === 'doorbell')!)));
  assert.throws(() => printOfItem({ kind: 'cue', name: 'kazoo' }), /no cue called kazoo/);
});

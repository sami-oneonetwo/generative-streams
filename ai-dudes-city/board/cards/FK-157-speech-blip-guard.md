# FK-157 · Speech-blip guard, approval file and board rule

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane S agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-126](FK-126-story-sounds-1.md), [FK-158](FK-158-injectable-audio-context.md), [FK-162](FK-162-voice-bus-split.md), [FK-173](FK-173-cast-voices.md) |

## Why (what changes for viewers or Sami)

Sami, 2026-10-24: "The noises as people speak right now are fantastic and I love them." Nothing protects them today. Agents can't hear; the blips share the sfx bus with booms and fanfares; one changed number in audio.ts would change every voice on stream without anyone noticing. This test makes any change to the blips fail until Sami has heard it and approved it.

## Scope

- New scripts/audio-voice.test.ts (picked up by `npm test`, which runs scripts/*.test.ts). It installs a fake AudioContext on `globalThis` that records every node, connection, parameter ramp and start/stop, and seeds `Math.random`, so client/dudes/audio.ts needs no change. It pins:
  - the pitch formula for all 9 seeds: 230 + (seed % 9) × 22 Hz, and the Mayor's low voice 150 + (seed % 9) × 8 Hz;
  - one syllable per word, clamped to 2–7; syllables of 70–130 ms and their gaps; the 10 ms attack and exponential decay; the ×0.85–1.30 jitter; the ×1.25 or ×0.82 glide;
  - a triangle at 0.07 plus a sine an octave up at 0.025, dry (no reverb send), on the sfx bus;
  - the 400 ms per-speaker throttle (`gap()`, audio.ts:271-277) and the distance falloff (`near()`, audio.ts:116-121);
  - that `near()` stays finite when `listen()` gets a NaN `half` (a perspective camera can pass one, and a NaN gain makes `exponentialRampToValueAtTime` throw). If today's code fails this, mark it `todo` with a pointer to FK-158, which adds the guard;
  - seedOf: a copy of the hash at client/dudes/main.ts:752 (Lane C's file), pinned for 5 sample ids, with a comment pointing at main.ts:752;
  - golden event lists for 5 lines ("hi", "hello there friend", a line with an emote, a 9-word line, and the Mayor's "Hello! Welcome to my town!" in the low voice), rounded and hashed with sha-256;
  - the effective voice gain: sfx level × 0.7 × master 0.9 into the compressor (−14 dB, 6:1).
- The golden hash is compared with `voice.hash` in a new client/dudes/audio-approved.json. On a mismatch the test fails with the board rule and the way out: "put it on /sounds and get Sami's Approve".
- This card creates audio-approved.json once, with today's hash as the baseline: `{ "voice": { "hash": "…", "by": "Sami", "date": "2026-10-24", "note": "today's blips: fantastic, I love them" }, "cues": {} }`. From then on only Sami's Approve on /sounds (FK-160) writes it.
- The board rule is already in BOARD.md → Ground rules (added by the coordinator on 2026-10-24).

## Acceptance criteria

- [ ] `npm test` is green with scripts/audio-voice.test.ts in it.
- [ ] In a scratch copy that is never committed, changing the blip gain 0.07 → 0.08 fails the test with the rule's message; so do 400 ms → 300 ms and a 230 → 240 Hz base.
- [ ] `git diff --stat main` shows only the two new files: audio.ts and main.ts are untouched.
- [ ] Sami: nothing changes on 4600 (no audio code changed).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm test`; the scratch-copy mutations above, reverted; `git diff --stat main`.

## Notes and risks

- Audio plan A1 (board/audio-plan.md §2). Do this first: no other Lane S card touches audio.ts before it lands.
- If a later card has to change the hash on purpose, it lands only after Sami has heard it on /sounds and clicked Approve (FK-160 writes the new hash). Agents never hand-edit audio-approved.json; the one-time baseline here is the only exception, and the coordinator signs it off.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- 2026-10-24 · lane S agent: picked up.
- 2026-10-24 · lane S agent: **done, ready for review** on fk-s (commit 0ffedea, rebased on main 383fc05; not landed). `git diff --stat main` = the two new files only: scripts/audio-voice.test.ts (+641) and client/dudes/audio-approved.json (+4). audio.ts and main.ts untouched; nothing changes on 4600, so no demo server or screenshots were needed.
  - **The fake:** `globalThis.window.AudioContext` is a recorder of every node, connection, param call (value, setValueAtTime, ramps, setTargetAtTime) and start/stop. Like a browser it throws on a non-finite value, a time before 0 and an exponential ramp to 0. `Math.random` is seeded (mulberry32), `performance.now` is a fake clock, and `setInterval`/`addEventListener` are stubbed, all only for the length of each call. Buses are named by behaviour: nudge each level and see which gain follows, so the names don't depend on creation order.
  - **11 tests, every failure ending with the board rule and "put it on /sounds and get Sami's Approve":**
    - the pitch for seeds 0–8 plus 9, 157 and 2^32−1: 230 + (seed % 9) × 22, low 150 + (seed % 9) × 8, and the sine at ×2;
    - 2–7 syllables (an emote counts as a word);
    - 70/130 ms syllables with 30/80 ms gaps at Math.random 0 and at its top, the 20 ms lead, the 10 ms attack and the exponential decay to 0.0001, stops at +50 ms;
    - the ×0.85/×1.30 jitter, the ×1.25 (r < 0.5) or ×0.82 glide over the whole syllable, and no glide on the sine;
    - triangle 0.07 and sine 0.025, four nodes a syllable, dry, onto the sfx bus only;
    - the voice path: sfx level × 0.7 (0.56 at the stream's 0.8, tc 0.1) → master 0.9 → compressor −14 dB 6:1 → out, which puts a syllable into the compressor at 0.03528;
    - the 400 ms throttle: at 399 ms the line is dropped, another speaker isn't held up, at 400 ms it plays, and a line too far to hear doesn't reset it;
    - the falloff table (reach = half × 1.4 + 12; full to 0.15 × reach, 0.65 at half the reach, silent under 0.05);
    - seedOf: a copy pinned for the 5 golden speakers, plus a check that main.ts still has the exact line (it's at main.ts:786 now, :752 in the plan);
    - the golden hash.
  - **The golden** is the voice path, the pitch table, the syllable counts, the two Math.random extremes, the throttle run, the falloff table, seedOf and the event lists of the 5 lines ("hi"; "hello there friend" at 0.65; "lol [emote:37226:KEKW] that is so good" through emoteNames; a 9-word line; the Mayor's "Hello! Welcome to my town!" in the low voice). Numbers are rounded (6 significant digits, times to 1 µs) and hashed with sha-256. Baseline: `fd4fb174e2c6734444bfae1ae97e1d615a4e0c6de4d28542f4529b74d3f5a2da`, written once to audio-approved.json as the card says (`by: Sami, 2026-10-24, "today's blips: fantastic, I love them"`, `cues: {}`). **This one-time baseline needs the coordinator's sign-off.**
  - **NaN half:** today's near() gives NaN and the gain ramp throws, so that test is a `todo` that names FK-158. FK-158: add the guard, then remove the `todo` option.
  - **Scratch-copy mutations** (in /tmp/fk-s-scratch, never committed; re-run with /tmp/fk-s-scratch/mutate.sh). Each one fails with the rule's message:
    - blip gain 0.07 → 0.08: 4 tests fail;
    - throttle 400 → 300 ms: 2 fail;
    - base 230 → 240 Hz: 3 fail;
    - sfx ×0.7 → ×0.6: 2 fail;
    - compressor −14 → −12 dB: 2 fail;
    - a reverb send on the blips: 2 fail;
    - seedOf ×31 → ×33 in main.ts: 1 fails.
    - Control: music bus ×0.32 → ×0.3 is not a voice change, and 0 tests fail.
  - **Checks:** `npm run typecheck` is green. `npm test`: 172 tests, 171 pass, 0 fail, 1 todo (161 existing on today's main + 11 new; the card's "112" was from before other lanes landed).
  - **For FK-160:** Approve has to compute the same hash. `golden()` and the fake sit together in the test file, ready to lift into a scripts/audio-voice-golden.ts module (Lane S's own path) when FK-160 needs them.
  - Hooks into other lanes' files: none.
- 2026-10-24 · lane S agent: **landed on main at 6caa500** (fast-forward of fk-s: 0ffedea + 6caa500, on main 383fc05). Two new files only: scripts/audio-voice.test.ts and client/dudes/audio-approved.json; audio.ts and main.ts untouched. Checks after the rebase: `npm run typecheck` green; `npm test` 173 tests, 172 pass, 0 fail, 1 todo (the NaN-half test, for FK-158).
  - **What Sami gets once 4600 is restarted and the client rebuilt:** nothing to see or hear. The blips sound exactly as they do today, and from now on any change to them fails `npm test` until he has heard it on /sounds and clicked Approve.
  - **Review notes, all applied in 6caa500 (test file only; the approved hash is still fd4fb174…f5a2da):**
    - a new test pins how main.ts feeds the voices: the exact line `if (text && text !== lastSaid.get(d.id)) audio.speech(seedOf(d.id), emoteNames(text), d.position, d.mayor);`, with speech() called from that one line only; the createAudio line's `sfx: level('sfx', 0.8)` (checked against LEVELS.sfx); and the operator's `sfx: a.sfx * level('sfx', 0.8) * 1.25`;
    - a 211-character, 43-word chat line is in the syllable-count cases, so a cap or mute by length fails;
    - a hash mismatch now writes the record to a temp file, a row a line, and the message says how to diff it: `AUDIO_VOICE_RECORD=/tmp/audio-voice-approved.json npx tsx --test scripts/audio-voice.test.ts` in a checkout of main writes the approved record. It also says a hash-only failure is something the other tests don't spell out.
  - **Scratch mutations for the review notes** (/tmp/fk-s-scratch/mutate2.sh, never committed). Each one fails 1 test with the rule's message:
    - main.ts drops `d.mayor`;
    - main.ts uses `seedOf(d.id) + 1`;
    - main.ts drops `emoteNames`;
    - main.ts createAudio sfx 0.8 → 0.6;
    - operator sfx ×1.25 → ×1.0;
    - speech() returns on lines over 60 characters;
    - `detune: 5` on the blips: only the hash test fails, and diffing the written record against the approved one shows exactly the `["#n","detune.value",5]` rows.
    - Controls pass with 0 failures: an unchanged copy, and the main.ts music level 0.5 → 0.4.
  - **Follow-ups:**
    - the long line went into the syllable cases, not LINES/golden, so the signed-off baseline hash didn't move. Add it to LINES the next time the hash changes on purpose through Approve (FK-160 or FK-173).
    - FK-173 edits the speech() call site in main.ts, so it has to update the SPEECH pin in the same change, and that needs Sami's Approve.
    - FK-160 can reuse `golden()`, `lined()` and the fake: lift them into scripts/audio-voice-golden.ts.
    - FK-158 adds the near() NaN guard; when it does, remove the todo.
  - Hooks into other lanes' files: none.

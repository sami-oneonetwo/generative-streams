# FK-157 · Speech-blip guard, approval file and board rule

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
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

- (picked up / review notes / done, with dates)

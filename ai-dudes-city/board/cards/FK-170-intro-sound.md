# FK-170 · Intro sound: the old-radio flashback and NOW

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-033](FK-033-bridge-intact-and-collapse.md), [FK-043](FK-043-intro-flashback.md), [FK-044](FK-044-intro-now.md), [FK-135](FK-135-story-sounds-2.md), [FK-164](FK-164-scene-cue-track.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

The Intro is a flashback. It should sound like an old recording until NOW snaps the town back to life.

## Scope

- I1–I4 flashback (FK-043): the Stone tune band-passed to 400 Hz–3 kHz, mono, 3% slower, with vinyl crackle. The Chief stand-in speaks in the Mayor's low voice (speech()'s existing low voice; no change to speech()).
- I4: creak (FK-135), creak, then the splash and the collapse (FK-033), then silence, then "…Still fine." and a bwomp.
- NOW (FK-044): the crackle stops and the full sound swells in; the two panels each get their motif (the gold fanfare, the red whistle).
- Filtering the voices too would be a voice change: offer it to Sami as an A/B on /sounds, and it ships only with his Approve.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the Intro chain and approves.
- [ ] On 4600, Story (dev) → Stage stream 1 → Play: Intro: the old-radio flashback, the yank and the collapse, the silence, and full sound at NOW.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] audio:check passes; the silence is exact zeros.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with `?debug=sfx` during Play: Intro.

## Notes and risks

- Audio plan A14.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

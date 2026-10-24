# FK-169 · Rally sound: the whistle, the fire, the us-plucks, Meanwhile and the scatter

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-026](FK-026-rally-v1.md), [FK-057](FK-057-stream-only-rallies.md), [FK-126](FK-126-story-sounds-1.md), [FK-164](FK-164-scene-cue-track.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Red's scene needs to feel secret and warm next to the Mayor's brass: a whistle, a fire, a tune that climbs as people join, and a comic hard cut back to the town.

## Scope

- Opens on Wren's whistle (FK-126).
- The bed: the town tune at −12 dB and low-passed, fire crackle, and her motif on the age's instrument.
- Each `us` plays a pluck one step further up the scale (at most 4 a second).
- R4 "Meanwhile…" (FK-057): a tuba bwomp, then a hard cut to the cheerful town tune at full level, mid-bar.
- The scatter ("He's coming. Act normal.", FK-057): a pizzicato scurry.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the rally chain and approves.
- [ ] On 4600 with Story ON, Play: Rally: the whistle once; five `us` from testers climb the scale; walking the head in scatters it with the scurry; Meanwhile cuts hard.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with `?debug=sfx` during Play: Rally.

## Notes and risks

- Audio plan A13.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

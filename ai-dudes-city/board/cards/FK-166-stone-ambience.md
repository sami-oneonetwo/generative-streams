# FK-166 · Stone ambience: the river, the fire, and birds by age

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-165](FK-165-age-music-stone.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Today's beds are the same in every age (birds, a 260 Hz hum, the fountain and the car drone, audio.ts:216-253): cars and a fountain in the Stone age.

## Scope

- Beds per age style. Stone: the river (louder near the water), fire crackle near the camp hearth (`STORY_SITES.camp`, through `near()`), birds. The hum, the fountain and the car drone stay for Modern.
- Birds are gated by age (Wasteland has none, FK-183).
- Story ON only; under the mix director's ambience level (−4 dB in scenes).

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the Stone beds against Modern's and approves them.
- [ ] On 4600 with Story ON: water by the river, fire at the camp, no cars.
- [ ] audio:check: the ambience sits about 14 LU under the blips.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the beds; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with `?debug=sfx`, the beds log as the camera moves.

## Notes and risks

- Audio plan A10.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

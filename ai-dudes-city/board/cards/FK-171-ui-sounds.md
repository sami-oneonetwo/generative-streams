# FK-171 · UI sounds: the NOW card, Board milestones and the side pop

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-010](FK-010-board-client.md), [FK-012](FK-012-sides.md), [FK-021](FK-021-show-hud.md), [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-162](FK-162-voice-bus-split.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-179](FK-179-defection-pops.md), [FK-184](FK-184-rising-sound-1.md) |

## Why (what changes for viewers or Sami)

The Board and the NOW card are the show's instructions; a tiny sound at the right moments makes chat look up, without turning the stream into a slot machine.

## Scope

- A `ui` bus with peaks at or below −24 dBFS (about 8 LU under the blips).
- NOW card (FK-021): a two-note chime.
- Board bars (FK-010): one note at 25, 50, 75 and 100% only; the ticker is silent.
- Joining a side (FK-012): a pop, at most 1 every 3 s (several inside that time sum into one).
- Story ON only. The triggers are ≤10-line hooks into Lane C's board.ts and show.ts (or main.ts).

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the UI sounds and approves.
- [ ] On 4600 with Story ON: four testers typing `red` / `gold` within 3 s give one pop; a bar crossing 25% plays one note; the NOW card chimes.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] audio:check: UI about −8 LU against the blips.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- A rate-limiter test; render; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with `?debug=sfx`.

## Notes and risks

- Audio plan A15. The Defection flip is FK-179.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

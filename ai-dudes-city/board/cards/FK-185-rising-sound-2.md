# FK-185 · The Rising sound 2: the three endings

| | |
|---|---|
| Milestone | Later |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-116](FK-116-endings.md), [FK-156](FK-156-ending-b.md), [FK-184](FK-184-rising-sound-1.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Each ending needs its own last sound.

## Scope

- A (FK-116): Wren's motif with the full band, and a launch roar in the mid band so it reads on phones.
- C (FK-116): a thin Overseer fanfare, then creak and splash (FK-135's creak).
- B (FK-156): a quiet, warm return of the music.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays all three endings and approves.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render each ending.

## Notes and risks

- Audio plan A26.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

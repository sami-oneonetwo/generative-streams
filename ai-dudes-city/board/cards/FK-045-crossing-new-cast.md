# FK-045 · The Crossing with the new cast

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-017](FK-017-show-runtime.md), [FK-038](FK-038-mayor-show-strip.md), [FK-127](FK-127-old-scenes-through-runtime.md), [FK-133](FK-133-stream-1-beats.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

The existing Crossing scene, re-cast: Ash limps over on Oak's shoulder and Kit adopts the head.

## Scope

- Re-cast the Crossing beats by role: Ash on Oak's shoulder; the Chief's line "Mind the floor. It's new." as a cue-card line; Kit runs straight to the Chief.

## Acceptance criteria

- [ ] When the bridge ask is met the Crossing arms (FK-133) and GO plays it with the five cast.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT` with /mayor open: 8 test names awake → need 4 (⌈0.4 × 8⌉; with 8 names you never see "8/8"); four *different* names type `red` → BRIDGE 4/4; the lamp shows GO = THE CROSSING; GO; watch it.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-090 · The Last Light 2: the cord, ASH, and the age over the grave (L4–L6)

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-086](FK-086-bronze-cast-and-adult-wren.md), [FK-089](FK-089-last-light-1.md), [FK-097](FK-097-red-job-props.md) |
| Unblocks | [FK-091](FK-091-candle-window.md), [FK-099](FK-099-bronze-rehearsal.md), [FK-177](FK-177-last-light-sound.md) |

## Why (what changes for viewers or Sami)

The grave-and-pull-back image: Wren older, the town Medieval.

## Scope

- L4 six seconds of silence; the lamp goes out; Wren ties the red cord on her wrist. L5 over her shoulder through the doorway at the statue and confetti; title card ASH. L6 the age restyles over the grave; the camera pulls back to an older Wren (DAUGHTER_SCALE, caravan.ts:99 → adult look from FK-086) standing in a Medieval town.

## Acceptance criteria

- [ ] On $PORT the age turns during the shot and Wren is adult afterwards; the cast persists.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT shots at L5 and L6.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

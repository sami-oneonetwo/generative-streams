# FK-076 · Layout A+: Bridge Lane

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-075](FK-075-layout-fill-by-block.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

A procession route from the square to the bridge for the Crossing, Kit, Oak's walk-off and the golf cart.

## Scope

- Skip lots q1_0_1_0 and q1_0_-1_0 in layoutPlots (both unclaimed); Lane C draws a 12 m lane from the square's east arm to the bridge (≤10-line hook into environment.ts).

## Acceptance criteria

- [ ] A lane runs from the square to the bridge; no claimed lot moves.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT wide shot.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

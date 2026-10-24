# FK-122 · Tally carry-over across streams

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-092](FK-092-defection-window.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Your side and history follow you across the run.

## Scope

- Per-age side history per chatter; "Kev crossed twice" across streams; plaque and Wren-build names persist for the finale roll.

## Acceptance criteria

- [ ] History survives a restart and an age turn.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

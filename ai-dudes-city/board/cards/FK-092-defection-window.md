# FK-092 · The Defection Window and one switch per age

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-025](FK-025-unveiling-v1.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-122](FK-122-tally-carry-over.md), [FK-179](FK-179-defection-pops.md) |

## Why (what changes for viewers or Sami)

Turncoats are content.

## Scope

- For 3 minutes after every Unveiling switching is free and every crossing pops up live; otherwise one switch per age; always announced on the ticker.

## Acceptance criteria

- [ ] A switch inside the window works twice; outside it, once.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

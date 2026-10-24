# FK-081 · Layout A+: corner parks become home blocks in fill order

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-080](FK-080-draw-open-blocks.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Capacity 32 → 62 lots, so a 40-chatter night has no renters.

## Scope

- `CITY.parks` decided per block: a corner park becomes a home block when the fill order reaches it.

## Acceptance criteria

- [ ] Lot 33 opens a former park as a home block.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test + $PORT shot.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

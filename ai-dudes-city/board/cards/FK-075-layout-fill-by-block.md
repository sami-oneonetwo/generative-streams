# FK-075 · Layout A+: hand out lots block by block from the bridge

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | — |
| Unblocks | [FK-076](FK-076-layout-bridge-lane.md), [FK-080](FK-080-draw-open-blocks.md) |

## Why (what changes for viewers or Sami)

Today the first four chatters land 66 m apart (one per side of the square), so 3 chatters need half-height 24; clustered in one block they need ~12.

## Scope

- Replace the lot ranking (src/shared/city.ts:181-188) with an explicit block order E, S, SE, N, NE, W, SW, NW, river-side cells first. Existing claims stay where they are. Update scripts/city.test.ts.

## Acceptance criteria

- [ ] The first chatters cluster by the river; Sami's lot is untouched.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with 6 Test chat names; one wide shot.

## Notes and risks

- Ready since 2026-10-24 (Sami approved A+, river east). It edits src/shared/city.ts, which Lane B holds until M1 ends: Lane E may start it as soon as B hands the file over (B may do that early, once its M1 edits there have landed), as long as it never delays the M1 critical path. In M2 the layout cards go first in Lane E's order.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

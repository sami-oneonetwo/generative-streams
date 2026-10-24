# FK-077 · Layout A+: keep half the square open

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | — |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The square can't hold a crowd ring once projects stand on its four lots.

## Scope

- Community projects never pick q0_0_1_1 or q0_0_1_-1, leaving a 20×39 m open half for town gatherings and the Rising.

## Acceptance criteria

- [ ] New community projects only use the west half.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test.

## Notes and risks

- Ready since 2026-10-24 (Sami approved A+, river east). The community-lot pick lives in src/worlds/ai-dudes/city.ts (around :758, Lane B's file): a ≤10-line hook to Lane B, or a helper in src/shared/city.ts once Lane E holds it. Lane E may start it as soon as that allows, as long as it never delays the M1 critical path.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

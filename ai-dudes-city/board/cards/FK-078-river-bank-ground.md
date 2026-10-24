# FK-078 · Layout A+: the River Bank (move the river, extend the ground)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | — |
| Unblocks | [FK-079](FK-079-river-bank-story-sites.md) |

## Why (what changes for viewers or Sami)

The bible's camp, Folly and cairn sit on the town bank, but walkable ground ends at x = 70.5 (src/worlds/ai-dudes/placement.ts:13) and the river's near bank is at x ≈ 79.5.

## Scope

- RIVER.x 86.5 → 116 (the offset in src/shared/city.ts:40), opening a 36 m bank on the town side.
- GROUND.bounds east to x ≈ 106 plus a far-bank landing strip; GROUND.water = the river minus the deck once mended; the hand-laid bridge path (caravan.ts:259) follows.
- Reposition the live band (stranded at far-bank positions) at boot.

## Acceptance criteria

- [ ] Dudes walk the new bank; the river is not walkable except over a mended bridge; the live save boots with the band on the new far bank.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with a copy of the live save; one wide shot.

## Notes and risks

- Lane A takes placement.ts after M1 for this card. RIVER (src/shared/city.ts:40) is a ≤10-line hook to Lane E, which holds shared/city.ts after M1; the bridge path (caravan.ts:259) is a hook to Lane B.
- Ready since 2026-10-24 (Sami approved A+, river east). It edits placement.ts (Lane B's in M1), and Lane A carries the M1 critical path, so it starts after Lane A's M1 cards: first in Lane A's M2 order.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

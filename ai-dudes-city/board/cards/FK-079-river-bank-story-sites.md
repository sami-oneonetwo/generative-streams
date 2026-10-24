# FK-079 · Layout A+: story sites on the bank

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | In progress |
| Owner | lane B agent, 2026-10-24 |
| Depends on | [FK-078](FK-078-river-bank-ground.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The Folly, the camp and Wren's fire line up along open water, so eye-level shots look across the river, never through chatter builds.

## Scope

- Move STORY_SITES.camp to (94, 0) on the new bank: FK-132's camp is drawn from STORY_SITES, so it follows with no drawing change. Trees on the far bank for the band to walk out of (≤10-line hook into environment.ts, Lane C).
- Move STORY_SITES: F1 = the camp plot, Wren's fire (100, −20), Wren's vantage (126, 4), cairn (106, 22), crowd anchors per age.
- Re-check every shot in src/shared/scenes.ts (a hook to Lane A, which owns scenes.ts; most shots are measured from BRIDGE, so they move with the river) and in src/shared/storyShots.ts (Lane C).

## Acceptance criteria

- [ ] The Unveiling and Intro play with the new sites; shots look across the water.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT shots of U1, U7, I7.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane B agent: picked up.

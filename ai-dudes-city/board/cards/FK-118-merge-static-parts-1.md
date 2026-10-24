# FK-118 · Performance 1: merge static build parts

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-065](FK-065-stats-overlay.md) |
| Unblocks | [FK-119](FK-119-merge-static-parts-2.md) |

## Why (what changes for viewers or Sami)

Each build part is its own mesh today (primitives.ts:227, up to 160 parts): at 40 chatters that's thousands of draw calls. Must land before any stream with 20+ chatters.

## Scope

- Merge non-animating parts into one mesh per material; moving parts stay separate.

## Acceptance criteria

- [ ] Draw calls drop ≥ 60% on the 40-dude $PORT world, no visible change in a screenshot comparison.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT ?stats=1 before/after.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-119 · Performance 2: smoke material and verification

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-118](FK-118-merge-static-parts-1.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

A new material is made for every smoke puff (objects.ts:577-578).

## Scope

- Shared smoke materials; record the final numbers in board/motion-budget.md.

## Acceptance criteria

- [ ] ≤ 1500 draw calls and ≤ 10 ms frames at 1080p with 40 dudes.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT ?stats=1.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

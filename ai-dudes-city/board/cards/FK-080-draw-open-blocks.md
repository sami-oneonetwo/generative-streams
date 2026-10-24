# FK-080 · Layout A+: draw only the blocks that are open

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-075](FK-075-layout-fill-by-block.md) |
| Unblocks | [FK-081](FK-081-parks-become-blocks.md) |

## Why (what changes for viewers or Sami)

With 5 chatters the town looks 90% empty; drawing only open blocks makes it a busy hamlet that grows on stream.

## Scope

- client/dudes/environment.ts draws a block once any of its lots is claimed; the next block appears when the current one is 75% full; unopened blocks are countryside; a marker on the single next free lot. Free lots are not drawn today (environment.ts:369).

## Acceptance criteria

- [ ] With 5 chatters the stream shows one block, the square and the bank.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT wide shots at 5 and 12 chatters.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

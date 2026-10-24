# FK-115 · The Rising 2: the honest count and the sides lower third (C7)

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-114](FK-114-rising-staging.md) |
| Unblocks | [FK-116](FK-116-endings.md), [FK-156](FK-156-ending-b.md), [FK-184](FK-184-rising-sound-1.md) |

## Why (what changes for viewers or Sami)

The town really decides. Ties go to Wren.

## Scope

- 45 s window; `red`/`gold` walk your dude across; a two-column lower third with a share bar; CLOSING 10, then an 8 s grace for Kick's delay; heads standing are the count, shown live.

## Acceptance criteria

- [ ] Count matches heads on $PORT; ties go red.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

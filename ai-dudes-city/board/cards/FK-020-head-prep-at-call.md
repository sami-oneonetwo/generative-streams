# FK-020 · Head prep at the Call

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-044](FK-044-intro-now.md), [FK-061](FK-061-head-walks-to-mark.md) |

## Why (what changes for viewers or Sami)

Sami never has to find a mark: at the Call the server puts his character where the scene needs him.

## Scope

- src/worlds/ai-dudes/mayor.ts `prepareHead(mark, face)`: force visible (a server-side override, separate from the page's own `hidden`, mayor.ts:230 / client/dudes/operator.ts:312), dismount, put the weapon away, free camera off, snap to the mark via `moved` (mayor.ts:333; walking is FK-061), set `MayorView.lock`.
- client/dudes/operator.ts ignores WASD while `lock` is set.
- Also add `forcedHidden` for the M2 flashback (FK-043).

## Acceptance criteria

- [ ] With /mayor open and Sami riding far away, Story (dev) → Gather puts him on the Folly mark, unmounted, facing the tarp; WASD does nothing until the release; afterwards he walks again.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev), with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

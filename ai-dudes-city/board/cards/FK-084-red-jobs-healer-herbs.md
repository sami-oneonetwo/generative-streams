# FK-084 · Bronze red jobs: the healer's hut, then herbs

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-047](FK-047-red-job-make-room.md) |
| Unblocks | [FK-088](FK-088-the-ask.md) |

## Why (what changes for viewers or Sami)

Whether chat finishes the healer's hut decides how Ash dies.

## Scope

- Job table: Bronze red 1 = a healer's hut for Ash, the first one built near the camp; then "grow herbs": any garden counts.

## Acceptance criteria

- [ ] A healer's hut near the camp completes the job and saves `healerHut: true`.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT inject.

## Notes and risks

- Lane E owns story/jobs.ts (the red-job table), so red-job cards live in Lane E.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

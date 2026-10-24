# FK-056 · "Stage stream 1" button

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-023](FK-023-folly-site-server.md), [FK-033](FK-033-bridge-intact-and-collapse.md), [FK-132](FK-132-camp-on-town-side.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

One press sets the world up for the Intro without wiping anyone's builds.

## Scope

- Story (dev) → Stage stream 1: copy the save first; bridge intact; band offstage; the Folly plot clear with the camp dressing (FK-132); cast reset; sides cleared for the night. No world wipe.

## Acceptance criteria

- [ ] After the press, chatters' lots and builds are untouched and the Intro can play.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT, then on 4600 before stream 1.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

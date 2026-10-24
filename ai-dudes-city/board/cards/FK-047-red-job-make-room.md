# FK-047 · Red job: "Make room" (any hut counts)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-011](FK-011-board-server.md), [FK-012](FK-012-sides.md), [FK-129](FK-129-story-jobs-drive-asks.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-084](FK-084-red-jobs-healer-herbs.md), [FK-105](FK-105-cairn-red-job.md), [FK-113](FK-113-wren-signs-on-lots.md), [FK-143](FK-143-huts-or-tents.md), [FK-151](FK-151-names-on-wren-builds.md) |

## Why (what changes for viewers or Sami)

After the Crossing, red builds for the band on their own lots: solo building feeds the shared goal.

## Scope

- The Stone entry of FK-129's red-job table (story/jobs.ts, Lane E): after the Crossing, "MAKE ROOM n/need": any hut built on your lot counts and credits you, through FK-129's ask engine and the build-counting loop it reuses (caravan.ts:551-560).
- Wren: "You're on our land too. Make room." NOW card; the Board's red bar switches.

## Acceptance criteria

- [ ] After the Crossing, a chatter's hut moves MAKE ROOM by one and credits them on the ticker.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT inject `test-kev "build me a hut"` after Story (dev) → Play: Crossing.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

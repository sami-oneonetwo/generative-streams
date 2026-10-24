# FK-133 · Stream-1 beat list and arming rules

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-037](FK-037-beat-queue.md) |
| Unblocks | [FK-045](FK-045-crossing-new-cast.md), [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

FK-037 is only the mechanism. Stream 1 needs its actual beats, in order, each arming under its own conditions, so the /mayor lamp always names the next thing.

## Scope

- story/beats.ts `STREAM_1`: INTRO (armed by Stage stream 1) → CROSSING (armed when the bridge ask is met) → RALLY 1 (5 min after the Crossing) → UNVEILING (Folly 100%, 3+ awake, no scene for 4+ min) → RALLY 2 (10 min after the Unveiling) → THE WONDER (a Board state, not a scene: opens when MAKE ROOM is met or at 1:20) → AGE TURN (armed when the Wonder stands).
- **Coordinator decision (Sami can overrule): the Crossing waits for GO** like every story beat, because it carries a Mayor line ("Mind the floor. It's new."); today it plays automatically at bridge complete. On Autopilot (FK-058) it fires after 60 s armed. Story OFF keeps today's automatic Crossing.
- Rhythm (bible §5): at most one full-town gathering per 20 min and 15 min of free play either side of a big beat; a thin crowd is a lamp warning, never a lock.

## Acceptance criteria

- [ ] A unit test walks the list on a fake clock: each beat arms only under its conditions.
- [ ] The Crossing waits for GO with Story ON and stays automatic with Story OFF.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test; `$PORT` with /mayor open: the lamp names each beat in order.

## Notes and risks

- Critic fix 15.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-121 · Depth of field for hero shots

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-040](FK-040-perspective-camera.md), [FK-136](FK-136-perspective-camera-2.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The soft crowd behind the head, for real.

## Scope

- three's own BokehPass (no new dependency: package.json is off limits) only in U4/U7/I7; off if fps < 50.

## Acceptance criteria

- [ ] U4 shows a soft crowd on $PORT at ≥ 50 fps.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT shot.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

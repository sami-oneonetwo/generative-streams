# FK-058 · Autopilot and the safety drawer

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-038](FK-038-mayor-show-strip.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Sami can take a break, and has every safety tool one click away.

## Scope

- Autopilot: rallies may still fire, big beats stay frozen, the camera stays on autoFrame.
- A safety drawer, closed by default: AI pause, clear bubbles, cancel designs, mute or send home a dude by click (wired to the existing show-safety tools).

## Acceptance criteria

- [ ] Autopilot freezes GO beats; each drawer button works.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

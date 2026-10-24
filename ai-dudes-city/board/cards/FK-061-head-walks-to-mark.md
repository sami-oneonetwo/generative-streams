# FK-061 · The head walks to his mark (replaces the snap)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-020](FK-020-head-prep-at-call.md) |
| Unblocks | [FK-109](FK-109-he-finds-out-and-the-offer.md) |

## Why (what changes for viewers or Sami)

On stream the head strolls to his spot during the Call instead of teleporting.

## Scope

- During the 25 s Call the server walks the Mayor to the mark (a server-driven path the /mayor page follows); snap only if he is not there by Start.

## Acceptance criteria

- [ ] At a Call the head walks into place within 20 s.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-052 · Pets stand beside their owner in the ring

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-019](FK-019-gather-visits.md), [FK-027](FK-027-pets-follow-owner.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Crowd shots show each chatter with their buddy.

## Scope

- movers.ts sets pet positions: in a gathering a follower sits 0.9 m beside its owner's slot, facing the anchor, below face height so it never blocks bubbles.

## Acceptance criteria

- [ ] A ring shot shows each pet at its owner's feet.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: three chatters with pets, Story (dev) → Gather; one shot.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

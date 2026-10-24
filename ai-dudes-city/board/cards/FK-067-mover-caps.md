# FK-067 · Mover caps and turn-taking

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Nothing caps how many chatter-built vehicles and animals move at once today; at 40 chatters that is noise.

## Scope

- At most 3 drive / 2 fly / 4 roam moving at once across town (pets and ridden builds excluded); parked movers rotate every 3 min; a brand-new build gets a 2-minute debut run so its builder sees it go; the rampage cap stays 2 (movers.ts:48). Only active while Story is ON (`state.ai.story`); Story OFF = today's game, unchanged.

## Acceptance criteria

- [ ] 20 cars on $PORT → at most 3 moving; a new car always gets its debut run.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with ?stats=1.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

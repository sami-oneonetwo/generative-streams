# FK-051 · Pets age with the world

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-027](FK-027-pets-follow-owner.md), [FK-049](FK-049-home-through-ages-server.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Your dog becomes a bronze-collared dog, then a knight's hound: pets restyle like builds.

## Scope

- Keeping `moves`, `creature` and `follows` through a restyle is FK-049's hook at mayor.ts:411-414 (that is the real bug: the restyle replaces the whole blueprint). Pets are already restyled per age today, so this card adds no AI cost.
- This card: a collar in the owner's side colour (cream if neutral), and the no-LLM age accessory kit (beads, bronze tag, bell, brass tag, LED collar, scrap goggles) drawn the moment the age turns, until the real restyle lands.

## Acceptance criteria

- [ ] After `set-age bronze` on $PORT kev's dog still follows him and wears the bronze tag, then its restyle.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

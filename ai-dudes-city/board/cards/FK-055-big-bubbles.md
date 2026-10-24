# FK-055 · Big bubbles for amplified lines

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-040](FK-040-perspective-camera.md), [FK-054](FK-054-amplification-gate.md) |
| Unblocks | [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

Sami's image: the crowd's own words, big, behind him.

## Scope

- A scale option in overlayPass (client/dudes/dudes.ts:1468): `say.big` bubbles pinned to screen size at 1.6× (58 px); the 4 newest in full, favouring chatters not shown yet tonight; raw text ≤ 60 characters; Kick emotes as pictures.

## Acceptance criteria

- [ ] A crowd shot shows up to 4 big bubbles, never overlapping tags.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT crowd shot with Test chat.

## Notes and risks

- FK-040's overlayPass hook (dudes.ts:1468-1478) lands first; this card changes the same function after it.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

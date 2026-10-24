# FK-041 · Ortho near-clip fallback per shot

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-044](FK-044-intro-now.md) |

## Why (what changes for viewers or Sami)

Insurance for FK-040: over-the-shoulder shots that don't cut through walls on the ortho camera.

## Scope

- A per-shot near-plane `clip` on the ortho camera, and a per-shot `cam: 'ortho'` override, so any shot can fall back.

## Acceptance criteria

- [ ] U7 on ortho with a clip shows Wren's shoulder and the crowd beyond without wall slices.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: one shot of U7 with `cam: 'ortho'`.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

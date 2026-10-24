# FK-064 · Lock story colours; the head wears gold, never red

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-006](FK-006-stone-cast-looks.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

Red and gold must never drift toward each other or toward the mud as the ages restyle, and the head is gold, not red.

## Scope

- Lock #B3262E, #FFC633 and the cast colours out of restyleColour (src/shared/ages.ts:194) and dressFor (today red → #9a4a3f and gold → #b89752 in Stone).
- The head never wears red: the King's red shirt and cape (ages.ts:94) and the Mayor's red propeller hat (ages.ts:120) become gold/ink. A gold sash in every age; the hat height ladder ×1.0, 1.2, 1.4, 1.6, 1.8, 2.0.

## Acceptance criteria

- [ ] In every age a shot shows story red and gold unchanged; the head has a gold sash and no red.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests) (ages.test.ts updated).

## How to verify

- $PORT `set-age` through all six; one shot each.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

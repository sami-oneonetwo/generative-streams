# FK-063 · Ink outline on people, pets and cast

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

Stone people are brown on brown mud; an outline makes them pop on a phone.

## Scope

- An inverted-hull outline (ink #1E1914 at 60%) on people, pets and cast only; Only active while Story is ON (`state.ai.story`); Story OFF = today's game, unchanged.

## Acceptance criteria

- [ ] A phone shot of Stone dudes on mud shows clear silhouettes; draw calls rise ≤ 5%.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Phone shot before/after on $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

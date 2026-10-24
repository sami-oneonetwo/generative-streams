# FK-066 · Bird flock

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-029](FK-029-world-breathes.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

One cheap sign of life overhead, styled per age.

## Scope

- One instanced flock of ≤ 9 birds, one at a time, every 60–120 s, crossing the current frame high in 6–10 s; crows, gulls, crows, pigeons, pigeons/drone, vultures by age; bursts up from the gathering spot at a Call; never visible while the letterbox is up. 1 draw call.

## Acceptance criteria

- [ ] Visible about once a minute or two; never in a scene.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with ?stats=1.

## Notes and risks

- New file client/dudes/life.ts; Lane D by default, but whichever of C or D is free first may take it (the file goes with the card).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-069 · Age-life movers (town-owned)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-032](FK-032-calm-during-scenes.md), [FK-068](FK-068-stone-life-design.md) |
| Unblocks | [FK-098](FK-098-bronze-life.md), [FK-104](FK-104-later-age-life-design.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

The world moves even when chat is quiet, without anybody's build being involved.

## Scope

- Town-owned movers (no owner, not in /admin, never blocking): one big mover on a fixed loop at ≤ 3 m/s, in frame every 60–90 s, plus 2–3 critters; a critter strolls in when fewer than 3 walkers are near the action; all park during scenes (FK-032). Only active while Story is ON (`state.ai.story`); Story OFF = today's game, unchanged.
- Town-owned movers carry `wild: true`, which keeps them out of restyles (worlds/ai-dudes/city.ts:116) and makes them unbreakable (damage.ts:38).

## Acceptance criteria

- [ ] On $PORT the mammoth passes about once a minute; goats wander; nothing moves in a scene.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with ?stats=1.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

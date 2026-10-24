# FK-120 · Thin out idle walking at scale

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | — |
| Unblocks | — |

## Why (what changes for viewers or Sami)

With 40 awake, the frame turns into ants.

## Scope

- The idle interval grows with the number of awake chatters (src/worlds/ai-dudes/sim.ts:280).

## Acceptance criteria

- [ ] With 40 awake on $PORT, ≤ 35% are walking at any moment.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT ?stats=1.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

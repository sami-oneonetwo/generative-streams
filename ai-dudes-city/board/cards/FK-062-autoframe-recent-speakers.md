# FK-062 · autoFrame frames recent speakers

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Layout alone can't keep 20+ chatters readable on a phone; framing the people who are talking can.

## Scope

- With Story ON, autoFrame (client/dudes/main.ts:201) frames chatters who spoke in the last 90 s, not every awake dude; AUTO_MAX 40 → 32 (main.ts:105); subjects stay below the top 250 px and the lower-right stays clear of HUD.

## Acceptance criteria

- [ ] With 10 chatters, 3 of them talking, the frame holds the 3 at half-height ≤ 20.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with Test chat; one shot.

## Notes and risks

- From the layout scout's L6; it doesn't depend on the layout decision.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

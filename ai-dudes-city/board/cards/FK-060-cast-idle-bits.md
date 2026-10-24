# FK-060 · Cast idle bits and name-checks

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | P · Product / coordinator |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The story stays in frame during free play, and every chatter hears their name from the cast within 10 minutes.

## Scope

- The coordinator writes the lines into story/lines.ts (P owns the line data) and a small scheduler in a new file story/idle.ts. Cast positions for the bits (Wren at the cold hearth, Oak at the tarp) are a ≤10-line hook into story/cast.ts (Lane B).
- One scripted bubble about every 3 min: Wren at the cold hearth "He sleeps in our hut.", Oak glaring at the tarp "That's our timber.", Moss "Hm."
- Name-checks within 10 min of a chatter's first line, favouring new and quiet chatters: Oak "@kev, one more plank.", Kit "@kev, the Boss is the best, right?"

## Acceptance criteria

- [ ] Over 15 min on $PORT with three chatters, each is named once and ~5 idle bits play.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Moved to the coordinator: it is mostly writing, and Lane B was setting the stream-1 date.
- Second on the cut list if M2 runs late.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

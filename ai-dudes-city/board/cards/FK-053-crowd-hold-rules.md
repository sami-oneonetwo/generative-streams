# FK-053 · Crowd-shot hold rules and the thin-crowd skip

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-035](FK-035-holds-and-mayor-slots-server.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Crowd shots last as long as chat is talking, and never show an empty room.

## Scope

- Crowd shots hold at least 20 s, start checking for quiet after 15 s (< 1 line per 5 s), and end by 45 s; Sami can hold Tab to keep or tap to move on.
- Thin crowd: fewer than 2 lines in the 10 s after the reveal skips the crowd shot. Townsfolk react with emotes only, never text.

## Acceptance criteria

- [ ] A quiet test run skips U6; a busy one holds until quiet.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT runs with and without Test chat.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

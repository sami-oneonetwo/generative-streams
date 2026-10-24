# FK-036 · Holds on the stream client

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-035](FK-035-holds-and-mayor-slots-server.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Held shots freeze cleanly instead of jumping.

## Scope

- client/dudes/main.ts: scene time `t = min(serverNow − at − shift, heldAt)`; the scene key stays `${id}:${at}` (main.ts:716); subtitles keyed by beat, not by `at` (main.ts:726).

## Acceptance criteria

- [ ] Holding Tab at U2 freezes the push-in; releasing continues without a jump.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open; a short screen check at the hold.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

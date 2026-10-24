# FK-057 · Stream-only rallies, warn pings and the scatter

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-026](FK-026-rally-v1.md), [FK-038](FK-038-mayor-show-strip.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-106](FK-106-the-knot.md), [FK-109](FK-109-he-finds-out-and-the-offer.md), [FK-169](FK-169-rally-sound.md) |

## Why (what changes for viewers or Sami)

Red plots behind the head's back; gold can snitch; Sami may walk over and break it up.

## Scope

- `scene.streamOnly`: cinema() skips it on /mayor (client/dudes/main.ts:698, ≤10-line hook by Lane C) and /mayor shows the ON STREAM chip.
- `warn` during a rally pings /mayor ("3 warn: Wren's fire, NE"). If the head comes within 15 m the rally scatters: "He's coming. Act normal."
- R4 "Meanwhile…": a hard cut to the live head, only if he moved or emoted in the last 5 s and not on Autopilot.

## Acceptance criteria

- [ ] A rally plays on /?stream=1 while /mayor keeps its own camera with the chip; a tester's `warn` pings /mayor; walking in scatters it.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-091 · The candle window

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-090](FK-090-last-light-2.md), [FK-097](FK-097-red-job-props.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-178](FK-178-candle-tones.md) |

## Why (what changes for viewers or Sami)

The run's best clip, and the easiest way to get a lurker to type for the first time.

## Scope

- 40 s; the cast's candles already lit; every chat line from anyone lights another at the grave ("Say his name"); camera holds. Exit NOW card: RAISE HIM A STONE · type red. Server counting is a ≤10-line hook in story/gather.ts.

## Acceptance criteria

- [ ] Ten test lines light ten candles.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-039 · Show keys: backtick GO, Tab, 1/2/3, Esc-hold panic

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-038](FK-038-mayor-show-strip.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-088](FK-088-the-ask.md), [FK-116](FK-116-endings.md), [FK-156](FK-156-ending-b.md) |

## Why (what changes for viewers or Sami)

About six presses a stream, working even while the say box has focus.

## Scope

- A capture-phase keydown listener that runs before the typing() check (client/dudes/operator.ts:221): backtick = GO, backtick again within 5 s = cancel; Tab tap = move on, hold = keep; 1/2/3 only during a slot (otherwise they stay poses, operator.ts:318); Esc held 1 s = panic. Never F-keys. B stays the build box (operator.ts:264).
- On reconnect /mayor opens straight into the running scene with the keys live.

## Acceptance criteria

- [ ] Each key works with the say box focused; 1–8 remain poses outside slots.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-088 · The Ask (Sami's answer branches the story)

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-039](FK-039-show-keys.md), [FK-084](FK-084-red-jobs-healer-herbs.md) |
| Unblocks | [FK-089](FK-089-last-light-1.md), [FK-099](FK-099-bronze-rehearsal.md), [FK-156](FK-156-ending-b.md) |

## Why (what changes for viewers or Sami)

The one place Sami's improv rewrites canon (bible decision 5, accepted).

## Scope

- Wren walks up to the Priest wherever he is; close two-shot: "He's worse. We need the bronze for medicine." Mayor slot with three cue lines: 1 "After the statue, small one." 2 "Have you tried walking it off?" 3 "…Take what you need." Pressing 3 jumps the healer's hut 50% and saves `city.story.helped = true`.

## Acceptance criteria

- [ ] Pressing 3 on /mayor jumps the healer's hut and saves `helped`; 1 or 2 don't.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

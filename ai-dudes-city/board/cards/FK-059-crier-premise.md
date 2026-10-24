# FK-059 · Crier: the premise on join, every 5 minutes, and a post at each Call

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

A named result in 10 seconds: every newcomer gets the premise and the two words.

## Scope

- Join reply: "@nia you're in! The Chief took Wren's home. Type red or gold." The premise and the current asks repeat every 5 minutes.
- **The Call post:** when a Call starts, the crier posts once in Kick chat with the gathering's 4-word premise ("GATHER! The Chief's secret build, by the river"); never for a cancelled Call; within the crier's existing rate limits.
- Code in a new Lane E file, story/crierStory.ts, with one ≤10-line hook into crier.ts (Lane B applies it).

## Acceptance criteria

- [ ] A new chatter gets the line; the repeat fires every 5 min while Story is ON.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT inject a new name; check KICK_REPLIES are off on $PORT and the reply shows in the log.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

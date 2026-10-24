# FK-028 · One pet per chatter

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-027](FK-027-pets-follow-owner.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md) |

## Why (what changes for viewers or Sami)

Sami's cap: one companion each, while the toy still always works.

## Scope

- Hook in act() (src/worlds/ai-dudes/index.ts:517): a pet request from a chatter who already has a follower becomes an edit of that pet (same id, owner and `follows`) with a puff; the crier says "Rex is now a goat."

## Acceptance criteria

- [ ] kev asks for a dog, then a cat → one pet, now a cat, still following.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT` inject both lines (FK-027's fixture pets); unit test.

## Notes and risks

- Coordinator decision: the PM proposed refusing ("You already have Rex"); eng and motion proposed replacing. Replacing wins because free building must always work (Sami's point (a)).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

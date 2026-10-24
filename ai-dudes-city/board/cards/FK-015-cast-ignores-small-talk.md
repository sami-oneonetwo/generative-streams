# FK-015 · The cast ignores the head's small talk

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | XS (≤ 2 h) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Otherwise Wren says "Hear, hear!" to the man who took her home.

## Scope

- Skip townies with `role` in speak() (src/worlds/ai-dudes/mayor.ts:244) and waveBack (mayor.ts:282).

## Acceptance criteria

- [ ] The Mayor says "hello" next to Wren: no cast reply; ordinary townies still reply.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test; off-air with /mayor open next to the cast.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

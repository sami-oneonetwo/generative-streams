# FK-143 · Huts or tents: the band sleeps where chat made room

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-047](FK-047-red-job-make-room.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

One of Stone's choices that changes the story (bible §4): how many huts chat made room for decides whether the band sleeps in huts or in tents.

## Scope

- At the Stone age turn: MAKE ROOM met → the cast's night spots are the credited chatters' huts; otherwise tents at the camp. Saved in `city.story.choices.huts` (FK-001).
- Shown in Bronze's opening and in Moss's "Previously" ("They gave us huts." / "Tents again.").

## Acceptance criteria

- [ ] Both outcomes on `$PORT`.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test plus one shot of each outcome on `$PORT`.

## Notes and risks

- Critic fix 19.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-129 · Story jobs drive the caravan ask engine

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-011](FK-011-board-server.md), [FK-012](FK-012-sides.md) |
| Unblocks | [FK-047](FK-047-red-job-make-room.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-130](FK-130-wonder-bar-server.md), [FK-146](FK-146-red-jobs-hall-workshops.md) |

## Why (what changes for viewers or Sami)

With Story ON the old caravan keeps running underneath. openVisit (caravan.ts:191-209) still makes the leader say the Mammoth Herders' `problems` lines, posts every visit to Kick (`crierVisitOpened`) and tells every awake agent about asks that the stream no longer shows (FK-009 hides #caravan).

## Scope

- story/jobs.ts (Lane E): a per-age red-job table and `storyAsks(age, visit)`. Visits before the Wonder come from the table (Stone: visit 0 = MAKE ROOM; an age with one red job goes straight from visit 0 to the Wonder visit). The Wonder visit is kept exactly as today (leaderProposesWonder, caravan.ts:215), so the age still turns when the Wonder stands.
- With Story ON openVisit sets no leader bubble, pushes no leader feed line and doesn't call crierVisitOpened; awake agents are told the story job instead ("Wren asks the town: build a hut on your own lot. It counts for red."). One ≤10-line hook at the top of openVisit (Lane B applies it): `if (storyOn(state)) return storyOpenVisit(state, cv, now)`.
- The Board's red bar reads the ask (FK-011), so it switches from BRIDGE to the job word by itself.

## Acceptance criteria

- [ ] Story ON, after Play: Crossing: no Mammoth Herders line in the feed, the bubbles or the Kick log; the red bar reads "MAKE ROOM 0/n"; agents get Wren's line.
- [ ] When MAKE ROOM is met the Wonder visit opens as today.
- [ ] Story OFF: today's three visits, unchanged (existing caravan tests green).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit tests first (storyAsks per age and visit; openVisit with Story ON and OFF).
- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): Play: Crossing (FK-127, Lane A, lands day 5), then read the demo log (/tmp/fk-demo-e.log) and take one stream shot.

## Notes and risks

- Critic fix 3 and 8: Lane E owns story/jobs.ts. FK-047 fills the Stone entry.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-130 · THE WONDER bar (server): red and gold by who put in what

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-011](FK-011-board-server.md), [FK-012](FK-012-sides.md), [FK-129](FK-129-story-jobs-drive-asks.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-131](FK-131-wonder-bar-client.md) |

## Why (what changes for viewers or Sami)

In the last stretch of every age the two bars merge into one, THE WONDER, filled red and gold by who put in what (bible §4.1, and §5 at 1:20). Without it the Wonder push has no progress on screen.

## Scope

- story/board.ts: once the Wonder visit is open, `TownView.board` carries `wonder: {word, pct, red, gold}`: `pct` from the project's progress (projectOf), `red` / `gold` = the share of contributions (coins and hands) from red- and gold-side chatters; neutrals and townsfolk count in the grey remainder.
- The ticker says "THE WONDER: everyone builds the Furnace. Type help." A bare `help` works the Wonder while it is open.
- Story (dev) → `wonder-open` jumps straight to it for demos (≤10-line hook, Lane A).

## Acceptance criteria

- [ ] Unit test: 3 red and 1 gold contributors → red 75%, gold 25% of the fill.
- [ ] Story OFF: no `wonder` in the view.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): Story (dev) → wonder-open, contributions from test names, one shot once FK-131 lands.

## Notes and risks

- Critic fix 3.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

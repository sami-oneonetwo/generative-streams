# FK-022 · RATE IT, pips and the crowd shot

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-021](FK-021-show-hud.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-053](FK-053-crowd-hold-rules.md), [FK-055](FK-055-big-bubbles.md), [FK-091](FK-091-candle-window.md), [FK-168](FK-168-unveiling-score.md), [FK-174](FK-174-crowd-voice-cap.md) |

## Why (what changes for viewers or Sami)

Chat's answers become pictures: a big live number at the reveal, red pips at Wren's fire.

## Scope

- `TownView.show.prompt` tiles: RATE IT (160 px live average, one decimal), a row of red pips (one per "us"), candles placeholder for M3.
- A `cinema-crowd` body class un-hides #people during crowd shots (client/dudes/index.html:42 hides it in cinema today). Bubbles stay normal size; big bubbles are FK-055.

## Acceptance criteria

- [ ] In a crowd shot the bubbles show.
- [ ] "7" and "3" from two chatters show 5.0.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): Story (dev) → Play: Unveiling, then /admin Test chat "7" and "3" from two names.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

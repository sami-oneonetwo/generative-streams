# FK-127 · Old scenes through the show runtime: opening, Crossing, age turn

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-026](FK-026-rally-v1.md), [FK-031](FK-031-m1-demo.md), [FK-045](FK-045-crossing-new-cast.md) |

## Why (what changes for viewers or Sami)

The Rally waits until the band has crossed, and the Crossing today only ticks inside tickCaravan. Split out of FK-017.

## Scope

- A thin adapter runs the existing caravan scenes (opening, Crossing, age turn) through tickShow while Story is ON; beats find the cast by role (story/cast.ts), not by caravan index (caravan.ts:429).
- With Story OFF tickCaravan runs them exactly as today (caravan.ts:513-533). The "don't tick here when Story is ON" guard is a ≤10-line hook into caravan.ts (Lane B).
- Wire Story (dev) → Play: Crossing, Play: Opening, Play: Age turn.

## Acceptance criteria

- [ ] `story-play crossing` plays with nobody awake and the caravan off.
- [ ] Story OFF: the opening and the Crossing play as today (the existing caravan tests stay green).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): Play: Crossing; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-a/fk127.png --w 1920 --h 1080 --wait 12000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 18 (split of FK-017).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-010 · The Board on stream (client) + ?demo=board

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-009](FK-009-sticker-toy-ui-base.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-131](FK-131-wonder-bar-client.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

The one thing always on screen: what gold builds, what red builds and who is winning, readable on a phone. With `?demo=board` Sami can see it on 4600 after the coordinator's client-only rebuild, before any server restart.

## Scope

- New client/dudes/board.ts rendering `TownView.board` into a root element `#board` in a top-centre strip 1240 px wide: gold pill bar on the left (crown, word inside the fill), red pill bar on the right (flag, "BRIDGE 3/8"), the rope tug line `type gold 7 ━━●━━ 4 type red` with a sliding knot, the 54 px ticker pill (crossfades every 20 s, hidden in cinema).
- Replaces renderCaravan (client/dudes/main.ts:862) when `board` is present; hidden during scenes. autoFrame (main.ts:201) keeps subjects below the top 250 px while the Board shows.
- `?demo=board` fills fake board data and assigns fake sides to visible dudes (for FK-013), locally, with no server change. Wren's site sign (FK-125) reads the same fake data.

## Acceptance criteria

- [ ] A 390 px phone shot of /?stream=1&demo=board shows "BIG HUT · type gold" and "BRIDGE 3/8 · type red" legibly.
- [ ] Story OFF: the caravan panel is back.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-c/fk010.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG); `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-c/fk010-phone.png --mobile --wait 8000`.

## Notes and risks

- Look per board/design-system.md §4; adjust details after FK-005 sign-off.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

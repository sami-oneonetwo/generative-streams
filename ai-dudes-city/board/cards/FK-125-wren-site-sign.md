# FK-125 · Wren's site sign, with Oak standing under it

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-011](FK-011-board-server.md), [FK-014](FK-014-cast-persists.md) |
| Unblocks | [FK-030](FK-030-story-world-kit-review.md), [FK-031](FK-031-m1-demo.md) |

## Why (what changes for viewers or Sami)

The red job needs a place in the world, not just a bar (bible §4, "How the job is SHOWN"): Oak stands on Wren's site under a big floating red sign with the count. FK-008 only designs its frame.

## Scope

- A floating red pennant, 3.2×1.4 m, at STORY_SITES.redSign, bobbing slowly (≤ 0.15 m at 0.3 Hz). Its text comes from `town.board.red` ("BRIDGE 3/4", later "MAKE ROOM 2/5") in Fredoka 700, cream on #B3262E with the ink rim (board/design-system.md §5). A canvas texture redrawn only when the text changes; one draw call.
- New file client/dudes/storyProps.ts (Lane D), mounted by a ≤10-line hook in main.ts (Lane C). A plain pennant until FK-008's frame lands, then the frame swaps in.
- `?demo=board` shows it with the fake board data, so Sami sees it after a client-only rebuild.
- Oak idles under it whenever no scene runs: a ≤10-line hook into story/cast.ts (Lane B).

## Acceptance criteria

- [ ] A 390 px phone shot reads the count on the sign; Oak stands under it.
- [ ] Story OFF: no sign.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-d/fk125.png --mobile --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).
- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): /admin → scene-opening, then one stream shot of the sign with real data.

## Notes and risks

- Critic fix 10 (design-system.md §5).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

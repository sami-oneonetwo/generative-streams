# FK-132 · The band's camp on the town side

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md), [FK-008](FK-008-camp-and-rally-fire-dressing.md), [FK-034](FK-034-intro-art.md) |
| Unblocks | [FK-043](FK-043-intro-flashback.md), [FK-044](FK-044-intro-now.md), [FK-056](FK-056-stage-stream-1.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

The camp is drawn on the far bank (`CAMP` at x ≈ 115.5, client/dudes/environment.ts:53), but the Intro's I3 ("plants a stick flag in their hearth"), I7 (Sami at their fire, seen across the river) and the Big Hut "on their camp plot" all need the hearth on the town side, at the Folly plot. Nothing in the game uses FK-008's camp props or FK-034's junk pile yet.

## Scope

- New client/dudes/camp.ts (Lane D) draws at STORY_SITES.camp (the provisional SE corner park until FK-079 moves STORY_SITES to the River Bank; Sami approved A+ on 2026-10-24): a ring of 3–4 empty huts, the cold hearth ring, the carved post with the red handprint, the Chief's stick flag (from I3 on) and the junk pile.
- The hearth smokes only while the head stands at it (FK-029's emitter).
- While Story is ON the far-bank camp (environment.ts:53) is hidden: a ≤10-line hook into environment.ts (Lane C).
- At the unveil the hearth stones become the Big Hut's doormat and the post its doorpost (bible §3, Stone).
- Static and merged into ≤ 3 draw calls.

## Acceptance criteria

- [ ] Story ON: a stream shot reads the camp as somebody's home at phone size; the far-bank camp is gone.
- [ ] Story OFF: today's far-bank camp, nothing new.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-d/fk132.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG), then the same with `--mobile`.

## Notes and risks

- Critic fix 4. Layout question 3 was answered yes on 2026-10-24: the camp moves to the town bank.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

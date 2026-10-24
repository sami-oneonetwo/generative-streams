# FK-016 · Apply the Stone cast looks

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-006](FK-006-stone-cast-looks.md), [FK-014](FK-014-cast-persists.md) |
| Unblocks | [FK-030](FK-030-story-world-kit-review.md), [FK-031](FK-031-m1-demo.md), [FK-144](FK-144-moss-knots-kit-hat.md) |

## Why (what changes for viewers or Sami)

The cast on stream must look like the board Sami approved.

## Scope

- Load design/spec/cast/stone.json into the look pipeline for `cast-*` townies; story colours bypass restyleColour (src/shared/ages.ts:194).
- Scales: Wren 0.82, Ash 1.15, Oak 1.25, Kit 0.7. Moss sits on her stump.

## Acceptance criteria

- [ ] A stream shot of the five matches the FK-006 board.
- [ ] Wren's red top third reads at phone size.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-d/fk016.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

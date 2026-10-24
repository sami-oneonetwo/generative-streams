# FK-042 · Hero shots: U2/U4 Mayor slots, U6 crowd, U7 over Wren's shoulder

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-025](FK-025-unveiling-v1.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-040](FK-040-perspective-camera.md), [FK-136](FK-136-perspective-camera-2.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-089](FK-089-last-light-1.md), [FK-107](FK-107-drawbridge-unveiling.md), [FK-110](FK-110-golf-cart.md), [FK-114](FK-114-rising-staging.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

The Unveiling's point: the head's triumph, the crowd's faces, and Wren small and red against it all.

## Scope

- U2 Mayor slot 1 ("Behold!"). U4 hero shot from the build looking back: the head's face in the middle third at eye level, crowd soft behind; Mayor slot 2 with the plaque names on the cue card ("Built by friends of the Chief: Kev, Dana, Bo!").
- U6 crowd shot tilted 15–20° down, tiered so bubbles don't stack. U7 over Wren's shoulder with her red filling a third of the frame, music drops out.
- Each shot keeps an ortho near-clip fallback (FK-041).
- The shot poses live in a new Lane C file, src/shared/storyShots.ts, which storyScenes.ts (Lane B) references by shot key, so Lane C never edits Lane B's file. The Mayor slots themselves are FK-035 / FK-038.

## Acceptance criteria

- [ ] Three shots (U4, U6, U7) match the bible's descriptions at 1920×1080.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT shots to /tmp/fk-shots/eng-c/fk042-*.png.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-025 · The Unveiling v1 (ortho camera)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-018](FK-018-gather-mode.md), [FK-019](FK-019-gather-visits.md), [FK-020](FK-020-head-prep-at-call.md), [FK-021](FK-021-show-hud.md), [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-023](FK-023-folly-site-server.md), [FK-024](FK-024-folly-look.md), [FK-124](FK-124-story-scenes-on-stream.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-042](FK-042-hero-shots.md), [FK-092](FK-092-defection-window.md), [FK-168](FK-168-unveiling-score.md) |

## Why (what changes for viewers or Sami)

The first full scene Sami can watch: everyone gathers, the tarp drops, chat rates it, the camera finds Wren.

## Scope

- Scene `unveil-stone` in src/shared/storyScenes.ts, registered in `STORY_SCENES` so the page plays it (FK-124), run by story/show.ts.
- Call: 25 s banner + beam pulse → U1 wide from behind the crowd (4 s) → U2 slow push-in (6 s; Mayor slot later) → U3 reveal: camera still, tarp drop, fanfare, title card THE CHIEF'S BIG HUT, RATE IT prompt → U5 slow pan past (5 s) → U6 crowd shot (fixed 20 s; hold rules are FK-053) → U7 pivot to Wren at STORY_SITES.wrenVantage (far bank if the bridge is not mended) with a WREN name card → U8 Wren: "That was our fire." → U9 exit wide, NOW card "BRIDGE n/8 · type red", hand back to autoFrame.
- Ortho camera only; the U4 hero shot is FK-042. Wire Story (dev) → Play: Unveiling.

## Acceptance criteria

- [ ] About 60 s end to end; nobody touches WASD.
- [ ] Afterwards the Folly stands unveiled and free play resumes.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): BOARD.md M1 demo step 6; three shots (U1, U3, U7) to /tmp/fk-shots/eng-b/fk025-*.png using `--wait` offsets from the scene start.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

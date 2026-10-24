# FK-040 · Perspective cinema camera 1: the camera and ?persp=1

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-042](FK-042-hero-shots.md), [FK-044](FK-044-intro-now.md), [FK-055](FK-055-big-bubbles.md), [FK-121](FK-121-depth-of-field.md), [FK-136](FK-136-perspective-camera-2.md) |

## Why (what changes for viewers or Sami)

Sami's signature shots (soft crowd behind the head, the build small beyond Wren's shoulder) need real perspective; on ortho they read as cropped walls.

## Scope

- A second THREE.PerspectiveCamera (~35° FOV) used only during scenes; free play keeps the ortho camera (client/dudes/main.ts:162).
- `CamPose.persp` {fov, dist}; hard cuts at shot boundaries; a default perspective pose derived from each ortho shot so every existing scene plays.
- `?persp=1` turns it on for scenes, for review shots and Sami's M1 walkthrough (the bible: on ortho the hero shots "read as cropped walls").
- Tags and bubbles: overlayPass (client/dudes/dudes.ts:1468-1478, Lane D) projects through whichever camera is active: a ≤10-line hook request to Lane D, landed before FK-055 changes the same function.
- Fog, the shadow box and per-shot tuning are FK-136; the hero shot poses are FK-042.

## Acceptance criteria

- [ ] With `?persp=1` the Unveiling (or, before FK-025, the Crossing) renders through the perspective camera with tags and bubbles in the right places; without it nothing changes; free play is unchanged.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT`: /admin → scene-opening (or Story (dev) → Play: Unveiling once FK-025 lands) on `/?stream=1&persp=1`; one shot mid-scene.

## Notes and risks

- Bible decision 6 (accepted): build it for stream 1; the bible prices it at 2–3 days, so it is three cards: this one (M1, day 5), FK-136 (refit, M2) and FK-042 (hero shots, M2). If it slips, FK-041 is the fallback. Depth of field is FK-121 (Later).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-136 · Perspective cinema camera 2: fog, shadows and shot tuning

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-040](FK-040-perspective-camera.md) |
| Unblocks | [FK-042](FK-042-hero-shots.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-121](FK-121-depth-of-field.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

The rest of the bible's 2–3 day camera: the perspective view must not pop shadows or band the fog, and every Stone shot needs a real pose.

## Scope

- Fog and the shadow box refitted to the perspective frustum; near/far planes per shot.
- A tuned `persp` pose for every Stone scene shot (Intro, Crossing, Unveiling, Rally, age turn).
- Story scenes default to perspective (no `?persp=1` needed) once Sami OKs the M1 walkthrough; FK-041's per-shot ortho fallback still works.

## Acceptance criteria

- [ ] No shadow pop or fog band at U1, U4 or U7; scenes play in perspective by default.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT`: three shots (U1, U4, U7) (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 18 (split of FK-040).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-134 · The walk shot: a high wide of everyone converging

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-019](FK-019-gather-visits.md), [FK-124](FK-124-story-scenes-on-stream.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

The bible's trailer shot (§6, the Bell, step 2): during the gathering walk the camera shows everyone converging on the spot.

## Scope

- From the end of the Call until Start, the stream camera eases to a high wide (half-height about 30) centred between the ring anchor and the walkers' centroid; pans stay under 10% of the frame per second; the GATHER banner stays up. It cuts to the scene's first shot at Start.
- /mayor keeps its own camera.

## Acceptance criteria

- [ ] Two shots 5 s apart during a walk show the dudes converging, all in frame.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): six test dudes, Gather; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-c/fk134-a.png --w 1920 --h 1080 --wait 8000` then `--wait 13000` to fk134-b.png (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 15.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

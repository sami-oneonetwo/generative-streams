# FK-013 · Side markers: ground disc and crown or flag

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-030](FK-030-story-world-kit-review.md), [FK-031](FK-031-m1-demo.md) |

## Why (what changes for viewers or Sami)

Sides must read on a phone and in greyscale: a disc under the dude, a crown for gold, a flag for red.

## Scope

- client/dudes/dudes.ts: from `DudeView.side` draw a 1.3 m ground disc (#B3262E or #FFC633) with the sticker rim (0.1 m cream, then 0.05 m ink). Instanced: one draw call per colour.
- Tag icon: crown for gold, pennant flag for red; neutrals get nothing.

## Acceptance criteria

- [ ] /?stream=1&demo=board shows discs and icons on visible dudes; real sides after FK-012.
- [ ] Red and gold discs differ clearly in a greyscale shot.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-d/fk013.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG); `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-d/fk013-phone.png --mobile --wait 8000`.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

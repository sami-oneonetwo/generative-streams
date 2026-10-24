# FK-131 · THE WONDER bar (client)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-010](FK-010-board-client.md), [FK-130](FK-130-wonder-bar-server.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

The merged bar is the last thing the Board shows each age, and it has to read on a phone like the two bars did.

## Scope

- client/dudes/board.ts: when `board.wonder` is present the two bars crossfade (1 s) into one 1240 px pill "THE WONDER · type help": gold fills from the left, red from the right, grey in between; the tug line stays underneath.
- `?demo=board&wonder=1` previews it locally.
- Look from FK-005's mock.

## Acceptance criteria

- [ ] A 390 px phone shot reads "THE WONDER", both colours and "type help".
- [ ] Story OFF: the caravan panel as today.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board&wonder=1" /tmp/fk-shots/eng-c/fk131.png --mobile --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 3.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

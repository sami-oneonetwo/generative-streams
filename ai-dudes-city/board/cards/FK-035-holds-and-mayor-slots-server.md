# FK-035 · Holds and Mayor slots (server)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-036](FK-036-holds-client.md), [FK-037](FK-037-beat-queue.md), [FK-042](FK-042-hero-shots.md), [FK-043](FK-043-intro-flashback.md), [FK-048](FK-048-age-turn-stone.md), [FK-053](FK-053-crowd-hold-rules.md), [FK-088](FK-088-the-ask.md), [FK-095](FK-095-moss-previously.md), [FK-163](FK-163-mix-director.md), [FK-164](FK-164-scene-cue-track.md), [FK-168](FK-168-unveiling-score.md) |

## Why (what changes for viewers or Sami)

Sami's mic is the line: a shot lasts as long as he holds Tab, and the stream never waits on typing.

## Scope

- Scene data gets `holds: [{at, maxMs, until: 'tab'|'quiet'|'ms'}]` and `'{mayorLine}'` subtitle slots.
- The server keeps `shift` and `heldAt` in `city.story.scene` instead of pushing `sc.at` forward (the client keys scenes by `${id}:${at}`, client/dudes/main.ts:716, so moving `at` re-seeds every shot's start pose).
- Sub-kinds `tab` (down/up) and `cue` (1/2/3) of FK-001's `{t:'show'}` MayorInput, parsed in story/beats.ts: no mayor.ts edit. With no /mayor socket, the cue line plays at the hold's timeout.

## Acceptance criteria

- [ ] A hold freezes scene time; a Tab release moves on; a timeout plays the cue line.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including hold maths unit tests.

## How to verify

- $PORT with /mayor open: Story (dev) → Play: Unveiling, hold Tab at U2.

## Notes and risks

- Coordinator decision: the bible says holds need no protocol change; the eng lead showed they do (C2). Eng wins on code facts.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

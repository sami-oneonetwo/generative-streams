# FK-033 · Bridge intact, then the collapse beat

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-043](FK-043-intro-flashback.md), [FK-056](FK-056-stage-stream-1.md), [FK-170](FK-170-intro-sound.md) |

## Why (what changes for viewers or Sami)

The Intro needs the log bridge whole until the Chief pulls it apart.

## Scope

- `city.story.bridgeIntact` makes the town view leave out `bridge`, so the client draws it whole (client/dudes/environment.ts:303). Today a stranded band reports 0, which draws it broken (caravan.ts:351).
- A `collapse` beat plays the existing splash + collapse effects at BRIDGE (src/shared/scenes.ts:10), then sets the bridge broken (progress 0).

## Acceptance criteria

- [ ] Stage stream 1 shows the bridge whole; the collapse beat breaks it with a splash.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: Story (dev) → Stage stream 1, then the collapse beat; shots before and after.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

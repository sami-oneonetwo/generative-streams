# FK-032 · Calm during scenes

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-069](FK-069-age-life-movers.md), [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Reveals must hold still so Kick's compression doesn't smear them: only the tarp, the dust and the signature part move.

## Scope

- While `city.story.scene` or a Call is active: chatter-built movers park (cars at the next junction, flyers land) in movers.ts; non-scene townsfolk idle in place (≤10-line hook into city.ts, Lane B); the flock and big movers leave or hide (hook into Lane C); confetti uses ≤ 24 big pieces.
- Life returns staggered over 10 s after the release.

## Acceptance criteria

- [ ] Two reveal shots 1 s apart differ only at the tarp, the signature part and the dust.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with a few movers built, Story (dev) → Play: Unveiling; two shots 1 s apart.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

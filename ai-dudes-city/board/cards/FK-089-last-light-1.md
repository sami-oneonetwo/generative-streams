# FK-089 · The Last Light 1: the Keep ribbon and the deathbed (L1–L3)

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-042](FK-042-hero-shots.md), [FK-088](FK-088-the-ask.md) |
| Unblocks | [FK-090](FK-090-last-light-2.md), [FK-099](FK-099-bronze-rehearsal.md), [FK-177](FK-177-last-light-sound.md) |

## Why (what changes for viewers or Sami)

The most important scene of the run.

## Scope

- L1 the Keep ribbon as a short Unveiling with a Mayor slot for the Priest's speech (cue card mentions everything except Ash). L2 hard cut indoors, still, warm, party sound muffled. L3 close two-shot: with the healer's hut, three lines ("It's warm. Who built this?" naming the top builder, "Don't carry this like a stone, Wren", "Live."), else one line "Live." on a bedroll by the cold hearth; if `helped`, "He gave the bronze. Remember that too."

## Acceptance criteria

- [ ] Both branches play on $PORT.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT twice: with and without the hut.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

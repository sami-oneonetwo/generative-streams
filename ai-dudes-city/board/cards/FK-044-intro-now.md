# FK-044 · Intro part 2: "NOW" (I5–I11)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-020](FK-020-head-prep-at-call.md), [FK-023](FK-023-folly-site-server.md), [FK-040](FK-040-perspective-camera.md), [FK-041](FK-041-ortho-near-clip-fallback.md), [FK-043](FK-043-intro-flashback.md), [FK-132](FK-132-camp-on-town-side.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-170](FK-170-intro-sound.md) |

## Why (what changes for viewers or Sami)

The band comes home to a broken bridge and a stranger at their fire, and that stranger is Sami, live.

## Scope

- I5 hard cut, card NOW, colour returns; on the far bank Ash limps out of the trees on Oak's shoulder, Wren in front, Moss behind, Kit trailing. I6 close on Wren: "We're home."
- I7 over Wren's shoulder across the river: no bridge, smoke from their hearth at STORY_SITES.camp (FK-132), a flag on it, and Sami's live Mayor at their fire (prepareHead at the Call).
- I8 Mayor slot (Tab; cue "Hello! Welcome to my town!"); Kit, tiny, waving back: "He waved at me!" I9 Ash: "Wren. That's our fire." I10 Moss: "Well. Somebody fix it, then."
- I11 two big panels held 8 s: red MEND THE BRIDGE · type red, gold HELP THE CHIEF · type gold. The cordon goes up on the Folly plot.

## Acceptance criteria

- [ ] Story (dev) → Play: Intro runs about 70 s end to end and leaves the cordon up and the Board live.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open; shots at I7 and I11.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

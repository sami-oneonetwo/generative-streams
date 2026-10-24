# FK-026 · Wren's Rally v1

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-014](FK-014-cast-persists.md), [FK-018](FK-018-gather-mode.md), [FK-019](FK-019-gather-visits.md), [FK-021](FK-021-show-hud.md), [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-126](FK-126-story-sounds-1.md), [FK-127](FK-127-old-scenes-through-runtime.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-057](FK-057-stream-only-rallies.md), [FK-082](FK-082-auto-rallies.md), [FK-169](FK-169-rally-sound.md) |

## Why (what changes for viewers or Sami)

Red gets its own scene: Wren whistles, a handful come, she tells them what is under the tarp.

## Scope

- Scene `rally-stone` in `STORY_SCENES`: the `whistle` cue (FK-126, Lane S) + banner "WREN'S FIRE · type coming" (20 s).
- Up to 6 dudes who typed "coming" (red first) get gather visits to STORY_SITES.wrenFire; Oak, Moss and Kit fill the arc.
- R1 low wide → R2 Wren close, two lines from the stream-1 bank (bible §6) with the "Him or us?" pips → R3 reverse over her shoulder; each "us" lights a pip and joins red (FK-012 path), up to 25 s → R5 the secret and the ask: "It's a hut. For him. Stand with me. Type red." → NOW card.
- One comer only → "Wren confides in you". In Stone, refuse with a reason until the band has crossed (Story (dev) → Play: Crossing first, FK-127). Wire Story (dev) → Play: Rally.

## Acceptance criteria

- [ ] "test-nia: coming" walks test-nia to the fire; "us" turns her red with a lit pip; about 35 s.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): BOARD.md M1 demo step 7.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

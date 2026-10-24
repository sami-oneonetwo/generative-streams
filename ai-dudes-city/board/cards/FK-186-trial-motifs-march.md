# FK-186 · Trial motifs and the Friends of the Boss march

| | |
|---|---|
| Milestone | Later |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-117](FK-117-trial-montage.md), [FK-155](FK-155-rising-trial-speech.md), [FK-164](FK-164-scene-cue-track.md), [FK-176](FK-176-bronze-music-gong.md), [FK-181](FK-181-medieval-music.md), [FK-182](FK-182-industrial-music.md), [FK-183](FK-183-wasteland-music.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The trial recalls six streams in a minute; each Folly should come back with its age's sound.

## Scope

- The trial montage (FK-117): each Folly's 3 s plays its age's motif, plus a rope-cinch for each of Moss's knots.
- Friends of the Boss (FK-155, C4): a gold march and a cheer.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the montage and the march and approves.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain.

## Notes and risks

- Audio plan A27.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

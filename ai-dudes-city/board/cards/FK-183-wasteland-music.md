# FK-183 · Wasteland music and the clanged pipe

| | |
|---|---|
| Milestone | Later |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-165](FK-165-age-music-stone.md) |
| Unblocks | [FK-186](FK-186-trial-motifs-march.md) |

## Why (what changes for viewers or Sami)

Stream 6 is the Wasteland; it should sound emptied out.

## Scope

- The Wasteland style: 70 BPM; a sparse, wobbly electric piano, slides, no hi-hats. Beds: wind and crows, no birds.
- Wasteland's Call: a clanged pipe.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays Wasteland and approves it, and the Call.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render 32 bars and the Call.

## Notes and risks

- Audio plan A25.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

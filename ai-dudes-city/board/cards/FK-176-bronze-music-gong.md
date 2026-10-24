# FK-176 · Bronze music and the gong

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-165](FK-165-age-music-stone.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-186](FK-186-trial-motifs-march.md) |

## Why (what changes for viewers or Sami)

Stream 2 is the Bronze age; it should sound like it from the first bar.

## Scope

- The Bronze style: 80 BPM; lyre arpeggios, frame drum, finger cymbal. Beds: a market and an anvil.
- Bronze's Call in FK-167's call table: a gong.
- Story ON only.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays Bronze against Stone and Modern and approves it, and the gong.
- [ ] On 4616, `set-age bronze` crossfades the music over 2 bars (never change the age on 4600).
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render 32 bars and the Call; read levels.json.

## Notes and risks

- Audio plan A20.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

# FK-168 · The Unveiling score

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-023](FK-023-folly-site-server.md), [FK-024](FK-024-folly-look.md), [FK-025](FK-025-unveiling-v1.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-135](FK-135-story-sounds-2.md), [FK-164](FK-164-scene-cue-track.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

The Unveiling is the show's big moment. Without this it plays over the lounge tune, with no drumroll and no reveal.

## Scope

- All through FK-164's cue track, on the shots of FK-025 (bible §6, U1–U9):
  - U2/U3: a drumroll that loops while Sami holds Tab (FK-035's hold) and stops on release.
  - The reveal: the roll cuts, 400 ms of nothing, then the tarp whoomp (a swish plus a 150 Hz body), the gold fanfare and a cheer, as one clean sound event.
  - U4 hero shot: a soft vamp under Sami's mic.
  - U6 crowd: the murmur (FK-167) plus the blips; each RATE IT number plays a tick pitched by its value, at most 3 a second. Ticks never replace the speaker's blips.
  - U7 Wren pivot: FK-135's `drop`: the music hard-cuts (≤ 150 ms) to wind and river; her line plays dry.
  - U9: the music comes back on a downbeat.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the Unveiling chain (roll, reveal, vamp, ticks, cut, return) and approves.
- [ ] On 4600 with Story ON, Play: Unveiling with Tab held at U2: the roll loops until he lets go; the reveal lands as one sound; testers typing numbers give ticks; the pivot cuts to wind and river, and Wren's blips stay.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] audio:check passes: the fanfare at most +3 LU, the gap and silences exact zeros.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with /mayor open and `?debug=sfx`, the cue log matches U1–U9.

## Notes and risks

- Audio plan A12.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

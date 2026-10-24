# FK-135 · Story sounds 2: the creak and the U7 music drop

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | XS (≤ 2 h) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-126](FK-126-story-sounds-1.md), [FK-160](FK-160-sound-approve-and-fingerprints.md) |
| Unblocks | [FK-043](FK-043-intro-flashback.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-140](FK-140-story-sounds-3.md), [FK-168](FK-168-unveiling-score.md), [FK-170](FK-170-intro-sound.md) |

## Why (what changes for viewers or Sami)

"Free wood!" needs its creak, and the Unveiling's pivot to Wren lands only when the music drops out (bible §6, U7).

## Scope

- audio.ts: `creak` (a slow wooden groan, about 1.2 s; reused by Still Fine and ending C).
- `drop`: a shot flag that hard-cuts the music and effects (≤ 150 ms) to wind and river for the shot, and brings the music back on a downbeat after. The voices are not dropped (the speech-blip rule): Wren's line plays dry. If Sami plays music in OBS, the U7 cue card says "music off".

## Acceptance criteria

- [ ] The I4 creak and the U7 drop fire on cue (debug log).
- [ ] On :4600/sounds Sami plays the creak and the drop (with a line of speech over it) and approves both.
- [ ] FK-157's voice hash is unchanged.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- 4616 (`board/tools/fk-demo.sh s`) with `?debug=sfx`; the render of the drop shows the music at exact zero and the voice unchanged.

## Notes and risks

- Critic fix 15. The splash already exists (FK-033 reuses it).
- Moved from Lane C to Lane S on 2026-10-24. The drop no longer silences every game sound: it keeps the voices, as the audio plan scores U7 ("hard-cut the music to wind and river, then her line, dry").
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161, once it lands), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

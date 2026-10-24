# FK-140 · Story sounds 3: the muffled party and sirens

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | XS (≤ 2 h) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-135](FK-135-story-sounds-2.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-112](FK-112-still-fine-turn.md), [FK-154](FK-154-still-fine-2.md), [FK-177](FK-177-last-light-sound.md) |

## Why (what changes for viewers or Sami)

The Last Light's L2 cuts indoors to a still room while the party goes on outside, muffled; Still Fine needs sirens.

## Scope

- audio.ts: a `muffle` shot flag: all non-voice audio low-passed at 400 Hz and −10 dB, over room tone (the voices stay clear); `siren` (a slow two-tone wail, loopable) for FK-154.

## Acceptance criteria

- [ ] L2 plays muffled; the siren loops and stops cleanly (debug log).
- [ ] On :4600/sounds Sami plays the muffle and the siren and approves both.
- [ ] FK-157's voice hash is unchanged.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- 4616 (`board/tools/fk-demo.sh s`) with `?debug=sfx`; Sami listens at the Bronze rehearsal too.

## Notes and risks

- Critic fix 15. Moved from Lane C to Lane S on 2026-10-24. FK-177 builds the rest of the Last Light's sound on this.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161, once it lands), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

# FK-172 · Phone pass: a highpass, a limiter, and something above 300 Hz in every cue

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-161](FK-161-offline-render-and-levels.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The bass (44–110 Hz), the kick (110→45 Hz) and `boom` (80→30 Hz at 0.35) are inaudible on phones, but they still pump the compressor, which ducks the blips.

## Scope

- A 50 Hz highpass before the compressor and a −1 dBTP limiter on the master.
- Every cue recognisable above 300 Hz: anything with sub content gets a partner at 200 Hz or above (a click, a harmonic).
- This changes the master chain the blips go through, so the speech-blip rule applies: if FK-157's hash moves, it lands only with Sami's Approve after an A/B on /sounds.

## Acceptance criteria

- [ ] audio:check: every cue keeps recognisable energy above 300 Hz, and the true peak is at most −1 dBTP everywhere.
- [ ] On :4600/sounds with the phone toggle on, Sami hears every cue, A/Bs the blips (no difference he can hear), and approves.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render everything before and after; compare levels.json.

## Notes and risks

- Audio plan A16. It takes boom's known issue from FK-161's baseline.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

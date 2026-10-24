# FK-173 · Cast voices Sami picks by ear

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md), [FK-128](FK-128-cast-renames-and-daughter.md), [FK-157](FK-157-speech-blip-guard.md), [FK-160](FK-160-sound-approve-and-fingerprints.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

There are only 9 base pitches, picked by a hash of the id (seedOf, main.ts:752). FK-014's `cast-<role>` ids already stop the cast's voices changing every age; this lets Sami choose each one's voice and keeps it for the season.

## Scope

- /sounds: a cast voice picker. For Wren, Ash, Moss, Oak and Kit, audition candidate voices (a seed, normal or low, a pitch offset) on their real lines; Sami picks one each and clicks Approve, which stores the picks in audio-approved.json (`castVoices`).
- seedOf (main.ts:752, Lane C's) reads the approved table for `cast-*` ids: a ≤10-line hook into main.ts. Chatter, townie and Mayor voices don't change.
- Speech-blip rule: this changes seedOf, so it needs Sami's Approve (his picks are the Approve).

## Acceptance criteria

- [ ] On :4600/sounds Sami picks and approves five cast voices.
- [ ] On 4600 with Story ON the cast speak in the voices he picked; on 4616 after `set-age bronze` they still do (never change the age on 4600).
- [ ] FK-157's hash for chatter voices is unchanged.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test: `cast-*` ids map to the approved voices and every other id to today's seedOf.

## Notes and risks

- Audio plan A17.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

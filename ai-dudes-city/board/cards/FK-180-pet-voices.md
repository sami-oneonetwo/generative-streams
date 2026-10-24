# FK-180 · Pet voices

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-027](FK-027-pets-follow-owner.md), [FK-159](FK-159-sound-board.md), [FK-163](FK-163-mix-director.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Pets follow their owners (FK-027) but make no sound except the donkey's bray.

## Scope

- Voices matched on the pet's blueprint name: bark, meow, cluck, baa, moo (with mid harmonics so it reads on phones), quack, whinny, roar, robot beeps, plus the existing bray.
- The nearest pet makes a sound every 10–25 s, at most 1 every 6 s town-wide; sometimes a pet answers right after its owner speaks.
- Never reuse speech() for pets. Quiet during scenes (FK-163). Story ON only, like pets following.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays every pet voice and approves.
- [ ] On 4600 with Story ON and a test pet: its voice at the right rate, never over a scene.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- A rate-limiter test; render each voice; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with a fixture pet and `?debug=sfx`.

## Notes and risks

- Audio plan A24.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

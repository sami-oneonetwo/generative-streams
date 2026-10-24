# FK-164 · Scene cue track: sounds on exact moments, once, through holds

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-160](FK-160-sound-approve-and-fingerprints.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-168](FK-168-unveiling-score.md), [FK-169](FK-169-rally-sound.md), [FK-170](FK-170-intro-sound.md), [FK-184](FK-184-rising-sound-1.md), [FK-186](FK-186-trial-motifs-march.md) |

## Why (what changes for viewers or Sami)

Story scenes need sounds on exact moments (the tarp drop, the whistle, the creak), and holds move scene time: a cue keyed on `${id}:${at}` (main.ts:716) would replay or skip when Sami holds Tab.

## Scope

- Scene data gets `sounds?: [{at, cue}]` (scene ms → cue name). The optional field in src/shared/scenes.ts is a ≤10-line hook to Lane A. FK-126's per-shot `sound` is read as one entry, so there is one shape.
- New client/dudes/cues.ts (Lane S's) fires each cue once per stable scene id, on the same scene time as FK-036 (`min(serverNow − at − shift, heldAt)`): a hold never refires a cue; a skip doesn't play what it skipped over (unless the cue is marked `always`); a page reload mid-scene doesn't replay past cues. One call from cinema(): a ≤10-line hook into main.ts (Lane C).
- Adds a `cue` bus for story cues, under the mix director (FK-163).

## Acceptance criteria

- [ ] Unit tests: a 10 s hold never refires a cue; a skip plays nothing it skipped; a reload mid-scene plays nothing from the past.
- [ ] On 4600, Story (dev) → Play: Rally with Tab held at the start: Sami hears the whistle exactly once.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit tests; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with /mayor open: Play: Rally, hold Tab; `?debug=sfx` shows one `sfx whistle`.

## Notes and risks

- Audio plan A8.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

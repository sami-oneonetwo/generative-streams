# FK-074 · Stream 1 rehearsal and go/no-go

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | product |
| Lane | P · Product / coordinator |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-032](FK-032-calm-during-scenes.md), [FK-037](FK-037-beat-queue.md), [FK-038](FK-038-mayor-show-strip.md), [FK-039](FK-039-show-keys.md), [FK-042](FK-042-hero-shots.md), [FK-044](FK-044-intro-now.md), [FK-045](FK-045-crossing-new-cast.md), [FK-047](FK-047-red-job-make-room.md), [FK-048](FK-048-age-turn-stone.md), [FK-050](FK-050-home-through-ages-card.md), [FK-051](FK-051-pets-age-with-world.md), [FK-052](FK-052-pets-in-the-ring.md), [FK-053](FK-053-crowd-hold-rules.md), [FK-054](FK-054-amplification-gate.md), [FK-056](FK-056-stage-stream-1.md), [FK-057](FK-057-stream-only-rallies.md), [FK-058](FK-058-autopilot-and-safety-drawer.md), [FK-059](FK-059-crier-premise.md), [FK-064](FK-064-story-colours-and-head-kit.md), [FK-073](FK-073-stream-1-cue-cards.md), [FK-129](FK-129-story-jobs-drive-asks.md), [FK-130](FK-130-wonder-bar-server.md), [FK-131](FK-131-wonder-bar-client.md), [FK-132](FK-132-camp-on-town-side.md), [FK-133](FK-133-stream-1-beats.md), [FK-134](FK-134-walk-shot.md), [FK-135](FK-135-story-sounds-2.md), [FK-136](FK-136-perspective-camera-2.md), [FK-139](FK-139-design-review-m2.md), [FK-163](FK-163-mix-director.md), [FK-164](FK-164-scene-cue-track.md), [FK-165](FK-165-age-music-stone.md), [FK-167](FK-167-bell-walk-murmur.md), [FK-168](FK-168-unveiling-score.md), [FK-169](FK-169-rally-sound.md), [FK-170](FK-170-intro-sound.md), [FK-171](FK-171-ui-sounds.md), [FK-174](FK-174-crowd-voice-cap.md), [FK-175](FK-175-obs-sidechain-loudness.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Stream 1 runs end to end before it runs live.

## Scope

- Run the M2 demo script twice: in full on the coordinator's demo server (4610, own worktree), then on 4600 at a check-in, stopping before the Wonder is finished (that would turn the 4600 world's age).
- On 4600: copy the save first, `test-` names preferred, and afterwards remove every test dude's builds, the dudes and their lots (/admin `remove-build`, `remove-dude`, `release-lot`: worlds/ai-dudes/index.ts:1965, 1947, 1787) or restore the pre-rehearsal save; finish with **Story OFF**.
- Write a go/no-go list; anything failing becomes a card or a cut (cut order in BOARD.md).

## Acceptance criteria

- [ ] Two clean runs; with Story ON a free build still lands on the lot.
- [ ] After the 4600 run no `test-` dude, build or lot remains and Story is OFF.
- [ ] Sami has heard stream 1's sound on 4600 (the Intro, the Bell, the Unveiling, the Rallies, the UI sounds, the Stone music) and approved it on :4600/sounds; the OBS sidechain check (FK-175) is done.
- [ ] A go/no-go list signed by Sami.

## How to verify

- BOARD.md → M2 demo script.

## Notes and risks

- The coordinator owns this card.

## Log

- (picked up / review notes / done, with dates)

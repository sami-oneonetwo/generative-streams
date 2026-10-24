# FK-163 · Mix director: scenes, the Mayor slot, and no feed sounds mid-scene

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-162](FK-162-voice-bus-split.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-167](FK-167-bell-walk-murmur.md), [FK-177](FK-177-last-light-sound.md), [FK-178](FK-178-candle-tones.md), [FK-180](FK-180-pet-voices.md) |

## Why (what changes for viewers or Sami)

Scenes have no sound of their own: cinema() (client/dudes/main.ts:698) does the camera, letterbox and subtitles only. The music plays on at full level, and the doorbell, sting and fanfare from the feed can fire in the middle of the Unveiling.

## Scope

- New client/dudes/mix.ts (Lane S's): a mix stage on top of the user levels, so M, N and -/= on /mayor still work.
  - In a story scene: music −6 dB, ambience −4 dB.
  - In a Mayor slot (FK-035's `{mayorLine}`, while Tab is held): music −10 dB plus a −3 dB dip at 2–4 kHz, so Sami's mic sits on top.
  - Any blip: music −3 dB for 250 ms.
  - The voice bus is never ducked.
- During scenes the feed sounds (doorbell, sting and fanfare, main.ts:773-780), hammering, birds, pets and the bray are dropped or queued; at most 2 queued ones play after the scene.
- Driven from `town.scene` / `town.show` by one call per frame: a ≤10-line hook into main.ts (Lane C).
- A mix-table test: the target gain per bus in each state (free play, scene, Mayor slot, each shot type); silences are exact zeros; the voice bus never drops below its user level.
- /sounds gets a mix-state switch (free play, scene, Mayor slot) for the town tune with a voice over it.
- Story OFF: the levels pass straight through and nothing changes.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the town tune with a line of speech in each mix state, hears the music sit under the voice, and approves each state.
- [ ] On 4600 with Story ON, Story (dev) → Play: Unveiling: no doorbell or sting during it, the music lower, the blips as loud as in free play.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- The mix-table test; the render of the tune in each mix state (levels.json shows −6 and −10 dB).
- On 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done) with `?debug=sfx`: the console lists the suppressed cues during Play: Unveiling.

## Notes and risks

- Audio plan A7. Ducking is for music and beds only; anything that would touch the voice bus falls under the speech-blip rule.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

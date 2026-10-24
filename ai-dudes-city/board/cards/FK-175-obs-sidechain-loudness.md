# FK-175 · OBS sidechain and the loudness check, with Sami

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-161](FK-161-offline-render-and-levels.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

On stream the game must sit at least 10 dB under Sami's voice, and the whole stream should land near −14 to −16 LUFS.

## Scope

- An OBS checklist in docs/audio-levels.md: set the browser source to "Control audio via OBS"; add a sidechain compressor on it keyed by Sami's mic (ratio about 4:1, threshold −30 dB, attack 5 ms, release 300 ms).
- With Sami at a check-in: record 2 minutes of him talking over a scene, measure it with FK-161's loudness meter, then he listens to the recording on his phone.

## Acceptance criteria

- [ ] Sami has set up the checklist in OBS.
- [ ] The recording measures about −14 to −16 LUFS, with the game at least 10 dB under his voice.
- [ ] Sami signs it off after listening on his phone.

## How to verify

- The measurement, in the card's Log.

## Notes and risks

- Audio plan A19. It needs Sami's time: the coordinator books it at a check-in. FK-161 is a dependency only for the loudness meter.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

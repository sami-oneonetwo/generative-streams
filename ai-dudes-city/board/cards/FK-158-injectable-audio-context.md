# FK-158 · Injectable AudioContext and random in createAudio

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-157](FK-157-speech-blip-guard.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-159](FK-159-sound-board.md), [FK-161](FK-161-offline-render-and-levels.md), [FK-165](FK-165-age-music-stone.md) |

## Why (what changes for viewers or Sami)

Everything in audio.ts uses `Math.random` and a live AudioContext (audio.ts:65-110), so nothing can be rendered offline, fingerprinted or played twice the same way. The sound board, the Approve fingerprints and the level checks all need the same code driven by an OfflineAudioContext and a seeded random.

## Scope

- `createAudio(enabled, initial, opts?: { ctx?: BaseAudioContext; rand?: () => number })` in client/dudes/audio.ts. The defaults are today's `new AudioContext()` and `Math.random`, so main.ts:744 doesn't change.
- Every `Math.random()` in audio.ts goes through `rand`: the reverb and noise buffers (:92, :103), samples (:154, :164), the music (:184-207), the birds (:219-222, :266) and speech (:301-305).
- `listen()` ignores a non-finite `half` (FK-157's `todo`, if it had one, now passes).
- Export the cue list (each cue's name, bus and play function) for the sound board (FK-159) and the offline render (FK-161).

## Acceptance criteria

- [ ] FK-157's golden voice hash is unchanged: its test passes without touching audio-approved.json.
- [ ] A new test drives createAudio twice with a fake context and the same seed and gets identical event lists for every cue.
- [ ] Sami at the next check-in: the stream sounds exactly as before (the town tune, the birds, the blips).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm test`; `git diff main -- client/dudes/main.ts` is empty.

## Notes and risks

- Audio plan A2. The speech-blip rule applies (this file holds speech() and tone()); the unchanged hash is the proof, so it lands without an Approve.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

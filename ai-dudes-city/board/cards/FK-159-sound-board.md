# FK-159 · Sound board v1 at /sounds

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-158](FK-158-injectable-audio-context.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-174](FK-174-crowd-voice-cap.md), [FK-180](FK-180-pet-voices.md) |

## Why (what changes for viewers or Sami)

Agents can't hear, and Sami can't judge a sound from a debug log. One page where he plays every cue, every voice and a crowd, at stream levels and through a phone filter, is how sound gets reviewed from now on.

## Scope

- New client/sounds/index.html and client/sounds/main.ts (Lane S's), importing client/dudes/audio.ts (its own AudioContext and FK-158's exported cue list). A big "Start sound" button, because browsers need a click first.
- Sections:
  - **Cues:** every existing cue (doorbell, fanfare, sting, built, hammer, bray, pew, boom, thud, coins, play, burst, bonk, the beds), and each story cue as it lands (the whistle and the bell from FK-126 first).
  - **Speech tester:** type a line and play it in each of the 9 voices, the Mayor's low voice, or a chosen seed, near and far.
  - **Crowd tester:** 6 or 15 talkers saying sample lines at stream rates.
  - **Music:** the town tune at the stream's default levels (music 0.5, sfx 0.8, ambience 0.6). Later cards add the ages and the mix states here.
  - **Meter:** peak and RMS from an AnalyserNode on the master.
  - **Phone toggle:** a 300 Hz–8 kHz band-pass, in mono.
- Served with no src/server/** change: a ≤10-line hook into scripts/build-client.mjs (Lane C's file) adds the `client/sounds/main.ts` entry and copies the page to public/sounds/index.html, so the existing `express.static('public')` (src/server/http.ts:135) serves it at :4600/sounds/ (Express redirects /sounds there).
- The page reads nothing from the server and writes nothing (Approve is FK-160), so it's harmless if someone else reaches it.

## Acceptance criteria

- [ ] After the coordinator's client rebuild, Sami opens :4600/sounds, plays every cue, types a line and hears it in all ten voices, and runs the 6- and 15-talker crowds.
- [ ] The phone toggle audibly thins the sound, and the meter moves with it.
- [ ] /?stream=1 sounds exactly as before: the voice hash is unchanged and main.ts is untouched.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Build in the worktree (`nice -n 10 node scripts/build-client.mjs`), start 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done), then `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs http://localhost:4616/sounds/ /tmp/fk-shots/sound/fk159.png --w 1920 --h 1080 --wait 4000` and Read the PNG: every section labelled and readable.
- A second shot.mjs run with `--eval` that clicks Start and every cue button and returns any console errors (none expected).

## Notes and risks

- Audio plan A3. The plan put a route in src/server/http.ts; a static page avoids Sami's server files.
- Lane C applies the build-client.mjs hook the same day (M1 day 3, beside FK-021).
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

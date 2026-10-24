# FK-158 · Injectable AudioContext and random in createAudio

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane S agent, 2026-10-24 |
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

- 2026-10-24 · lane S agent: picked up.
- 2026-10-24 · lane S agent: **done, ready for review** on fk-s (commit 21859d2, rebased on main d9dfd22; not landed). `git diff --stat main` = 4 files, all Lane S's: client/dudes/audio.ts, scripts/audio-voice.test.ts, and the new scripts/audio-fake.ts and scripts/audio-replay.test.ts. `git diff main -- client/dudes/main.ts` and `-- client/dudes/audio-approved.json` are both empty.
  - **The voice hash is unchanged.** I ran FK-157's guard test exactly as it is on main against the new audio.ts before touching the test file: 11 pass, and the NaN-half todo now passes. The record it hashes (written with AUDIO_VOICE_RECORD, 782 lines) is byte-identical before and after (`cmp`), and still hashes to the approved `fd4fb174…f5a2da`. I checked it again at the final commit.
  - **audio.ts:**
    - `createAudio(enabled, initial, opts: AudioOptions = {})`. The options are `ctx?: AudioContext | OfflineAudioContext`, `rand?: () => number` and `now?: () => number`. main.ts:778 doesn't change.
    - The defaults are today's `new AudioContext()`, `Math.random` and `performance.now`. Both functions are looked up at each call, so a test that swaps Math.random still reaches them, as before.
    - All 23 `Math.random()` calls go through `rand`: the reverb and noise buffers, hiss() (rate and offset), the music (progression, key, the late chord, the walking bass, the vibraphone), the birds and their spacing, and speech(). The only one left in the file is the default.
    - **Two changes from the card's signature, both needed for "played twice the same way":**
      - **`ctx` is a union, not BaseAudioContext.** BaseAudioContext has no resume(), and the union lets the code tell an offline context apart (`'startRendering' in ctx`).
      - **There is a new `now` option.** The throttles read performance.now(), so on a page under 4 s old the doorbell (1.5 s), fanfare and sting (4 s) are dropped. A fresh /sounds tab or render page would hit that, and so did my first test run: the doorbell was missing.
    - **An OfflineAudioContext counts as running** (it is 'suspended' until it renders, which would otherwise skip every cue). It gets no 100 ms timer and no pointerdown/keydown wake-up.
    - **New handle `ahead(seconds, only?)`.** It runs the music and bird clock in one go: the same tick() the timer runs, every 100 ms from the context's time, for the bars and bird calls that start within `seconds`. Offline, call it once for the whole length (the clock doesn't move). `only: 'music' | 'birds'` keeps each one's fingerprint separate. silent() has it too.
    - **`listen()` ignores a non-finite x, z or half** and keeps the last good values. FK-157's todo is removed, and its test now also checks that the line plays as it would at the last good half (8).
    - **`export const CUES`**: 30 cues, each with `{ name, bus, placed, play(a, at?) }`.
      - Bus sfx, unplaced: doorbell, fanfare, sting.
      - Bus sfx, placed (fade with distance): built, hammer, coins, boom, pew, bonk, thud, bray; play:shoot/swim/strum/jump/swing/kick/punch/lift and play:other (the chime every other pose gets); burst:smoke/confetti/hearts/sparkles.
      - beds:engines (sfx) and beds:fountain (ambience). A bed holds until `beds(0, 0)`.
      - music: 32 bars, 89.3 s. birds: 60 s, on ambience.
      - The blips aren't a cue: speech() is pinned by audio-voice.test.ts, and /sounds has its speech tester. `Bus` is exported.
  - **Tests:**
    - The fake moved word for word from audio-voice.test.ts into scripts/audio-fake.ts (`diff` of the moved lines against main: identical). It gained one addition, `FakeOfflineContext` ('suspended', with startRendering), so FK-160 can share it. golden() and lined() stay in the voice test.
    - New scripts/audio-replay.test.ts, 12 tests. Math.random throws while createAudio and every cue run, and the page timers and listeners are stubbed:
      - every cue played twice from seed 7 gives identical event lists, set-up included, and none is empty;
      - seed 8 changes exactly the cues with chance in them: the music, the birds, and every cue that plays noise;
      - the reverb and noise buffers come from the seed;
      - speech() follows the seed;
      - the source has no Math.random call except the default;
      - each cue is heard on the bus it names (traced from its sources down the wires), and every placed cue is silent at 500 away;
      - the music cue is exactly 32 bars; ahead(10) schedules only the 4 bars that start within 10 s;
      - the throttles run on `now`: a fanfare is held at +3999 ms and plays at +4000;
      - ahead(30) on an offline context equals a live context's timer ticked by hand, event for event (11 bars plus the birds);
      - the offline context has no timer or listeners, while a live one gets `[100]` and pointerdown/keydown;
      - listen() with NaN or ±Infinity in half, x or z keeps the last good camera;
      - switched off, every cue is a no-op.
    - A failed comparison prints only the first row that differs. Without that, a failing deepEqual on the fake's event graph took minutes to print.
  - **Scratch mutations** (in /tmp/fk-s-158/scratch; re-run with /tmp/fk-s-158/mutate.sh; never committed). Every one fails its tests quickly, and the unchanged control passes both files:
    - a bird reaches for Math.random: 6 replay tests fail;
    - the default rand captured once (`?? Math.random`): the voice guard fails (4, the hash among them), and so does 1 replay test;
    - offline not counted as running: 9 fail;
    - the timer on offline too: 1 fails;
    - no listen() guard: 1 fails, and the voice NaN test fails too;
    - ahead() ticks to the end of its window (33 bars): 1 fails;
    - the throttle back on performance.now: 3 fail;
    - beds:fountain labelled sfx: 1 fails;
    - bray marked placed but not passed `at`: 1 fails.
  - **Real Chrome** (Chrome 154 headless, scratch page /tmp/fk-s-158/real, never committed; shot /tmp/fk-shots/lane-s/fk158-offline-diff.png): all 30 cues, a blip line and an empty render, on a real OfflineAudioContext with seed 7 and the clock at 10 s. Every one renders.
    - 19–20 of the 32 renders are bit-identical run to run. The rest differ by at most 3.7e-8 (about −149 dBFS, below 24-bit) from their first note: the reverb-send cues, the music, the birds and the blips. Peaks and RMS agree to 0.1 dB.
    - So that is float rounding inside Chrome's renderer, not anything audio.ts does. **For FK-160: hash the event lists (as the card says), not the rendered samples. For FK-161: round levels to 0.1 dB.**
    - ~~Rough peaks at the stream's levels (FK-161 measures properly):~~ **Wrong, struck at landing (see the landing entry): these were played at t≈0.02 s on a fresh context, while the buses still glide from 1.0 to their levels and the limiter hasn't settled. They are not stream levels.**
      - ~~boom −16.9 dBFS (the loudest);~~
      - ~~the music −19.1;~~
      - ~~strum −23.3, built −24.9;~~
      - ~~the blips −26.9;~~
      - ~~fanfare −29.8;~~
      - ~~the engines drone −28.4 peak / −36.2 RMS;~~
      - ~~the hum alone −41.6.~~
  - **Found, not fixed (it changes the sound, so it needs Sami's ear), for FK-161 and FK-163:** reverb sends skip the buses (tone(): `out → send → reverb → wet → master`).
    - With every bus at 0, 230 of the tune's 852 tones in 32 bars still reach the master through the reverb. These are the e-piano (send 0.25) and the vibraphone (0.5).
    - So do coins, built, doorbell, fanfare, strum, hearts, sparkles and play:other.
    - So M (music off) and N (effects off) on /mayor leave a reverb ghost of the tune and the chimes. The blips are dry and not affected.
  - **What Sami gets once 4600 is rebuilt:** nothing new to hear. The stream sounds exactly as before (same tune, birds and blips; the voice record is byte-identical). The one difference is a camera that hands audio a NaN: before, every placed sound threw; now they play from the last good camera.
  - Checks: `npm run typecheck` green; `npm test` 193 tests, 193 pass, 0 fail, 0 todo (181 on today's main, the old todo among them and now passing, plus 12 new). No demo server was needed (no server or main.ts change).
  - Hooks into other lanes' files: none.
- 2026-10-24 · lane S agent: **landed** on main at **d631b7b** (FK-158 commits d8ea121 and d631b7b, rebased on main 6fc351b, fast-forward). `npm run typecheck` green. `npm test` 212/212 pass, 0 todo. One run had a single failure in scripts/dudes.test.ts ("driving through people runs them over…", server world, doesn't import audio). It passed 3/3 alone and the full rerun was green, so it's a load flake, not this card. `git diff main -- client/dudes/main.ts client/dudes/audio-approved.json` was empty before the merge.
  - **What Sami gets once 4600 is rebuilt:** nothing new to hear. The town tune, the birds and the blips sound exactly as before (the voice record is byte-identical, hash `fd4fb174…f5a2da`). The one difference: a camera that hands audio a NaN no longer makes every placed sound throw; they play from the last good camera. Underneath, /sounds (FK-159), the fingerprints (FK-160) and the offline render (FK-161) can now drive the same code with their own context, seed and clock, through `CUES` and `ahead()`.
  - **Review notes applied** (d631b7b, comments only, no sound change): AudioOptions.ctx and Cue.play say a render that measures plays after the buses and limiter settle (`ctx.suspend(2)`, then play, then `ctx.resume()`). AudioOptions.now says to start the injected clock at least 6000 ms in (1e4, say); every throttle starts from 0, so below the bray's 6 s gap the first call of each throttled cue is silently dropped. The `?? 0` default is unchanged, so the stream's first seconds are unchanged.
  - **The struck peaks, corrected.** These are the reviewers' re-renders in real Chrome 154, each cue played after a 2–3 s settle; I did not measure them myself. FK-161 measures them properly.
    - boom −14.4 dBFS;
    - kick and punch −20.1 to −20.2 (not −25.7), thud −21.6 to −21.8 (not −27.2), bonk −25.6 (not −30.7);
    - play:shoot −23.6 steady (but see the hiss click below);
    - the music −25.3 to −27.3 over 8 s and −25.9 over the full 32 bars (not −19.1);
    - the blips about −27.0 (they barely move);
    - birds −40.2 (5–7 dB lower than fresh), the hum alone −46.2 (not −41.6).
    - The music settles by about 1 s, boom by about 0.5 s. Settled, with every bus at 0, only the reverb-send cues leak (−50 to −66 dBFS). Fresh from t=0 every cue still peaks at −19 to −40 with every bus at 0, because the buses haven't glided down yet.
  - **Hand-off to FK-161 (offline render and levels):** play each cue only after the context settles: `ctx.suspend(2).then(() => { cue.play(a); ctx.resume(); })`, then `startRendering()`, and measure only from that point. when() and ahead() read `ctx.currentTime`, so FK-158's API works as it is. Pass `now` starting at 1e4 or more. Don't "fix" the glide in applyLevels or the bus set-up: that's the sfx bus gain, which the speech-blip rule covers.
  - **Follow-ups, not done here:**
    - **hiss() start click (on main before this card, for FK-161 and FK-172; it changes the sound, so it needs Sami's ear).**
      - What happens: each hiss gets a fresh GainNode at its default gain 1.0, and the envelope's `setValueAtTime(0.0001, t)` can land a frame after the buffer source starts. The result is a one-sample click at the start of the hiss.
      - The reviewer's case: play:shoot at exactly 2.0 s (seeds 7 and 9) puts one 0.144 sample (−16.8 dBFS) among neighbours of −0.0004, at the swish start +0.476 s. That's 7 dB over the cue's real peak. Played at 1.37, 3.7, 5 or 7.13 s, it doesn't happen.
      - On stream it can hit any hiss(): swish, swim, smoke, confetti, and the music's brushes and hats. tone() starts at phase 0, so the blips are safe.
      - FK-161: the clip and true-peak checks won't flag a −17 dBFS tick, so add a single-sample spike check.
      - Likely fix: set `g.gain.value = 0.0001` before scheduling in hiss(). Doing the same in tone(), for symmetry, needs Sami's Approve.
    - **near() finiteness (later sound card, optional).** listen() guards the camera, but a placed sound whose own `at` has a NaN x or z still gives a NaN gain and throws. That was already so on main, and positions come from validated state. The fix is for near() to return 0 for a non-finite distance. I left it out because speech() calls near(), so it falls under the speech-blip rule. Finite blips wouldn't change and the hash would hold, but it belongs on a sound card with the hash check, not slipped into a landing.
    - Carried over from review: reverb sends skip the buses, so M or N on /mayor leaves a reverb ghost of the tune and the chimes (FK-161, FK-163; needs Sami's ear).
  - Hooks into other lanes' files: none. No demo server used.

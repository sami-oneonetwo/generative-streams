# FK-162 · Voice bus split, and the N-key question

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Done (landed on main at 10a3bc7; Sami's ear check and N-key answer still due at FK-031 step 10) |
| Owner | lane S agent, 2026-10-24 |
| Depends on | [FK-157](FK-157-speech-blip-guard.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-163](FK-163-mix-director.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

The blips share the sfx bus (audio.ts:81) with booms, hammers and fanfares, so anything that ducks the effects ducks the voices too. A voice bus of their own, at exactly today's gain, is what lets every later mix change leave the voices alone.

## Scope

- audio.ts: a `voice` bus fed only by speech(), with gain = sfx level × 0.7 (the same as the sfx bus today), into the same master and compressor. No level, wave or timing changes.
- N on /mayor (client/dudes/operator.ts:277) still mutes the blips with the effects, exactly as today: the voice bus follows the sfx level.
- The N-key question for Sami, written in this card's Log for the M1 check-in: (a) keep today's N, effects and voices together (the default); or (b) N for effects only, plus a separate voice key. (b) would be a new card: ≤10-line hooks into operator.ts (Lane E) and main.ts (Lane C), with the level in a new optional field (no saved enum widened; the levels are saved at src/worlds/ai-dudes/state.ts:497).

## Acceptance criteria

- [ ] FK-157's golden voice hash is unchanged: the split provably changes nothing.
- [ ] With the fake context, speech() connects only to the voice bus and no other cue does; `levels({sfx: 0})` silences both buses.
- [ ] Sami at the check-in: the blips sound the same; he answers the N-key question (recorded in the Log).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm test` (the golden test plus a routing test).

## Notes and risks

- Audio plan A6. The plan's order is A1 → A2 → A6, so pick it up after FK-158 even though it only needs FK-157.
- Speech-blip rule: this touches the sfx and voice bus gain, so the hash must not move.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- 2026-10-24 · lane S agent: picked up.
- 2026-10-24 · lane S agent: **done, ready for review** on fk-s (commit a4f02a9, rebased on main ce88280; not landed). `git diff --stat main` = 3 files, all Lane S's: client/dudes/audio.ts (+18 −10), scripts/audio-voice.test.ts and scripts/audio-replay.test.ts. `git diff main -- client/dudes/main.ts client/dudes/operator.ts client/dudes/audio-approved.json` is empty.
  - **audio.ts:**
    - A fourth bus, `voice` (`Bus` is now music | sfx | ambience | voice), made, wired and levelled exactly as the sfx bus is. It's a gain into the same master (0.9) and compressor (−14 dB, 6:1), with `setTargetAtTime(sfx × 0.7, now, 0.1)` in applyLevels next to the sfx bus's line.
    - speech()'s two tones now say `bus: 'voice'`. Nothing else in speech() or tone() changed: no level, wave, timing or envelope.
    - No cue is on 'voice' (Cue.bus says so).
    - AudioLevels is unchanged: the voices follow `sfx`. So N on /mayor (operator.ts:277, then main.ts:794, then `levels({ sfx: 0 })`) mutes both, exactly as today.
  - **The voice hash is unchanged** (`fd4fb174…f5a2da`) and audio-approved.json is untouched. The record it hashes (AUDIO_VOICE_RECORD, 28,828 bytes) is byte-identical (`cmp`) to the one main's own test writes on main's audio.ts. I checked it again after the rebase.
    - **How the test sees it.** The record calls the blips' bus 'sfx', its name when Sami approved it. Two gains now follow the sfx level: the effects' bus (the engines' drone is wired into it at set-up) and the voices' own (nothing is wired into it). The test tells them apart that way, and `AS_APPROVED` writes the voices' bus into the record under its approved name.
    - **Why that's sound.** The new twin test pins the voices' bus's set-up rows equal to the sfx bus's, so the record describes the same path the blips always took.
    - **Main's guard test, unchanged, against the new audio.ts fails 3 tests.** Its bus finder expects one gain per level, so it can't find 'sfx'. The guard noticed the routing change, as it should, so the test had to learn the second bus. No pinned value changed.
  - **Tests:** 221 pass (219 on today's main + 2 new), 0 fail, 0 todo. `npm run typecheck` is green and the client bundle builds.
    - audio-voice.test.ts (every failure carries the board rule):
      - the blips go "straight onto the voices' own bus" (it said the sfx bus);
      - "the voice path" now follows the voices' bus into the master and compressor;
      - **new, "the voices' bus is the sfx bus's twin":** the same set-up rows (`create gain`, `connect master`, `setTargetAtTime 0.56 @0 tc 0.1`); the same target as the sfx bus at sfx 0.8, 1, 0.25 and 0 (N); and music and ambience at 0 leave it at 0.56.
    - audio-replay.test.ts: buses() finds four buses. **New, "speech() plays into the voice bus alone and no cue does; levels({ sfx: 0 }) silences both":**
      - a placed line and the head's unplaced one connect into the voice bus and nothing else (no reverb send, not the sfx bus);
      - all 28 cues stay off it (CUES has 28 entries; "30" was a miscount, corrected at landing), and nothing at all is wired into it;
      - it feeds the same master as the sfx bus, beside it, not through it;
      - `levels({ sfx: 0 })` puts both at 0 and leaves music at 0.16 and ambience at 0.3; back at 0.8, both are at 0.56.
  - **Scratch mutations** (/tmp/fk-s-162/mutate.sh, never committed). The counts are failing tests as audio-voice + audio-replay. Both controls pass with the record identical, and every mutation fails:
    - control, unchanged: 0 + 0;
    - control, the voice bus made first (creation order): 0 + 0;
    - one syllable's triangle back on the sfx bus: 2 + 1 (routing and the hash);
    - the sine back on the sfx bus: 2 + 1;
    - the voice bus at sfx × 0.6: 3 + 1;
    - a 0.2 s glide: 3 + 0;
    - a fixed 0.56 (N would no longer mute the blips): 4 + 2;
    - on the music level: 4 + 2;
    - chained through the sfx bus (ducking the effects would duck the voices): 3 + 1;
    - `gain.value = 1` set on the voice bus: 2 + 0;
    - a cue (the doorbell) on the voice bus: 0 + 2. The voice record is identical: that's a routing fault, not a voice change;
    - the engines' drone wired into the voice bus too: 4 + 2;
    - a reverb send on the blips: 2 + 1.
  - **Real Chrome** (Chrome 154 headless; scratch page /tmp/fk-s-162/real, never committed; shot /tmp/fk-shots/lane-s/fk162-offline-diff.png). Main's audio.ts against the branch's on a real OfflineAudioContext: seed 7, clock at 10 s, the stream's levels, 8 s each. The five golden lines play one a second from 2 s (after the settle), with effects and beds overlapping them, and everything is measured from 2 s. Over two runs:
    - **the five lines alone:** peak −26.4 dBFS and RMS −48.0 on both. Main vs FK-162 differs by at most 1.1e-8; main vs main, the renderer's own run-to-run noise, also by up to 1.1e-8.
    - **the lines with effects and beds:** −12.4 / −33.8 on both. Main vs FK-162 ≤ 7.5e-8; main vs main ≤ 7.5e-8.
    - **the same plus the town tune:** −12.4 / −33.6. Main vs FK-162 ≤ 8.9e-8 (−141 dBFS); main vs main ≤ 7.5e-8.
    - **the effects alone:** −12.4 / −33.9. Main vs FK-162 ≤ 6.0e-8; main vs main ≤ 1.0e-7.
    - So the split can't be heard. Every difference is the size of the renderer's own noise and under one 24-bit step (1.2e-7), and peaks and RMS agree to 0.1 dB.
    - **N** (sfx 0, with music and ambience at 0 to isolate it): the five lines add exactly 0 on both (bit for bit, against a render without them). With effects there's −49.3 dBFS on both: FK-158's reverb ghost (sends skip the buses), not the blips.
    - **sfx 0.4:** the lines peak at −32.3 dBFS on both.
  - **Demo server:** not used. Both slots were taken (lanes A and D), and there is nothing to see or to serve: no server, page or main.ts change.
  - **The N-key question for Sami, for the M1 check-in (FK-031 step 10).** Today N on /mayor turns the effects off and the speech blips go with them. Now that the blips have a bus of their own, which do you want?
    - **(a) Keep N as it is**, effects and voices together. This is the default, and it is what this card ships: nothing changes.
    - **(b) N for the effects only, plus a separate voice key** (V, say). That's a new card:
      - ≤10-line hooks into operator.ts (Lane E: the key and the "effects / voices" label at operator.ts:357) and main.ts (Lane C: pass a `voice` level);
      - the `{ t: 'audio' }` input in mayor.ts:72 (Lane E) takes an optional `voice`;
      - the level goes in a new optional field beside the saved `audio` (src/worlds/ai-dudes/state.ts:499 and :550, now `{ music, sfx }`), with no saved enum widened;
      - audio.ts gets an optional `voice` level that defaults to `sfx`.
    - Sami's answer: _(to record here at the check-in)_.
  - **Follow-ups:**
    - The next time the voice hash changes on purpose through Sami's Approve (FK-160 or FK-173), rename the record's 'sfx' to 'voice' and drop `AS_APPROVED` in the same change. FK-157's note to add the long line to LINES then still applies.
    - FK-163 (mix director) can now duck the sfx bus without touching the voices; the voices' bus gain is still the speech-blip rule's.
  - Hooks into other lanes' files: none.
- 2026-10-24 · lane S agent: **landed** on main at **10a3bc7** (fast-forward of fk-s: a4f02a9, then 10a3bc7 for the review notes; main was ce88280, so no rebase conflicts). `npm run typecheck` green; `npm test` 221/221 pass, 0 fail.
  - **What Sami gets once the coordinator restarts 4600 and rebuilds the client:** nothing he can hear changes. The blips are on a bus of their own at exactly the effects' level, so the approved voice hash `fd4fb174…f5a2da` still passes, and N on /mayor still mutes effects and voices together. This is what lets FK-163 duck the effects and leave the voices alone.
  - **Review notes applied (10a3bc7, tests only):**
    - audio-replay.test.ts: the per-cue loop finds the buses before each cue plays and adds `${cue.name} never touches the voice bus's gain (no duck)`. Scratch check, reverted: a fanfare that ducks the voice bus (`setTargetAtTime(0)`) now fails the FK-162 test with "fanfare never touches the voice bus's gain (no duck)". The FK-158 test "each cue is heard on the bus it names" still fails it with the bus finder's "2 !== 1".
    - audio-voice.test.ts: a comment on the twin pin says FK-163 relaxes its effects' half (and the replay test's "beside it") through Sami's Approve; the voices' rows and the approved record stay.
    - The Log's "30 cues" is now 28.
  - **Still open before this card is fully signed off (acceptance item 3):** Sami's ear and his N-key answer. There is no /sounds page yet (FK-159 and FK-160 are Backlog), so the coordinator runs the check after FK-159 lands. Or, at the next rebuild, Sami A/Bs the blips on /?stream=1 (old build against new) and answers the N-key question above. Record his answer in "Sami's answer" above.
  - **Follow-ups (from review):**
    - FK-163: when it changes the effects' bus (a duck stage, extra automation, another level), it relaxes the twin pin in audio-voice.test.ts and the "beside it" assertion in audio-replay.test.ts in the same change, through Sami's Approve, together with the `AS_APPROVED` rename if the hash moves then. Don't edit the record to match.
    - FK-163/FK-166: rig() in audio-voice.test.ts and buses() in audio-replay.test.ts tell the two sfx-level buses apart by what is wired in at set-up (the engines' drone feeds the effects' bus, nothing feeds the voices'). If the drone moves or something else is wired in at set-up, the voice guard can't find its buses. Harden them to find the voice bus as the gain speech() connects into.
    - Review saw 1 failing test in 1 of 8 full `npm test` runs on the loaded box (the audio files passed every time; not captured which test). If the coordinator sees it again, name it from the run's output.

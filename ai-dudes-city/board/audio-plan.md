> Copied into the board by the coordinator on 2026-10-24 from the audio lead's plan (/tmp/fk-staging/audio-plan.md), unchanged below this note. Card ids: A1–A24 are FK-157 to FK-180 in order; A25 is FK-181 (Medieval), FK-182 (Industrial, plus Modern's PA call) and FK-183 (Wasteland); A26 is FK-184 and FK-185; A27 is FK-186. The story sound cards FK-126, FK-135 and FK-140 also moved to Lane S. Two changes from the plan: /sounds is a static page built into public/ (no src/server/** route), and Approve is an admin action through /admin/api (BOARD.md → Conflicts resolved).

# Finders Keepers — audio audit and plan (audio lead, 2026-10-24)

## 1. Audit
- **Signal chain (`client/dudes/audio.ts:65-110`):** three buses (music ×0.32, sfx ×0.7, ambience ×0.5) feed a master (0.9), then a compressor (−14 dB, 6:1), then the output. A 1.6 s noise reverb is mixed in at 0.22. Everything uses `Math.random`, so nothing is reproducible yet.
- **Music (:168-214):** 86 BPM. Electric-piano maj7/m7 chords on 4 progressions, re-picked every 16 bars, with a 35% chance of a key change. Walking bass, brushed drums, and a pentatonic vibraphone in bars 4–7 of every 8. Scheduled 0.4 s ahead on a 100 ms tick (:256).
- **Ambience (:216-253):** birds every 2–8 s, a 260 Hz hum, a fountain near the square, and the car drone (which is on the sfx bus).
- **Triggers, all in client/dudes/main.ts** (effects.ts, dudes.ts and operator.ts never call audio):
  - speech :762 (the Mayor uses the low voice)
  - built :766
  - doorbell :773
  - fanfare :774/:779
  - sting :780
  - hammer :793
  - beds :805
  - bray :809
  - pew :829/:964/:976
  - boom :966/:969/:975 (combat.ts:242, caravan.ts:425)
  - thud :957/:967/:970/:978
  - coins/play/burst/bonk :972–977
  - The splash and lit-bomb effects make no sound.
- **Levels:** sound is on for the stream page and off on /mayor unless `?sound=1`. URL base levels are music 0.5, sfx 0.8, ambience 0.6.
  - /mayor keys (operator.ts:274-281): M toggles music, N toggles effects, -/= step the music level. They send `{t:'audio'}`, which mayor.ts:196 stores (persisted at state.ts:497).
  - main.ts:755-758 `hear()` applies those levels on the stream page.
  - N also mutes the blips and the ambience. There is no separate control for voice, UI, master or scenes.
- **Gaps:**
  - Nothing varies by age.
  - Scenes have no sound of their own: cinema() at main.ts:698 does camera, letterbox and subtitles only. Music plays on at full level during scenes, subtitle lines make no blips, the restyle is silent, and doorbell/sting/fanfare can fire mid-scene.
  - The bass (44–110 Hz), the kick (110→45 Hz) and `boom` (80→30 Hz at 0.35) are inaudible on phones, but they still pump the compressor, which ducks the blips.

## 2. Protecting the speech blips
- **Where they come from:**
  - `speech()` at audio.ts:293-307, plus `tone()` (:124-150), the sfx bus gain (:81), the `gap()` throttle (:271-277) and `near()` (:116-121).
  - Called from main.ts:762 with `seedOf(id)` (:752) and `emoteNames(text)`.
- **Why they work:**
  - One syllable per word, clamped to 2–7.
  - Each syllable lasts 70–130 ms with a 10 ms attack and an exponential decay.
  - Base pitch is 230 + (seed%9)×22 Hz; the Mayor's is 150 + (seed%9)×8 Hz. Each syllable jitters ×0.85–1.30 and glides ×1.25 or ×0.82.
  - Triangle wave at 0.07 gain plus a sine an octave up at 0.025, dry (no reverb), with energy at 200–1000 Hz (phone-friendly).
  - 400 ms throttle per speaker, and quieter with distance.
- **Risks:**
  - Blips share the sfx bus, so ducking effects or pressing N also ducks speech, and booms pump the compressor.
  - Cast pitch changes every age, because traveller ids hash `name:age` (caravan.ts:166).
  - No cap on simultaneous blips, and only 9 base pitches.
  - A perspective camera passing NaN `half` to `listen()` gives NaN gain, which makes `exponentialRampToValueAtTime` throw.
- **The guard (M1, before anyone touches audio):**
  - `scripts/audio-voice.test.ts` uses a fake AudioContext and a seeded `Math.random`, so audio.ts needs no change. It pins:
    - the pitch formula for all 9 seeds, normal and low;
    - the syllable clamp, durations and gaps, wave types, gains, attack, glides, dry routing and the 400 ms throttle;
    - golden events for 5 lines;
    - the effective gain;
    - that `near()` stays finite.
  - It fails if the golden hash changes without a matching entry in `client/dudes/audio-approved.json`. Only Sami's Approve on the sound board writes that file.
- **Board rule:** "Speech blips are Sami's. Any change to speech(), tone(), seedOf, the voice or sfx bus gain, the compressor, or anything that mutes, ducks, caps or replaces voices needs a sound-board link and Sami's Approve. Agents never edit the golden file."

## 3. The plan
- Keep the same scheduler and warm maj7 harmony in every age; swap instruments, tempo and beds.
- Two motifs never change: **gold** is a bright brass/bell fanfare; **red** is Wren's 3-note bone-whistle call.

| Age | Music | Beds | Call |
|---|---|---|---|
| Stone | 76 BPM: marimba/log chords, hand drums, bone flute, bass an octave up | river, fire, birds | log drum ×2 |
| Bronze | 80 BPM: lyre arpeggios, frame drum, finger cymbal | market, anvil | gong |
| Medieval | 84 BPM: lute, recorder, tabor, drone | bell tower, hooves | church bell |
| Industrial | 92 BPM: honky-tonk piano, tuba bass | steam, clank | factory whistle |
| Modern | today's tune, untouched (the reference) | today's beds | PA ding-dong |
| Wasteland | 70 BPM: sparse wobbly electric piano, slides, no hats | wind, crows, no birds | clanged pipe |

The age restyle crossfades the music over 2 bars.

**Scene scoring**
- **The Bell:** the age's call ×2, then the music thins to a pulse.
- **Gathering walk:** patter that grows with the number of walkers, and a murmur (filtered noise at 300–1500 Hz, wobbling ~5 Hz, never blips) that swells as they arrive. At the scene start: music −6 dB, drums out.
- **Unveiling:**
  - A drumroll that loops while Tab is held.
  - The reveal: roll cut, 400 ms gap, then the tarp whoomp (swish plus a 150 Hz body), the fanfare and a cheer.
  - Hero shot: a soft vamp.
  - Crowd: murmur plus blips; RATE IT ticks pitched by value, at most 3/s.
  - Wren pivot: hard-cut the music (≤150 ms) to wind and river, then her line, dry.
  - The music comes back on a downbeat.
- **Rally:**
  - Opens with her whistle.
  - Bed: the town tune −12 dB and lowpassed, fire crackle, and her motif on the age's instrument.
  - Each "us" plays a pluck that climbs the scale.
  - "Meanwhile…": a tuba bwomp, then a hard cut to the cheerful town tune at full level, mid-bar.
  - Scatter: a pizzicato scurry.
- **Intro flashback:**
  - The Stone tune band-passed to 400–3k Hz, in mono, 3% slower, with vinyl crackle. The Chief uses the low voice.
  - Creak, creak, splash and collapse, then silence, then "...Still fine" and a bwomp.
  - At NOW: the crackle stops and full sound swells in. The two panels each get their motif.
- **Last Light:**
  - The party is muffled: all non-voice audio lowpassed at 400 Hz and −10 dB, over room tone.
  - At L4: a lamp-snuff, then **6 s of true digital silence on every bus, including voice**.
  - The ASH card gets a struck-bowl tone. The restyle rises on a reverse swell into Wren's motif in Medieval instruments.
  - Candle window: each chat line plays a glass tone from one pentatonic chord, at most 4/s, over a pad. These replace the blips here (needs Sami's approval).
- **Rising:**
  - Wind and a drone. "ONE SEAT" gets a deflated trumpet blat.
  - Trial: each Folly's age motif plus a rope-cinch per knot. Friends of the Boss: a gold march and a cheer.
  - The count: toms at 120–250 Hz plus a click, speeding from 70 to 120 BPM. Each crossing gets a side pop, the last 10 s tick, and a drumroll covers the 8 s grace.
  - Endings: A is Wren's motif with the full band and a mid-band launch roar. C is a thin Overseer fanfare, then creak and splash. B is a quiet, warm return of the music.

**UI, on a `ui` bus with peaks ≤ −24 dBFS**
- NOW card: a two-note chime.
- Board bars: a note at 25, 50, 75 and 100% only. The ticker is silent.
- Joining a side: a pop, at most 1 per 3 s.
- Defection: a two-note flip, at most 1 per 1.5 s, summed.

**Pets**
- Voices matched on the blueprint name: bark, meow, cluck, baa, moo (with mid harmonics), quack, whinny, roar, robot beeps, plus the existing bray.
- The nearest pet makes a sound every 10–25 s, at most 1 per 6 s town-wide. Pets sometimes answer their owner.
- Never reuse `speech()` for pets.

**Mixing**
- Buses: music, ambience, sfx, ui, cue, and a **voice bus split out of sfx at the same gain**. The guard test proves the split changes nothing.
- A mix stage on top of the user levels, so M and N still work:
  - scenes: music −6 dB, ambience −4 dB;
  - Mayor slot: music −10 dB plus a −3 dB dip at 2–4 kHz;
  - any blip: music −3 dB for 250 ms.
- During scenes, drop or queue feed sounds, hammering, birds, pets and the bray.
- Phones: a 50 Hz highpass before the compressor and a −1 dBTP limiter. Every cue must be recognisable above 300 Hz; any sub content needs a partner at 200 Hz or above.
- Loudness relative to the blips (0 LU):

  | Layer | Target |
  |---|---|
  | Music | −10 to −12 LU |
  | UI | −8 LU |
  | Ambience | −14 LU |
  | Fanfare | at most +3 LU |
  | Whole game | at least 10 dB under Sami's voice |
  | Stream | ≈ −14 to −16 LUFS |

- **OBS:** a sidechain compressor on the browser source keyed by Sami's mic (≈4:1, −30 dB, 5 ms attack, 300 ms release).
- Reveals are one clean sound event. Silences are exact zeros.

## 4. Resources
1. **Sound board at `/sounds`.** A local-only page bundled by build-client.mjs that imports audio.ts. It has:
   - every cue;
   - a speech tester (line, cast voice or seed);
   - a crowd tester (6 or 15 talkers);
   - each age's music in each mix state;
   - meters;
   - a phone toggle (300 Hz–8 kHz, mono);
   - an A/B against the approved version;
   - an **Approve** button. Agents can't hear, so Sami's click is the review.
2. **Offline render.** `createAudio` takes an injectable `{ctx, rand}`; the guard proves the blips are unchanged.
   - `scripts/audio-render.mjs` (playwright-core plus the ~/gs-tools Chrome) renders every cue and 32 bars of each age's music through OfflineAudioContext to WAV.
   - It also writes JSON: peak, true peak, RMS, approximate LUFS, the share under 150 Hz, clips and a silence check.
   - `npm run audio:check` fails on clipping or off-target levels.
3. **`docs/audio-levels.md`**, generated: cue, bus, trigger, peak, LU vs the blips, rate limit, allowed scenes, phone share, date approved.
4. **Regression tests:**
   - the voice golden;
   - cue fingerprints against the approved file;
   - a mix table per scene and shot (silences are 0; voice is never ducked);
   - the rate limiters;
   - the key-to-level mapping.
5. **For Sami:** an OBS checklist ("Control audio via OBS", the sidechain), and listening to a recorded test on his phone.

## 5. Cards
Review on every card: Sami listens on :4600/sounds and clicks Approve. "Bible #n" is item n in the story bible's §9 build-plan table.

**M1: See it**

| Card | Size | Needs | Files | Done when |
|---|---|---|---|---|
| A1 Speech-blip guard, approval file and board rule | ½d | — | scripts/audio-voice.test.ts, client/dudes/audio-approved.json | npm test is green; changing 0.07→0.08 fails it |
| A2 Injectable ctx/rand in createAudio | ½d | A1 | — | golden unchanged; the stream sounds the same |
| A3 Sound board v1 (all cues, speech, crowd, meters, phone toggle) | 1d | A2 | client/sounds/*, build-client.mjs, src/server/http.ts | — |
| A4 Approve button and fingerprints | ½d | A3 | local-only route | — |
| A5 Offline render, audio:check, baseline level table | 1d | A2 | — | — |
| A6 Voice bus split and N-key decision | ½d | A1 | audio.ts, main.ts, operator.ts | — |

**M2: Stream 1: Stone**

| Card | Size | Needs | Notes |
|---|---|---|---|
| A7 Mix director with scene suppression | 1d | bible #2, #3 | — |
| A8 Scene cue track (`sounds:[{at,cue}]`, fires once per stable scene id despite holds) | ½d | bible #2, #3 | scenes.ts, main.ts |
| A9 Age music styles, Stone flavour, restyle crossfade | 1d | A2 | Modern's fingerprint stays identical |
| A10 Stone ambience (river, fire, birds gated by age) | ½d | A9 | — |
| A11 Bell, gathering walk, murmur | 1d | bible #5, A7 | — |
| A12 Unveiling score | 1d | bible #3, #6, #9, A8 | — |
| A13 Whistle, rally bed, us-plucks, Meanwhile, scatter | 1d | bible #4, A8 | — |
| A14 Intro sound | 1d | bible #13, A8 | — |
| A15 UI sounds (NOW, Board milestones, side pop) | ½d | bible #7, #8 | — |
| A16 Phone pass | ½d | A5 | — |
| A17 Pinned cast voice seeds | ½d | bible #11, A1 | Sami picks by ear |
| A18 Crowd voice cap (≈4 per 300 ms) | ½d | bible #6, A3 | Sami's ear mandatory |
| A19 OBS sidechain and loudness check | ½d | — | done with Sami |

**M3: Bronze ready**

| Card | Size | Needs |
|---|---|---|
| A20 Bronze style and gong | 1d | A9 |
| A21 Last Light sound | 1d | Last Light card, A7 |
| A22 Candle tones (Sami approves) | ½d | candle-window card |
| A23 Defection pops | ½d | Defection Window card |
| A24 Pet voices | 1d | A3 |

**Later:** A25 Medieval/Industrial/Wasteland styles (1d each); A26 Rising sound (2×1d); A27 trial motifs and march (½d).

# FK-165 · Age music: the Stone style and the restyle crossfade

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-158](FK-158-injectable-audio-context.md), [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-161](FK-161-offline-render-and-levels.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-166](FK-166-stone-ambience.md), [FK-176](FK-176-bronze-music-gong.md), [FK-181](FK-181-medieval-music.md), [FK-182](FK-182-industrial-music.md), [FK-183](FK-183-wasteland-music.md) |

## Why (what changes for viewers or Sami)

Nothing varies by age: the Stone age plays the same lounge electric piano as Modern. Each age should sound like its age while staying the same warm town.

## Scope

- The music scheduler (audio.ts:168-214) takes a style per age (instruments, tempo, drums, beds) on the same scheduler and the same warm maj7 harmony.
- **Modern = today's tune, untouched.** Its fingerprint must stay identical: it is the reference.
- **Stone:** 76 BPM; marimba / log chords, hand drums, a bone flute; the bass an octave up so it reads on phones.
- The two motifs never change: gold is a bright brass/bell fanfare; red is Wren's 3-note bone-whistle call (FK-126). Each style can play both on its own instruments.
- The age restyle crossfades the music over 2 bars.
- Story ON only: with Story OFF every age keeps today's tune (Story OFF = today's game).
- /sounds: an age picker that plays 32 bars of each finished style in each mix state, with an A/B against Modern.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays Stone and Modern, A/Bs them, hears the 2-bar crossfade, and approves Stone.
- [ ] Modern's fingerprint matches its approved one; with Story OFF the stream sounds the same.
- [ ] audio:check: Stone's music sits −10 to −12 LU under the blips, with no clips and the bass audible above 150 Hz.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render 32 bars of Stone and of Modern; read levels.json; the fingerprint test.

## Notes and risks

- Audio plan A9. Bronze is FK-176; Medieval, Industrial and Wasteland are FK-181 to FK-183.
- If a second Lane S agent runs the music track in M2 (BOARD.md → M2 lane order), the styles go in a new client/dudes/music.ts, with a ≤10-line hook in audio.ts.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

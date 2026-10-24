# FK-126 · Story sounds 1: Wren's whistle and the Call bell

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | XS (≤ 2 h) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md), [FK-157](FK-157-speech-blip-guard.md) |
| Unblocks | [FK-026](FK-026-rally-v1.md), [FK-031](FK-031-m1-demo.md), [FK-135](FK-135-story-sounds-2.md), [FK-167](FK-167-bell-walk-murmur.md), [FK-169](FK-169-rally-sound.md) |

## Why (what changes for viewers or Sami)

Every rally opens on Wren's bone whistle, and every Call needs a sound that says "come here". audio.ts only has fanfare- and boom-type sounds.

## Scope

- client/dudes/audio.ts (Lane S's): `whistle` (Wren's 3-note bone-whistle call, about 0.8 s: red's motif, which never changes) and `bell` (one warm bell, about 1.5 s), synthesised like the existing fanfare (no audio files, no new dependencies) and levelled with the fanfare.
- A `?debug=sfx` console line for every cue played (`sfx whistle`), which later Lane S cards reuse.
- The triggers are ≤10-line hook requests: an optional `sound: 'whistle' | 'bell'` on a scene shot (Lane A, src/shared/scenes.ts, unless FK-001's contracts already carry it; FK-164 later reads it as a one-entry `sounds` track), and the play calls where the stream page starts a shot and where the Call banner (FK-021) shows (Lane C, main.ts / show.ts; C applies it after FK-021 lands and before FK-026).

## Acceptance criteria

- [ ] Story (dev) → Gather rings the bell once; Play: Rally opens on the whistle.
- [ ] Nothing new plays with Story OFF.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] Once FK-159 and FK-160 are up, both cues are on :4600/sounds and Sami approves them at the M1 check-in.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done), with Story ON in /admin → Story (dev): the page console (`?debug=sfx`, read through shot.mjs) shows `sfx whistle` / `sfx bell` at the right moments; Sami listens at the check-in.

## Notes and risks

- Critic fix 7 and 15. Moved from Lane C to Lane S on 2026-10-24 (audio.ts is Lane S's now). Day 2 in Lane S's M1 plan, once FK-001 lands; FK-026 (day 6) needs it.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161, once it lands), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

# FK-160 · Approve on /sounds, and cue fingerprints

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-159](FK-159-sound-board.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-135](FK-135-story-sounds-2.md), [FK-163](FK-163-mix-director.md), [FK-164](FK-164-scene-cue-track.md), [FK-165](FK-165-age-music-stone.md), [FK-171](FK-171-ui-sounds.md), [FK-172](FK-172-phone-pass.md), [FK-173](FK-173-cast-voices.md), [FK-174](FK-174-crowd-voice-cap.md) |

## Why (what changes for viewers or Sami)

Sami's click is the review, because agents can't hear. Approve records what he heard, and the fingerprints make any later change he hasn't heard fail the tests.

## Scope

- **Fingerprints:** each cue's event list under a fake context and a seeded random (FK-157's machinery), hashed. New scripts/audio-cues.test.ts fails when a cue's hash differs from its entry in client/dudes/audio-approved.json; cues with no entry yet are listed, not failed, until Sami approves them.
- **/sounds** shows, for the voices and for each cue: "approved <date>", "changed since approval" or "not approved yet", and an **Approve** button. At Approve the page also keeps a render of the cue in the browser (IndexedDB), and an **A/B** button plays it against the current version.
- **The write:** Approve calls a new admin action `audio-approve` {kind: 'voice' | 'cue' | 'mix', name, hash} through /admin/api, so it sits behind the existing operator guard (src/server/http.ts:87) with no server change. The action is registered in src/worlds/ai-dudes/index.ts's admin actions (a ≤10-line hook into Lane A's file) and calls a new Lane S module, src/worlds/ai-dudes/audioApproval.ts, which validates (name ≤ 40 characters, hex hash, file ≤ 64 KB) and writes client/dudes/audio-approved.json with `by: "Sami"` and the date. The page sends the operator token the way /admin does (client/admin/main.ts:14-19).
- **The flow:** Sami clicks Approve on 4600 → the main checkout's client/dudes/audio-approved.json changes → the coordinator commits it on main at the check-in ("audio: Sami approved …") → the lanes rebase. Agents never edit the file.

## Acceptance criteria

- [ ] On :4600/sounds Sami clicks Approve on the voices and on the cues he likes; the page shows "approved" and the date; the coordinator commits the file on main.
- [ ] A/B plays the approved render against the current one.
- [ ] Changing a cue in a scratch copy makes scripts/audio-cues.test.ts fail and name the cue.
- [ ] Approve without the operator token, from an untrusted address, is refused.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm test`; the scratch-copy check, reverted.
- On 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done): call the action with the admin token, check the worktree's JSON changed, then `git checkout -- client/dudes/audio-approved.json` in your own worktree. Never commit a test approval.

## Notes and risks

- Audio plan A4. Lane A applies the index.ts hook. On M1 day 4 Lane A is on FK-019 (critical path): if the hook would delay it, A applies it after FK-019 lands and Lane S tests against a local patch meanwhile.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

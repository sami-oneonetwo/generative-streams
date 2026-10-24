# FK-160 · Approve on /sounds, and cue fingerprints

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Review |
| Owner | lane S agent, 2026-10-24 |
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

- 2026-10-24, lane S agent: picked up.
- 2026-10-24, lane S agent: **done, ready for review** on fk-s (e938b14 + a34c172, rebased on main ed95965; not landed). `npm run typecheck` green; `npm test` 357 tests, 357 pass (340 on main + 17 new: 5 in scripts/audio-cues.test.ts, 11 in scripts/audio-approve.test.ts, 1 in scripts/audio-voice.test.ts). FK-157's voice hash is unchanged (fd4fb174…f5a2da).
  - **Fingerprints** (client/sounds/prints.ts, run by the tests and by the page alike): each cue in CUES plays on the fake from seed 160 with the page clock still and the audio clock 2 s in. Its record holds three things: its own events; the chain it sounds through (its bus and level, the reverb and its 0.22 send back, master, compressor, and for a bed its source and filter, node by node and named by role or path, so a node added elsewhere renames nothing); and a digest of every buffer it plays (the reverb tail, the noise). A placed cue plays at the camera and 15 m out. The record is hashed with a hand-written sha-256, because 4600 is plain http and browsers keep crypto.subtle for secure pages; a test checks it against node:crypto for 0-200 bytes, UTF-8 and the FIPS vectors. Cost: about 1 s for all 28 cues plus the voices.
  - **scripts/audio-cues.test.ts**: one test per approved cue, named after it ("doorbell: the cue Sami approved on …"). A changed cue fails with both hashes, the rule, and its record written to /tmp. `AUDIO_CUE_RECORDS=<dir>` writes every record so a change can be diffed. Cues not approved yet are listed as a diagnostic, not failed (28 of 28 today). An approval whose cue no longer exists is listed too.
  - **Scratch-copy check** (/tmp/fk-s-scratch160, never committed; rerun with /tmp/fk-s-scratch160/mutate.sh). doorbell, fanfare, beds:fountain and music were approved there through approve(), then audio.ts was changed one thing at a time:
    - doorbell gain 0.07 → 0.08: only doorbell fails, and the message names it. Diffing the two records shows the single `["#1","gain.exponentialRampToValueAtTime",0.07 → 0.08,0.025]` row.
    - reverb send back 0.22 → 0.25: doorbell, fanfare and music fail.
    - reverb tail exponent 2.6 → 2.8 (buffer only): doorbell, fanfare and music fail.
    - noise ×0.9 (buffer only): fanfare, beds:fountain and music fail.
    - fountain filter 1800 → 2000 Hz: beds:fountain fails.
    - effects bus ×0.7 → ×0.6: doorbell, fanfare and beds:fountain fail.
    - music bus ×0.32 → ×0.3: music fails.
    - Controls fail nothing: an unapproved cue (bray) made louder, and an unchanged copy.
  - **The blips on the board**: FK-157's golden() and its rig moved into client/sounds/voiceRecord.ts, so the page fingerprints the voices exactly as the guard does. The guard's pins still make the sound the stream's way (createAudio() making its own context from window.AudioContext). A new pin checks that the board's way (the fake handed in as an offline context) gives the same record, and that the page's sha-256 matches node's. scripts/audio-fake.ts moved to client/sounds/fake.ts, which gained an OfflineAudioContext-like suspend(). The approval file's format is shared by the server and the page in a new src/shared/audioApproved.ts (Lane S's new file): one approval a line, names sorted, the committed file reads back byte for byte, and keys other cards add later (FK-173's castVoices) are kept.
  - **The write**: src/worlds/ai-dudes/audioApproval.ts adds the admin action `audio-approve`. Its value is the JSON `{kind, name, hash}`; the input is text, 200 characters at most.
    - It refuses a kind that isn't voice, cue or mix; a name that isn't a letter then up to 39 of `\w:.-` (so no `__proto__`); a voice approval not named `speech`; a hash that isn't 64 lower-case hex; an unreadable file; and a file over 64 KB. A refusal writes nothing.
    - It writes `by: "Sami"` and the server's local date atomically, then refreshes public/sounds/approved.json, the copy the board reads through express.static. A hash already approved is a no-op.
    - The Mayor's aide can't call it (not on its ALLOWED list, which a test checks).
    - It is not behind the Story switch: it changes nothing in the game.
  - **The guard**, tested on a real express mount of operatorGuard + makeAdminRouter (the way http.ts mounts /admin/api):
    - without ADMIN_TOKEN: X-Forwarded-For, a foreign Host, a cross-origin Origin and Sec-Fetch-Site cross-site each get 403; this machine gets 200;
    - with a token: none and a wrong one get 401, the right one gets 200;
    - a refusal leaves the file untouched.
  - **/sounds**: under every cue tile, the voices ("The blips, all ten voices, approved as one") and the tune and birds toggles there is a row with "approved 24 Oct", "changed since approval" or "not approved yet", plus Approve and A/B.
    - Approve renders the sound first (OfflineAudioContext at 48 kHz from the fingerprint's seed, trimmed to −90 dBFS, kept as 16-bit in IndexedDB), then POSTs /admin/api/action. It sends the operator token the way /admin does: a token field in the header that opens itself on a 401 or 403, with the refusal in a toast.
    - A/B plays the kept render (A · approved), then the sound now rendered the same way (B · now), through the board's output, so the phone filter and the meter apply.
    - A test shows each cue's render asks for exactly its fingerprint's events.
    - Approved items this browser keeps no render of, whose hash still matches (the FK-157 blips), are rendered and kept in the background, so their A/B works too.
    - Only approve.ts talks to the server; the board test now says so.
  - **On 4616** (fk-demo.sh s, stopped afterwards), all shots in /tmp/fk-shots/lane-s/:
    - curl as this machine gave 200 and the worktree's audio-approved.json gained the line, the served copy matched, and the log read "audio: Sami approved the cue bray …".
    - Through the tunnel (X-Forwarded-For), with a foreign Host, and from the box's own untrusted address 10.62.9.16 (with or without a made-up token): 404 from the tunnel guard, which answers before the operator guard does. Cross-origin: 403. A bad hash: 409 with its reason. The file was unchanged each time.
    - From the page, Approve on doorbell turned it to "approved 24 Oct" with A/B (fk160-4616-doorbell-approved.png). The page's hash, 4fb526824ee5…, is the one the test computes: audio-cues.test.ts passed "doorbell: the cue Sami approved".
    - Then I served a board built from the scratch copy with doorbell at 0.08. It read "changed since approval", and A/B played A then B (fk160-4616-changed2-before-ab.png, -ab-A.png, -ab-B.png). The kept render is 1.86 s with a −27.8 dBFS peak; B measured −27.2 dBFS on the meter.
    - A refused Approve (a 401, as a server with a token answers) opened the token field and showed the reason (fk160-4616-refused.png).
    - Phone layout: fk160-phone-cues-look.png.
    - Afterwards I ran `git checkout -- client/dudes/audio-approved.json` in the worktree and rebuilt public/ from source. No test approval is committed.
  - **Hooks** (≤10 lines, marked `// hook FK-160`):
    - src/worlds/ai-dudes/index.ts (Lane A), 2 lines: the import, and `audioApproveAction<DudesState>()` after `...storyDevActions()`. I applied it myself, and the rebase onto FK-018 only needed both import lines kept.
    - scripts/build-client.mjs (Lane C), 1 line: `PAGES['client/dudes/audio-approved.json'] = 'public/sounds/approved.json'`.
    - No server change: http.ts and admin.ts are untouched.
  - **For the coordinator / Sami:**
    - The action also shows in /admin → Other actions as "Sound board: record Sami's Approve (sent by /sounds)", with a text field, since that panel lists every action. If you'd rather hide it, that is a one-line CURATED hook in client/admin/main.ts (Lane A).
    - On a desktop the cue tiles grew a status row, so the Cues card now scrolls past the fold at 1080p.
    - Sami: after the rebuild, Start on :4600/sounds and click Approve on the voices row and on each cue you like. client/dudes/audio-approved.json in the main checkout gains a line per click, for the coordinator to commit ("audio: Sami approved …").

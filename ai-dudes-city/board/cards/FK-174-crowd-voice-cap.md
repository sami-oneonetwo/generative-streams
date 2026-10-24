# FK-174 · Crowd voice cap

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-159](FK-159-sound-board.md), [FK-160](FK-160-sound-approve-and-fingerprints.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Nothing caps simultaneous blips. In a 15-person crowd shot every line blips at once, which turns to mush and pushes the compressor.

## Scope

- At most about 4 new voice onsets per 300 ms, town-wide. Extras are dropped, nearest and on-screen speakers kept first; the Mayor and the cast are never dropped.
- /sounds: the 15-talker crowd capped and uncapped side by side, with the cap (3, 4 or 5) selectable.
- Speech-blip rule: this caps voices, so Sami's ear is mandatory. It lands only with his Approve and the number he picks.

## Acceptance criteria

- [ ] On :4600/sounds Sami A/Bs the crowd, picks the cap and approves.
- [ ] A single speaker's golden hash is unchanged; a rate-limiter test passes.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the 15-talker crowd capped and uncapped; compare peaks and clips in levels.json.

## Notes and risks

- Audio plan A18.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

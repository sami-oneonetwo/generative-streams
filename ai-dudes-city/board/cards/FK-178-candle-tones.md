# FK-178 · Candle tones

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-091](FK-091-candle-window.md), [FK-163](FK-163-mix-director.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

In the candle window (FK-091) every chat line lights a candle for Ash; a soft glass tone per line makes chat's grief audible.

## Scope

- For the 40 s window, each chat line plays a glass tone from one pentatonic chord, at most 4 a second, over a soft pad.
- The tones replace the blips during the window. That replaces voices, so it is Sami's call under the speech-blip rule: if he says no, the blips stay and the tones play under them.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the window with 6 and with 15 lines and approves (or picks "blips stay").
- [ ] On 4600 the candle window plays it.
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- A rate-limiter test; render the window.

## Notes and risks

- Audio plan A22.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

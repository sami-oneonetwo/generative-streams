# FK-177 · The Last Light sound

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-089](FK-089-last-light-1.md), [FK-090](FK-090-last-light-2.md), [FK-140](FK-140-story-sounds-3.md), [FK-163](FK-163-mix-director.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

Ash's death is the season's quietest scene; the sound carries most of it.

## Scope

- L2 (FK-089): the party outside is muffled: all non-voice audio low-passed at 400 Hz and −10 dB, over room tone (FK-140's `muffle`).
- L4 (FK-090): a lamp-snuff, then **6 s of true digital silence on every bus, voices included**. Muting the voices falls under the speech-blip rule, so it needs Sami's Approve.
- L5, the ASH card: a struck-bowl tone.
- L6: the restyle rises on a reverse swell into Wren's motif on Medieval instruments (lute and recorder; FK-181 reuses them).

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the Last Light chain and approves it, the 6 s silence included.
- [ ] On 4600, Play: Last Light in both branches: the muffle, the silence, the bowl, the swell.
- [ ] The render shows exact zeros on every bus for the 6 s.
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain; read the silence check in levels.json.

## Notes and risks

- Audio plan A21.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

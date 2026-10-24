# FK-184 · The Rising sound 1: staging and the count

| | |
|---|---|
| Milestone | Later |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-114](FK-114-rising-staging.md), [FK-115](FK-115-rising-count.md), [FK-164](FK-164-scene-cue-track.md), [FK-171](FK-171-ui-sounds.md) |
| Unblocks | [FK-185](FK-185-rising-sound-2.md) |

## Why (what changes for viewers or Sami)

The Rising's count is the season's vote; it needs tension that chat can hear speeding up.

## Scope

- Wind and a drone under C1; "ONE SEAT" (FK-114) gets a deflated trumpet blat.
- The count (FK-115): toms at 120–250 Hz plus a click, speeding from 70 to 120 BPM; each crossing plays a side pop (FK-171's, rate-limited); the last 10 s tick; a drumroll covers the 8 s grace.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the staging and the count and approves.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the chain; a rate-limiter test for the pops.

## Notes and risks

- Audio plan A26 (two cards).
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

# FK-179 · Defection pops

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-092](FK-092-defection-window.md), [FK-171](FK-171-ui-sounds.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

In the Defection Window (FK-092) every crossing is news; a small flip makes it land without drowning the scene.

## Scope

- On the ui bus (FK-171): each crossing plays a two-note flip (gold → red falls, red → gold rises), at most 1 every 1.5 s; crossings inside that time sum into one fuller flip.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays single and summed flips and approves.
- [ ] On 4600, two testers cross within a second: one fuller flip.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- A rate-limiter test; render.

## Notes and risks

- Audio plan A23.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)

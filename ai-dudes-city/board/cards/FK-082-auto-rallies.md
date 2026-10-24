# FK-082 · Automatic rallies

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-026](FK-026-rally-v1.md), [FK-037](FK-037-beat-queue.md) |
| Unblocks | [FK-083](FK-083-rally-live-facts.md), [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

From stream 2 Wren really does plot behind his back: no prompt, no veto.

## Scope

- story/beats.ts fires a rally when all hold (bible §5): 2+ chatters awake; no scene for 10+ min; no rally for 20 min; the head 30+ m from Wren's fire; Sami hasn't typed in 20 s; no camera focus mode.

## Acceptance criteria

- [ ] On $PORT a rally fires by itself under those conditions and never otherwise.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with a sped-up clock in the test harness.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

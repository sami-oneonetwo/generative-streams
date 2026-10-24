# FK-093 · The Verdict 1: red handprints or a gold wing on the Folly

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-023](FK-023-folly-site-server.md), [FK-094](FK-094-verdict-variants-design.md), [FK-141](FK-141-verdict-decision.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-117](FK-117-trial-montage.md) |

## Why (what changes for viewers or Sami)

Deeds stay visible: each age's winning side changes the Folly for good.

## Scope

- Draw each Folly's verdict from `city.story.verdicts` (FK-141): red → FK-094's handprint recolour map on the Folly, gold → the wing part added. Both persist into every later age; earlier Follies keep theirs.
- The decision, Kit's badge, the plaza spot and the VERDICT card are FK-141.

## Acceptance criteria

- [ ] Both outcomes on `$PORT`; the paint or wing persists into the next age.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

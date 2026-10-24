# FK-096 · Gold shifts and wages

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-023](FK-023-folly-site-server.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

Gold gets comfort: wages for Folly shifts from Bronze on.

## Scope

- `gold`/`help` from a gold chatter starts a Folly shift that speeds the timer and pays coins; the name goes on the plaque.

## Acceptance criteria

- [ ] A gold shift moves the Folly and pays the chatter.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

# FK-046 · Kit follows the head and copies his poses

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md) |
| Unblocks | [FK-111](FK-111-kits-badge.md) |

## Why (what changes for viewers or Sami)

Gives Sami a live scene partner for five streams.

## Scope

- From the Crossing on: Kit re-paths every 1 s to 1.5 m behind the head at 3 m/s, snaps over if > 30 m behind, and copies the head's emote after 0.6 s.

## Acceptance criteria

- [ ] Sami walks and poses on /mayor; Kit trails and copies.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with /mayor open; one shot.

## Notes and risks

- First on the cut list if M2 runs late.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

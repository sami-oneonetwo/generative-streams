# FK-141 · The Verdict 2: the call, Kit's badge, the plaza spot, the card

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-023](FK-023-folly-site-server.md), [FK-048](FK-048-age-turn-stone.md) |
| Unblocks | [FK-093](FK-093-verdict.md), [FK-099](FK-099-bronze-rehearsal.md), [FK-144](FK-144-moss-knots-kit-hat.md) |

## Why (what changes for viewers or Sami)

Deeds stay visible: at every age turn the side that leads the tally changes the world. Split out of FK-093.

## Scope

- At the age turn: the side leading the age's tally (ties go red) is saved in `city.story.verdicts` (FK-001, max 6).
- Kit's badge off (red) or polished (gold); red also reserves the plaza spot for Wren's next build.
- The VERDICT: RED / GOLD card (FK-138's look) between the cliffhanger and the standings card.

## Acceptance criteria

- [ ] Both outcomes on `$PORT`; the verdict survives save and load; ties go red.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test plus `$PORT` with test names on each side.

## Notes and risks

- Critic fix 18 (split of FK-093).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

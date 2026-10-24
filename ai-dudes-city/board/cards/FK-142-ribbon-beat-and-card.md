# FK-142 · Reusable ribbon beat and the SHE WON'T FORGET card

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-021](FK-021-show-hud.md), [FK-048](FK-048-age-turn-stone.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md), [FK-148](FK-148-medieval-age-turn.md), [FK-149](FK-149-industrial-age-turn.md) |

## Why (what changes for viewers or Sami)

He cuts the ribbon on every Wonder chat built (bible §2, the head's constants), and Bronze ends on SHE WON'T FORGET (§3).

## Scope

- Extract FK-048's Furnace ribbon into `ribbonBeat(wonder, cueLines)`: the head on his mark at the Wonder, the ribbon cut, a Mayor slot ("My idea!"). Used by the Keep (L1), the Steam Engine, the Power Station, the Launch Tower and the rocket.
- The Bronze cliffhanger card SHE WON'T FORGET after the candle window.

## Acceptance criteria

- [ ] Stone's age turn still plays the same; Bronze's L1 uses the beat; the card shows after the candle window.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT` (shot list and exact lines added when promoted).

## Notes and risks

- Critic fix 19.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

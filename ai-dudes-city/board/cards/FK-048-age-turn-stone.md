# FK-048 · Stone age turn: ribbon, cliffhanger, standings, same cast

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-012](FK-012-sides.md), [FK-014](FK-014-cast-persists.md), [FK-017](FK-017-show-runtime.md), [FK-021](FK-021-show-hud.md), [FK-035](FK-035-holds-and-mayor-slots-server.md) |
| Unblocks | [FK-050](FK-050-home-through-ages-card.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-141](FK-141-verdict-decision.md), [FK-142](FK-142-ribbon-beat-and-card.md) |

## Why (what changes for viewers or Sami)

Stream 1 ends on a hook, and Bronze opens with the same people.

## Scope

- The Chief cuts the Furnace ribbon: "My idea!" Ash lies by the fire and doesn't get up. Wren: "He'll be better by the bronze days." Moss: "Hm."
- Standings card: "Tonight: red 9, gold 6. Kev crossed twice."
- The age turns with the cast kept (FK-014) and the Folly unrestyled.

## Acceptance criteria

- [ ] Story (dev) → Play: Age turn ends stream 1; Bronze opens with the same five cast ids and the Big Hut standing.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT only (it changes the age).

## Notes and risks

- The standings card follows FK-138's look once it lands; the ribbon becomes FK-142's reusable beat in M3.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

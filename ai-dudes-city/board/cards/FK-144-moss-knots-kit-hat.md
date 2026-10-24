# FK-144 · Moss's knots and Kit's little blue hat

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-016](FK-016-apply-stone-cast-looks.md), [FK-141](FK-141-verdict-decision.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

Two small marks that carry the run: Moss ties one knot per Folly, and Kit wears a tiny blue copy of the Boss's hat from the Crossing on (design-system.md §6).

## Scope

- Moss's cord shows one knot per standing Folly (count `object.folly`), readable in a close-up.
- Kit's hat: the head's hat silhouette at ×0.5 in Kit's blue #2F6FD0, following the hat ladder (FK-064); his gold badge on or off from FK-141.

## Acceptance criteria

- [ ] Close-up shots show the knot count and the hat.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT` close-ups after `set-age bronze`.

## Notes and risks

- Critic fix 19. If M2 has slack, pull the hat forward: design-system.md §6 has it from the Crossing on.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

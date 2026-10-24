# FK-128 · Cast renames and the daughter clean-up

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-014](FK-014-cast-persists.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-173](FK-173-cast-voices.md) |

## Why (what changes for viewers or Sami)

Nobody else in town may be called Wren, Ash or Oak, and the old "Toma / Ama" daughter must not talk over Wren. Split out of FK-014.

## Scope

- With Story ON drop Toma / Ama (caravan.ts:87, 98, 102: `DAUGHTER`, `daughterTitle`) and the new-band greetings; leave `city.daughter` alone.
- The `name-daughter` admin action (index.ts:1815) refuses with "Story is on: Wren is the daughter" (≤10-line hook, Lane A).
- Rename clashing NPCs: "Wren" in TOWNIE_NAMES (city.ts:77), Minstrel Wren (caravan.ts:89), Ashur the Boatman (caravan.ts:88), Mr Ashby (caravan.ts:90), Road Boss Mara (caravan.ts:92); the street "Oak Street" (src/shared/city.ts:44) → "Alder Street".

## Acceptance criteria

- [ ] No townie or traveller is called Wren, Ash* or Oak*.
- [ ] `name-daughter` refuses with Story ON and works as today with Story OFF.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test over every name table; on `$PORT`, /admin → name-daughter with Story ON and OFF.

## Notes and risks

- Renaming Oak Street changes the addresses on that street; only Sami's lot is claimed today.
- Critic fix 18 (split of FK-014).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)

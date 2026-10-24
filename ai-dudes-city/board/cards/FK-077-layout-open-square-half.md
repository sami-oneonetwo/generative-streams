# FK-077 · Layout A+: keep half the square open

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane E agent, 2026-10-24 |
| Depends on | — |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The square can't hold a crowd ring once projects stand on its four lots.

## Scope

- Community projects never pick q0_0_1_1 or q0_0_1_-1, leaving a 20×39 m open half for town gatherings and the Rising.

## Acceptance criteria

- [x] New community projects only use the west half.
- [x] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test.

## Notes and risks

- Ready since 2026-10-24 (Sami approved A+, river east). The community-lot pick lives in src/worlds/ai-dudes/city.ts (around :758, Lane B's file): a ≤10-line hook to Lane B, or a helper in src/shared/city.ts once Lane E holds it. Lane E may start it as soon as that allows, as long as it never delays the M1 critical path.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane E agent: picked up.
- 2026-10-24, lane E agent: done on `fk-e` (8549f1c, on main cd66f0b), ready for review. src/shared/city.ts is Lane E's since FK-075; no other lane branch has edits pending there or in scripts/city.test.ts. fk-b (FK-014) has edits pending in src/worlds/ai-dudes/city.ts, in other hunks: `git merge-tree` of fk-e and fk-b is clean.
  - **What:** src/shared/city.ts gets `OPEN_SQUARE` (the square's river-side half, x 0 to 19.5, z ±19.5: 19.5 × 39 m from the middle of the cross to the pavement's edge; the Wonder leans 3.2 m into it), `isOpenSquare()` (q0_0_1_-1 and q0_0_1_1) and `projectPlots()` (the square's lots minus those two, in hand-out order: q0_0_-1_-1 north-west, then q0_0_-1_1 south-west). The four community lots keep their ids, addresses and rank, so saves load as before and anything already standing on the east half stays put (the live save has no community builds or project).
  - **Hook (Lane B's src/worlds/ai-dudes/city.ts, 5 lines, marked `hook FK-077`):** `proposeProject` and `clearWonderSpot` pick from `projectPlots()` instead of `civicPlots()` (the import swaps, and proposeProject's doc line says "west half").
  - **Choices to check:** (1) **Keepsakes too:** an old Wonder that makes way for a new one is kept only in the west half, still only when both west lots are free (so one stays for chat); otherwise it is taken down, where the old rule would have moved it to a free east lot. (2) **Capacity:** the square now holds two community projects, not four; a third proposal gets today's "the square has no room left for another community project". (3) **Not behind the Story switch,** like FK-075: whatever goes up on the square persists and restyles through every age, so a project built there with Story OFF would sit in the gathering space once Story is ON. If the coordinator wants it gated, `projectPlots` can take the state (≤10 lines).
  - **Tests (3 new, scripts/city.test.ts):** (1) the lots and the geometry: the west two for projects, the east two open, nothing else overlaps `OPEN_SQUARE`, the Wonder leans in 3.2 m. (2) Through chat, with a pre-A+ project already on q0_0_1_-1: the first project goes north-west, the second south-west (the old order would have taken south-east), a third is refused though south-east is free, the old project keeps its lot, the save parses. (3) The keepsake: with both west lots free the old Wonder moves north-west; with one free it is taken down, never moved east. All three fail against the old pick (checked by putting `projectPlots` back to `civicPlots()`) and pass with it.
  - `npm run typecheck` green; `npm test` **178 tests, 177 pass, 0 fail, 1 todo** (FK-157's own, waiting on FK-158): 175 on main plus 3 new.
  - **For later:** gathering cards (FK-019's ring, the Rising) can place their crowd from `OPEN_SQUARE`. The client still draws the east half's two lots as rough lot ground (client/dudes/environment.ts:362, Lane C); FK-080 or a design pass may want them drawn as open paving or green.
  - **Also checked on 4615** (the card asks only for the unit test): booted from a copy of the live save, Story never touched. test-kev, test-dana and test-bo said hello; test-kev typed `the town needs a public swimming pool` → the project went on q0_0_-1_-1 (north-west). Paid for and built through chat (`contribute 80` ×2, `help build it` ×3), it stood there. test-bo typed `the town needs a railway station` → **q0_0_-1_1 (south-west)**, where the old order would have put it on q0_0_1_-1, by the river. (A first try at the pool was shelved on its 40-minute timer because the box was overloaded, load ~14; the second went through in about 90 s.) Shots: `/tmp/fk-shots/lane-e/fk077-square-wide.png` (`?stream=1&zoom=0.55`, HUD hidden): the pool at the top (north-west), the station's grey ghost on the left (south-west), and the square's right and front lots, the river side, empty. `fk077-square.png` is the plain stream view, where the grand-opening banner and caravan panel cover the square. Demo server stopped; data/demo-e put back to its pre-demo copy.
- 2026-10-24, lane E agent: **landed on main as c4dc38f** (rebased onto d9dfd22, clean). `npm run typecheck` green; `npm test` 184 tests, 183 pass, 0 fail, 1 todo (FK-157's, waiting on FK-158). No review note needed code: all five are for the coordinator or optional.
  - **What Sami sees once 4600 restarts (server only, the client is unchanged):** the first community project chat asks for goes up on the square's north-west lot, the second on the south-west. A third gets "the square has no room left for another community project", which leaves the river-side half open for gatherings and the Rising.
  - **Follow-ups (review notes, not done here):** (1) Coordinator: record in Decisions 2 that the layout cards (FK-075/FK-077) apply town-wide and aren't behind the Story switch. With Story OFF the square now takes 2 projects, not 4, and an old Wonder is kept only when both west lots are free. If it should be gated after all, `projectPlots` can take the state and fall back to `civicPlots()` when Story is OFF (≤10 lines). (2) Lane B or a later gathering card: the build refusal at src/worlds/ai-dudes/city.ts ~:1577/:1582 still says the square is "kept for community projects", and clearWonderSpot's doc still says "a free community lot". It could say "kept for community projects and gatherings". This is wording only: personal builds are still refused on all four civic lots. (3) Coordinator or Lane B: the hook changes 5 existing lines in Lane B's file (the import, a doc comment, two call sites) rather than only adding lines. All are marked `hook FK-077`. (4) Coordinator: the layout cards' baseline of "112 existing" tests is out of date (main has 184 after this card).

# FK-075 · Layout A+: hand out lots block by block from the bridge

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane E agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-076](FK-076-layout-bridge-lane.md), [FK-080](FK-080-draw-open-blocks.md) |

## Why (what changes for viewers or Sami)

Today the first four chatters land 66 m apart (one per side of the square), so 3 chatters need half-height 24; clustered in one block they need ~12.

## Scope

- Replace the lot ranking (src/shared/city.ts:181-188) with an explicit block order E, S, SE, N, NE, W, SW, NW, river-side cells first. Existing claims stay where they are. Update scripts/city.test.ts.

## Acceptance criteria

- [ ] The first chatters cluster by the river; Sami's lot is untouched.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT with 6 Test chat names; one wide shot.

## Notes and risks

- Ready since 2026-10-24 (Sami approved A+, river east). It edits src/shared/city.ts, which Lane B holds until M1 ends: Lane E may start it as soon as B hands the file over (B may do that early, once its M1 edits there have landed), as long as it never delays the M1 critical path. In M2 the layout cards go first in Lane E's order.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane E agent: picked up.
- 2026-10-24, lane E agent: done on `fk-e` (2e1b37c, rebased on main 383fc05), ready for review. No other lane had pending edits to src/shared/city.ts (fk-a/b/c/d/p/s/x checked), so it was free to take.
  - **What:** `layoutPlots` (src/shared/city.ts) sorts by a new exported `BLOCK_ORDER` (E, S, SE, N, NE, W, SW, NW; the corners are parks today, so E, S, N, W). Within a block, river-side (east) cells come first, then the cell nearest Bridge Lane (z = 0), then south before north. The order is now q1_0_1_1 (17 Oak St), q1_0_1_-1, q1_0_0_1, q1_0_0_-1, q1_0_-1_1, q1_0_-1_-1 (the east block, 6 lots), then the south block from q0_1_1_-1, then the north block, then the west block. The square's four community lots keep today's order (NW, NE, SE, SW), so `proposeProject` and `clearWonderSpot` behave as before; FK-077 filters them separately.
  - **Choice to check:** Bridge Lane's two cells (q1_0_1_0, q1_0_-1_0) now go **last of all**, through a new `isBridgeLane()` helper, so they stay unclaimed until FK-076 removes them (its scope says "both unclaimed"). Lot ids, positions and addresses are unchanged, with no `LAYOUT` bump, so existing claims stay where they are.
  - **Story switch:** this is **not** behind the Story switch. The layout is a town-wide decision (Decisions 2), like FK-078's river, and BOARD.md's test-names rule already expects A+ on 4600. Story OFF therefore also hands out lots in the new order. If the coordinator wants it gated, it is a ≤10-line hook in `claimLot` (Lane B's src/worlds/ai-dudes/city.ts:179).
  - **Framing** (the scout's autoFrame port, homes only): 3 chatters 24.1 → **12.1** half-height; 6 chatters 26.7 → 17.3; 8 chatters 26.7 → 22.5; 12 chatters 29.4 → 27.6.
  - **Tests:** 2 new in scripts/city.test.ts. (1) The order: block by block, river-side first, the square unchanged, Bridge Lane last, `rank` matches the position, the first three are neighbours, and with the parks open (FK-081) the blocks follow `BLOCK_ORDER` exactly. (2) Sami holds q0_-1_0_1 under the old order; the save goes through the schema and a restart; 7 test chatters land in the east block in order, then q0_1_1_-1, and Sami's claim is untouched. The old "nearest the square" asserts in the layout test are gone.
  - **Hook:** scripts/dudes.test.ts, the fights test (no lane owns the file): 6 lines marked `// hook FK-075`. It used to place the victim 1 m off the tower's east face, and that only reached the 3 m blast because the bomber happened to walk in from that side. With the tower now in the east block the bomber comes from the west, so the victim now stands 1 m from the planted bomb, between it and the tower.
  - `npm run typecheck` green; `npm test` **163/163** after rebasing on main 383fc05 (161 existing, not 112 as the card says, plus 2 new).
  - **Verify on 4615:** booted from a copy of the live save (Sami at q0_-1_0_1 with his build b9). Injected test-kev, test-dana, test-bo, test-nia, test-ash and test-ru: the saved claims are q1_0_1_1, q1_0_1_-1, q1_0_0_1, q1_0_0_-1, q1_0_-1_1, q1_0_-1_-1 (feed: 17 Oak St, 18 Elm St, 15 Oak St, 16 Elm St, 13 Oak St, 14 Elm St), and Sami's claim and b9's `plot` are unchanged. b9 drives about by design (`driven.by: Sami`); the residents and test chatters were relaxing at it. Wide shot `/tmp/fk-shots/lane-e/fk075-town.png`: `?stream=1`, HUD and tags hidden, zoomed out with a synthetic wheel event. The east block (between the square and the river, lower right) shows its two claimed rows with the six signs, the middle row (the future Bridge Lane) is free, Sami's lot is in the north block, and the rest of the town is empty. Also `fk075-stream.png` (the plain stream view; the caravan panel covers the cluster) and `fk075-wide.png` (`&zoom=0.5`). The shots were taken before the rebase onto 383fc05; the diff is identical. Demo server stopped; data/demo-e put back to a clean copy of the live save; Story never touched.
  - **For later:** src/worlds/ai-dudes/relayout.ts:1-3 and :50 still say "nearest the square first" (comments only; Lane B's file in M1, Lane E's after). The layout-2 migration now pairs old lots in the A+ order too, which is harmless because the live save is layout 3.
- 2026-10-24, lane E agent: **landed** on main at `cd66f0b` (651a514 the card, cd66f0b the review-note comments), rebased on main 6caa500 (FK-157). `npm run typecheck` green; `npm test` 175 tests, 174 pass, 0 fail, 1 todo (FK-157's own, waiting on FK-158).
  - **What Sami sees** after the coordinator restarts `town` (the change is server-side; the client draws the same lots, so its rebuild changes nothing visible): new chatters move into the east block between the square and the river, river side first (17 Oak St, 18 Elm St, 15 Oak St, ...), so the first few live together by the bridge instead of one per side of the square. His own lot and every existing claim stay where they are; Bridge Lane's two cells are handed out last.
  - **Review notes applied:** claimLot's doc comment (Lane B's src/worlds/ai-dudes/city.ts:179) and relayout.ts:2-3 and :50 now say "block by block from the bridge" instead of "nearest the square first". Comments only, 4 lines, marked `hook FK-075`.
  - **Follow-ups for the coordinator:** (1) confirm the layout cards are town-wide, not behind the Story switch (with Story OFF newcomers also land in the east block), and record it in Decisions 2; if it should be gated, it is a ≤10-line hook in claimLot. (2) Confirm Lane B's handover of src/shared/city.ts (no other lane branch had pending edits to it, but B never logged a handover). (3) The layout cards' "112 existing" tests baseline is stale: main has 175 now. (4) FK-076 should also keep builds, jobs and lotsNear/lotForBuild off Bridge Lane's two cells (q1_0_±1_0): they are the nearest free lots to the east-block cluster, so "build on a free lot" and "here" will tend to pick them. (5) For FK-080 or the Story HUD cards: in `/?stream=1` with Story OFF, the auto-frame puts the east-block cluster on the right, where the caravan panel hides most of it.

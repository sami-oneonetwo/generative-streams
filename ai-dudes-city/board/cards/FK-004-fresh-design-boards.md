# FK-004 · Fresh design boards for Sami

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane X agent, 2026-10-24 |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | — |
| Design spend (openai/gpt-6-astra only) | $0 (+ $0.55 optional critique-boards) |

## Why (what changes for viewers or Sami)

Sami asked to look at the designs. The boards he has (design/out/rfinal2/board-life.png, design/out/ofinal/outfits-board.png) still show the old pastel Future; he has never seen the shipped Wasteland on a board.

## Scope

- Re-render builds as round rfinal3 and outfits as round o4 from the shipped kits (src/shared/ages.ts, client/dudes/agePieces.json), all six ages, one labelled board per set.
- Optional `critique-boards` ($0.55). Attach a one-paragraph crisp / playful / consistent note per board, using the audit in board/design-system.md §1.

## Acceptance criteria

- [ ] Two PNGs (design/out/rfinal3/, design/out/o4/) show all six ages including the shipped Wasteland.
- [ ] The audit note names the top 3 fixes, each pointing at an FK card.

## How to verify

- Read both PNGs; the coordinator posts them to Sami.

## Notes and risks

- Render only; no generation.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane X agent: picked up.
- 2026-10-24 lane X agent: **both acceptance criteria pass; ready for review** on fk-x (3a13294, rebased on cd66f0b, not landed). Typecheck green; `npm test` 181: 180 pass, 0 fail, plus main's one TODO (FK-158's NaN-gain test). 6 of them are new, in scripts/design-boards.test.ts.
  - **The two boards for Sami** (I read both): **design/out/rfinal3/board-life.png** (people and example builds, 2772×2253) and **design/out/o4/outfits-board.png** (what people wear, 1224×3181). Each has six age rows, Stone to the shipped **Wasteland** (no pastel Future), a label under the title (round, date, "as shipped: …") and its audit note printed underneath. Both render deterministically: a second render came out byte-identical.
  - **From the shipped kits:** new `--shipped` flag on design/render.mjs and render-outfits.mjs (design/shipped.ts). It reads the world rules from src/shared/ageBibles.json, the town's pieces from client/dudes/agePieces.json (without the 13 ground slabs the town draws itself) and the kits from src/shared/ageOutfits.json. The people columns are now the town's own rigged figures (design/board/people.ts): two townsfolk in the first two everyday kits (`dressFor`), the head in the age's head look and head kit (as mayor.ts `headLook` draws him), the leader in the leader kit. Before this, board-life drew concept figures that never shipped: its Wasteland head was "Overseer of the Salvaged Keys", but the game's is "Overseer of the Four Lots". The example builds (home, café, skyscraper, dog, car) are still samples from the design prompt, and the label says so. I also exported design/spec in a /tmp sandbox: it is byte-identical to all three shipped JSONs, so nothing is waiting to be exported.
  - **Labelled:** the outfits board is now at two-thirds size (it was half), with every kit named under its own pair. Each pair has a role line (EVERYDAY / THE HEAD / CARAVAN LEADER) and a name of at most two lines. The names drop the garment list, because the export cuts it at 60 characters, often mid-word. The ground fills every row the same way, and the old board's unreadable 8 px labels are gone. Captions on board-life wrap to two lines.
  - **Audit notes** (design/out/rfinal3/note-board-life.txt and design/out/o4/note-outfits-board.txt; any `note-<board>.txt` beside a board is printed under it). Each has one crisp / playful / consistent paragraph built on design-system §1 and astra's critique, then the top 3 fixes:
    - board-life: (1) the head wears gold, never red, plus a gold sash and the hat ladder → **FK-064**; (2) an ink outline so Stone and Wasteland people stand out from the mud → **FK-063**; (3) the design prompt's 25% roof/wall lightness gap, no story red or gold as a main colour (the red hatchback), Wasteland builds in the A/B so they read as the Modern town rebuilt → **FK-070**.
    - outfits: (1) **FK-064**; (2) **FK-063**; (3) with Story ON the leader's slot is the band (Ash, then Wren in locked red), dressed by **FK-006** (Stone), FK-086 (Bronze) and FK-100 to FK-103. The generic leaders stay as they are, so Story OFF is today's game.
  - **Optional critique-boards, done:** two capped `critique-image` runs with `DESIGN_BUDGET_USD=173.2862` (spend + $0.82, so no single call could take the card past 2× its ceiling): board-life **revise 6/10** ($0.195) and outfits-board **revise 6/10** ($0.173). The gate came back phone ✗, colours ✗, story colours ✗, funny ✓ on both. The critiques are critique-board-life.json and critique-outfits-board.json beside the PNGs. **Card spend $0.368** (ceiling $0.55); programme spend is now **$172.83**. I used critique-image rather than the old `critique-boards` subcommand: that one reads r<round>'s three boards uncapped at high effort and can't see an outfits board.
  - **For the reviewer:** (1) astra wants Wren's red on the generic caravan leaders. I didn't take that: the leader slot becomes the band only with Story ON (cast cards), and the note says so. (2) Astra flags red on everyday people. That red is the sample chatter's own shirt (#c4402f, the same sample people as ofinal), which the kits take on, and the notes say so. Whether a red-shirted chatter should read as Wren's side with Story ON is a question for FK-064 or the coordinator. (3) Only the two boards are committed. The full round would be about 60 MB of cells and sheets. `node design/render.mjs final3 --shipped --only board-fabric` gives the shipped town-fabric board if Sami wants it too (I checked that board-fabric and board-vignettes render in shipped mode; those scratch renders are deleted). (4) design/board/main.ts isn't in tsconfig's include. I typechecked it with a /tmp tsconfig (green); people.ts and shipped.ts go through `npm run typecheck` via the new test.
  - **How to verify:** read the two PNGs above. For the coordinator to post to Sami: the people-and-builds board, then the outfits board.
- 2026-10-24 lane X agent: **landed on main at d9dfd22** (3a13294 + review notes d9dfd22, fast-forward from cd66f0b). Typecheck green; `npm test` 181: 180 pass, 0 fail, 1 TODO (main's FK-158 NaN-gain test). No new spend (re-renders only); card spend stays **$0.368**.
  - **What Sami can see now:** two boards to open, design/out/rfinal3/board-life.png (people and example builds, now 2772×2102) and design/out/o4/outfits-board.png (what people wear, 1224×3181). Both show all six ages through the shipped Wasteland, each with its review note and 3 fixes. No game change, so 4600 needs no restart or rebuild for this card. The coordinator posts the PNGs.
  - **Review notes applied (d9dfd22):** (1) The kit names on the outfits board have 14×scale of padding a side (was 6), so neighbouring names no longer run together ("Hearthkeeper in the Folded Shoulder Hide" / "Young Ridge Scout" and "Short-Vest Salvage Runner" / "Overseer of the Four Lots" now have a clear gap). No name is cut. (2) The board-life note's Crisp sentence is corrected. The builds keep their contrast in greyscale; the brown-on-brown problem is the people, the Stone people most of all and then the Wasteland's. (3) On a board wide enough for two 900 px columns, the review note is set in two columns: the paragraph on the left, the top 3 fixes on the right. The board-life note now fills the width (the outfits board stays one column). (4) BOARD_DATE=YYYY-MM-DD on render.mjs or render-outfits.mjs pins the date in the label, so a board re-renders byte-identical on another day. Both boards were re-rendered with BOARD_DATE=2026-10-24. (5) The noteBlock comment is re-wrapped to the file's width.
  - **Follow-ups for the coordinator:** (a) **FK-064 scope or a Decision:** may a chatter wear story red at all once FK-064 locks #B3262E out of restyling? On these boards, the red on everyday people and on every caravan leader is the first sample chatter's own shirt (people.ts SAMPLES[0], #c4402f). The reviewer accepted it for this round. For future boards, draw the leader on SAMPLES[1] or give SAMPLES[0] a non-story hue, so that red on a board only ever means the story. (b) **FK-070 scope:** if you accept fix 3 on board-life, add "include Wasteland builds in the A/B" (its current scope is 15 builds per arm, with no ages named). (c) **Accept the critique swap:** the card named `critique-boards`, but I ran two capped `critique-image` runs instead ($0.368 against the $0.55 ceiling). `critique-boards` only reads a round's three r-boards, uncapped at high effort, and can't see the outfits board. (d) The 15 px grey captions on board-life still need a zoom on a phone. That is cosmetic, and it was the same on rfinal2.

# FK-003 · Design pipeline repair

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane X agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-004](FK-004-fresh-design-boards.md), [FK-006](FK-006-stone-cast-looks.md), [FK-007](FK-007-the-big-hut.md), [FK-008](FK-008-camp-and-rally-fire-dressing.md), [FK-034](FK-034-intro-art.md), [FK-068](FK-068-stone-life-design.md), [FK-070](FK-070-design-prompt-tuning.md), [FK-071](FK-071-pet-designs.md), [FK-085](FK-085-golden-me.md), [FK-097](FK-097-red-job-props.md), [FK-100](FK-100-medieval-design-pack.md), [FK-101](FK-101-industrial-design-pack.md), [FK-102](FK-102-modern-design-pack.md), [FK-103](FK-103-wasteland-design-pack.md) |
| Design spend (openai/gpt-6-astra only) | $0 (≤ $0.30 for the critique smoke test) |

## Why (what changes for viewers or Sami)

No design can be reviewed until the renderers work on this box. Every design card depends on this one.

## Scope

- design/render.mjs:8 and design/render-outfits.mjs:8 load playwright from ../../noodle-shop (missing here) and launch channel:'chrome'. Port both to the ~/gs-tools playwright-core + SwiftShader setup that shot.mjs uses.
- Fix WORLD in design/astra.ts:136 (says 22 m lots in a 3×3 grid of eight-lot blocks): 12 m lots, blocks of eight lots round a courtyard, corner parks (src/shared/city.ts:9-37).
- New astra subcommands: `folly <age>`, `cast <age>`, `pets`, `critique-image <png>` (the existing critique prompt on any PNG). Model stays `openai/gpt-6-astra` (design/astra.ts:28).
- Do NOT touch src/shared/ageBibles.json here: that changes live in-game builds (it is FK-070).

## Acceptance criteria

- [ ] `node design/render.mjs` re-renders an existing sheet (rfinal2 board-life) to a new PNG on this box.
- [ ] `critique-image` on that PNG returns a score and problems for ≤ $0.30.

## How to verify

- Read the re-rendered PNG; `tail -3 design/out/spend.jsonl` shows the critique cost.

## Notes and risks

- Budget rule for every astra run: `DESIGN_BUDGET_USD = spend so far (sum of design/out/spend.jsonl, $171.92 today) + this card's ceiling`. Programme cap $240 without Sami.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane X agent: picked up.
- 2026-10-24 lane X agent: built on fk-x (commit f139c67, not landed). Typecheck green, `npm test` 129/129 (13 new in scripts/design-story.test.ts).
  - **Renderers:** new design/browser.mjs launches playwright-core from ~/gs-tools and the newest chrome-headless-shell under ~/.t3/tools with SwiftShader, the same setup as shot.mjs. render.mjs and render-outfits.mjs both use it. render.mjs also gets `--only <names>` (it still draws everything but saves only those). `node design/render.mjs fk003 --only board-life` re-rendered the people board in 29 s to design/out/rfk003/board-life.png. I read it: all six ages, with the shipped Wasteland row (rfinal2 still shows the old Future). render-outfits also renders (checked on a scratch round, not kept). design/out/board.js was rebuilt from today's client code.
  - **WORLD** now lives in design/catalogue.ts and is built from src/shared/city.ts: 12 m lots, 4 home blocks of 8 lots round a courtyard, 4 corner parks, 141 m across, a 14 m river. I also fixed the free-lot brief's stale "16 m lot". src/shared/ageBibles.json is untouched (that is FK-070).
  - **New subcommands** (data and checks in design/story.ts; each takes `--notes "…" [--image png]` to revise instead of starting over):
    - `folly <age> [1 2 3]`: three takes at high effort into spec/folly/<age>.json, and `folly <age> pick <n>`. Each take has hero `tag`s and a `heroes` index, and is checked for room, required tags, and gold/red only on the allowed tags.
    - `cast <age> [roles…]`: each member is pinned on a kit shipped in src/shared/ageOutfits.json, with fixed colours, extra parts, and Moss's seat or Ash's bedroll. Scale and the hat ladder come from the catalogue. Locked-colour checks run into spec/cast/<age>.json.
    - `pets [ids…|kits] [--age]`: the eight Stone pets go through DESIGN_SYSTEM and designMessage, plus `PET_BRANCH` (the pet branch for FK-070 to ship). They get companion-spec checks. One more call makes the six age kits; everything goes to spec/pets/.
    - `critique-image <png…> [--brief] [--age] [--effort]`: the critique rubric plus the design gate. It writes critique-<name>.json beside the image.
  - **Budget:** it is now checked before every retry, and each call prints its cost. I dry-ran every new subcommand against a stubbed API in a /tmp sandbox ($0).
  - **Smoke (acceptance 2):** `critique-image` on rfk003/board-life.png returned **revise 6/10** with 8 problems: story colours leak (King's red cloak, gold caravan master, red Modern hatchback), Wasteland builds don't read as the ruined Modern, Wasteland people merge, caravan leaders unclear, and the board can't be read at 390 px. **It cost $0.365 (7,006 tokens in, 5,131 out), over the $0.30 ceiling**, because it scored all 55 pieces. Fixed in the same commit: it now lists only pieces under 8 (at most 8), runs at medium effort and is capped at 3,500 tokens out, so the worst case is about $0.28 a board. Spend is now $172.28.
  - **WAITING ON THE COORDINATOR:** proving the cap needs one more run, expected $0.15–0.20 with a worst case of $0.28. That passes this card's ceiling (the card total would be at most about $0.65). Once you OK it: `cd /home/sami/workspace/fk-wt/x/ai-dudes-city && DESIGN_BUDGET_USD=172.56 npx tsx design/astra.ts critique-image design/out/rfk003/board-life.png --brief "the people-and-builds board, ages in rows"`, then `tail -3 design/out/spend.jsonl`.
  - Not mine, so left alone: scripts/design-bakeoff.ts and scripts/smoke.mjs still load playwright from the missing ../../noodle-shop.
- 2026-10-24 lane X agent (second session): picked up. Rebased fk-x on main (fd27274), clean; the commit is now 7540df3.
- 2026-10-24 lane X agent (second session): **both acceptance criteria pass; ready for review** on fk-x (7540df3 + 86a472a, not landed). Typecheck green, `npm test` 139/139 after the rebase.
  - **Acceptance 1, re-checked after the rebase:** `node design/render.mjs fk003check --only board-life` ran in 36 s and came out byte-identical to the committed design/out/rfk003/board-life.png. I read it: six age rows (the Wasteland row is the shipped one), 8 columns, clean. `NOBUILD=1 node design/render-outfits.mjs fk003check stone` also renders (I read outfits-stone.png: the six Stone kits on rigged figures). Both scratch rounds are deleted.
  - **Acceptance 2:** I ran the capped `critique-image` under the coordinator's 2× pre-approval, with `DESIGN_BUDGET_USD=172.5188` (spend + the $0.235 left under 2×, so no retry could take the card past $0.60). It cost **$0.182** (6,943 tokens in, 1,705 out, 46 s), under the $0.30 ceiling: `tail -3 design/out/spend.jsonl` shows it. Result: **revise 6/10**, 8 problems, 8 pieces listed worst first. The pieces: Stone lodging tower 4, caravan leaders 4, Wasteland home, café and tower 5, medieval King 5, Wasteland people 6, Modern hatchback 6. Gate: phone ✗, colours ✗, story colours ✗, funny ✓. It replaces the first run's critique-board-life.json; the 55-piece version is still in 7540df3 (8d09708 on main) if FK-004 wants it. Note for FK-004 (corrected at landing): with Story ON the caravan-leader slot is the band (Ash in Stone and Bronze, then Wren), dressed by `cast` (FK-006). Don't paint the generic leaders story red, but do strip the head's gold from the generic leaders (the Medieval "Gold-and-Blue Caravan Master" and the Modern "Golden-Jacket Tour Guide"): that is the side-colour break in design-system §1 item 2.
  - **Card spend: $0.547** ($0.365 + $0.182). That is over the $0.30 ceiling but inside the 2× pre-approval. Programme spend is now **$172.47**.
  - Also fixed in 86a472a: `cleanPetKits` read each kit part's anchor from the unfiltered list, so a junk entry in astra's list shifted every anchor after it. It now filters the same way `cleanParts` does, and has a test.
  - The earlier "WAITING ON THE COORDINATOR" entry is resolved by this run. Still not mine: scripts/design-bakeoff.ts and scripts/smoke.mjs load playwright from the missing ../../noodle-shop.
- 2026-10-24 lane X agent: **landed on main at 34f0013** (fast-forward of fk-x: 8d09708, 67b4f36, 34f0013). Rebased on 31fd62c; typecheck green, `npm test` 148/148.
  - **What Sami gets:** nothing changes in the game or on 4600 (design tooling only; no client rebuild needed for this card). The design team can now render boards on this box (`node design/render.mjs <round> [--only <names>]`, `node design/render-outfits.mjs`) and run `npx tsx design/astra.ts folly|cast|pets|critique-image`, so FK-004, FK-006, FK-007 and the other design cards can start.
  - **Review notes applied in 34f0013 (design/story.ts):** Ash's brief no longer calls him "the tallest of them" (Oak is 1.25 in every age, so Ash at 1.15/1.2 can't be); it now says "tall and thin (Oak is the big, broad one)". Industrial Oak gets "an iron-headed mallet (0.35 m head)" instead of a sledgehammer, so his prop keeps one silhouette. The FK-004 note above is corrected: the band fills the caravan-leader slot, and the generic leaders lose the head's gold.
  - **PET_BRANCH uses `"moves":"roam"` on purpose**, not design-system §8 item 4's `'follow'`: FK-027 turns small roaming builds into followers, and `'follow'` would widen the saved Moves enum. FK-070 should ship `'roam'`. The code comment now says so.
  - **Follow-ups:** (1) design-system §6 still says Ash is "Tallest (1.15 / 1.2)" while Oak is 1.25: the design lead or FK-006 should either raise Ash above 1.25 or change the table's word (story.ts now goes with "tall and thin"), and §8 item 4 should say `'roam'`. (2) For later cards, size each run's `DESIGN_BUDGET_USD` so a single call can't pass the card's ceiling, as the second run here did with 172.5188. (3) design/out/board.js was built in the worktree, so its esbuild path comments read `../../../generative-streams/ai-dudes/node_modules/...`. The code is otherwise identical to a fresh build, and the next rebuild from the main checkout puts the comments back. (4) Not mine: scripts/design-bakeoff.ts and scripts/smoke.mjs still load playwright from the missing ../../noodle-shop.

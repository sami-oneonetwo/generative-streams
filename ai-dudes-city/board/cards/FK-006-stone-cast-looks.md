# FK-006 · Stone cast looks (Wren, Ash, Moss, Oak, Kit, the Chief)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Review |
| Owner | lane X agent, 2026-10-24 |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | [FK-016](FK-016-apply-stone-cast-looks.md), [FK-064](FK-064-story-colours-and-head-kit.md), [FK-086](FK-086-bronze-cast-and-adult-wren.md) |
| Design spend (openai/gpt-6-astra only) | ~$3 |

## Why (what changes for viewers or Sami)

Viewers must tell the five apart at phone size, and Wren's red must be the biggest shape in any frame she is in.

## Scope

- `cast stone` → design/spec/cast/stone.json: fixed-colour outfit kits (they skip restyleColour) plus hand-made parts over the pinned Stone kit.
- Wren: teen at scale 0.82 (today DAUGHTER_SCALE is 0.56, src/worlds/ai-dudes/caravan.ts:99); red hair cord with long tails, red-ochre shoulder hide, bone whistle; the top third of her silhouette is red.
- Ash: the tallest (1.15), grey-streaked, cream bandage on the left leg, 2.1 m carved staff, red wrist cord.
- Moss: seated on a stump, green shawl #4E8A3A, knotted cord in her lap. Oak: scale 1.25, orange apron #E8762B, mallet with a 0.35 m head. Kit: scale 0.7, plain blue #2F6FD0, 0.16 m gold badge.
- The head (Stone Chief): gold sash, hat at ×1.0 of the ladder, no red anywhere. The flashback stand-in Chief uses this Stone head kit (`headLook`, src/worlds/ai-dudes/mayor.ts:51), not MAYOR_LOOK, which is the Modern look.
- One board PNG: all six at the stream camera plus a 390 px greyscale strip.

## Acceptance criteria

- [ ] Each of the six is identifiable at 390 px in greyscale.
- [ ] Only the locked story colours from board/design-system.md §2.
- [ ] Passes the design gate (design-system.md §9).

## How to verify

- Read design/out/cast/stone-board.png.

## Notes and risks

- Engineering applies it in FK-016.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane X agent: picked up.
- 2026-10-24 lane X agent: **all three acceptance criteria pass; ready for review** on fk-x (83e9caf, rebased on 502d7b8, not landed). Typecheck green (and design/board/main.ts + astra.ts through a scratch tsconfig); `npm test` 326/326, 15 of them new in scripts/design-cast.test.ts.
  - **The board for Sami:** design/out/cast/stone-board.png (2432×2107; a copy is at /tmp/fk-shots/lane-x/fk006-stone-board.png). It shows the six at the stream camera (orthographic, 40° down, yaw 0.65) on the square's dirt, the same line-up from behind, and the phone check: the 1920×1080 stream frame at the auto camera's closest zoom (half-height 6 m), shrunk to 390 px and greyed, drawn at real size and ×3. Under each one: their name, scale, height and main colours. The design gate note is printed underneath. `BOARD_DATE=2026-10-24 node design/render-cast.mjs stone` redraws it byte-identical.
  - **The spec FK-016 applies:** design/spec/cast/stone.json. Everyone is pinned on a shipped Stone kit with their own parts over it, in fixed colours, at the catalogue's scale and body. Wren 0.82 (1.43 m), on kit 2: a red top-knot with waist-long tails, a flared split red cape, the bone whistle, and a notched tally stick under her arm. Ash 1.15 on a long body (2.27 m, the tallest): grey layered hides with a light collar, a 2.1 m crooked staff, the cream bandage with an oversized knot, the red wrist cord. Moss seated on a 0.42 m root stump: green shawl, covered knees, the counting cord with one huge knot. Oak 1.25, build 1.2 (2.02 m, the broadest): an orange hide smock and apron, the stone mallet (0.35 m head) hanging at his knee, a tiny spare mallet on his belt. Kit 0.7 (1.22 m): plain blue, the 0.16 m gold badge on a cord, a stubby copy of the Chief's staff, no hat yet. The Chief, always on his head kit in the game's head look: the gold sash hugging him, with a vain knot at the hip; hat ×1.0; no red. The flashback stand-in should use this same head kit (headLook), not MAYOR_LOOK.
  - **For FK-016:** apply `scale`, `look` (its height and build matter: they make Ash the tallest and Oak the broadest) and `outfit`; for Moss also `prop` and `seat`. `seat` is in the page's pose channels: {top 0.42, rise −0.26, legs −0.853, arms −0.6, hips −0.05}. The game's own 'sit' would leave her feet in the air (hips 0.1 m off the ground, legs straight out).
  - **Measured from the board's flat-drawn pixels** (design/out/cast/stone-measures.json; tests pin them to the committed spec's hash):
    - Wren's top third is 87% red, and red is 49% of her.
    - Each band member's locked colour is their biggest shape: Ash grey 39%, Moss green 66%, Oak orange 50%, Kit blue 50%.
    - Everyone has 4 main colours or fewer. The Chief has gold 11% and no red.
    - At 390 px, every pair differs by at least 25% in height or width (pixels tall × wide: Wren 24×16, Ash 33×19, Moss 22×27, Oak 30×28, Kit 18×12, the Chief 40×26).
  - **Gate (design-system §9): passed by me as design lead.** astra's critique-image went from revise 6/10 (round 1) to revise 7/10 (final); both are kept in design/out/cast/. It gave colours ✓, story colours ✓, phone ✗, funny ✗. My call: phone passes on silhouettes (the measures above), since astra's ✗ is about small props blurring at 18–24 px. Funny passes at close and mid shots. I did not take two of its notes: an ochre hide sash for the Chief (his gold sash is locked), and poses (a look can't set a pose). Revise rounds: 2, the cap.
  - **Pipeline changes (design/):**
    - The `cast` brief gives hero sizes in standard-figure metres (Ash's staff 1.59 m down the arm → 2.1 m on him), Wren's top third, a wider and darker seat, and what each shipped kit already wears and holds (the head and leader kits carry story gold; kits 0 and 3 carry spears).
    - `composeCast` sets the body from the catalogue, pins the head on his kit in the age's head look, and works out Moss's seat. It checks the hero sizes and accepts `colour` on prop parts: round 1's stump came out in the fallback grey because astra wrote `colour`, and a replaced colour is now a check.
    - readsRed/readsGold moved to design/colour.ts, shared with the board.
    - design/board/main.ts gains `renderCast`; `camera()` can fit a list of boxes. The FK-004 outfits board re-renders byte-identical.
  - **Design-system §6 follow-up from FK-003 (Ash "tallest" vs Oak 1.25):** resolved without changing any scale. Ash's body height is 1.15 and Oak's 0.92 (with build 1.2), so Ash stands 2.27 m against Oak's 2.02 m. design/story.ts says "the tallest of them" again.
  - **Spend: $3.67 for this card** (cast $1.00, revise 1 $1.42, revise 2 on Oak/Moss/Ash $0.89, two critiques $0.18 each), against the $3 ceiling and inside the 2× pre-approval. Every run used `DESIGN_BUDGET_USD=179.14`. Programme spend is now **$176.82**.
  - **Follow-ups for the coordinator:** (1) FK-063, the ink outline: in greyscale the locked colours sit close to the square's dirt (Oak's orange is about 1.2:1 against it), so today the silhouettes carry the phone check and the outline should lift them. (2) FK-030: judge astra's remaining notes in the game (the capes look boxy from behind; Oak's orange reads as a smock rather than an apron). (3) design-system §6 can keep "Ash: tallest"; the numbers above make it true.
